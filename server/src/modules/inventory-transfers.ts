import { revisionSnapshot, auditRevision } from '../services/revisions-history';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, intParam, listQuery, parse, paged } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { enrich } from '../lib/enrich';
import { num, r2, r3 } from '../lib/calc';
import { postStock } from '../services/stock';
import { nextNumber } from '../services/numbering';
import { audit } from '../services/audit';
import { qDate, qInt } from '../services/finance-common';
import type { ModuleDef } from '../app';

const router = Router();

const bodySchema = z.object({
  txDate: z.coerce.date().optional(),
  fromWarehouseId: z.number().int(),
  toWarehouseId: z.number().int(),
  remarks: z.string().optional().nullable(),
  items: z.array(z.object({ productId: z.number().int(), qty: z.number().positive() })).min(1),
});

async function load(id: number) {
  const t = await prisma.stockTransfer.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });
  if (!t) throw notFound('Stock transfer not found');
  return t;
}

/** dispatched unit cost per product for a transfer (from the TRANSFER_OUT stock transactions) */
async function dispatchedCosts(transferId: number) {
  const outs = await prisma.stockTransaction.findMany({ where: { refType: 'STOCK_TRANSFER', refId: transferId, txType: 'TRANSFER_OUT' } });
  const m = new Map<number, number>();
  for (const o of outs) m.set(o.productId, num(o.unitCost));
  return m;
}

async function present(t: Awaited<ReturnType<typeof load>>) {
  const costs = ['IN_TRANSIT', 'RECEIVING', 'COMPLETED', 'DISPATCHED'].includes(t.status) ? await dispatchedCosts(t.id) : new Map<number, number>();
  const items = t.items.map((i) => {
    const qty = num(i.qty);
    const received = num(i.receivedQty);
    const unitCost = costs.get(i.productId) ?? 0;
    return { ...i, qty, receivedQty: received, pendingQty: r3(qty - received), unitCost, value: r2(qty * unitCost) };
  });
  await enrich(items as unknown as Record<string, unknown>[], { productId: 'product' });
  const [row] = await enrich([{ ...t, items }] as unknown as Record<string, unknown>[], { fromWarehouseId: 'fromWarehouse', toWarehouseId: 'toWarehouse' });
  return row;
}

// ---------- in transit
router.get(
  '/in-transit',
  can('stock_transfer', 'view'),
  ah(async (_req, res) => {
    const list = await prisma.stockTransfer.findMany({ where: { status: { in: ['IN_TRANSIT', 'RECEIVING', 'DISPATCHED'] } }, include: { items: true }, orderBy: { id: 'desc' } });
    const rows = [];
    let totalValue = 0;
    for (const t of list) {
      const costs = await dispatchedCosts(t.id);
      const pendingValue = r2(t.items.reduce((s, i) => s + (num(i.qty) - num(i.receivedQty)) * (costs.get(i.productId) ?? 0), 0));
      totalValue += pendingValue;
      rows.push({
        id: t.id,
        transferNo: t.transferNo,
        txDate: t.txDate,
        status: t.status,
        fromWarehouseId: t.fromWarehouseId,
        toWarehouseId: t.toWarehouseId,
        dispatchedQty: r3(t.items.reduce((s, i) => s + num(i.qty), 0)),
        receivedQty: r3(t.items.reduce((s, i) => s + num(i.receivedQty), 0)),
        pendingQty: r3(t.items.reduce((s, i) => s + num(i.qty) - num(i.receivedQty), 0)),
        pendingValue,
      });
    }
    await enrich(rows as unknown as Record<string, unknown>[], { fromWarehouseId: 'fromWarehouse', toWarehouseId: 'toWarehouse' });
    res.json({ rows, total: rows.length, totalValue: r2(totalValue) });
  }),
);

router.get(
  '/',
  can('stock_transfer', 'view'),
  ah(async (req, res) => {
    const q = listQuery(req);
    const where: Record<string, unknown> = {};
    if (req.query.status) where.status = String(req.query.status);
    const fw = qInt(req.query.fromWarehouseId);
    const tw = qInt(req.query.toWarehouseId);
    const wh = qInt(req.query.warehouseId);
    if (fw) where.fromWarehouseId = fw;
    if (tw) where.toWarehouseId = tw;
    if (wh) where.OR = [{ fromWarehouseId: wh }, { toWarehouseId: wh }];
    const from = qDate(req.query.from);
    const to = qDate(req.query.to, true);
    if (from || to) where.txDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    if (q.search) where.AND = [{ OR: [{ transferNo: { contains: q.search } }, { remarks: { contains: q.search } }] }];
    const sortable = ['transferNo', 'txDate', 'status', 'id'];
    const orderBy = { [q.sort && sortable.includes(q.sort) ? q.sort : 'id']: q.dir };
    const [raw, total] = await Promise.all([
      prisma.stockTransfer.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { items: true } }),
      prisma.stockTransfer.count({ where }),
    ]);
    const rows = raw.map(({ items, ...t }) => ({
      ...t,
      itemCount: items.length,
      totalQty: r3(items.reduce((s, i) => s + num(i.qty), 0)),
      receivedQty: r3(items.reduce((s, i) => s + num(i.receivedQty), 0)),
    }));
    await enrich(rows as unknown as Record<string, unknown>[], { fromWarehouseId: 'fromWarehouse', toWarehouseId: 'toWarehouse' });
    res.json(paged(rows, total, q));
  }),
);

