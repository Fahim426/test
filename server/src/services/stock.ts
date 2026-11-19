import { prisma, Tx } from '../lib/prisma';
import { badRequest } from '../lib/errors';
import { num, r2, r3, r4 } from '../lib/calc';

/**
 * STOCK ENGINE — the ONLY place that mutates StockBalance / writes StockTransaction.
 * Never update stock quantities anywhere else. Always call these inside a prisma.$transaction.
 */

export type StockTxType =
  | 'OPENING'
  | 'PURCHASE_RECEIPT'
  | 'SALES_DELIVERY'
  | 'SALES_RETURN'
  | 'PURCHASE_RETURN'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'ADJUSTMENT'
  | 'COUNT'
  | 'DAMAGE'
  | 'SCRAP'
  | 'WAREHOUSE_RECEIPT'
  | 'LANDED_COST_ADJ';

export interface PostStockInput {
  txType: StockTxType;
  productId: number;
  warehouseId: number;
  qty: number; // signed: + increases, - decreases
  unitCost?: number; // required for inbound; for outbound the current avg cost is used
  locationId?: number;
  refType?: string;
  refId?: number;
  refNo?: string;
  remarks?: string;
  date?: Date;
  userId?: number;
  allowNegative?: boolean;
  /** when true, an outbound movement is allowed to consume reserved stock (e.g. delivery fulfilling its own reservation) */
  consumesReservation?: boolean;
}

async function balanceRow(tx: Tx, productId: number, warehouseId: number) {
  const key = { productId_warehouseId: { productId, warehouseId } };
  let row = await tx.stockBalance.findUnique({ where: key });
  if (!row) {
    try {
      row = await tx.stockBalance.create({ data: { productId, warehouseId } });
    } catch {
      row = await tx.stockBalance.findUnique({ where: key }); // lost a creation race
    }
  }
  // No-op update takes the row lock until commit, then re-read so concurrent postings cannot lose updates.
  await tx.stockBalance.update({ where: key, data: { onHand: { increment: 0 } } });
  return tx.stockBalance.findUniqueOrThrow({ where: key });
}

/** Recompute product-level weighted average cost from all warehouse balances. */
async function refreshProductAvgCost(tx: Tx, productId: number) {
  const rows = await tx.stockBalance.findMany({ where: { productId } });
  let qty = 0;
  let val = 0;
  for (const b of rows) {
    qty += num(b.onHand);
    val += num(b.onHand) * num(b.avgCost);
  }
  if (qty > 0) await tx.product.update({ where: { id: productId }, data: { averageCost: r4(val / qty) } });
}

/** Creates the stock transaction and updates the balance cache. Returns the transaction (with unitCost used). */
export async function postStock(tx: Tx, i: PostStockInput) {
  if (!i.qty) throw badRequest('Stock movement quantity cannot be zero');
  const bal = await balanceRow(tx, i.productId, i.warehouseId);
  const onHand = num(bal.onHand);
  const reserved = num(bal.reserved);
  const avg = num(bal.avgCost);
  let unitCost: number;
  let newAvg = avg;

  if (i.qty > 0) {
    unitCost = i.unitCost !== undefined ? i.unitCost : avg;
    const base = Math.max(onHand, 0);
    const newQty = base + i.qty;
    newAvg = newQty > 0 ? r4((base * avg + i.qty * unitCost) / newQty) : unitCost;
  } else {
    unitCost = i.unitCost !== undefined && i.txType === 'PURCHASE_RETURN' ? i.unitCost : avg;
    const after = onHand + i.qty;
    if (!i.allowNegative) {
      if (after < 0) {
        const p = await tx.product.findUnique({ where: { id: i.productId }, select: { code: true } });
        throw badRequest(`Insufficient stock for ${p?.code ?? i.productId}: on hand ${onHand}, requested ${-i.qty}`);
      }
      if (!i.consumesReservation && after < reserved) {
        const p = await tx.product.findUnique({ where: { id: i.productId }, select: { code: true } });
        throw badRequest(`Stock for ${p?.code ?? i.productId} is reserved: available ${r3(onHand - reserved)}, requested ${-i.qty}`);
      }
    }
  }

  const row = await tx.stockTransaction.create({
    data: {
      txDate: i.date ?? new Date(),
      txType: i.txType,
      productId: i.productId,
      warehouseId: i.warehouseId,
      locationId: i.locationId,
      qty: i.qty,
      unitCost,
      value: r2(i.qty * unitCost),
      refType: i.refType,
      refId: i.refId,
      refNo: i.refNo,
      remarks: i.remarks,
      createdBy: i.userId,
    },
  });
  await tx.stockBalance.update({
    where: { id: bal.id },
    data: { onHand: r3(onHand + i.qty), avgCost: newAvg },
  });
  if (i.qty > 0 && i.txType === 'PURCHASE_RECEIPT') {
    await tx.product.update({ where: { id: i.productId }, data: { lastPurchasePrice: unitCost } });
  }
  await refreshProductAvgCost(tx, i.productId);
  return row;
}

