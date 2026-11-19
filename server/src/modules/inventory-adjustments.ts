import { revisionSnapshot, auditRevision } from '../services/revisions-history';
import { Router } from 'express';
import { z } from 'zod';
import { prisma, Tx } from '../lib/prisma';
import { ah, intParam, listQuery, parse, paged } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { enrich } from '../lib/enrich';
import { num, r2, r3, r4 } from '../lib/calc';
import { postStock, StockTxType } from '../services/stock';
import { postJournal } from '../services/accounting';
import { nextNumber } from '../services/numbering';
import { audit } from '../services/audit';
import { qDate, qInt } from '../services/finance-common';
import type { ModuleDef } from '../app';

const router = Router();
const TYPES = ['OPENING', 'ADJUSTMENT', 'COUNT', 'DAMAGE', 'SCRAP', 'WAREHOUSE_RECEIPT'] as const;
type AdjType = (typeof TYPES)[number];

const itemSchema = z.object({
  productId: z.number().int(),
  qtyChange: z.number().optional(),
  countedQty: z.number().min(0).optional(),
  systemQty: z.number().optional(),
  unitCost: z.number().min(0).optional(),
});
const bodySchema = z.object({
  adjType: z.enum(TYPES),
  txDate: z.coerce.date().optional(),
  warehouseId: z.number().int(),
  reason: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1),
});

async function defaultCost(tx: Tx | typeof prisma, productId: number, warehouseId: number) {
  const b = await tx.stockBalance.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
  if (b && num(b.avgCost) > 0) return num(b.avgCost);
  const p = await tx.product.findUnique({ where: { id: productId }, select: { averageCost: true, costPrice: true } });
  return num(p?.averageCost) || num(p?.costPrice);
}

/** Normalises the lines according to the adjustment type (sign rules, count difference, default cost). */
async function buildItems(tx: Tx | typeof prisma, type: AdjType, warehouseId: number, items: z.infer<typeof itemSchema>[]) {
  const seen = new Set<number>();
  const out: Array<{ productId: number; systemQty: number; countedQty: number; qtyChange: number; unitCost: number }> = [];
  for (const it of items) {
    if (seen.has(it.productId)) throw badRequest('Duplicate product in adjustment lines');
    seen.add(it.productId);
    const prod = await tx.product.findUnique({ where: { id: it.productId }, select: { id: true, code: true } });
    if (!prod) throw badRequest(`Product ${it.productId} not found`);
    let systemQty = 0;
    let countedQty = 0;
    let qtyChange = 0;
    if (type === 'COUNT') {
      if (it.countedQty === undefined) throw badRequest(`Counted quantity required for ${prod.code}`);
      const b = await tx.stockBalance.findUnique({ where: { productId_warehouseId: { productId: it.productId, warehouseId } } });
      systemQty = it.systemQty !== undefined ? it.systemQty : num(b?.onHand);
      countedQty = it.countedQty;
      qtyChange = r3(countedQty - systemQty);
    } else {
      if (it.qtyChange === undefined || it.qtyChange === 0) throw badRequest(`Quantity required for ${prod.code}`);
      qtyChange = it.qtyChange;
      if (type === 'OPENING' || type === 'WAREHOUSE_RECEIPT') {
        if (qtyChange < 0) throw badRequest(`${type} quantities must be positive (${prod.code})`);
      } else if (type === 'DAMAGE' || type === 'SCRAP') {
        qtyChange = -Math.abs(qtyChange);
      }
    }
    let unitCost = it.unitCost ?? 0;
    if (qtyChange > 0 && !unitCost) unitCost = await defaultCost(tx, it.productId, warehouseId);
    out.push({ productId: it.productId, systemQty, countedQty, qtyChange, unitCost });
  }
  return out;
}

async function load(id: number) {
  const adj = await prisma.stockAdjustment.findUnique({ where: { id }, include: { items: true } });
  if (!adj) throw notFound('Stock adjustment not found');
  return adj;
}

async function present(adj: Awaited<ReturnType<typeof load>>) {
  const items = adj.items.map((i) => ({
    ...i,
    systemQty: num(i.systemQty),
    countedQty: num(i.countedQty),
    qtyChange: num(i.qtyChange),
    unitCost: num(i.unitCost),
    value: r2(num(i.qtyChange) * num(i.unitCost)),
  }));
  await enrich(items as unknown as Record<string, unknown>[], { productId: 'product' });
  const [row] = await enrich([{ ...adj, items }] as unknown as Record<string, unknown>[], { warehouseId: 'warehouse' });
  const journal = await prisma.journalEntry.findFirst({ where: { sourceType: 'STOCK_ADJUSTMENT', sourceId: adj.id }, include: { lines: true } });
  return { ...row, journal };
}

