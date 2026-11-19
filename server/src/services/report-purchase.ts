import { prisma } from '../lib/prisma';
import { num } from '../lib/calc';
import {
  ReportDef, ReportParams, Row, col, P, dateRange, iso, VALID_PURCHASE, loadLookups, Lookups, productFilterIds, warehouseFilterIds,
  pName, pCode, brandName, catName, Col,
} from './report-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const supp = (L: Lookups, id: number) => L.suppliers.get(id)?.name ?? `#${id}`;

async function invWhere(p: ReportParams, statuses: string[] | null, pids: number[] | null): Promise<Any> {
  const w: Any = {};
  if (statuses) w.status = { in: statuses };
  if (p.status) w.status = p.status;
  const dr = dateRange(p);
  if (dr) w.docDate = dr;
  if (p.supplierId) w.supplierId = p.supplierId;
  if (pids) w.items = { some: { productId: { in: pids } } };
  return w;
}

interface PLine {
  inv: Any;
  it: Any;
  net: number;
  vat: number;
}

async function loadPurchases(p: ReportParams) {
  const pids = await productFilterIds(p);
  const invs: Any[] = await prisma.purchaseInvoice.findMany({
    where: await invWhere(p, VALID_PURCHASE, pids),
    include: { items: true },
    orderBy: [{ docDate: 'asc' }, { id: 'asc' }],
  });
  const L = await loadLookups({
    productIds: invs.flatMap((i) => i.items.map((x: Any) => x.productId)),
    supplierIds: invs.map((i) => i.supplierId),
  });
  const lines: PLine[] = [];
  for (const inv of invs) {
    const rate = num(inv.exchangeRate) || 1;
    for (const it of inv.items) {
      if (pids && !pids.includes(it.productId)) continue;
      lines.push({ inv, it, net: (num(it.amount) - num(it.vatAmount)) * rate, vat: num(it.vatAmount) * rate });
    }
  }
  return { invs, lines, L };
}

function aggLines(lines: PLine[], keyOf: (l: PLine) => string, label: (l: PLine) => Row): Row[] {
  const m = new Map<string, Row & { _inv: Set<number> }>();
  for (const l of lines) {
    const k = keyOf(l);
    let g = m.get(k);
    if (!g) {
      g = { ...label(l), qty: 0, net: 0, vat: 0, total: 0, _inv: new Set<number>() };
      m.set(k, g);
    }
    g.qty = num(g.qty) + num(l.it.qty);
    g.net = num(g.net) + l.net;
    g.vat = num(g.vat) + l.vat;
    g.total = num(g.total) + l.net + l.vat;
    g._inv.add(l.inv.id);
  }
  return [...m.values()].map((g) => {
    const { _inv, ...rest } = g;
    return { ...rest, invoices: _inv.size } as Row;
  });
}

