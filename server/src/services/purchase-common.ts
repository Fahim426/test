/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request } from 'express';
import { z } from 'zod';
import { prisma, Tx } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { calcLine, calcTotals, num, r2, r3, r4 } from '../lib/calc';
import { listQuery, paged } from '../lib/http';
import { enrich } from '../lib/enrich';
import { getLinks } from './docLink';
import { audit } from './audit';
import { actOnApproval, findRule, registerApprovalHandler, submitForApproval } from './approval';
import { forbidden } from '../lib/errors';
import { nextNumber } from './numbering';

/** Shared helpers for the purchase modules. */

export const PARTY_ENRICH = { supplierId: 'supplier', warehouseId: 'warehouse' };

export async function baseCurrency(tx: Tx | typeof prisma = prisma): Promise<string> {
  const c = await tx.company.findFirst({ where: { isActive: true } });
  return c?.baseCurrency || 'AED';
}

/** exchange rate to base currency: 1 for base, provided value, else Currency.rate. */
export async function resolveRate(tx: Tx | typeof prisma, code: string, provided?: number | null, base?: string) {
  const b = base ?? (await baseCurrency(tx));
  if (code === b) return 1;
  if (provided && provided > 0) return provided;
  const c = await tx.currency.findUnique({ where: { code } });
  if (c && num(c.rate) > 0) return num(c.rate);
  throw badRequest(`Exchange rate required for currency ${code}`);
}

export async function getSetting(tx: Tx | typeof prisma, key: string, def: number): Promise<number> {
  const s = await tx.systemSetting.findUnique({ where: { key } });
  const n = s ? Number(s.value) : NaN;
  return Number.isFinite(n) ? n : def;
}

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);

export async function supplierDueDate(tx: Tx | typeof prisma, supplierId: number, docDate: Date) {
  const s = await tx.supplier.findUnique({ where: { id: supplierId } });
  let days = 0;
  if (s?.paymentTermId) {
    const t = await tx.paymentTerm.findUnique({ where: { id: s.paymentTermId } });
    days = t?.days ?? 0;
  }
  return addDays(docDate, days);
}

export function assertStatus(doc: { status: string } | null, allowed: string[], what: string) {
  if (!doc) throw notFound();
  if (!allowed.includes(doc.status)) throw badRequest(`Cannot ${what}: document is ${doc.status} (allowed: ${allowed.join(', ')})`);
  return doc;
}

export async function deleteLinks(tx: Tx, type: string, id: number) {
  await tx.documentLink.deleteMany({ where: { OR: [{ fromType: type, fromId: id }, { toType: type, toId: id }] } });
}

export async function approvalOf(docType: string, docId: number) {
  return prisma.approvalRequest.findFirst({ where: { docType, docId }, orderBy: { id: 'desc' }, include: { actions: { orderBy: { id: 'asc' } } } });
}

/** Enrich a single document (+ items) and attach links/approval. */
export async function finishDoc(doc: any, docType: string, map: Record<string, string> = PARTY_ENRICH) {
  await enrich([doc], map);
  if (Array.isArray(doc.items)) await enrich(doc.items, { productId: 'product' });
  const [links, approval] = await Promise.all([getLinks(docType, doc.id), approvalOf(docType, doc.id)]);
  return { ...doc, links, approval };
}

/** Finds the (original, non-reversal) POSTED journal for a source document. */
export async function findSourceJournal(tx: Tx, sourceType: string, sourceId: number) {
  return tx.journalEntry.findFirst({
    where: { sourceType, sourceId, status: 'POSTED', NOT: { narration: { startsWith: 'Reversal' } } },
    orderBy: { id: 'asc' },
  });
}

