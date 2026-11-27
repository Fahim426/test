import { Router } from 'express';
import { prisma, partNumberProductIds } from '../lib/prisma';
import { ah, listQuery, paged } from '../lib/http';
import { badRequest } from '../lib/errors';
import { can } from '../middleware/auth';
import { enrich } from '../lib/enrich';
import { num, r2, r3 } from '../lib/calc';
import { getAvailability } from '../services/stock';
import { qDate, qInt } from '../services/finance-common';
import type { ModuleDef } from '../app';

const router = Router();

async function balanceWhere(q: Record<string, unknown>) {
  const productWhere: Record<string, unknown> = {};
  const brandId = qInt(q.brandId ?? q.brand);
  const categoryId = qInt(q.categoryId ?? q.category);
  if (brandId) productWhere.brandId = brandId;
  if (categoryId) productWhere.categoryId = categoryId;
  const search = String(q.search || '').trim();
  if (search) {
    productWhere.OR = [
      { code: { contains: search } },
      { name: { contains: search } },
      { oemNumber: { contains: search } },
      { barcode: { contains: search } },
      ...((await partNumberProductIds(search)).map((id) => ({ id }))),
    ];
  }
  const where: Record<string, unknown> = {};
  const w = qInt(q.warehouseId ?? q.warehouse);
  const p = qInt(q.productId ?? q.product);
  if (w) where.warehouseId = w;
  if (p) where.productId = p;
  if (Object.keys(productWhere).length) where.product = productWhere;
  return where;
}

const productSelect = {
  id: true,
  code: true,
  name: true,
  stockNumber: true,
  oemNumber: true,
  barcode: true,
  purchaseUnit: true,
  salesUnit: true,
  reorderLevel: true,
  minStock: true,
  maxStock: true,
  averageCost: true,
  brand: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
};

const isLow = (onHand: number, p: { reorderLevel: unknown; minStock: unknown }) => {
  const lvl = Math.max(num(p.reorderLevel), num(p.minStock));
  return lvl > 0 ? onHand <= lvl : onHand <= 0;
};

