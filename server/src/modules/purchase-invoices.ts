import { revisionSnapshot, auditRevision } from '../services/revisions-history';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import { z } from 'zod';
import { prisma, Tx } from '../lib/prisma';
import { ah, intParam, parse } from '../lib/http';
import { badRequest, conflict, notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import { nextNumber } from '../services/numbering';
import { linkDocs } from '../services/docLink';
import { postJournal, reverseJournal } from '../services/accounting';
import { enrich } from '../lib/enrich';
import { calcLine, calcTotals, num, r2, r3 } from '../lib/calc';
import { assertStatus, baseCurrency, deleteLinks, finishDoc, findSourceJournal, listDocs, resolveRate, supplierDueDate } from '../services/purchase-common';
import type { ModuleDef } from '../app';

const T = { timeout: 30000 };
const PI = 'purchase_invoice';

const lineIn = z.object({
  orderItemId: z.coerce.number().int().nullish(),
  receiptItemId: z.coerce.number().int().nullish(),
  productId: z.coerce.number().int().nullish(),
  description: z.string().nullish(),
  qty: z.coerce.number().positive(),
  unit: z.string().nullish(),
  rate: z.coerce.number().min(0).optional(),
  discount: z.coerce.number().min(0).optional(),
  vatRate: z.coerce.number().min(0).optional(),
});
type LineIn = z.infer<typeof lineIn>;
const invSchema = z.object({
  supplierId: z.coerce.number().int().optional(),
  supplierInvoiceNo: z.string().nullish(),
  invoiceType: z.enum(['LOCAL', 'IMPORT']).optional(),
  docDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().nullish(),
  orderId: z.coerce.number().int().nullish(),
  receiptId: z.coerce.number().int().nullish(),
  currencyCode: z.string().optional(),
  exchangeRate: z.coerce.number().positive().optional(),
  roundOff: z.coerce.number().default(0),
  remarks: z.string().nullish(),
  items: z.array(lineIn).min(1),
});
type InvIn = z.input<typeof invSchema>;

/** qty of a GRN line already returned via GRN-based (uninvoiced) returns */
async function returnedUninvoiced(tx: Tx, receiptItemId: number) {
  const rows = await tx.purchaseReturnItem.findMany({ where: { receiptItemId, return: { status: { not: 'CANCELLED' }, invoiceId: null } }, select: { qty: true } });
  return rows.reduce((s, r) => s + num(r.qty), 0);
}

async function normalize(tx: Tx, input: InvIn) {
  const out: any[] = [];
  const orders = new Map<number, any>();
  const receipts = new Set<number>();
  const receiptTypes = new Set<string>();
  const allocated = new Map<number, number>();
  let supplierId = input.supplierId;

  const useReceipt = (g: any) => {
    if (g.status !== 'POSTED') throw badRequest(`Goods receipt ${g.docNo} is not posted`);
    if (supplierId && g.supplierId !== supplierId) throw badRequest('All lines must belong to the same supplier');
    supplierId = g.supplierId;
    receipts.add(g.id);
    receiptTypes.add(g.grnType);
  };
  const getOrder = async (orderId: number) => {
    if (!orders.has(orderId)) orders.set(orderId, await tx.purchaseOrder.findUnique({ where: { id: orderId } }));
    return orders.get(orderId);
  };
  const avail = async (gi: any) => r3(num(gi.qty) - num(gi.invoicedQty) - (await returnedUninvoiced(tx, gi.id)) - (allocated.get(gi.id) ?? 0));

  const push = async (gi: any, poi: any | null, qty: number, l: LineIn, lineQty: number) => {
    const share = l.qty ? qty / lineQty : 1;
    const rate = l.rate ?? (poi ? num(poi.rate) : 0);
    const discount = l.discount !== undefined ? r2(l.discount * share) : poi ? r2((num(poi.discount) * qty) / (num(poi.qty) || 1)) : 0;
    const prod = gi?.productId ?? l.productId ?? poi?.productId ?? null;
    let vatRate = l.vatRate ?? (poi ? num(poi.vatRate) : undefined);
    if (vatRate === undefined) {
      const p = prod ? await tx.product.findUnique({ where: { id: prod } }) : null;
      vatRate = num(p?.vatRate);
    }
    const c = calcLine({ qty, rate, discount, vatRate });
    out.push({
      orderItemId: gi?.orderItemId ?? poi?.id ?? null, receiptItemId: gi?.id ?? null, productId: prod, description: l.description ?? poi?.description ?? null,
      qty, unit: l.unit ?? poi?.unit ?? null, rate, discount, vatRate, vatAmount: c.vatAmount, amount: c.amount,
    });
    if (gi) allocated.set(gi.id, (allocated.get(gi.id) ?? 0) + qty);
  };

  for (const l of input.items) {
    if (l.receiptItemId) {
      const gi: any = await tx.goodsReceiptItem.findUnique({ where: { id: l.receiptItemId }, include: { receipt: true } });
      if (!gi) throw badRequest(`Receipt item ${l.receiptItemId} not found`);
      useReceipt(gi.receipt);
      const a = await avail(gi);
      if (l.qty > a + 0.0005) throw badRequest(`Cannot invoice ${l.qty}: only ${Math.max(0, a)} of receipt line ${gi.id} (${gi.receipt.docNo}) is received and not yet invoiced`);
      const poi = await tx.purchaseOrderItem.findUnique({ where: { id: gi.orderItemId } });
      await getOrder(gi.receipt.orderId);
      await push(gi, poi, l.qty, l, l.qty);
    } else if (l.orderItemId) {
      const poi: any = await tx.purchaseOrderItem.findUnique({ where: { id: l.orderItemId } });
      if (!poi) throw badRequest(`Order item ${l.orderItemId} not found`);
      const o = await getOrder(poi.orderId);
      if (supplierId && o.supplierId !== supplierId) throw badRequest('All lines must belong to the same supplier');
      supplierId = o.supplierId;
      const gis: any[] = await tx.goodsReceiptItem.findMany({ where: { orderItemId: poi.id, receipt: { status: 'POSTED' } }, include: { receipt: true }, orderBy: { id: 'asc' } });
      let left = l.qty;
      for (const gi of gis) {
        if (left <= 0.0005) break;
        const a = await avail(gi);
        if (a <= 0) continue;
        const take = Math.min(a, left);
        useReceipt(gi.receipt);
        await push(gi, poi, r3(take), l, l.qty);
        left = r3(left - take);
      }
      if (left > 0.0005) throw badRequest(`Cannot invoice ${l.qty} of "${poi.description ?? poi.productId}": only ${r3(l.qty - left)} received and not yet invoiced`);
    } else {
      if (!l.productId && !l.description) throw badRequest('Free invoice lines need a product or description');
      if (l.rate === undefined) throw badRequest('Free invoice lines need a rate');
      await push(null, null, l.qty, l, l.qty);
    }
  }
  if (!supplierId) throw badRequest('supplierId is required');
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw badRequest('Supplier not found');
  const firstOrder = [...orders.values()][0];
  const base = await baseCurrency(tx);
  let currencyCode = input.currencyCode ?? firstOrder?.currencyCode ?? supplier.currencyCode ?? base;
  if (orders.size > 1 && [...orders.values()].some((o) => o.currencyCode !== firstOrder.currencyCode)) throw badRequest('Lines from orders with different currencies cannot be invoiced together');
  if (firstOrder && !input.currencyCode) currencyCode = firstOrder.currencyCode;
  const exchangeRate = await resolveRate(tx, currencyCode, input.exchangeRate ?? (firstOrder && firstOrder.currencyCode === currencyCode ? num(firstOrder.exchangeRate) : undefined), base);
  const invoiceType = receiptTypes.has('IMPORT') ? 'IMPORT' : input.invoiceType ?? (firstOrder?.orderType === 'IMPORT' ? 'IMPORT' : 'LOCAL');
  return {
    lines: out, supplierId, supplier, currencyCode, exchangeRate, invoiceType,
    orderId: input.orderId ?? (orders.size === 1 ? firstOrder.id : null), receiptId: input.receiptId ?? (receipts.size === 1 ? [...receipts][0] : null), receipts: [...receipts], orderIds: [...orders.keys()],
  };
}

async function recalcGrnInvoiced(tx: Tx, receiptId: number) {
  const items = await tx.goodsReceiptItem.findMany({ where: { receiptId } });
  const full = items.length > 0 && items.every((i) => num(i.invoicedQty) >= num(i.qty) - 0.0005);
  await tx.goodsReceipt.update({ where: { id: receiptId }, data: { invoiced: full } });
}

async function adjustInvoiced(tx: Tx, lines: Array<{ receiptItemId: number | null; orderItemId: number | null; qty: unknown }>, sign: 1 | -1) {
  const touched = new Set<number>();
  for (const l of lines) {
    if (!l.receiptItemId) continue;
    const gi = await tx.goodsReceiptItem.findUnique({ where: { id: l.receiptItemId } });
    if (gi) {
      await tx.goodsReceiptItem.update({ where: { id: gi.id }, data: { invoicedQty: r3(Math.max(0, num(gi.invoicedQty) + sign * num(l.qty))) } });
      touched.add(gi.receiptId);
    }
    if (l.orderItemId) {
      const poi = await tx.purchaseOrderItem.findUnique({ where: { id: l.orderItemId } });
      if (poi) await tx.purchaseOrderItem.update({ where: { id: poi.id }, data: { invoicedQty: r3(Math.max(0, num(poi.invoicedQty) + sign * num(l.qty))) } });
    }
  }
  for (const r of touched) await recalcGrnInvoiced(tx, r);
}

async function createInvoice(tx: Tx, raw: InvIn, user: { id: number; username: string }, from?: { type: string; id: number; no: string }) {
  const n = await normalize(tx, raw);
  const docDate = raw.docDate ?? new Date();
  const t = calcTotals(n.lines, raw.roundOff ?? 0);
  const baseTotal = r2(t.total * n.exchangeRate);
  const dueDate = raw.dueDate ?? (await supplierDueDate(tx, n.supplierId, docDate));
  const docNo = await nextNumber(tx, 'PURCHASE_INVOICE', { date: docDate });
  const inv = await tx.purchaseInvoice.create({
    data: {
      docNo, supplierInvoiceNo: raw.supplierInvoiceNo, invoiceType: n.invoiceType, docDate, dueDate, supplierId: n.supplierId, orderId: n.orderId, receiptId: n.receiptId,
      currencyCode: n.currencyCode, exchangeRate: n.exchangeRate, subtotal: t.subtotal, discount: t.discount, vatAmount: t.vatAmount, roundOff: t.roundOff, total: t.total, baseTotal,
      status: 'DRAFT', remarks: raw.remarks, createdBy: user.id, items: { create: n.lines },
    },
  });
  await adjustInvoiced(tx, n.lines, 1);
  for (const rid of n.receipts) {
    const g = await tx.goodsReceipt.findUnique({ where: { id: rid } });
    await linkDocs(tx, { type: 'GOODS_RECEIPT', id: rid, no: g!.docNo }, { type: 'PURCHASE_INVOICE', id: inv.id, no: inv.docNo });
  }
  if (from && !(from.type === 'GOODS_RECEIPT' && n.receipts.includes(from.id))) await linkDocs(tx, from, { type: 'PURCHASE_INVOICE', id: inv.id, no: inv.docNo });
  else if (!from) for (const oid of n.orderIds) {
    const o = await tx.purchaseOrder.findUnique({ where: { id: oid } });
    await linkDocs(tx, { type: o!.orderType === 'IMPORT' ? 'IMPORT_PURCHASE_ORDER' : 'PURCHASE_ORDER', id: oid, no: o!.docNo }, { type: 'PURCHASE_INVOICE', id: inv.id, no: inv.docNo });
  }
  await audit(tx, user, 'CREATE', 'PurchaseInvoice', inv.id, { docNo, total: t.total, from: from?.no });
  return inv;
}

async function loadInv(id: number) {
  const d = await prisma.purchaseInvoice.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });
  if (!d) throw notFound('Purchase invoice not found');
  return d;
}
const outstandingOf = (r: any) => (['POSTED', 'PARTIALLY_PAID'].includes(r.status) ? r2(Math.max(0, num(r.baseTotal) - num(r.paidAmount))) : 0);