/** Generic paged list with search / status / date / id filters. */
export async function listDocs(
  req: Request,
  o: {
    model: string;
    search?: string[];
    supplierSearch?: boolean;
    numeric?: string[];
    strings?: string[];
    dateField?: string;
    include?: any;
    base?: any;
    map?: (row: any) => any;
    enrich?: Record<string, string>;
    after?: (rows: any[]) => Promise<void>;
  },
) {
  const q = listQuery(req);
  const where: any = { ...(o.base || {}) };
  const and: any[] = [];
  if (q.search) {
    const or: any[] = (o.search ?? []).map((f) => ({ [f]: { contains: q.search } }));
    if (o.supplierSearch) {
      const ids = (await prisma.supplier.findMany({ where: { OR: [{ name: { contains: q.search } }, { code: { contains: q.search } }] }, select: { id: true } })).map((s) => s.id);
      if (ids.length) or.push({ supplierId: { in: ids } });
    }
    if (or.length) and.push({ OR: or });
  }
  const st = req.query.status;
  if (st) and.push({ status: String(st).includes(',') ? { in: String(st).split(',') } : String(st) });
  for (const f of o.numeric ?? []) if (req.query[f] !== undefined && req.query[f] !== '') and.push({ [f]: Number(req.query[f]) });
  for (const f of o.strings ?? []) if (req.query[f]) and.push({ [f]: String(req.query[f]) });
  const df = o.dateField ?? 'docDate';
  if (req.query.from) and.push({ [df]: { gte: new Date(String(req.query.from)) } });
  if (req.query.to) and.push({ [df]: { lte: new Date(String(req.query.to) + (String(req.query.to).length <= 10 ? 'T23:59:59.999Z' : '')) } });
  if (and.length) where.AND = and;
  const sortable = new Set(['id', 'docNo', 'docDate', 'status', 'total', 'createdAt', 'noteNo', 'shipmentNo', 'eta', 'etd']);
  const sortField = q.sort && sortable.has(q.sort) ? q.sort : 'id';
  const d = (prisma as any)[o.model];
  const [rowsRaw, total] = await Promise.all([
    d.findMany({ where, include: o.include, orderBy: { [sortField]: q.dir }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    d.count({ where }),
  ]);
  let rows = rowsRaw as any[];
  if (o.map) rows = rows.map(o.map);
  await enrich(rows, o.enrich ?? PARTY_ENRICH);
  if (o.after) await o.after(rows);
  return paged(rows, total, q);
}

// ---------------------------------------------------------------------------------------------
// Purchase order construction (shared by local PO, import PO, quotation/proforma conversion)
// ---------------------------------------------------------------------------------------------
export const poItemSchema = z.object({
  productId: z.coerce.number().int(),
  oemNumber: z.string().nullish(),
  description: z.string().nullish(),
  qty: z.coerce.number().positive(),
  unit: z.string().nullish(),
  rate: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).default(0),
  vatRate: z.coerce.number().min(0).optional(),
});
export const poSchema = z.object({
  docDate: z.coerce.date().optional(),
  supplierId: z.coerce.number().int(),
  quotationId: z.coerce.number().int().nullish(),
  quotationRef: z.string().nullish(),
  importRequestId: z.coerce.number().int().nullish(),
  warehouseId: z.coerce.number().int().nullish(),
  currencyCode: z.string().optional(),
  exchangeRate: z.coerce.number().positive().optional(),
  paymentTerms: z.string().nullish(),
  deliveryTerms: z.string().nullish(),
  expectedDate: z.coerce.date().nullish(),
  remarks: z.string().nullish(),
  terms: z.string().nullish(),
  roundOff: z.coerce.number().default(0),
  supplierCountry: z.string().nullish(),
  incoterms: z.string().nullish(),
  portOfLoading: z.string().nullish(),
  portOfDestination: z.string().nullish(),
  shippingMethod: z.string().nullish(),
  shippingAgent: z.string().nullish(),
  clearingAgent: z.string().nullish(),
  items: z.array(poItemSchema).min(1, 'At least one item is required'),
});
export type PoInput = z.input<typeof poSchema>;

export async function buildOrderData(tx: Tx, i: PoInput, orderType: 'LOCAL' | 'IMPORT') {
  const supplier = await tx.supplier.findUnique({ where: { id: i.supplierId } });
  if (!supplier) throw badRequest('Supplier not found');
  const base = await baseCurrency(tx);
  const currencyCode = i.currencyCode ?? supplier.currencyCode ?? base;
  const exchangeRate = await resolveRate(tx, currencyCode, i.exchangeRate, base);
  const ids = [...new Set(i.items.map((x) => x.productId))];
  const products = await tx.product.findMany({ where: { id: { in: ids } } });
  const pm = new Map(products.map((p) => [p.id, p]));
  const items = i.items.map((x) => {
    const p = pm.get(x.productId);
    if (!p) throw badRequest(`Product ${x.productId} not found`);
    const vatRate = x.vatRate ?? (orderType === 'IMPORT' || supplier.vatCategory !== 'TAXABLE' ? 0 : num(p.vatRate));
    const c = calcLine({ qty: x.qty, rate: x.rate, discount: x.discount ?? 0, vatRate });
    return {
      productId: x.productId,
      oemNumber: x.oemNumber ?? p.oemNumber,
      description: x.description ?? p.name,
      qty: x.qty,
      unit: x.unit ?? p.purchaseUnit,
      rate: x.rate,
      discount: x.discount ?? 0,
      vatRate,
      vatAmount: c.vatAmount,
      amount: c.amount,
    };
  });
  const t = calcTotals(items, i.roundOff ?? 0);
  const data = {
    orderType,
    docDate: i.docDate ?? new Date(),
    supplierId: i.supplierId,
    quotationId: i.quotationId ?? null,
    quotationRef: i.quotationRef ?? null,
    importRequestId: i.importRequestId ?? null,
    warehouseId: i.warehouseId ?? null,
    currencyCode,
    exchangeRate,
    paymentTerms: i.paymentTerms ?? null,
    deliveryTerms: i.deliveryTerms ?? null,
    expectedDate: i.expectedDate ?? null,
    remarks: i.remarks ?? null,
    terms: i.terms ?? null,
    subtotal: t.subtotal,
    discount: t.discount,
    vatAmount: t.vatAmount,
    roundOff: t.roundOff,
    total: t.total,
    supplierCountry: i.supplierCountry ?? (orderType === 'IMPORT' ? supplier.country : null) ?? null,
    incoterms: i.incoterms ?? null,
    portOfLoading: i.portOfLoading ?? null,
    portOfDestination: i.portOfDestination ?? null,
    shippingMethod: i.shippingMethod ?? null,
    shippingAgent: i.shippingAgent ?? null,
    clearingAgent: i.clearingAgent ?? null,
  };
  return { data, items };
}

export const baseTotalOf = (o: { total: unknown; exchangeRate: unknown }) => r2(num(o.total) * num(o.exchangeRate));

export function orderQtys(items: Array<{ qty: unknown; receivedQty: unknown; invoicedQty?: unknown }>) {
  const orderedQty = r3(items.reduce((s, i) => s + num(i.qty), 0));
  const receivedQty = r3(items.reduce((s, i) => s + num(i.receivedQty), 0));
  const invoicedQty = r3(items.reduce((s, i) => s + num(i.invoicedQty), 0));
  const pendingQty = r3(items.reduce((s, i) => s + Math.max(0, num(i.qty) - num(i.receivedQty)), 0));
  return { orderedQty, receivedQty, invoicedQty, pendingQty, receivedPct: orderedQty ? r2(Math.min(100, (receivedQty / orderedQty) * 100)) : 0 };
}

export const IMPORT_RECEIVABLE = ['CONFIRMED', 'PAYMENT_PENDING', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'RECEIVED'];
export const LOCAL_RECEIVABLE = ['APPROVED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED'];

/** Recompute PO status from received quantities after a GRN is posted / cancelled. */
export async function refreshOrderStatus(tx: Tx, orderId: number) {
  const o = await tx.purchaseOrder.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!o) return null;
  const fully = o.items.length > 0 && o.items.every((i) => num(i.receivedQty) >= num(i.qty) - 0.0005);
  const any = o.items.some((i) => num(i.receivedQty) > 0);
  let next = o.status;
  if (o.orderType === 'LOCAL') {
    if (LOCAL_RECEIVABLE.includes(o.status)) next = fully ? 'FULLY_RECEIVED' : any ? 'PARTIALLY_RECEIVED' : 'APPROVED';
  } else if (IMPORT_RECEIVABLE.includes(o.status)) {
    if (fully) next = 'RECEIVED';
    else if (o.status === 'RECEIVED') next = 'ARRIVED';
  }
  if (next !== o.status) await tx.purchaseOrder.update({ where: { id: orderId }, data: { status: next } });
  return next;
}

