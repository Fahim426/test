import { Request } from 'express';
import { prisma, Tx } from '../lib/prisma';
import { badRequest } from '../lib/errors';
import { enrich } from '../lib/enrich';
import { reserveStock } from './stock';
import { customerBalance } from './accounting';
import { audit } from './audit';
import { approvalFor, docLinks, creditMode, boolSetting, reservedByProduct, allocateReserved, availabilityFor, num, r2, r3, pct } from './sales-common';

/** Per-request override of `sales.allowBackorder` (e.g. POST /:id/approve?allowBackorder=true). Keyed by order id. */
export const backorderOverride = new Map<number, boolean>();

export interface Shortage {
  productId: number;
  productCode: string;
  required: number;
  available: number;
  short: number;
}

/** Credit-limit check. Returns warnings (warn mode) or throws (block mode). */
export async function creditCheck(tx: Tx, order: { id: number; docNo: string; customerId: number; total: unknown; exchangeRate: unknown }): Promise<string[]> {
  const mode = await creditMode(tx);
  if (mode === 'off') return [];
  const cust = await tx.customer.findUnique({ where: { id: order.customerId } });
  const limit = num(cust?.creditLimit);
  if (!cust || limit <= 0) return [];
  const bal = await customerBalance(cust.id, tx);
  const orderBase = r2(num(order.total) * (num(order.exchangeRate) || 1));
  const exposure = r2(bal + orderBase);
  if (exposure <= limit) return [];
  const msg = `Credit limit exceeded for ${cust.code} ${cust.name}: limit ${limit.toFixed(2)}, current balance ${bal.toFixed(2)} + this order ${orderBase.toFixed(2)} = ${exposure.toFixed(2)}`;
  if (mode === 'block') throw badRequest(msg, { creditLimit: limit, balance: bal, orderTotal: orderBase });
  return [msg];
}

/** Reserves (does not deduct) stock for every undelivered line. Idempotent: only reserves what is not yet reserved. */
export async function reserveForOrder(tx: Tx, orderId: number, allowBackorder: boolean) {
  const o = await tx.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  const have = await reservedByProduct(tx, orderId);
  const need = new Map<number, number>();
  for (const it of o.items) need.set(it.productId, r3((need.get(it.productId) ?? 0) + Math.max(0, num(it.qty) - num(it.deliveredQty))));
  const codes = new Map((await tx.product.findMany({ where: { id: { in: [...need.keys()] } }, select: { id: true, code: true } })).map((p) => [p.id, p.code]));
  const plan: { productId: number; qty: number }[] = [];
  const shortages: Shortage[] = [];
  for (const [productId, n] of need) {
    const missing = r3(n - (have.get(productId) ?? 0));
    if (missing <= 0) continue;
    const bal = await tx.stockBalance.findUnique({ where: { productId_warehouseId: { productId, warehouseId: o.warehouseId } } });
    const avail = Math.max(0, r3(num(bal?.onHand) - num(bal?.reserved)));
    if (avail >= missing) plan.push({ productId, qty: missing });
    else {
      shortages.push({ productId, productCode: codes.get(productId) ?? String(productId), required: missing, available: avail, short: r3(missing - avail) });
      if (allowBackorder && avail > 0) plan.push({ productId, qty: avail });
    }
  }
  if (shortages.length && !allowBackorder) {
    throw badRequest(
      `Cannot approve ${o.docNo}: insufficient available stock for ${shortages.map((s) => `${s.productCode} (required ${s.required}, available ${s.available}, short ${s.short})`).join('; ')}`,
      { shortages },
    );
  }
  for (const p of plan) {
    await reserveStock(tx, { salesOrderId: o.id, salesOrderNo: o.docNo, customerId: o.customerId, productId: p.productId, warehouseId: o.warehouseId, qty: p.qty });
  }
  return { shortages, reserved: plan };
}