async function invoiceDetail(id: number) {
  const inv = await loadInv(id);
  const d: any = await finishDoc(inv, 'PURCHASE_INVOICE', { supplierId: 'supplier' });
  d.outstanding = outstandingOf(inv);
  d.order = inv.orderId ? await prisma.purchaseOrder.findUnique({ where: { id: inv.orderId }, select: { id: true, docNo: true, orderType: true } }) : null;
  d.receipt = inv.receiptId ? await prisma.goodsReceipt.findUnique({ where: { id: inv.receiptId }, select: { id: true, docNo: true, grnType: true } }) : null;
  const allocs = await prisma.voucherAllocation.findMany({ where: { docType: 'PURCHASE_INVOICE', docId: id }, include: { voucher: { select: { voucherNo: true, voucherDate: true, status: true, mode: true } } } });
  d.payments = allocs.filter((a) => a.voucher.status !== 'CANCELLED');
  d.returns = await prisma.purchaseReturn.findMany({ where: { invoiceId: id, status: { not: 'CANCELLED' } }, select: { id: true, docNo: true, status: true, total: true } });
  return d;
}

async function postInvoice(tx: Tx, id: number, user: { id: number; username: string }) {
  const inv: any = await tx.purchaseInvoice.findUnique({ where: { id }, include: { items: true } });
  assertStatus(inv, ['DRAFT'], 'post');
  if (!inv.supplierInvoiceNo?.trim()) throw badRequest('Supplier invoice number is required before posting');
  const dup = await tx.purchaseInvoice.findFirst({ where: { supplierId: inv.supplierId, supplierInvoiceNo: inv.supplierInvoiceNo, status: { not: 'CANCELLED' }, id: { not: id } } });
  if (dup) throw conflict(`Supplier invoice ${inv.supplierInvoiceNo} was already entered as ${dup.docNo}`);
  const rate = num(inv.exchangeRate);
  let grni = 0;
  for (const it of inv.items) {
    if (!it.receiptItemId) continue;
    const gi = await tx.goodsReceiptItem.findUnique({ where: { id: it.receiptItemId } });
    grni += r2(num(it.qty) * num(gi?.unitCost));
  }
  grni = r2(grni);
  const vat = r2(num(inv.vatAmount) * rate);
  const ro = r2(num(inv.roundOff) * rate);
  const ap = r2(num(inv.baseTotal));
  const inventory = r2(ap - grni - vat - ro); // net of non-GRN lines + price/FX variance on GRN lines
  const j = await postJournal(tx, {
    date: inv.docDate, entryType: 'AUTO', sourceType: 'PURCHASE_INVOICE', sourceId: id, sourceNo: inv.docNo, narration: `Purchase invoice ${inv.docNo} (${inv.supplierInvoiceNo})`, userId: user.id,
    lines: [
      { accountKey: 'GRNI', debit: grni, description: 'Clear goods received not invoiced' },
      { accountKey: 'INVENTORY', debit: inventory > 0 ? inventory : 0, credit: inventory < 0 ? -inventory : 0, description: 'Inventory / purchase price variance' },
      { accountKey: 'VAT_INPUT', debit: vat, vatAmount: vat, description: 'Input VAT' },
      { accountKey: 'ROUND_OFF', debit: ro > 0 ? ro : 0, credit: ro < 0 ? -ro : 0 },
      { accountKey: 'AP', credit: ap, partyType: 'SUPPLIER', partyId: inv.supplierId, description: `Supplier invoice ${inv.supplierInvoiceNo}` },
    ],
  });
  await tx.purchaseInvoice.update({ where: { id }, data: { status: 'POSTED', journalId: j.id } });
  await audit(tx, user, 'POST', 'PurchaseInvoice', id, { journal: j.entryNo, baseTotal: ap });
  return j;
}