export async function advancePaidFor(orderId: number) {
  const rows = await prisma.voucherAllocation.findMany({ where: { docType: 'PURCHASE_ORDER', docId: orderId, voucher: { status: { not: 'CANCELLED' } } } });
  return r2(rows.reduce((s, r) => s + num(r.amount), 0));
}

/** Creates a PO (DRAFT) with numbering; caller handles links. */
export async function createPurchaseOrder(tx: Tx, input: PoInput, orderType: 'LOCAL' | 'IMPORT', userId?: number) {
  const { data, items } = await buildOrderData(tx, input, orderType);
  const docNo = await nextNumber(tx, orderType === 'IMPORT' ? 'IMPORT_PURCHASE_ORDER' : 'PURCHASE_ORDER', { date: data.docDate });
  return tx.purchaseOrder.create({ data: { ...data, docNo, status: 'DRAFT', createdBy: userId, items: { create: items } }, include: { items: true } });
}

// approval engine hook: PO moves to APPROVED (CONFIRMED for imports) or back to DRAFT when rejected
registerApprovalHandler('PURCHASE_ORDER', async (tx, req, outcome) => {
  const o = await tx.purchaseOrder.findUnique({ where: { id: req.docId } });
  if (!o || o.status !== 'PENDING_APPROVAL') return;
  const status = outcome === 'APPROVED' ? (o.orderType === 'IMPORT' ? 'CONFIRMED' : 'APPROVED') : 'DRAFT';
  await tx.purchaseOrder.update({ where: { id: o.id }, data: { status } });
  await audit(tx, undefined, outcome === 'APPROVED' ? 'APPROVE' : 'REJECT', 'PurchaseOrder', o.id, { via: 'approval-engine', docNo: o.docNo, status });
});

