import { readProductConfig } from './product-config';
import { drawCompanyLogo } from './report-brand';
import { drawInvoicePhotoTable } from './products-invoice-table';
import { prisma } from '../lib/prisma';
import { num, r2 } from '../lib/calc';
import { notFound, badRequest } from '../lib/errors';
import { companyInfo, newDoc, drawTable, addFooters, PdfCol, PDF_COLORS, fmtNum } from './report-export';
import { iso } from './report-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export const DOC_TYPES = ['PURCHASE_ORDER', 'GOODS_RECEIPT', 'PURCHASE_INVOICE', 'SALES_QUOTATION', 'SALES_ORDER', 'DELIVERY_NOTE', 'SALES_INVOICE'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DOC_PERMISSION: Record<DocType, string> = {
  PURCHASE_ORDER: 'purchase_order',
  GOODS_RECEIPT: 'goods_receipt',
  PURCHASE_INVOICE: 'purchase_invoice',
  SALES_QUOTATION: 'sales_quotation',
  SALES_ORDER: 'sales_order',
  DELIVERY_NOTE: 'delivery_note',
  SALES_INVOICE: 'sales_invoice',
};

export function normalizeDocType(t: string): DocType {
  const k = t.trim().toUpperCase().replace(/[-\s]+/g, '_');
  if (!(DOC_TYPES as readonly string[]).includes(k)) throw badRequest(`Unsupported document type '${t}'`, { supported: DOC_TYPES });
  return k as DocType;
}

interface Party {
  name: string;
  address?: string | null;
  trn?: string | null;
  phone?: string | null;
  email?: string | null;
  extra?: string | null;
}
interface DocModel {
  title: string;
  docNo: string;
  date: Date | string | null;
  status?: string;
  partyLabel: string;
  party: Party;
  info: [string, string][];
  columns: PdfCol[];
  lines: string[][];
  productIds?: number[];
  totals: [string, string, boolean?][];
  currency: string;
  terms?: string | null;
  remarks?: string | null;
  signatures: string[];
  showCompanyTrn: boolean;
}

const m2 = (n: unknown) => fmtNum(r2(num(n)), 'money');
const q3 = (n: unknown) => fmtNum(num(n), 'qty');
const d = (v: unknown) => iso(v as Date) ?? '';

async function productMap(ids: (number | null | undefined)[]) {
  const u = [...new Set(ids.filter((x): x is number => typeof x === 'number'))];
  const rows = u.length ? await prisma.product.findMany({ where: { id: { in: u } }, select: { id: true, code: true, name: true, oemNumber: true, salesUnit: true, purchaseUnit: true } }) : [];
  return new Map(rows.map((r) => [r.id, r]));
}
const pdesc = (pm: Map<number, Any>, id: number | null | undefined, fallback?: string | null) => {
  const p = id ? pm.get(id) : null;
  if (!p) return fallback || '';
  return `${p.code} - ${p.name}${p.oemNumber ? `\nMfr Part No: ${p.oemNumber}` : ''}`;
};
const customerParty = async (id: number, override?: { trn?: string | null; address?: string | null }): Promise<Party> => {
  const c = await prisma.customer.findUnique({ where: { id } });
  return { name: c?.name ?? `#${id}`, address: override?.address || [c?.address, c?.city, c?.country].filter(Boolean).join(', '), trn: override?.trn || c?.trn, phone: c?.phone || c?.mobile, email: c?.email, extra: c?.code ? `Customer Code: ${c.code}` : null };
};
const supplierParty = async (id: number): Promise<Party> => {
  const s = await prisma.supplier.findUnique({ where: { id } });
  return { name: s?.name ?? `#${id}`, address: [s?.address, s?.country].filter(Boolean).join(', '), trn: s?.trn, phone: s?.phone, email: s?.email, extra: s?.code ? `Supplier Code: ${s.code}` : null };
};
const salesmanName = async (id?: number | null) => (id ? (await prisma.salesman.findUnique({ where: { id } }))?.name ?? '' : '');
const whName = async (id?: number | null) => (id ? (await prisma.warehouse.findUnique({ where: { id } }))?.name ?? '' : '');