router.get(
  '/:id',
  can('stock_transfer', 'view'),
  ah(async (req, res) => {
    res.json(await present(await load(intParam(req))));
  }),
);

async function validateBody(b: z.infer<typeof bodySchema>) {
  if (b.fromWarehouseId === b.toWarehouseId) throw badRequest('Source and destination warehouses must differ');
  const whs = await prisma.warehouse.findMany({ where: { id: { in: [b.fromWarehouseId, b.toWarehouseId] } } });
  if (whs.length !== 2) throw badRequest('Warehouse not found');
  const ids = b.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) throw badRequest('Duplicate product in transfer lines');
  const prods = await prisma.product.count({ where: { id: { in: ids } } });
  if (prods !== ids.length) throw badRequest('Product not found');
}

router.post(
  '/',
  can('stock_transfer', 'create'),
  ah(async (req, res) => {
    const b = parse(bodySchema, req.body);
    await validateBody(b);
    const t = await prisma.$transaction(
      async (tx) => {
        const txDate = b.txDate ?? new Date();
        const transferNo = await nextNumber(tx, 'STOCK_TRANSFER', { date: txDate });
        const row = await tx.stockTransfer.create({
          data: {
            transferNo,
            txDate,
            fromWarehouseId: b.fromWarehouseId,
            toWarehouseId: b.toWarehouseId,
            remarks: b.remarks,
            status: 'REQUESTED',
            createdBy: req.user?.id,
            items: { create: b.items.map((i) => ({ productId: i.productId, qty: i.qty })) },
          },
        });
        await audit(tx, req.user, 'CREATE', 'StockTransfer', row.id, { transferNo });
        return row;
      },
      { timeout: 30000 },
    );
    res.status(201).json(await present(await load(t.id)));
  }),
);

router.put(
  '/:id',
  can('stock_transfer', 'edit'),
  ah(async (req, res) => {
    const id = intParam(req);
    const b = parse(bodySchema, req.body);
    await validateBody(b);
    await prisma.$transaction(async (tx) => {
    const revisionBefore = await revisionSnapshot(tx, 'StockTransfer', id);
      const cur = await tx.stockTransfer.findUnique({ where: { id } });
      if (!cur) throw notFound('Stock transfer not found');
      if (cur.status !== 'REQUESTED') throw badRequest('Only REQUESTED transfers can be edited');
      await tx.stockTransferItem.deleteMany({ where: { transferId: id } });
      await tx.stockTransfer.update({
        where: { id },
        data: {
          txDate: b.txDate ?? cur.txDate,
          fromWarehouseId: b.fromWarehouseId,
          toWarehouseId: b.toWarehouseId,
          remarks: b.remarks,
          items: { create: b.items.map((i) => ({ productId: i.productId, qty: i.qty })) },
        },
      });
      await auditRevision(tx, req.user, 'StockTransfer', id, revisionBefore, req.body?.changeReason);
    await audit(tx, req.user, 'UPDATE', 'StockTransfer', id);
    });
    res.json(await present(await load(id)));
  }),
);

router.delete(
  '/:id',
  can('stock_transfer', 'delete'),
  ah(async (req, res) => {
    const id = intParam(req);
    await prisma.$transaction(async (tx) => {
      const cur = await tx.stockTransfer.findUnique({ where: { id } });
      if (!cur) throw notFound('Stock transfer not found');
      if (cur.status !== 'REQUESTED') throw badRequest('Only REQUESTED transfers can be deleted');
      await tx.stockTransfer.delete({ where: { id } });
      await audit(tx, req.user, 'DELETE', 'StockTransfer', id, { transferNo: cur.transferNo });
    });
    res.json({ ok: true });
  }),
);

async function transition(req: import('express').Request, from: string[], to: string, action: string, perm: string, extra?: { remarks?: string }) {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const cur = await tx.stockTransfer.findUnique({ where: { id } });
    if (!cur) throw notFound('Stock transfer not found');
    if (!from.includes(cur.status)) throw badRequest(`Cannot ${action.toLowerCase()} a transfer in status ${cur.status}`);
    await tx.stockTransfer.update({ where: { id }, data: { status: to, ...(extra?.remarks ? { remarks: [cur.remarks, extra.remarks].filter(Boolean).join(' | ') } : {}) } });
    await audit(tx, req.user, action, 'StockTransfer', id, { from: cur.status, to, ...extra });
  });
  void perm;
  return id;
}