/** unit cost (base currency) of a PO line = (qty*rate - discount)/qty * exchangeRate */
export function poUnitCostBase(item: { qty: unknown; rate: unknown; discount: unknown }, exchangeRate: unknown) {
  const q = num(item.qty);
  if (!q) return 0;
  return r4(((q * num(item.rate) - num(item.discount)) / q) * num(exchangeRate));
}

/** Submit PO for approval: no matching rule => auto-approved (APPROVED for local, CONFIRMED for import). */
export async function submitOrder(tx: Tx, id: number, user: { id: number; username: string }) {
  const o = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
  assertStatus(o, ['DRAFT'], 'submit');
  if (!o!.items.length) throw badRequest('Order has no items');
  const ar = await submitForApproval(tx, { docType: 'PURCHASE_ORDER', docId: id, docNo: o!.docNo, amount: baseTotalOf(o!), userId: user.id });
  const approved = o!.orderType === 'IMPORT' ? 'CONFIRMED' : 'APPROVED';
  const status = ar.required ? 'PENDING_APPROVAL' : approved;
  await tx.purchaseOrder.update({ where: { id }, data: { status } });
  await audit(tx, user, 'SUBMIT', 'PurchaseOrder', id, { status, approvalRequired: ar.required });
  return status;
}

export function orderRow(r: any) {
  const q = orderQtys(r.items);
  const out = { ...r, ...q, baseTotal: baseTotalOf(r) };
  delete out.items;
  return out;
}

export async function orderDetail(id: number) {
  const o = await prisma.purchaseOrder.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });
  if (!o) throw notFound('Purchase order not found');
  const d: any = await finishDoc(o, 'PURCHASE_ORDER');
  for (const it of d.items) {
    it.pendingQty = r3(Math.max(0, num(it.qty) - num(it.receivedQty)));
    it.uninvoicedQty = r3(Math.max(0, num(it.receivedQty) - num(it.invoicedQty)));
    it.unitCostBase = poUnitCostBase(it, o.exchangeRate);
  }
  Object.assign(d, orderQtys(o.items), { baseTotal: baseTotalOf(o) });
  d.advancePaid = await advancePaidFor(id);
  d.receipts = await prisma.goodsReceipt.findMany({ where: { orderId: id }, select: { id: true, docNo: true, status: true, docDate: true, grnType: true, invoiced: true }, orderBy: { id: 'asc' } });
  d.invoices = await prisma.purchaseInvoice.findMany({ where: { orderId: id }, select: { id: true, docNo: true, status: true, docDate: true, total: true, baseTotal: true, paidAmount: true }, orderBy: { id: 'asc' } });
  if (o.orderType === 'IMPORT') d.shipments = await prisma.importShipment.findMany({ where: { orderId: id }, select: { id: true, shipmentNo: true, status: true, containerNo: true, eta: true }, orderBy: { id: 'asc' } });
  return d;
}

/** Approve a PO: walks the configured approval chain (Admin may act on every step) or approves directly when no rule applies. */
export async function approveOrder(tx: Tx, id: number, user: { id: number; username: string; role: string }, comment?: string) {
  const o: any = assertStatus(await tx.purchaseOrder.findUnique({ where: { id } }), ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL'], 'approve');
  const pending = await tx.approvalRequest.findFirst({ where: { docType: 'PURCHASE_ORDER', docId: id, status: 'PENDING' } });
  if (pending) {
    let guard = 0;
    let cur = pending;
    while (cur.status === 'PENDING' && guard++ < 10) {
      cur = await actOnApproval(tx, pending.id, user, 'APPROVED', comment);
      if (user.role !== 'Admin') break;
    }
  } else {
    if (user.role !== 'Admin' && (await findRule(tx, 'PURCHASE_ORDER', baseTotalOf(o)))) throw forbidden('This order requires approval workflow: submit it first');
    await tx.purchaseOrder.update({ where: { id }, data: { status: o.orderType === 'IMPORT' ? 'CONFIRMED' : 'APPROVED' } });
    await audit(tx, user, 'APPROVE', 'PurchaseOrder', id, { direct: true, comment });
  }
}

export async function rejectOrder(tx: Tx, id: number, user: { id: number; username: string; role: string }, comment?: string) {
  assertStatus(await tx.purchaseOrder.findUnique({ where: { id } }), ['PENDING_APPROVAL', 'SUBMITTED'], 'reject');
  const pending = await tx.approvalRequest.findFirst({ where: { docType: 'PURCHASE_ORDER', docId: id, status: 'PENDING' } });
  if (pending) await actOnApproval(tx, pending.id, user, 'REJECTED', comment); // handler returns PO to DRAFT
  else await tx.purchaseOrder.update({ where: { id }, data: { status: 'DRAFT' } });
  await audit(tx, user, 'REJECT', 'PurchaseOrder', id, { comment });
}