const priced = (pm: Map<number, Any>, items: Any[]) => ({
  columns: [
    { label: '#', type: 'number', align: 'center', w: 3 },
    { label: 'Description', type: 'text', align: 'left', w: 28 },
    { label: 'Unit', type: 'text', align: 'center', w: 5 },
    { label: 'Qty', type: 'qty', align: 'right', w: 7 },
    { label: 'Rate', type: 'money', align: 'right', w: 9 },
    { label: 'Disc', type: 'money', align: 'right', w: 7 },
    { label: 'VAT %', type: 'money', align: 'right', w: 6 },
    { label: 'VAT', type: 'money', align: 'right', w: 8 },
    { label: 'Amount', type: 'money', align: 'right', w: 10 },
  ] as PdfCol[],
  lines: items.map((it, i) => [String(i + 1), pdesc(pm, it.productId, it.description), it.unit || '', q3(it.qty), m2(it.rate), m2(it.discount), fmtNum(num(it.vatRate), 'qty'), m2(it.vatAmount), m2(it.amount)]),
});

const SIGN_SALES = ['Prepared By', 'Authorized Signatory', 'Received By (Name / Sign / Stamp)'];

async function build(type: DocType, id: number): Promise<DocModel> {
  const co = await companyInfo();
  switch (type) {
    case 'PURCHASE_ORDER': {
      const o: Any = await prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
      if (!o) throw notFound('Purchase order not found');
      const pm = await productMap(o.items.map((i: Any) => i.productId));
      const t = priced(pm, o.items);
      return {
        title: 'PURCHASE ORDER', docNo: o.docNo, date: o.docDate, status: o.status, partyLabel: 'SUPPLIER', party: await supplierParty(o.supplierId),
        info: [['PO No', o.docNo], ['Date', d(o.docDate)], ['Type', o.orderType], ['Expected Date', d(o.expectedDate)], ['Currency', o.currencyCode], ['Payment Terms', o.paymentTerms ?? ''], ['Delivery Terms', o.deliveryTerms ?? ''], ['Deliver To', await whName(o.warehouseId)]].filter(([, v]) => v) as [string, string][],
        ...t,
        totals: [['Subtotal', m2(o.subtotal)], ['Discount', m2(o.discount)], ['VAT', m2(o.vatAmount)], ...(num(o.roundOff) ? [['Round Off', m2(o.roundOff)] as [string, string]] : []), [`Total (${o.currencyCode})`, m2(o.total), true]],
        currency: o.currencyCode, terms: o.terms, remarks: o.remarks, signatures: ['Prepared By', 'Approved By', 'Supplier Acknowledgement'], showCompanyTrn: true,
      };
    }
    case 'GOODS_RECEIPT': {
      const g: Any = await prisma.goodsReceipt.findUnique({ where: { id }, include: { items: true } });
      if (!g) throw notFound('Goods receipt not found');
      const [pm, po] = await Promise.all([productMap(g.items.map((i: Any) => i.productId)), prisma.purchaseOrder.findUnique({ where: { id: g.orderId }, select: { docNo: true } })]);
      return {
        title: 'GOODS RECEIPT NOTE', docNo: g.docNo, date: g.docDate, status: g.status, partyLabel: 'SUPPLIER', party: await supplierParty(g.supplierId),
        info: [['GRN No', g.docNo], ['Date', d(g.docDate)], ['PO No', po?.docNo ?? ''], ['Type', g.grnType], ['Supplier DN', g.supplierDeliveryNo ?? ''], ['Warehouse', await whName(g.warehouseId)]].filter(([, v]) => v) as [string, string][],
        columns: [
          { label: '#', type: 'number', align: 'center', w: 3 }, { label: 'Description', type: 'text', align: 'left', w: 32 },
          { label: 'Ordered', type: 'qty', align: 'right', w: 9 }, { label: 'Prev. Received', type: 'qty', align: 'right', w: 9 }, { label: 'This Receipt', type: 'qty', align: 'right', w: 9 }, { label: 'Unit Cost', type: 'money', align: 'right', w: 9 }, { label: 'Value', type: 'money', align: 'right', w: 10 },
        ],
        lines: g.items.map((it: Any, i: number) => [String(i + 1), pdesc(pm, it.productId), q3(it.orderedQty), q3(it.previouslyReceived), q3(it.qty), m2(it.landedUnitCost || it.unitCost), m2(num(it.qty) * num(it.landedUnitCost || it.unitCost))]),
        totals: [['Total Qty', q3(g.items.reduce((a: number, i: Any) => a + num(i.qty), 0))], ['Total Value', m2(g.items.reduce((a: number, i: Any) => a + num(i.qty) * num(i.landedUnitCost || i.unitCost), 0)), true]],
        currency: co.currency, remarks: g.remarks, signatures: ['Received By (Store)', 'Checked By', 'Supplier Representative'], showCompanyTrn: true,
      };
    }
    case 'PURCHASE_INVOICE': {
      const v: Any = await prisma.purchaseInvoice.findUnique({ where: { id }, include: { items: true } });
      if (!v) throw notFound('Purchase invoice not found');
      const pm = await productMap(v.items.map((i: Any) => i.productId));
      const t = priced(pm, v.items);
      return {
        title: 'PURCHASE INVOICE', docNo: v.docNo, date: v.docDate, status: v.status, partyLabel: 'SUPPLIER', party: await supplierParty(v.supplierId),
        info: [['Invoice No', v.docNo], ['Date', d(v.docDate)], ['Supplier Inv No', v.supplierInvoiceNo ?? ''], ['Due Date', d(v.dueDate)], ['Type', v.invoiceType], ['Currency', v.currencyCode], ['Exchange Rate', num(v.exchangeRate) !== 1 ? String(num(v.exchangeRate)) : '']].filter(([, x]) => x) as [string, string][],
        ...t, productIds: v.items.map((i: Any) => i.productId),
        totals: [['Subtotal', m2(v.subtotal)], ['Discount', m2(v.discount)], ['VAT', m2(v.vatAmount)], ...(num(v.roundOff) ? [['Round Off', m2(v.roundOff)] as [string, string]] : []), [`Total (${v.currencyCode})`, m2(v.total), true], ...(v.currencyCode !== co.currency ? [[`Total (${co.currency})`, m2(v.baseTotal)] as [string, string]] : []), ['Paid', m2(v.paidAmount)]],
        currency: v.currencyCode, remarks: v.remarks, signatures: ['Prepared By', 'Verified By', 'Approved By'], showCompanyTrn: true,
      };
    }
    case 'SALES_QUOTATION': {
      const q: Any = await prisma.salesQuotation.findUnique({ where: { id }, include: { items: true } });
      if (!q) throw notFound('Sales quotation not found');
      const pm = await productMap(q.items.map((i: Any) => i.productId));
      const t = priced(pm, q.items);
      return {
        title: 'SALES QUOTATION', docNo: q.docNo, date: q.docDate, status: q.status, partyLabel: 'QUOTATION TO', party: await customerParty(q.customerId),
        info: [['Quotation No', q.docNo], ['Date', d(q.docDate)], ['Valid Until', d(q.validUntil)], ['Salesman', await salesmanName(q.salesmanId)], ['Currency', q.currencyCode], ['Payment Terms', q.paymentTerms ?? '']].filter(([, x]) => x) as [string, string][],
        ...t,
        totals: [['Subtotal', m2(q.subtotal)], ['Discount', m2(q.discount)], ['VAT', m2(q.vatAmount)], ...(num(q.roundOff) ? [['Round Off', m2(q.roundOff)] as [string, string]] : []), [`Total (${q.currencyCode})`, m2(q.total), true]],
        currency: q.currencyCode, terms: q.terms, remarks: q.remarks, signatures: ['Prepared By', 'Authorized Signatory', 'Customer Acceptance'], showCompanyTrn: true,
      };
    }
    case 'SALES_ORDER': {
      const o: Any = await prisma.salesOrder.findUnique({ where: { id }, include: { items: true } });
      if (!o) throw notFound('Sales order not found');
      const pm = await productMap(o.items.map((i: Any) => i.productId));
      const t = priced(pm, o.items);
      return {
        title: 'SALES ORDER', docNo: o.docNo, date: o.docDate, status: o.status, partyLabel: 'CUSTOMER', party: await customerParty(o.customerId),
        info: [['Order No', o.docNo], ['Date', d(o.docDate)], ['Customer PO', o.customerPoNo ?? ''], ['Delivery Date', d(o.deliveryDate)], ['Salesman', await salesmanName(o.salesmanId)], ['Warehouse', await whName(o.warehouseId)], ['Currency', o.currencyCode], ['Payment Terms', o.paymentTerms ?? '']].filter(([, x]) => x) as [string, string][],
        ...t,
        totals: [['Subtotal', m2(o.subtotal)], ['Discount', m2(o.discount)], ['VAT', m2(o.vatAmount)], ...(num(o.roundOff) ? [['Round Off', m2(o.roundOff)] as [string, string]] : []), [`Total (${o.currencyCode})`, m2(o.total), true]],
        currency: o.currencyCode, terms: o.terms, remarks: o.remarks, signatures: ['Prepared By', 'Authorized Signatory', 'Customer Signature'], showCompanyTrn: true,
      };
    }
    case 'DELIVERY_NOTE': {
      const dn: Any = await prisma.deliveryNote.findUnique({ where: { id }, include: { items: true } });
      if (!dn) throw notFound('Delivery note not found');
      const [pm, so, ordItems] = await Promise.all([
        productMap(dn.items.map((i: Any) => i.productId)),
        prisma.salesOrder.findUnique({ where: { id: dn.salesOrderId }, select: { docNo: true, customerPoNo: true } }),
        prisma.salesOrderItem.findMany({ where: { id: { in: dn.items.map((i: Any) => i.orderItemId) } }, select: { id: true, qty: true, unit: true } }),
      ]);
      const oi = new Map(ordItems.map((x) => [x.id, x]));
      return {
        title: 'DELIVERY NOTE', docNo: dn.docNo, date: dn.docDate, status: dn.status, partyLabel: 'DELIVER TO', party: await customerParty(dn.customerId, { address: dn.deliveryAddress }),
        info: [['Delivery No', dn.docNo], ['Date', d(dn.docDate)], ['Sales Order', so?.docNo ?? ''], ['Customer PO', so?.customerPoNo ?? ''], ['Warehouse', await whName(dn.warehouseId)], ['Driver', dn.driver ?? ''], ['Vehicle No', dn.vehicleNo ?? '']].filter(([, x]) => x) as [string, string][],
        columns: [
          { label: '#', type: 'number', align: 'center', w: 3 }, { label: 'Description', type: 'text', align: 'left', w: 40 }, { label: 'Unit', type: 'text', align: 'center', w: 6 },
          { label: 'Ordered', type: 'qty', align: 'right', w: 9 }, { label: 'Delivered', type: 'qty', align: 'right', w: 9 },
        ],
        lines: dn.items.map((it: Any, i: number) => [String(i + 1), pdesc(pm, it.productId), oi.get(it.orderItemId)?.unit ?? '', q3(oi.get(it.orderItemId)?.qty), q3(it.qty)]),
        totals: [['Total Qty Delivered', q3(dn.items.reduce((a: number, i: Any) => a + num(i.qty), 0)), true]],
        currency: co.currency, remarks: dn.remarks, terms: 'Goods received in good condition and correct quantity unless noted otherwise.', signatures: ['Prepared By', 'Driver', 'Received By (Name / Sign / Stamp)'], showCompanyTrn: false,
      };
    }
    case 'SALES_INVOICE': {
      const v: Any = await prisma.salesInvoice.findUnique({ where: { id }, include: { items: true } });
      if (!v) throw notFound('Sales invoice not found');
      const pm = await productMap(v.items.map((i: Any) => i.productId));
      const t = priced(pm, v.items);
      return {
        title: 'TAX INVOICE', docNo: v.docNo, date: v.docDate, status: v.status, partyLabel: 'BILL TO', party: await customerParty(v.customerId, { trn: v.trn, address: v.address }),
        info: [['Invoice No', v.docNo], ['Date', d(v.docDate)], ['Due Date', d(v.dueDate)], ['Salesman', await salesmanName(v.salesmanId)], ['Payment Terms', v.paymentTerms ?? ''], ['Currency', v.currencyCode], ['Exchange Rate', num(v.exchangeRate) !== 1 ? String(num(v.exchangeRate)) : '']].filter(([, x]) => x) as [string, string][],
        ...t, productIds: v.items.map((i: Any) => i.productId),
        totals: [['Subtotal', m2(v.subtotal)], ['Discount', m2(v.discount)], ['Total excl. VAT', m2(num(v.subtotal) - num(v.discount))], ['VAT', m2(v.vatAmount)], ...(num(v.roundOff) ? [['Round Off', m2(v.roundOff)] as [string, string]] : []), [`Total (${v.currencyCode})`, m2(v.total), true], ...(v.currencyCode !== co.currency ? [[`Total (${co.currency})`, m2(v.baseTotal)] as [string, string]] : [])],
        currency: v.currencyCode, remarks: v.remarks, terms: 'Goods once sold are not returnable except as per our return policy. Please settle payment by the due date.', signatures: SIGN_SALES, showCompanyTrn: true,
      };
    }
  }
}