async function cancelInvoice(tx: Tx, id: number, user: { id: number; username: string }) {
  const inv: any = await tx.purchaseInvoice.findUnique({ where: { id }, include: { items: true } });
  assertStatus(inv, ['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID'], 'cancel');
  if (inv.status !== 'DRAFT') {
    if (num(inv.paidAmount) > 0.004) throw badRequest('Invoice has payments allocated; cancel the payment(s) first');
    if (await tx.purchaseReturn.count({ where: { invoiceId: id, status: { not: 'CANCELLED' } } })) throw badRequest('Invoice has purchase returns; cancel them first');
    const jid = inv.journalId ?? (await findSourceJournal(tx, 'PURCHASE_INVOICE', id))?.id;
    if (jid) await reverseJournal(tx, jid, user.id);
  }
  await adjustInvoiced(tx, inv.items, -1);
  await tx.purchaseInvoice.update({ where: { id }, data: { status: 'CANCELLED' } });
  await audit(tx, user, 'CANCEL', 'PurchaseInvoice', id, { wasStatus: inv.status });
}

// ================================================================== /purchase-invoices
const router = Router();
router.get('/', can(PI, 'view'), ah(async (req, res) => {
  res.json(await listDocs(req, {
    model: 'purchaseInvoice', search: ['docNo', 'supplierInvoiceNo', 'remarks'], supplierSearch: true, numeric: ['supplierId', 'orderId', 'receiptId'], strings: ['invoiceType'],
    map: (r) => ({ ...r, outstanding: outstandingOf(r) }),
  }));
}));
router.get('/outstanding', can(PI, 'view'), ah(async (req, res) => {
  const where: any = { status: { in: ['POSTED', 'PARTIALLY_PAID'] } };
  if (req.query.supplierId) where.supplierId = Number(req.query.supplierId);
  const now = Date.now();
  const rows: any[] = (await prisma.purchaseInvoice.findMany({ where, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }] }))
    .map((r) => ({ id: r.id, docNo: r.docNo, supplierInvoiceNo: r.supplierInvoiceNo, supplierId: r.supplierId, docDate: r.docDate, dueDate: r.dueDate, currencyCode: r.currencyCode, exchangeRate: num(r.exchangeRate), total: num(r.total), baseTotal: num(r.baseTotal), paidAmount: num(r.paidAmount), status: r.status, outstanding: outstandingOf(r), daysOverdue: r.dueDate ? Math.max(0, Math.floor((now - r.dueDate.getTime()) / 86400000)) : 0 }))
    .filter((r) => r.outstanding > 0.004);
  await enrich(rows, { supplierId: 'supplier' });
  res.json({ rows, totalOutstanding: r2(rows.reduce((s, r) => s + r.outstanding, 0)) });
}));
router.get('/:id', can(PI, 'view'), ah(async (req, res) => res.json(await invoiceDetail(intParam(req)))));
router.post('/', can(PI, 'create'), ah(async (req, res) => {
  const b = parse(invSchema, req.body);
  const inv = await prisma.$transaction((tx) => createInvoice(tx, b, req.user!), T);
  res.status(201).json(await invoiceDetail(inv.id));
}));
router.put('/:id', can(PI, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const revisionBefore = await revisionSnapshot(tx, 'PurchaseInvoice', id);
    const cur: any = assertStatus(await tx.purchaseInvoice.findUnique({ where: { id }, include: { items: true } }), ['DRAFT'], 'edit');
    const b = parse(invSchema.partial().extend({ items: z.array(lineIn).optional() }), req.body);
    const data: any = {};
    if (b.supplierInvoiceNo !== undefined) data.supplierInvoiceNo = b.supplierInvoiceNo;
    if (b.docDate) data.docDate = b.docDate;
    if (b.dueDate !== undefined) data.dueDate = b.dueDate;
    if (b.remarks !== undefined) data.remarks = b.remarks;
    if (b.items || b.roundOff !== undefined || b.exchangeRate) {
      const items = b.items ?? cur.items.map((i: any) => ({ orderItemId: i.orderItemId, receiptItemId: i.receiptItemId, productId: i.productId, description: i.description, qty: num(i.qty), unit: i.unit, rate: num(i.rate), discount: num(i.discount), vatRate: num(i.vatRate) }));
      await adjustInvoiced(tx, cur.items, -1);
      const n = await normalize(tx, { supplierId: cur.supplierId, currencyCode: b.currencyCode ?? cur.currencyCode, exchangeRate: b.exchangeRate ?? num(cur.exchangeRate), invoiceType: cur.invoiceType, roundOff: 0, items });
      const ro = b.roundOff ?? num(cur.roundOff);
      const t = calcTotals(n.lines, ro);
      Object.assign(data, { currencyCode: n.currencyCode, exchangeRate: n.exchangeRate, subtotal: t.subtotal, discount: t.discount, vatAmount: t.vatAmount, roundOff: t.roundOff, total: t.total, baseTotal: r2(t.total * n.exchangeRate), invoiceType: n.invoiceType });
      await tx.purchaseInvoiceItem.deleteMany({ where: { invoiceId: id } });
      await tx.purchaseInvoiceItem.createMany({ data: n.lines.map((l) => ({ ...l, invoiceId: id })) });
      await adjustInvoiced(tx, n.lines, 1);
    }
    await tx.purchaseInvoice.update({ where: { id }, data });
    await auditRevision(tx, req.user, 'PurchaseInvoice', id, revisionBefore, req.body?.changeReason);
    await audit(tx, req.user, 'UPDATE', 'PurchaseInvoice', id);
  }, T);
  res.json(await invoiceDetail(id));
}));
router.delete('/:id', can(PI, 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const inv: any = assertStatus(await tx.purchaseInvoice.findUnique({ where: { id }, include: { items: true } }), ['DRAFT'], 'delete');
    await adjustInvoiced(tx, inv.items, -1);
    await tx.purchaseInvoice.delete({ where: { id } });
    await deleteLinks(tx, 'PURCHASE_INVOICE', id);
    await audit(tx, req.user, 'DELETE', 'PurchaseInvoice', id);
  }, T);
  res.json({ ok: true });
}));
router.post('/:id/post', can(PI, 'post'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction((tx) => postInvoice(tx, id, req.user!), T);
  res.json(await invoiceDetail(id));
}));
router.post('/:id/cancel', can(PI, 'cancel'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction((tx) => cancelInvoice(tx, id, req.user!), T);
  res.json(await invoiceDetail(id));
}));