router.get(
  '/count-sheet',
  can('stock_adjustment', 'view'),
  ah(async (req, res) => {
    const warehouseId = qInt(req.query.warehouseId);
    if (!warehouseId) throw badRequest('warehouseId is required');
    const productWhere: Record<string, unknown> = {};
    const brandId = qInt(req.query.brandId);
    const categoryId = qInt(req.query.categoryId);
    if (brandId) productWhere.brandId = brandId;
    if (categoryId) productWhere.categoryId = categoryId;
    const search = String(req.query.search || '').trim();
    if (search) productWhere.OR = [{ code: { contains: search } }, { name: { contains: search } }, { oemNumber: { contains: search } }];
    const bals = await prisma.stockBalance.findMany({
      where: { warehouseId, ...(Object.keys(productWhere).length ? { product: productWhere } : {}), ...(req.query.includeZero === '1' ? {} : { onHand: { not: 0 } }) },
      include: { product: { select: { id: true, code: true, name: true, oemNumber: true, rack: true, shelf: true, bin: true, purchaseUnit: true } } },
      orderBy: { product: { code: 'asc' } },
    });
    const items = bals.map((b) => ({ productId: b.productId, product: b.product, systemQty: num(b.onHand), countedQty: null as number | null, qtyChange: 0, unitCost: num(b.avgCost) }));
    const [wh] = await enrich([{ warehouseId }] as unknown as Record<string, unknown>[], { warehouseId: 'warehouse' });
    res.json({ adjType: 'COUNT', warehouseId, warehouse: wh.warehouse, items });
  }),
);

router.get(
  '/',
  can('stock_adjustment', 'view'),
  ah(async (req, res) => {
    const q = listQuery(req);
    const where: Record<string, unknown> = {};
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.adjType) where.adjType = String(req.query.adjType);
    const wh = qInt(req.query.warehouseId);
    if (wh) where.warehouseId = wh;
    const from = qDate(req.query.from);
    const to = qDate(req.query.to, true);
    if (from || to) where.txDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    if (q.search) where.OR = [{ adjNo: { contains: q.search } }, { reason: { contains: q.search } }, { remarks: { contains: q.search } }];
    const sortable = ['adjNo', 'txDate', 'status', 'adjType', 'id'];
    const orderBy = { [q.sort && sortable.includes(q.sort) ? q.sort : 'id']: q.dir };
    const [rowsRaw, total] = await Promise.all([
      prisma.stockAdjustment.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { items: true } }),
      prisma.stockAdjustment.count({ where }),
    ]);
    const rows = rowsRaw.map(({ items, ...a }) => ({
      ...a,
      itemCount: items.length,
      totalQtyChange: r3(items.reduce((s, i) => s + num(i.qtyChange), 0)),
      totalValue: r2(items.reduce((s, i) => s + num(i.qtyChange) * num(i.unitCost), 0)),
    }));
    await enrich(rows as unknown as Record<string, unknown>[], { warehouseId: 'warehouse' });
    res.json(paged(rows, total, q));
  }),
);

router.get(
  '/:id',
  can('stock_adjustment', 'view'),
  ah(async (req, res) => {
    res.json(await present(await load(intParam(req))));
  }),
);

router.post(
  '/',
  can('stock_adjustment', 'create'),
  ah(async (req, res) => {
    const b = parse(bodySchema, req.body);
    const created = await prisma.$transaction(
      async (tx) => {
        const wh = await tx.warehouse.findUnique({ where: { id: b.warehouseId } });
        if (!wh) throw badRequest('Warehouse not found');
        const items = await buildItems(tx, b.adjType, b.warehouseId, b.items);
        const txDate = b.txDate ?? new Date();
        const adjNo = await nextNumber(tx, 'STOCK_ADJUSTMENT', { date: txDate });
        const adj = await tx.stockAdjustment.create({
          data: { adjNo, adjType: b.adjType, txDate, warehouseId: b.warehouseId, reason: b.reason, remarks: b.remarks, status: 'DRAFT', createdBy: req.user?.id, items: { create: items } },
        });
        await audit(tx, req.user, 'CREATE', 'StockAdjustment', adj.id, { adjNo, adjType: b.adjType });
        return adj;
      },
      { timeout: 30000 },
    );
    res.status(201).json(await present(await load(created.id)));
  }),
);

router.put(
  '/:id',
  can('stock_adjustment', 'edit'),
  ah(async (req, res) => {
    const id = intParam(req);
    const b = parse(bodySchema, req.body);
    await prisma.$transaction(
      async (tx) => {
    const revisionBefore = await revisionSnapshot(tx, 'StockAdjustment', id);
        const cur = await tx.stockAdjustment.findUnique({ where: { id } });
        if (!cur) throw notFound('Stock adjustment not found');
        if (cur.status !== 'DRAFT') throw badRequest('Only DRAFT adjustments can be edited; post a new adjustment to correct a posted one');
        const items = await buildItems(tx, b.adjType, b.warehouseId, b.items);
        await tx.stockAdjustmentItem.deleteMany({ where: { adjustmentId: id } });
        await tx.stockAdjustment.update({
          where: { id },
          data: { adjType: b.adjType, txDate: b.txDate ?? cur.txDate, warehouseId: b.warehouseId, reason: b.reason, remarks: b.remarks, items: { create: items } },
        });
        await auditRevision(tx, req.user, 'StockAdjustment', id, revisionBefore, req.body?.changeReason);
    await audit(tx, req.user, 'UPDATE', 'StockAdjustment', id);
      },
      { timeout: 30000 },
    );
    res.json(await present(await load(id)));
  }),
);