export async function renderDocumentPdf(type: DocType, id: number): Promise<{ buffer: Buffer; filename: string }> {
  const [co, m] = await Promise.all([companyInfo(), build(type, id)]);
  const { doc, done } = newDoc(false);
  doc.info.Producer = co.name;
  const config = await readProductConfig();
  const left = 36;
  const width = doc.page.width - 72;

  // header: company (left) / title (right)
  doc.font('Helvetica-Bold').fontSize(16).fillColor(PDF_COLORS.head).text(co.name, left, await drawCompanyLogo(doc, left, 28, 220), { width: width * 0.52 });
  doc.font('Helvetica').fontSize(8).fillColor(PDF_COLORS.muted);
  const addr = [co.address, co.phone ? `Tel: ${co.phone}` : '', co.email].filter(Boolean).join('\n');
  if (addr) doc.text(addr, { width: width * 0.52 });
  if (co.trn) doc.font('Helvetica-Bold').fillColor(PDF_COLORS.text).text(`TRN: ${co.trn}`, { width: width * 0.52 });
  const leftEnd = doc.y;
  doc.font('Helvetica-Bold').fontSize(18).fillColor(PDF_COLORS.head).text(m.title, left + width * 0.55, 36, { width: width * 0.45, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor(PDF_COLORS.text).text(`No: ${m.docNo}`, left + width * 0.55, doc.y, { width: width * 0.45, align: 'right' });
  if (m.status) doc.fontSize(8).fillColor(['DRAFT', 'CANCELLED'].includes(m.status) ? '#B91C1C' : PDF_COLORS.muted).text(`Status: ${m.status}`, left + width * 0.55, doc.y, { width: width * 0.45, align: 'right' });
  let y = Math.max(leftEnd, doc.y) + 8;
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1.5).strokeColor(PDF_COLORS.head).stroke();
  y += 10;

  // party + info blocks
  const colW = (width - 14) / 2;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(PDF_COLORS.muted).text(m.partyLabel, left, y, { width: colW });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(PDF_COLORS.text).text(m.party.name, left, doc.y + 1, { width: colW });
  doc.font('Helvetica').fontSize(9);
  for (const t of [m.party.address, m.party.phone ? `Tel: ${m.party.phone}` : '', m.party.email, m.party.trn ? `TRN: ${m.party.trn}` : '', m.party.extra]) if (t) doc.text(String(t), left, doc.y, { width: colW });
  const partyEnd = doc.y;
  let iy = y;
  const ix = left + colW + 14;
  doc.font('Helvetica').fontSize(9);
  for (const [k, v] of m.info) {
    doc.fillColor(PDF_COLORS.muted).text(k, ix, iy, { width: 85, lineBreak: false });
    doc.fillColor(PDF_COLORS.text).font('Helvetica-Bold').text(v, ix + 88, iy, { width: colW - 88 });
    doc.font('Helvetica');
    iy = Math.max(doc.y, iy + 12);
  }
  y = Math.max(partyEnd, iy) + 12;
  doc.y = y;

  // lines
  const body = m.lines;
  if (m.productIds && config.features.productImages) await drawInvoicePhotoTable(doc, m.columns, body, m.productIds, y);
  else drawTable(doc, m.columns, body, { fontSize: 8, startY: y, onNewPage: () => doc.page.margins.top });
  let ty = doc.y + 10;

  // totals box
  const boxW = 230;
  const needed = m.totals.length * 15 + 8;
  if (ty + needed > doc.page.height - 110) {
    doc.addPage();
    ty = doc.page.margins.top;
  }
  const bx = left + width - boxW;
  const startTy = ty;
  for (const [label, val, strong] of m.totals) {
    if (strong) doc.rect(bx, ty - 2, boxW, 16).fill(PDF_COLORS.head);
    doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 10 : 9).fillColor(strong ? '#FFFFFF' : PDF_COLORS.text);
    doc.text(label, bx + 6, ty + 1, { width: boxW / 2 - 6, lineBreak: false });
    doc.text(val, bx + boxW / 2, ty + 1, { width: boxW / 2 - 6, align: 'right', lineBreak: false });
    ty += 16;
  }
  // terms / remarks (left of totals)
  let ly = startTy;
  const noteW = width - boxW - 16;
  doc.fillColor(PDF_COLORS.text);
  if (m.remarks) {
    doc.font('Helvetica-Bold').fontSize(8).text('Remarks', left, ly, { width: noteW });
    doc.font('Helvetica').fontSize(8).text(m.remarks, left, doc.y, { width: noteW });
    ly = doc.y + 6;
  }
  if (m.terms) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(PDF_COLORS.text).text('Terms & Conditions', left, ly, { width: noteW });
    doc.font('Helvetica').fontSize(8).fillColor(PDF_COLORS.muted).text(m.terms, left, doc.y, { width: noteW });
    ly = doc.y + 6;
  }
  let sy = Math.max(ty, ly) + 28;
  if (sy + 50 > doc.page.height - doc.page.margins.bottom - 20) {
    doc.addPage();
    sy = doc.page.margins.top + 30;
  }
  const sw = (width - 20 * (m.signatures.length - 1)) / m.signatures.length;
  m.signatures.forEach((s, i) => {
    const sx = left + i * (sw + 20);
    doc.moveTo(sx, sy).lineTo(sx + sw, sy).lineWidth(0.6).strokeColor('#6B7280').stroke();
    doc.font('Helvetica').fontSize(8).fillColor(PDF_COLORS.muted).text(s, sx, sy + 3, { width: sw, align: 'center' });
  });
  addFooters(doc, `${co.name}${co.trn ? `  -  TRN ${co.trn}` : ''}  -  ${m.title} ${m.docNo}`);
  doc.end();
  return { buffer: await done, filename: `${m.title.replace(/\s+/g, '_')}_${m.docNo}.pdf` };
}