// ================================================================== conversions
const hdr = z.object({
  supplierInvoiceNo: z.string().nullish(),
  docDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().nullish(),
  roundOff: z.coerce.number().default(0),
  exchangeRate: z.coerce.number().positive().optional(),
  remarks: z.string().nullish(),
  items: z.array(z.object({ receiptItemId: z.coerce.number().int().nullish(), orderItemId: z.coerce.number().int().nullish(), qty: z.coerce.number().positive(), rate: z.coerce.number().min(0).optional(), discount: z.coerce.number().min(0).optional(), vatRate: z.coerce.number().min(0).optional() })).optional(),
});

const fromGrn = Router();
fromGrn.post('/:id/create-invoice', can(PI, 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(hdr, req.body ?? {});
  const inv = await prisma.$transaction(async (tx) => {
    const g: any = await tx.goodsReceipt.findUnique({ where: { id }, include: { items: true } });
    assertStatus(g, ['POSTED'], 'invoice (goods receipt must be POSTED)');
    let items: LineIn[] | undefined = b.items as any;
    if (items) {
      for (const i of items) if (i.receiptItemId && !g.items.some((x: any) => x.id === i.receiptItemId)) throw badRequest('Item does not belong to this goods receipt');
      items = items.map((i) => (i.receiptItemId ? i : { ...i, receiptItemId: g.items.find((x: any) => x.orderItemId === i.orderItemId)?.id })) as any;
    } else {
      items = [];
      for (const gi of g.items) {
        const q = r3(num(gi.qty) - num(gi.invoicedQty) - (await returnedUninvoiced(tx, gi.id)));
        if (q > 0) items.push({ receiptItemId: gi.id, qty: q });
      }
    }
    if (!items!.length) throw badRequest('Goods receipt is already fully invoiced');
    const { items: _i, ...h } = b;
    return createInvoice(tx, { ...h, supplierId: g.supplierId, receiptId: id, orderId: g.orderId, items: items as any }, req.user!, { type: 'GOODS_RECEIPT', id, no: g.docNo });
  }, T);
  res.status(201).json(await invoiceDetail(inv.id));
}));