router.post(
  '/:id/approve',
  can('stock_transfer', 'approve'),
  ah(async (req, res) => {
    const id = await transition(req, ['REQUESTED'], 'APPROVED', 'APPROVE', 'approve');
    res.json(await present(await load(id)));
  }),
);
router.post(
  '/:id/reject',
  can('stock_transfer', 'reject'),
  ah(async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? `Rejected: ${req.body.reason}` : undefined;
    const id = await transition(req, ['REQUESTED'], 'REJECTED', 'REJECT', 'reject', { remarks: reason });
    res.json(await present(await load(id)));
  }),
);
router.post(
  '/:id/cancel',
  can('stock_transfer', 'cancel'),
  ah(async (req, res) => {
    const id = await transition(req, ['REQUESTED', 'APPROVED'], 'CANCELLED', 'CANCEL', 'cancel');
    res.json(await present(await load(id)));
  }),
);

// ---------- dispatch: TRANSFER_OUT at source avg cost, status IN_TRANSIT
router.post(
  '/:id/dispatch',
  can('stock_transfer', 'post'),
  ah(async (req, res) => {
    const id = intParam(req);
    await prisma.$transaction(
      async (tx) => {
        const t = await tx.stockTransfer.findUnique({ where: { id }, include: { items: true } });
        if (!t) throw notFound('Stock transfer not found');
        if (t.status !== 'APPROVED') throw badRequest(`Only APPROVED transfers can be dispatched (status is ${t.status})`);
        for (const it of t.items) {
          await postStock(tx, {
            txType: 'TRANSFER_OUT',
            productId: it.productId,
            warehouseId: t.fromWarehouseId,
            qty: -num(it.qty),
            refType: 'STOCK_TRANSFER',
            refId: t.id,
            refNo: t.transferNo,
            date: qDate(req.body?.date) ?? new Date(),
            userId: req.user?.id,
          });
        }
        await tx.stockTransfer.update({ where: { id }, data: { status: 'IN_TRANSIT' } });
        await audit(tx, req.user, 'DISPATCH', 'StockTransfer', id, { transferNo: t.transferNo });
      },
      { timeout: 60000 },
    );
    res.json(await present(await load(id)));
  }),
);

// ---------- receive (partial allowed)
const receiveSchema = z.object({
  items: z.array(z.object({ productId: z.number().int().optional(), itemId: z.number().int().optional(), receivedQty: z.number().positive() })).optional(),
  receiveAll: z.boolean().optional(),
});
router.post(
  '/:id/receive',
  can('stock_transfer', 'post'),
  ah(async (req, res) => {
    const id = intParam(req);
    const b = parse(receiveSchema, req.body ?? {});
    if (!b.receiveAll && !b.items?.length) throw badRequest('Provide items with receivedQty, or receiveAll: true');
    await prisma.$transaction(
      async (tx) => {
        const t = await tx.stockTransfer.findUnique({ where: { id }, include: { items: true } });
        if (!t) throw notFound('Stock transfer not found');
        if (!['IN_TRANSIT', 'RECEIVING', 'DISPATCHED'].includes(t.status)) throw badRequest(`Transfer is ${t.status}; only in-transit transfers can be received`);
        const costs = await dispatchedCosts(t.id);
        const todo: Array<{ item: (typeof t.items)[number]; qty: number }> = [];
        if (b.receiveAll) {
          for (const it of t.items) {
            const left = r3(num(it.qty) - num(it.receivedQty));
            if (left > 0) todo.push({ item: it, qty: left });
          }
        } else {
          for (const l of b.items!) {
            const it = t.items.find((i) => (l.itemId ? i.id === l.itemId : i.productId === l.productId));
            if (!it) throw badRequest('Line does not belong to this transfer');
            const left = r3(num(it.qty) - num(it.receivedQty));
            if (l.receivedQty > left + 0.0005) throw badRequest(`Received quantity ${l.receivedQty} exceeds pending ${left}`);
            todo.push({ item: it, qty: l.receivedQty });
          }
        }
        if (!todo.length) throw badRequest('Nothing to receive');
        for (const { item, qty } of todo) {
          await postStock(tx, {
            txType: 'TRANSFER_IN',
            productId: item.productId,
            warehouseId: t.toWarehouseId,
            qty,
            unitCost: costs.get(item.productId) ?? 0,
            refType: 'STOCK_TRANSFER',
            refId: t.id,
            refNo: t.transferNo,
            date: qDate(req.body?.date) ?? new Date(),
            userId: req.user?.id,
          });
          await tx.stockTransferItem.update({ where: { id: item.id }, data: { receivedQty: r3(num(item.receivedQty) + qty) } });
        }
        const fresh = await tx.stockTransferItem.findMany({ where: { transferId: id } });
        const done = fresh.every((i) => num(i.receivedQty) >= num(i.qty) - 0.0005);
        await tx.stockTransfer.update({ where: { id }, data: { status: done ? 'COMPLETED' : 'RECEIVING' } });
        await audit(tx, req.user, 'RECEIVE', 'StockTransfer', id, { transferNo: t.transferNo, lines: todo.map((x) => ({ productId: x.item.productId, qty: x.qty })), completed: done });
      },
      { timeout: 60000 },
    );
    res.json(await present(await load(id)));
  }),
);

export default [{ path: '/stock-transfers', router }] satisfies ModuleDef[];