/** Re-values existing stock after landed cost is applied (value-only transaction, qty 0 effect on quantity). */
export async function revalueStock(
  tx: Tx,
  i: { productId: number; warehouseId: number; extraValue: number; refType: string; refId: number; refNo: string; userId?: number; date?: Date },
) {
  const bal = await balanceRow(tx, i.productId, i.warehouseId);
  const onHand = num(bal.onHand);
  const avg = num(bal.avgCost);
  const newAvg = onHand > 0 ? r4((onHand * avg + i.extraValue) / onHand) : avg;
  await tx.stockTransaction.create({
    data: {
      txDate: i.date ?? new Date(),
      txType: 'LANDED_COST_ADJ',
      productId: i.productId,
      warehouseId: i.warehouseId,
      qty: 0,
      unitCost: newAvg,
      value: r2(i.extraValue),
      refType: i.refType,
      refId: i.refId,
      refNo: i.refNo,
      createdBy: i.userId,
    },
  });
  await tx.stockBalance.update({ where: { id: bal.id }, data: { avgCost: newAvg } });
  await refreshProductAvgCost(tx, i.productId);
  return newAvg;
}

/** Available-to-sell = onHand - reserved */
export async function getAvailability(productId: number, warehouseId?: number, tx: Tx | typeof prisma = prisma) {
  const rows = await tx.stockBalance.findMany({ where: { productId, ...(warehouseId ? { warehouseId } : {}) } });
  const onHand = rows.reduce((s, r) => s + num(r.onHand), 0);
  const reserved = rows.reduce((s, r) => s + num(r.reserved), 0);
  return { onHand: r3(onHand), reserved: r3(reserved), available: r3(onHand - reserved) };
}

/** Reserve stock for a sales order line (does NOT reduce physical stock). */
export async function reserveStock(
  tx: Tx,
  i: { salesOrderId: number; salesOrderNo: string; customerId: number; productId: number; warehouseId: number; qty: number },
) {
  const bal = await balanceRow(tx, i.productId, i.warehouseId);
  const available = num(bal.onHand) - num(bal.reserved);
  if (available < i.qty) {
    const p = await tx.product.findUnique({ where: { id: i.productId }, select: { code: true } });
    throw badRequest(`Cannot reserve ${i.qty} of ${p?.code ?? i.productId}: only ${r3(available)} available`);
  }
  await tx.stockBalance.update({ where: { id: bal.id }, data: { reserved: r3(num(bal.reserved) + i.qty) } });
  return tx.stockReservation.create({ data: { ...i, qty: i.qty } });
}

/** Release the unfulfilled part of all ACTIVE reservations of a sales order (cancel / close). */
export async function releaseOrderReservations(tx: Tx, salesOrderId: number) {
  const rows = await tx.stockReservation.findMany({ where: { salesOrderId, status: 'ACTIVE' } });
  for (const r of rows) {
    const remaining = num(r.qty) - num(r.fulfilledQty);
    if (remaining > 0) {
      const bal = await balanceRow(tx, r.productId, r.warehouseId);
      await tx.stockBalance.update({ where: { id: bal.id }, data: { reserved: r3(Math.max(0, num(bal.reserved) - remaining)) } });
    }
    await tx.stockReservation.update({ where: { id: r.id }, data: { status: 'RELEASED' } });
  }
}

/** Called by delivery posting: consumes reservation (reserved decreases) for delivered qty. */
export async function fulfillReservation(tx: Tx, salesOrderId: number, productId: number, qty: number) {
  let left = qty;
  const rows = await tx.stockReservation.findMany({ where: { salesOrderId, productId, status: 'ACTIVE' }, orderBy: { id: 'asc' } });
  for (const r of rows) {
    if (left <= 0) break;
    const remaining = num(r.qty) - num(r.fulfilledQty);
    const take = Math.min(remaining, left);
    if (take <= 0) continue;
    const bal = await balanceRow(tx, r.productId, r.warehouseId);
    await tx.stockBalance.update({ where: { id: bal.id }, data: { reserved: r3(Math.max(0, num(bal.reserved) - take)) } });
    const fulfilled = num(r.fulfilledQty) + take;
    await tx.stockReservation.update({
      where: { id: r.id },
      data: { fulfilledQty: fulfilled, status: fulfilled >= num(r.qty) ? 'FULFILLED' : 'ACTIVE' },
    });
    left -= take;
  }
}