router.delete(
  '/:id',
  can('stock_adjustment', 'delete'),
  ah(async (req, res) => {
    const id = intParam(req);
    await prisma.$transaction(async (tx) => {
      const cur = await tx.stockAdjustment.findUnique({ where: { id } });
      if (!cur) throw notFound('Stock adjustment not found');
      if (cur.status !== 'DRAFT') throw badRequest('Only DRAFT adjustments can be deleted');
      await tx.stockAdjustment.delete({ where: { id } });
      await audit(tx, req.user, 'DELETE', 'StockAdjustment', id, { adjNo: cur.adjNo });
    });
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/cancel',
  can('stock_adjustment', 'cancel'),
  ah(async (req, res) => {
    const id = intParam(req);
    await prisma.$transaction(async (tx) => {
      const cur = await tx.stockAdjustment.findUnique({ where: { id } });
      if (!cur) throw notFound('Stock adjustment not found');
      if (cur.status !== 'DRAFT') throw badRequest('Only DRAFT adjustments can be cancelled; a posted adjustment is corrected with a new adjustment');
      await tx.stockAdjustment.update({ where: { id }, data: { status: 'CANCELLED' } });
      await audit(tx, req.user, 'CANCEL', 'StockAdjustment', id);
    });
    res.json(await present(await load(id)));
  }),
);

router.post(
  '/:id/post',
  can('stock_adjustment', 'post'),
  ah(async (req, res) => {
    const id = intParam(req);
    await prisma.$transaction(
      async (tx) => {
        const adj = await tx.stockAdjustment.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });
        if (!adj) throw notFound('Stock adjustment not found');
        if (adj.status !== 'DRAFT') throw badRequest(`Adjustment is ${adj.status}; only DRAFT can be posted`);
        const type = adj.adjType as AdjType;
        const txType: StockTxType = type === 'ADJUSTMENT' ? 'ADJUSTMENT' : (type as StockTxType);
        let gain = 0;
        let loss = 0;
        let posted = 0;
        for (const it of adj.items) {
          const qty = num(it.qtyChange);
          if (!qty) continue;
          let unitCost = num(it.unitCost);
          if (qty > 0 && !unitCost) unitCost = await defaultCost(tx, it.productId, adj.warehouseId);
          const row = await postStock(tx, {
            txType,
            productId: it.productId,
            warehouseId: adj.warehouseId,
            qty,
            unitCost: qty > 0 ? unitCost : undefined,
            refType: 'STOCK_ADJUSTMENT',
            refId: adj.id,
            refNo: adj.adjNo,
            remarks: adj.reason ?? undefined,
            date: adj.txDate,
            userId: req.user?.id,
          });
          if (qty > 0) {
            gain += num(row.value);
            if (unitCost !== num(it.unitCost)) await tx.stockAdjustmentItem.update({ where: { id: it.id }, data: { unitCost } });
          } else {
            loss += -num(row.value);
            await tx.stockAdjustmentItem.update({ where: { id: it.id }, data: { unitCost: r4(num(row.unitCost)) } });
          }
          posted++;
        }
        if (!posted) throw badRequest('Nothing to post: all lines have zero quantity change');
        gain = r2(gain);
        loss = r2(loss);
        const creditKey = type === 'OPENING' ? 'OPENING_EQUITY' : 'STOCK_ADJUSTMENT';
        const lines = [
          { accountKey: 'INVENTORY', debit: gain, description: `${type} stock gain` },
          { accountKey: creditKey, credit: gain, description: `${type} ${adj.adjNo}` },
          { accountKey: 'STOCK_ADJUSTMENT', debit: loss, description: `${type} stock loss` },
          { accountKey: 'INVENTORY', credit: loss, description: `${type} ${adj.adjNo}` },
        ];
        if (gain || loss) {
          await postJournal(tx, {
            date: adj.txDate,
            entryType: 'AUTO',
            sourceType: 'STOCK_ADJUSTMENT',
            sourceId: adj.id,
            sourceNo: adj.adjNo,
            narration: `Stock ${type.toLowerCase().replace('_', ' ')} ${adj.adjNo}`,
            userId: req.user?.id,
            lines,
          });
        }
        await tx.stockAdjustment.update({ where: { id }, data: { status: 'POSTED' } });
        await audit(tx, req.user, 'POST', 'StockAdjustment', id, { adjNo: adj.adjNo, gain, loss });
      },
      { timeout: 60000 },
    );
    res.json(await present(await load(id)));
  }),
);

export default [{ path: '/stock-adjustments', router }] satisfies ModuleDef[];
