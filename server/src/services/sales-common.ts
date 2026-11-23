import { Request } from 'express';
import { z } from 'zod';
import { prisma, Tx } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { num, r2, r3, r4, calcLine, calcTotals } from '../lib/calc';
import { listQuery } from '../lib/http';
import { enrich } from '../lib/enrich';
import { getLinks } from './docLink';

/* ------------------------------------------------------------------ settings */
export async function getSetting(key: string, def: string, tx: Tx | typeof prisma = prisma): Promise<string> {
  const s = await tx.systemSetting.findUnique({ where: { key } });
  return s ? String(s.value).trim() : def;
}
export async function boolSetting(key: string, def: boolean, tx: Tx | typeof prisma = prisma): Promise<boolean> {
  const v = (await getSetting(key, def ? 'true' : 'false', tx)).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}
export type CreditMode = 'off' | 'warn' | 'block';
export async function creditMode(tx: Tx | typeof prisma = prisma): Promise<CreditMode> {
  const v = (await getSetting('sales.creditLimitMode', 'warn', tx)).toLowerCase();
  return v === 'off' || v === 'block' ? v : 'warn';
}

/* ------------------------------------------------------------------ lines */
export const lineIn = z.object({
  id: z.coerce.number().int().optional(),
  productId: z.coerce.number().int(),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().min(0).optional().nullable(),
  discount: z.coerce.number().min(0).optional().nullable(),
  vatRate: z.coerce.number().min(0).optional().nullable(),
  description: z.string().optional().nullable(),
  oemNumber: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
});
export type LineIn = z.infer<typeof lineIn>;

export interface PreparedLine {
  productId: number;
  oemNumber: string | null;
  description: string | null;
  qty: number;
  unit: string | null;
  rate: number;
  discount: number;
  vatRate: number;
  vatAmount: number;
  amount: number;
}

/** Defaults rate from product price list (retail/wholesale), VAT rate from product, then recomputes line + totals. */
export async function prepareLines(tx: Tx, lines: LineIn[], opts: { priceType?: string; roundOff?: number } = {}) {
  if (!lines.length) throw badRequest('At least one item is required');
  const ids = [...new Set(lines.map((l) => l.productId))];
  const prods = await tx.product.findMany({ where: { id: { in: ids } } });
  const byId = new Map(prods.map((p) => [p.id, p]));
  const out: PreparedLine[] = [];
  for (const l of lines) {
    const p = byId.get(l.productId);
    if (!p) throw badRequest(`Product ${l.productId} not found`);
    const priceType = (opts.priceType || 'RETAIL').toUpperCase();
    const defRate = priceType === 'WHOLESALE' ? num(p.wholesalePrice) : num(p.retailPrice);
    const rate = l.rate === undefined || l.rate === null ? defRate : l.rate;
    const vatRate = l.vatRate === undefined || l.vatRate === null ? num(p.vatRate) : l.vatRate;
    const discount = l.discount ?? 0;
    const c = calcLine({ qty: l.qty, rate, discount, vatRate });
    if (c.net < 0) throw badRequest(`Discount exceeds line value for ${p.code}`);
    out.push({
      productId: l.productId,
      oemNumber: l.oemNumber ?? p.oemNumber ?? null,
      description: l.description ?? p.name,
      qty: l.qty,
      unit: l.unit ?? p.salesUnit ?? null,
      rate,
      discount,
      vatRate,
      vatAmount: c.vatAmount,
      amount: c.amount,
    });
  }
  const totals = calcTotals(out, opts.roundOff ?? 0);
  return { lines: out, totals };
}

/* ------------------------------------------------------------------ misc lookups */
export async function resolveRate(tx: Tx | typeof prisma, code: string | undefined, given?: number | null) {
  if (given !== undefined && given !== null && given > 0) return given;
  if (!code) return 1;
  const c = await tx.currency.findUnique({ where: { code } });
  if (!c) return 1;
  return c.isBase ? 1 : num(c.rate) || 1;
}

export async function defaultWarehouseId(tx: Tx | typeof prisma, given?: number | null): Promise<number> {
  if (given) {
    const w = await tx.warehouse.findUnique({ where: { id: given } });
    if (!w) throw badRequest('Warehouse not found');
    return w.id;
  }
  const w = await tx.warehouse.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } });
  if (!w) throw badRequest('No warehouse configured');
  return w.id;
}

export async function mustCustomer(tx: Tx | typeof prisma, id: number) {
  const c = await tx.customer.findUnique({ where: { id } });
  if (!c) throw badRequest('Customer not found');
  if (!c.isActive) throw badRequest(`Customer ${c.code} is inactive`);
  return c;
}

/** payment term text (code or name) or the customer's default term -> {name, days} */
export async function resolveTerm(tx: Tx | typeof prisma, text: string | null | undefined, customerPaymentTermId?: number | null) {
  let t = null;
  if (text) t = await tx.paymentTerm.findFirst({ where: { OR: [{ code: text }, { name: text }] } });
  if (!t && !text && customerPaymentTermId) t = await tx.paymentTerm.findUnique({ where: { id: customerPaymentTermId } });
  return { name: text || t?.name || null, days: t ? t.days : 0, basis: t?.basis ?? 'INVOICE_DATE' };
}