/** Moves a PENDING_APPROVAL/DRAFT order to APPROVED and reserves stock. Throws (rolling back the tx) on shortage. */
export async function approveOrderTx(tx: Tx, orderId: number, user?: Request['user']) {
  const o = await tx.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (!['PENDING_APPROVAL', 'DRAFT'].includes(o.status)) throw badRequest(`Cannot approve: order status is ${o.status}`);
  await creditCheck(tx, o); // block mode throws; warnings are recomputed by callers
  // negative-stock selling (temporary, until go-live) never stops on a shortage
  const allow = backorderOverride.get(orderId) ?? ((await boolSetting('sales.allowBackorder', false, tx)) || (await boolSetting('sales.allowNegativeStock', false, tx)));
  const r = await reserveForOrder(tx, orderId, allow);
  await tx.salesOrder.update({ where: { id: orderId }, data: { status: 'APPROVED' } });
  await audit(tx, user, 'APPROVE', 'SalesOrder', orderId, { reserved: r.reserved, backorder: r.shortages });
  return r;
}

export function rejectOrderTx(tx: Tx, orderId: number) {
  return tx.salesOrder.updateMany({ where: { id: orderId, status: 'PENDING_APPROVAL' }, data: { status: 'DRAFT' } });
}

/** Full order document: lines with ordered/reserved/picked/delivered/invoiced/pending + reservations. */
export async function orderDetail(id: number) {
  const o = await prisma.salesOrder.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });
  if (!o) return null;
  const [row] = await enrich([o as unknown as Record<string, unknown>], { customerId: 'customer', salesmanId: 'salesman', warehouseId: 'warehouse' });
  const items = await enrich(o.items as unknown as Record<string, unknown>[], { productId: 'product' });
  const res = await reservedByProduct(prisma, id);
  const alloc = allocateReserved(o.items, res);
  const live = ['APPROVED', 'PARTIALLY_DELIVERED'].includes(o.status);
  const av = await availabilityFor(prisma, [...new Set(o.items.map((i) => i.productId))], o.warehouseId);
  for (const it of items) {
    const qty = num(it.qty);
    const delivered = num(it.deliveredQty);
    const reserved = alloc.get(it.id as number) ?? 0;
    const pending = Math.max(0, r3(qty - delivered));
    it.ordered = qty;
    it.reserved = reserved;
    it.picked = num(it.pickedQty);
    it.delivered = delivered;
    it.invoiced = num(it.invoicedQty);
    it.pending = pending;
    it.toInvoice = Math.max(0, r3(delivered - num(it.invoicedQty)));
    it.backorder = live && pending > 0 && reserved < pending;
    it.backorderQty = live ? Math.max(0, r3(pending - reserved)) : 0;
    const a = av.get(it.productId as number)!;
    it.availability = { availableStock: a.onHand, reservedStock: a.reserved, availableToSell: a.availableToSell };
  }
  const reservations = await enrich(
    (await prisma.stockReservation.findMany({ where: { salesOrderId: id }, orderBy: { id: 'asc' } })) as unknown as Record<string, unknown>[],
    { productId: 'product', warehouseId: 'warehouse' },
  );
  const approval = await approvalFor('SALES_ORDER', id);
  return { ...row, items, reservations, summary: summary(o.items), links: await docLinks('SALES_ORDER', id), approval };
}

export function summary(items: { qty: unknown; pickedQty: unknown; deliveredQty: unknown; invoicedQty: unknown }[]) {
  const q = items.reduce((s, i) => s + num(i.qty), 0);
  const d = items.reduce((s, i) => s + Math.min(num(i.deliveredQty), num(i.qty)), 0);
  const inv = items.reduce((s, i) => s + Math.min(num(i.invoicedQty), num(i.qty)), 0);
  const pk = items.reduce((s, i) => s + Math.min(num(i.pickedQty), num(i.qty)), 0);
  return { orderedQty: r3(q), pickedQty: r3(pk), deliveredQty: r3(d), invoicedQty: r3(inv), deliveredPct: pct(d, q), invoicedPct: pct(inv, q), pickedPct: pct(pk, q) };
}