// ---------- balances (product x warehouse)
router.get(
  '/balances',
  can('stock', 'view'),
  ah(async (req, res) => {
    const q = listQuery(req);
    const where = await balanceWhere(req.query);
    const hideZero = req.query.includeZero !== '1' && req.query.includeZero !== 'true';
    if (hideZero) where.OR = [{ onHand: { not: 0 } }, { reserved: { not: 0 } }];
    const lowOnly = req.query.lowStockOnly === '1' || req.query.lowStockOnly === 'true';
    const include = { product: { select: productSelect } };
    const orderBy = [{ product: { code: 'asc' as const } }, { warehouseId: 'asc' as const }];
    let rowsRaw;
    let total;
    if (lowOnly) {
      const all = await prisma.stockBalance.findMany({ where, include, orderBy });
      const low = all.filter((b) => isLow(num(b.onHand), b.product));
      total = low.length;
      rowsRaw = low.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    } else {
      [rowsRaw, total] = await Promise.all([
        prisma.stockBalance.findMany({ where, include, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        prisma.stockBalance.count({ where }),
      ]);
    }
    const rows = rowsRaw.map((b) => {
      const onHand = num(b.onHand);
      const reserved = num(b.reserved);
      return {
        id: b.id,
        productId: b.productId,
        warehouseId: b.warehouseId,
        product: b.product,
        onHand,
        reserved,
        available: r3(onHand - reserved),
        avgCost: num(b.avgCost),
        value: r2(onHand * num(b.avgCost)),
        lowStock: isLow(onHand, b.product),
      };
    });
    await enrich(rows as unknown as Record<string, unknown>[], { warehouseId: 'warehouse' });
    res.json(paged(rows, total, q));
  }),
);

// ---------- summary (per product totals)
router.get(
  '/summary',
  can('stock', 'view'),
  ah(async (req, res) => {
    const q = listQuery(req);
    const where = await balanceWhere(req.query);
    const all = await prisma.stockBalance.findMany({ where, include: { product: { select: productSelect } } });
    const map = new Map<number, { product: (typeof all)[number]['product']; onHand: number; reserved: number; value: number; warehouses: number }>();
    for (const b of all) {
      const m = map.get(b.productId) ?? { product: b.product, onHand: 0, reserved: 0, value: 0, warehouses: 0 };
      m.onHand += num(b.onHand);
      m.reserved += num(b.reserved);
      m.value += num(b.onHand) * num(b.avgCost);
      if (num(b.onHand) !== 0) m.warehouses++;
      map.set(b.productId, m);
    }
    const lowOnly = req.query.lowStockOnly === '1' || req.query.lowStockOnly === 'true';
    let rows = [...map.entries()].map(([productId, m]) => ({
      productId,
      product: m.product,
      onHand: r3(m.onHand),
      reserved: r3(m.reserved),
      available: r3(m.onHand - m.reserved),
      value: r2(m.value),
      avgCost: m.onHand > 0 ? r2(m.value / m.onHand) : num(m.product.averageCost),
      warehouses: m.warehouses,
      lowStock: isLow(m.onHand, m.product),
    }));
    if (req.query.includeZero !== '1') rows = rows.filter((r) => r.onHand !== 0 || r.reserved !== 0);
    if (lowOnly) rows = rows.filter((r) => r.lowStock);
    rows.sort((a, b) => a.product.code.localeCompare(b.product.code));
    const totals = { onHand: r3(rows.reduce((s, r) => s + r.onHand, 0)), reserved: r3(rows.reduce((s, r) => s + r.reserved, 0)), value: r2(rows.reduce((s, r) => s + r.value, 0)) };
    res.json({ ...paged(rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), rows.length, q), totals });
  }),
);

// ---------- availability
router.get(
  '/availability',
  can('stock', 'view'),
  ah(async (req, res) => {
    const productId = qInt(req.query.productId);
    if (!productId) throw badRequest('productId is required');
    const warehouseId = qInt(req.query.warehouseId);
    const total = await getAvailability(productId, warehouseId);
    const bals = await prisma.stockBalance.findMany({ where: { productId, ...(warehouseId ? { warehouseId } : {}) } });
    const warehouses = await enrich(
      bals.map((b) => ({ warehouseId: b.warehouseId, onHand: num(b.onHand), reserved: num(b.reserved), available: r3(num(b.onHand) - num(b.reserved)), avgCost: num(b.avgCost) })) as unknown as Record<string, unknown>[],
      { warehouseId: 'warehouse' },
    );
    res.json({ productId, warehouseId: warehouseId ?? null, ...total, warehouses });
  }),
);

// ---------- ledger with running balance
router.get(
  '/ledger',
  can('stock', 'view'),
  ah(async (req, res) => {
    const productId = qInt(req.query.productId);
    if (!productId) throw badRequest('productId is required');
    const warehouseId = qInt(req.query.warehouseId);
    const from = qDate(req.query.from);
    const to = qDate(req.query.to, true);
    const type = req.query.type ? String(req.query.type) : undefined;
    const base = { productId, ...(warehouseId ? { warehouseId } : {}) };

    let openQty = 0;
    let openValue = 0;
    if (from) {
      const o = await prisma.stockTransaction.aggregate({ where: { ...base, txDate: { lt: from } }, _sum: { qty: true, value: true } });
      openQty = num(o._sum.qty);
      openValue = num(o._sum.value);
    }
    const txs = await prisma.stockTransaction.findMany({
      where: { ...base, ...(from || to ? { txDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
      orderBy: [{ txDate: 'asc' }, { id: 'asc' }],
    });
    let rq = openQty;
    let rv = openValue;
    let inQty = 0;
    let outQty = 0;
    const all = txs.map((t) => {
      const qty = num(t.qty);
      const value = num(t.value);
      rq = r3(rq + qty);
      rv = r2(rv + value);
      if (qty > 0) inQty += qty;
      else outQty += -qty;
      return {
        id: t.id,
        date: t.txDate,
        txType: t.txType,
        warehouseId: t.warehouseId,
        qty,
        inQty: qty > 0 ? qty : 0,
        outQty: qty < 0 ? -qty : 0,
        unitCost: num(t.unitCost),
        value,
        runningQty: rq,
        runningValue: rv,
        refType: t.refType,
        refId: t.refId,
        refNo: t.refNo,
        remarks: t.remarks,
      };
    });
    const entries = await enrich((type ? all.filter((e) => e.txType === type) : all) as unknown as Record<string, unknown>[], { warehouseId: 'warehouse' });
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, code: true, name: true, oemNumber: true, purchaseUnit: true } });
    res.json({
      product,
      warehouseId: warehouseId ?? null,
      from: from ?? null,
      to: to ?? null,
      openingQty: r3(openQty),
      openingValue: r2(openValue),
      totalIn: r3(inQty),
      totalOut: r3(outQty),
      closingQty: rq,
      closingValue: rv,
      entries,
    });
  }),
);

// ---------- valuation
router.get(
  '/valuation',
  can('stock', 'view'),
  ah(async (req, res) => {
    const q = listQuery(req);
    const where = { ...(await balanceWhere(req.query)), onHand: { not: 0 } };
    const all = await prisma.stockBalance.findMany({
      where,
      include: { product: { select: { id: true, code: true, name: true, brand: { select: { name: true } }, category: { select: { name: true } } } } },
      orderBy: [{ warehouseId: 'asc' }, { product: { code: 'asc' } }],
    });
    const rowsAll = all.map((b) => ({
      productId: b.productId,
      warehouseId: b.warehouseId,
      product: b.product,
      onHand: num(b.onHand),
      avgCost: num(b.avgCost),
      value: r2(num(b.onHand) * num(b.avgCost)),
    }));
    const byWh = new Map<number, { warehouseId: number; qty: number; value: number }>();
    for (const r of rowsAll) {
      const w = byWh.get(r.warehouseId) ?? { warehouseId: r.warehouseId, qty: 0, value: 0 };
      w.qty += r.onHand;
      w.value += r.value;
      byWh.set(r.warehouseId, w);
    }
    const warehouses = await enrich([...byWh.values()].map((w) => ({ ...w, qty: r3(w.qty), value: r2(w.value) })) as unknown as Record<string, unknown>[], { warehouseId: 'warehouse' });
    const rows = await enrich(rowsAll.slice((q.page - 1) * q.pageSize, q.page * q.pageSize) as unknown as Record<string, unknown>[], { warehouseId: 'warehouse' });
    res.json({
      ...paged(rows, rowsAll.length, q),
      byWarehouse: warehouses,
      totals: { qty: r3(rowsAll.reduce((s, r) => s + r.onHand, 0)), value: r2(rowsAll.reduce((s, r) => s + r.value, 0)) },
    });
  }),
);

// ---------- reservations
router.get(
  '/reservations',
  can('stock', 'view'),
  ah(async (req, res) => {
    const q = listQuery(req);
    const where: Record<string, unknown> = {};
    const status = req.query.status ? String(req.query.status) : 'ACTIVE';
    if (status !== 'ALL') where.status = status;
    for (const k of ['salesOrderId', 'customerId', 'productId', 'warehouseId'] as const) {
      const v = qInt(req.query[k]);
      if (v) where[k] = v;
    }
    if (q.search) where.salesOrderNo = { contains: q.search };
    const [rowsRaw, total, agg] = await Promise.all([
      prisma.stockReservation.findMany({ where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.stockReservation.count({ where }),
      prisma.stockReservation.aggregate({ where, _sum: { qty: true, fulfilledQty: true } }),
    ]);
    const rows = rowsRaw.map((r) => ({ ...r, qty: num(r.qty), fulfilledQty: num(r.fulfilledQty), remainingQty: r3(num(r.qty) - num(r.fulfilledQty)) }));
    await enrich(rows as unknown as Record<string, unknown>[], { customerId: 'customer', productId: 'product', warehouseId: 'warehouse' });
    const reservedTotal = num(agg._sum.qty);
    res.json({ ...paged(rows, total, q), totals: { qty: r3(reservedTotal), fulfilledQty: r3(num(agg._sum.fulfilledQty)), remainingQty: r3(reservedTotal - num(agg._sum.fulfilledQty)) } });
  }),
);

// ---------- reconcile: StockBalance.onHand == Σ StockTransaction.qty
router.get(
  '/reconcile',
  can('stock', 'view'),
  ah(async (_req, res) => {
    const [sums, bals, resv] = await Promise.all([
      prisma.stockTransaction.groupBy({ by: ['productId', 'warehouseId'], _sum: { qty: true } }),
      prisma.stockBalance.findMany(),
      prisma.stockReservation.groupBy({ by: ['productId', 'warehouseId'], where: { status: 'ACTIVE' }, _sum: { qty: true, fulfilledQty: true } }),
    ]);
    const key = (p: number, w: number) => `${p}:${w}`;
    const txMap = new Map(sums.map((s) => [key(s.productId, s.warehouseId), num(s._sum.qty)]));
    const balMap = new Map(bals.map((b) => [key(b.productId, b.warehouseId), b]));
    const discrepancies: Array<{ productId: number; warehouseId: number; balanceOnHand: number; transactionsQty: number; difference: number }> = [];
    for (const k of new Set([...txMap.keys(), ...balMap.keys()])) {
      const [p, w] = k.split(':').map(Number);
      const b = num(balMap.get(k)?.onHand);
      const t = txMap.get(k) ?? 0;
      if (Math.abs(b - t) > 0.0005) discrepancies.push({ productId: p, warehouseId: w, balanceOnHand: b, transactionsQty: t, difference: r3(b - t) });
    }
    const resMap = new Map(resv.map((r) => [key(r.productId, r.warehouseId), num(r._sum.qty) - num(r._sum.fulfilledQty)]));
    const reservedDiscrepancies: Array<{ productId: number; warehouseId: number; balanceReserved: number; activeReservations: number; difference: number }> = [];
    for (const k of new Set([...resMap.keys(), ...balMap.keys()])) {
      const [p, w] = k.split(':').map(Number);
      const b = num(balMap.get(k)?.reserved);
      const t = resMap.get(k) ?? 0;
      if (Math.abs(b - t) > 0.0005) reservedDiscrepancies.push({ productId: p, warehouseId: w, balanceReserved: b, activeReservations: r3(t), difference: r3(b - t) });
    }
    const dEnriched = await enrich(discrepancies as unknown as Record<string, unknown>[], { productId: 'product', warehouseId: 'warehouse' });
    const rEnriched = await enrich(reservedDiscrepancies as unknown as Record<string, unknown>[], { productId: 'product', warehouseId: 'warehouse' });
    res.json({
      ok: discrepancies.length === 0,
      checked: new Set([...txMap.keys(), ...balMap.keys()]).size,
      discrepancies: dEnriched,
      reservedOk: reservedDiscrepancies.length === 0,
      reservedDiscrepancies: rEnriched,
    });
  }),
);

export default [{ path: '/stock', router }] satisfies ModuleDef[];