const purchaseRegister: ReportDef = {
  key: 'purchase-register',
  title: 'Purchase Register',
  group: 'Purchase',
  description: 'Posted purchase invoices with VAT, totals and amounts paid.',
  params: [P.from, P.to, P.supplier, P.product, P.brand, P.category],
  columns: [
    col('docDate', 'Date', 'date'),
    col('docNo', 'Invoice No'),
    col('supplierInvoiceNo', 'Supplier Inv'),
    col('supplier', 'Supplier'),
    col('invoiceType', 'Type'),
    col('currency', 'Cur'),
    col('subtotal', 'Subtotal', 'money', true),
    col('vatAmount', 'VAT', 'money', true),
    col('total', 'Total (AED)', 'money', true),
    col('paid', 'Paid', 'money', true),
    col('balance', 'Balance', 'money', true),
    col('status', 'Status'),
  ],
  async run(p) {
    const { invs, L } = await loadPurchases(p);
    const rows = invs.map((i): Row => {
      const rate = num(i.exchangeRate) || 1;
      const total = num(i.baseTotal) || num(i.total) * rate;
      return {
        docDate: iso(i.docDate),
        docNo: i.docNo,
        supplierInvoiceNo: i.supplierInvoiceNo ?? '',
        supplier: supp(L, i.supplierId),
        invoiceType: i.invoiceType,
        currency: i.currencyCode,
        subtotal: (num(i.subtotal) - num(i.discount)) * rate,
        vatAmount: num(i.vatAmount) * rate,
        total,
        paid: num(i.paidAmount),
        balance: total - num(i.paidAmount),
        status: i.status,
      };
    });
    if (p.groupBy === 'supplier' || p.groupBy === 'month') {
      const m = new Map<string, Row>();
      for (const r of rows) {
        const k = p.groupBy === 'month' ? String(r.docDate).slice(0, 7) : String(r.supplier);
        const g = m.get(k) ?? { group: k, invoices: 0, subtotal: 0, vatAmount: 0, total: 0, paid: 0, balance: 0 };
        g.invoices = num(g.invoices) + 1;
        for (const f of ['subtotal', 'vatAmount', 'total', 'paid', 'balance']) g[f] = num(g[f]) + num(r[f]);
        m.set(k, g);
      }
      return {
        rows: [...m.values()],
        columns: [col('group', p.groupBy === 'month' ? 'Month' : 'Supplier'), col('invoices', 'Invoices', 'number', true), col('subtotal', 'Subtotal', 'money', true), col('vatAmount', 'VAT', 'money', true), col('total', 'Total (AED)', 'money', true), col('paid', 'Paid', 'money', true), col('balance', 'Balance', 'money', true)],
      };
    }
    return { rows };
  },
};
purchaseRegister.params.push(P.groupBy(['none', 'supplier', 'month'], 'none'));

const supplierPurchase: ReportDef = {
  key: 'supplier-purchase',
  title: 'Supplier Purchase Report',
  group: 'Purchase',
  description: 'Purchases per supplier: invoices, net, VAT and total.',
  params: [P.from, P.to, P.supplier, P.product, P.brand, P.category],
  columns: [col('code', 'Code'), col('supplier', 'Supplier'), col('invoices', 'Invoices', 'number', true), col('qty', 'Qty', 'qty', true), col('net', 'Net Purchases', 'money', true), col('vat', 'VAT', 'money', true), col('total', 'Total', 'money', true)],
  async run(p) {
    const { lines, L } = await loadPurchases(p);
    const rows = aggLines(lines, (l) => String(l.inv.supplierId), (l) => ({ code: L.suppliers.get(l.inv.supplierId)?.code ?? '', supplier: supp(L, l.inv.supplierId) }));
    rows.sort((a, b) => num(b.net) - num(a.net));
    return { rows };
  },
};

const productPurchase: ReportDef = {
  key: 'product-purchase',
  title: 'Product Purchase Report',
  group: 'Purchase',
  description: 'Quantity purchased and average cost per product.',
  params: [P.from, P.to, P.supplier, P.product, P.brand, P.category],
  columns: [col('code', 'Code'), col('product', 'Product'), col('brand', 'Brand'), col('invoices', 'Invoices', 'number', true), col('qty', 'Qty', 'qty', true), col('avgCost', 'Avg Cost', 'money'), col('net', 'Net Purchases', 'money', true), col('vat', 'VAT', 'money', true), col('total', 'Total', 'money', true)],
  async run(p) {
    const { lines, L } = await loadPurchases(p);
    const rows = aggLines(lines, (l) => String(l.it.productId ?? `d:${l.it.description}`), (l) => ({ code: pCode(L, l.it.productId), product: l.it.productId ? pName(L, l.it.productId) : l.it.description || '(non-stock)', brand: brandName(L, l.it.productId) }));
    rows.forEach((r) => (r.avgCost = num(r.qty) ? num(r.net) / num(r.qty) : 0));
    rows.sort((a, b) => num(b.net) - num(a.net));
    return { rows };
  },
};

const purchaseByBrand: ReportDef = {
  key: 'purchase-by-brand',
  title: 'Purchase by Brand',
  group: 'Purchase',
  description: 'Purchases grouped by product brand.',
  params: [P.from, P.to, P.supplier, P.brand, P.category],
  columns: [col('brand', 'Brand'), col('invoices', 'Invoices', 'number', true), col('qty', 'Qty', 'qty', true), col('net', 'Net Purchases', 'money', true), col('vat', 'VAT', 'money', true), col('total', 'Total', 'money', true)],
  async run(p) {
    const { lines, L } = await loadPurchases(p);
    const rows = aggLines(lines, (l) => brandName(L, l.it.productId), (l) => ({ brand: brandName(L, l.it.productId) }));
    rows.sort((a, b) => num(b.net) - num(a.net));
    return { rows };
  },
};