const fromPo = Router();
fromPo.post('/:id/create-invoice', can(PI, 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(hdr, req.body ?? {});
  const inv = await prisma.$transaction(async (tx) => {
    const o: any = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!o) throw notFound('Purchase order not found');
    if (['DRAFT', 'CANCELLED', 'PENDING_APPROVAL'].includes(o.status)) throw badRequest(`Order is ${o.status}`);
    let items: any[] | undefined = b.items;
    if (items) {
      for (const i of items) {
        if (!i.orderItemId && !i.receiptItemId) throw badRequest('Each item needs orderItemId');
        if (i.orderItemId && !o.items.some((x: any) => x.id === i.orderItemId)) throw badRequest('Item does not belong to this order');
      }
    } else {
      items = o.items.map((i: any) => ({ orderItemId: i.id, qty: r3(num(i.receivedQty) - num(i.invoicedQty)) })).filter((i: any) => i.qty > 0);
    }
    if (!items!.length) throw badRequest('Nothing to invoice: no received quantity is left uninvoiced');
    const { items: _i, ...h } = b;
    return createInvoice(tx, { ...h, supplierId: o.supplierId, orderId: id, items: items! }, req.user!, { type: o.orderType === 'IMPORT' ? 'IMPORT_PURCHASE_ORDER' : 'PURCHASE_ORDER', id, no: o.docNo });
  }, T);
  res.status(201).json(await invoiceDetail(inv.id));
}));

export default [
  { path: '/purchase-invoices', router },
  { path: '/goods-receipts', router: fromGrn },
  { path: '/purchase-orders', router: fromPo },
  { path: '/import-orders', router: fromPo },
] as ModuleDef[];