export const addDays = (d: Date, days: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

export function mustStatus(doc: { status: string }, allowed: string[], what: string) {
  if (!allowed.includes(doc.status)) throw badRequest(`Cannot ${what}: document status is ${doc.status} (allowed: ${allowed.join(', ')})`);
}

export function mustFound<T>(row: T | null | undefined, what = 'Document'): T {
  if (!row) throw notFound(`${what} not found`);
  return row;
}

/* ------------------------------------------------------------------ list helper */
const SORTABLE = new Set(['id', 'docNo', 'docDate', 'total', 'status', 'createdAt', 'customerId']);

export async function buildListWhere(req: Request, opts: { extra?: Record<string, unknown>; searchFields?: string[]; dateField?: string } = {}) {
  const q = listQuery(req);
  const where: Record<string, unknown> = { ...(opts.extra ?? {}) };
  const and: Record<string, unknown>[] = [];
  const status = String(req.query.status || '').trim();
  if (status) where.status = status.includes(',') ? { in: status.split(',').map((s) => s.trim()) } : status;
  for (const k of ['customerId', 'warehouseId', 'salesmanId', 'salesOrderId', 'invoiceId']) {
    if (req.query[k] !== undefined && req.query[k] !== '' && Number.isFinite(Number(req.query[k]))) where[k] = Number(req.query[k]);
  }
  const df = opts.dateField ?? 'docDate';
  const range: Record<string, Date> = {};
  if (req.query.from) range.gte = new Date(String(req.query.from));
  if (req.query.to) {
    const t = new Date(String(req.query.to));
    t.setHours(23, 59, 59, 999);
    range.lte = t;
  }
  if (range.gte || range.lte) where[df] = range;
  if (q.search) {
    const or: Record<string, unknown>[] = (opts.searchFields ?? ['docNo', 'remarks']).map((f) => ({ [f]: { contains: q.search } }));
    const custs = await prisma.customer.findMany({ where: { OR: [{ name: { contains: q.search } }, { code: { contains: q.search } }] }, select: { id: true }, take: 200 });
    if (custs.length) or.push({ customerId: { in: custs.map((c) => c.id) } });
    and.push({ OR: or });
  }
  if (and.length) where.AND = and;
  const sortKey = q.sort && SORTABLE.has(q.sort) ? q.sort : 'id';
  return { q, where, orderBy: { [sortKey]: q.dir } as Record<string, 'asc' | 'desc'> };
}

/* ------------------------------------------------------------------ shared detail bits */
export async function approvalFor(docType: string, docId: number) {
  return prisma.approvalRequest.findFirst({ where: { docType, docId }, orderBy: { id: 'desc' }, include: { actions: { orderBy: { id: 'asc' } } } });
}
export async function docLinks(type: string, id: number) {
  return getLinks(type, id);
}
export async function enrichItems<T extends Record<string, unknown>>(items: T[]) {
  return enrich(items, { productId: 'product' });
}

/* ------------------------------------------------------------------ availability */
export async function availabilityFor(tx: Tx | typeof prisma, productIds: number[], warehouseId?: number | null) {
  const rows = productIds.length
    ? await tx.stockBalance.findMany({ where: { productId: { in: productIds }, ...(warehouseId ? { warehouseId } : {}) } })
    : [];
  const map = new Map<number, { onHand: number; reserved: number; available: number; availableToSell: number }>();
  for (const id of productIds) map.set(id, { onHand: 0, reserved: 0, available: 0, availableToSell: 0 });
  for (const r of rows) {
    const a = map.get(r.productId)!;
    a.onHand = r3(a.onHand + num(r.onHand));
    a.reserved = r3(a.reserved + num(r.reserved));
    a.available = r3(a.onHand - a.reserved);
    a.availableToSell = Math.max(0, a.available);
  }
  return map;
}

/* ------------------------------------------------------------------ order helpers */
/** Outstanding (unfulfilled) ACTIVE reservation qty per product for an order. */
export async function reservedByProduct(tx: Tx | typeof prisma, salesOrderId: number) {
  const rows = await tx.stockReservation.findMany({ where: { salesOrderId, status: 'ACTIVE' } });
  const m = new Map<number, number>();
  for (const r of rows) m.set(r.productId, r3((m.get(r.productId) ?? 0) + num(r.qty) - num(r.fulfilledQty)));
  return m;
}

/** Splits product-level reserved qty across order lines in order (capped by each line's undelivered qty). */
export function allocateReserved(items: { id: number; productId: number; qty: unknown; deliveredQty: unknown }[], res: Map<number, number>) {
  const left = new Map(res);
  const out = new Map<number, number>();
  for (const it of items) {
    const pend = Math.max(0, num(it.qty) - num(it.deliveredQty));
    const have = left.get(it.productId) ?? 0;
    const a = r3(Math.min(pend, have));
    out.set(it.id, a);
    left.set(it.productId, r3(have - a));
  }
  return out;
}

/** Recomputes SalesOrder.status from delivered/invoiced quantities (only for live statuses). */
export async function refreshOrderStatus(tx: Tx, orderId: number) {
  const o = await tx.salesOrder.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!o) return null;
  if (!['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'INVOICED'].includes(o.status)) return o.status;
  const allDel = o.items.every((i) => num(i.deliveredQty) >= num(i.qty) - 0.0005);
  const anyDel = o.items.some((i) => num(i.deliveredQty) > 0);
  const allInv = o.items.every((i) => num(i.invoicedQty) >= num(i.qty) - 0.0005);
  const status = allDel && allInv ? 'INVOICED' : allDel ? 'DELIVERED' : anyDel ? 'PARTIALLY_DELIVERED' : 'APPROVED';
  if (status !== o.status) await tx.salesOrder.update({ where: { id: orderId }, data: { status } });
  return status;
}

export const pct = (a: number, b: number) => (b > 0 ? r2(Math.min(100, (a / b) * 100)) : 0);
export { r2, r3, r4, num, calcLine, calcTotals };