const NOT_OPEN_PO = ['DRAFT', 'CANCELLED', 'CLOSED', 'FULLY_RECEIVED', 'RECEIVED', 'COMPLETED', 'SUBMITTED', 'PENDING_APPROVAL'];

const pendingPO: ReportDef = {
  key: 'pending-po',
  title: 'Pending Purchase Orders',
  group: 'Purchase',
  description: 'Approved purchase orders with ordered vs received quantities still pending.',
  params: [P.from, P.to, P.supplier, P.product, P.brand, P.category, P.warehouse],
  columns: [
    col('docDate', 'PO Date', 'date'),
    col('docNo', 'PO No'),
    col('supplier', 'Supplier'),
    col('code', 'Code'),
    col('product', 'Product'),
    col('ordered', 'Ordered', 'qty', true),
    col('received', 'Received', 'qty', true),
    col('pending', 'Pending', 'qty', true),
    col('rate', 'Rate', 'money'),
    col('pendingValue', 'Pending Value', 'money', true),
    col('expectedDate', 'Expected', 'date'),
    col('daysOverdue', 'Days Late', 'number'),
    col('status', 'Status'),
  ],
  async run(p) {
    const pids = await productFilterIds(p);
    const where: Any = { status: { notIn: NOT_OPEN_PO } };
    const dr = dateRange(p);
    if (dr) where.docDate = dr;
    if (p.supplierId) where.supplierId = p.supplierId;
    const wh = await warehouseFilterIds(p);
    if (wh) where.warehouseId = { in: wh };
    const pos: Any[] = await prisma.purchaseOrder.findMany({ where, include: { items: true }, orderBy: { docDate: 'asc' } });
    const L = await loadLookups({ productIds: pos.flatMap((o) => o.items.map((i: Any) => i.productId)), supplierIds: pos.map((o) => o.supplierId) });
    const now = Date.now();
    const rows: Row[] = [];
    for (const o of pos) {
      const rate = num(o.exchangeRate) || 1;
      for (const it of o.items) {
        if (pids && !pids.includes(it.productId)) continue;
        const pending = num(it.qty) - num(it.receivedQty);
        if (pending <= 0.0005) continue;
        rows.push({
          docDate: iso(o.docDate),
          docNo: o.docNo,
          supplier: supp(L, o.supplierId),
          code: pCode(L, it.productId),
          product: pName(L, it.productId),
          ordered: num(it.qty),
          received: num(it.receivedQty),
          pending,
          rate: num(it.rate) * rate,
          pendingValue: pending * num(it.rate) * rate,
          expectedDate: iso(o.expectedDate),
          daysOverdue: o.expectedDate && new Date(o.expectedDate).getTime() < now ? Math.floor((now - new Date(o.expectedDate).getTime()) / 86400000) : 0,
          status: o.status,
        });
      }
    }
    return { rows };
  },
};

const pendingGRN: ReportDef = {
  key: 'pending-grn',
  title: 'Pending GRN (Received Not Invoiced)',
  group: 'Purchase',
  description: 'Posted goods receipts whose quantities have not yet been invoiced by the supplier.',
  params: [P.from, P.to, P.supplier, P.product, P.brand, P.category, P.warehouse],
  columns: [
    col('docDate', 'GRN Date', 'date'),
    col('docNo', 'GRN No'),
    col('poNo', 'PO No'),
    col('supplier', 'Supplier'),
    col('warehouse', 'Warehouse'),
    col('code', 'Code'),
    col('product', 'Product'),
    col('received', 'Received', 'qty', true),
    col('invoiced', 'Invoiced', 'qty', true),
    col('pending', 'Not Invoiced', 'qty', true),
    col('unitCost', 'Unit Cost', 'money'),
    col('pendingValue', 'Pending Value', 'money', true),
    col('ageDays', 'Age (days)', 'number'),
  ],
  async run(p) {
    const pids = await productFilterIds(p);
    const where: Any = { status: 'POSTED', invoiced: false };
    const dr = dateRange(p);
    if (dr) where.docDate = dr;
    if (p.supplierId) where.supplierId = p.supplierId;
    const wh = await warehouseFilterIds(p);
    if (wh) where.warehouseId = { in: wh };
    const grns: Any[] = await prisma.goodsReceipt.findMany({ where, include: { items: true }, orderBy: { docDate: 'asc' } });
    const L = await loadLookups({ productIds: grns.flatMap((g) => g.items.map((i: Any) => i.productId)), supplierIds: grns.map((g) => g.supplierId) });
    const pos = await prisma.purchaseOrder.findMany({ where: { id: { in: [...new Set(grns.map((g) => g.orderId))] } }, select: { id: true, docNo: true } });
    const poNo = new Map(pos.map((o) => [o.id, o.docNo]));
    const now = Date.now();
    const rows: Row[] = [];
    for (const g of grns) {
      for (const it of g.items) {
        if (pids && !pids.includes(it.productId)) continue;
        const pending = num(it.qty) - num(it.invoicedQty);
        if (pending <= 0.0005) continue;
        const cost = num(it.landedUnitCost) || num(it.unitCost);
        rows.push({
          docDate: iso(g.docDate),
          docNo: g.docNo,
          poNo: poNo.get(g.orderId) ?? '',
          supplier: supp(L, g.supplierId),
          warehouse: L.warehouses.get(g.warehouseId)?.name ?? '',
          code: pCode(L, it.productId),
          product: pName(L, it.productId),
          received: num(it.qty),
          invoiced: num(it.invoicedQty),
          pending,
          unitCost: cost,
          pendingValue: pending * cost,
          ageDays: Math.floor((now - new Date(g.docDate).getTime()) / 86400000),
        });
      }
    }
    return { rows };
  },
};

const purchaseReturn: ReportDef = {
  key: 'purchase-return',
  title: 'Purchase Return Report',
  group: 'Purchase',
  description: 'Posted returns to suppliers.',
  params: [P.from, P.to, P.supplier, P.warehouse, P.product, P.brand, P.category],
  columns: [col('docDate', 'Date', 'date'), col('docNo', 'Return No'), col('supplier', 'Supplier'), col('warehouse', 'Warehouse'), col('reason', 'Reason'), col('qty', 'Qty', 'qty', true), col('subtotal', 'Subtotal', 'money', true), col('vatAmount', 'VAT', 'money', true), col('total', 'Total', 'money', true), col('status', 'Status')],
  async run(p) {
    const pids = await productFilterIds(p);
    const where: Any = { status: p.status || 'POSTED' };
    const dr = dateRange(p);
    if (dr) where.docDate = dr;
    if (p.supplierId) where.supplierId = p.supplierId;
    const wh = await warehouseFilterIds(p);
    if (wh) where.warehouseId = { in: wh };
    if (pids) where.items = { some: { productId: { in: pids } } };
    const rets: Any[] = await prisma.purchaseReturn.findMany({ where, include: { items: true }, orderBy: { docDate: 'asc' } });
    const L = await loadLookups({ supplierIds: rets.map((r) => r.supplierId) });
    const rows = rets.map((r): Row => ({
      docDate: iso(r.docDate),
      docNo: r.docNo,
      supplier: supp(L, r.supplierId),
      warehouse: L.warehouses.get(r.warehouseId)?.name ?? '',
      reason: r.reason,
      qty: r.items.filter((i: Any) => !pids || pids.includes(i.productId)).reduce((a: number, i: Any) => a + num(i.qty), 0),
      subtotal: num(r.subtotal),
      vatAmount: num(r.vatAmount),
      total: num(r.total),
      status: r.status,
    }));
    return { rows };
  },
};

const importPurchase: ReportDef = {
  key: 'import-purchase',
  title: 'Import Purchase Report',
  group: 'Purchase',
  description: 'Import purchase orders with shipment status, ETA, received % and landed cost.',
  params: [P.from, P.to, P.supplier, P.warehouse],
  columns: [
    col('docDate', 'PO Date', 'date'),
    col('docNo', 'PO No'),
    col('supplier', 'Supplier'),
    col('country', 'Country'),
    col('incoterms', 'Incoterms'),
    col('currency', 'Cur'),
    col('foreignTotal', 'PO Value (FCY)', 'money', true),
    col('baseTotal', 'PO Value (AED)', 'money', true),
    col('shipments', 'Shipments'),
    col('shipmentStatus', 'Shipment Status'),
    col('etd', 'ETD', 'date'),
    col('eta', 'ETA', 'date'),
    col('actualArrival', 'Arrived', 'date'),
    col('receivedPct', 'Received %', 'percent'),
    col('landedCharges', 'Landed Charges', 'money', true),
    col('landedTotal', 'Landed Total (AED)', 'money', true),
    col('status', 'PO Status'),
  ],
  async run(p) {
    const where: Any = { OR: [{ orderType: { not: 'LOCAL' } }, { shipments: { some: {} } }], status: { notIn: ['DRAFT', 'CANCELLED'] } };
    const dr = dateRange(p);
    if (dr) where.docDate = dr;
    if (p.supplierId) where.supplierId = p.supplierId;
    const wh = await warehouseFilterIds(p);
    if (wh) where.warehouseId = { in: wh };
    const pos: Any[] = await prisma.purchaseOrder.findMany({ where, include: { items: true, shipments: true }, orderBy: { docDate: 'asc' } });
    const L = await loadLookups({ supplierIds: pos.map((o) => o.supplierId) });
    const grns = await prisma.goodsReceipt.findMany({ where: { orderId: { in: pos.map((o) => o.id) }, status: 'POSTED' }, select: { id: true, orderId: true } });
    const lcs = grns.length ? await prisma.landedCost.findMany({ where: { receiptId: { in: grns.map((g) => g.id) }, status: 'POSTED' }, select: { receiptId: true, totalAdditional: true, actualLandedCost: true } }) : [];
    const orderOfGrn = new Map(grns.map((g) => [g.id, g.orderId]));
    const lcByOrder = new Map<number, number>();
    for (const lc of lcs) {
      const oid = orderOfGrn.get(lc.receiptId)!;
      lcByOrder.set(oid, (lcByOrder.get(oid) ?? 0) + num(lc.totalAdditional));
    }
    const dmin = (a: Date[]) => (a.length ? new Date(Math.min(...a.map((d) => d.getTime()))) : null);
    const dmax = (a: Date[]) => (a.length ? new Date(Math.max(...a.map((d) => d.getTime()))) : null);
    const rows = pos.map((o): Row => {
      const rate = num(o.exchangeRate) || 1;
      const ordered = o.items.reduce((a: number, i: Any) => a + num(i.qty), 0);
      const received = o.items.reduce((a: number, i: Any) => a + num(i.receivedQty), 0);
      const sh: Any[] = o.shipments;
      const charges = lcByOrder.get(o.id) ?? 0;
      return {
        docDate: iso(o.docDate),
        docNo: o.docNo,
        supplier: supp(L, o.supplierId),
        country: o.supplierCountry ?? '',
        incoterms: o.incoterms ?? '',
        currency: o.currencyCode,
        foreignTotal: num(o.total),
        baseTotal: num(o.total) * rate,
        shipments: sh.map((s) => s.shipmentNo).join(', '),
        shipmentStatus: sh.length ? sh[sh.length - 1].status : 'NO SHIPMENT',
        etd: iso(dmin(sh.filter((s) => s.etd).map((s) => new Date(s.etd)))),
        eta: iso(dmax(sh.filter((s) => s.eta).map((s) => new Date(s.eta)))),
        actualArrival: iso(dmax(sh.filter((s) => s.actualArrival).map((s) => new Date(s.actualArrival)))),
        receivedPct: ordered ? (received / ordered) * 100 : 0,
        landedCharges: charges,
        landedTotal: num(o.total) * rate + charges,
        status: o.status,
      };
    });
    return { rows };
  },
};

export const purchaseReports: ReportDef[] = [purchaseRegister, supplierPurchase, productPurchase, purchaseByBrand, pendingPO, pendingGRN, purchaseReturn, importPurchase];
export type { Col };
void catName;
