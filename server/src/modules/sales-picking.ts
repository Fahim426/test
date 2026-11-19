import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, parse, intParam, paged } from '../lib/http';
import { badRequest } from '../lib/errors';
import { can } from '../middleware/auth';
import { enrich } from '../lib/enrich';
import { nextNumber } from '../services/numbering';
import { audit } from '../services/audit';
import { linkDocs } from '../services/docLink';
import { buildListWhere, mustFound, mustStatus, approvalFor, docLinks, reservedByProduct, allocateReserved, num, r3 } from '../services/sales-common';
import type { ModuleDef } from '../app';

const router = Router();

async function detail(id: number) {
  const p = mustFound(await prisma.pickingList.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } }), 'Picking list');
  const so = await prisma.salesOrder.findUnique({ where: { id: p.salesOrderId }, include: { items: true } });
  const [row] = await enrich([p as unknown as Record<string, unknown>], { warehouseId: 'warehouse' });
  const [soRow] = so ? await enrich([{ id: so.id, docNo: so.docNo, status: so.status, customerId: so.customerId, deliveryDate: so.deliveryDate }], { customerId: 'customer' }) : [null];
  const items = await enrich(p.items as unknown as Record<string, unknown>[], { productId: 'product' });
  const soItems = new Map((so?.items ?? []).map((i) => [i.id, i]));
  for (const it of items) {
    const si = soItems.get(it.orderItemId as number);
    it.soQty = si ? num(si.qty) : null; // total ordered on the order line
    it.ordered = num(it.orderedQty); // qty requested on this list
    it.reserved = num(it.reservedQty);
    it.picked = num(it.pickedQty);
    it.pending = r3(num(it.orderedQty) - num(it.pickedQty));
  }
  return { ...row, salesOrder: soRow, items, links: await docLinks('PICKING_LIST', id), approval: await approvalFor('PICKING_LIST', id) };
}

router.get('/', can('picking', 'view'), ah(async (req, res) => {
  const { q, where, orderBy } = await buildListWhere(req, { searchFields: ['docNo', 'remarks', 'pickedBy'] });
  const [rows, total] = await Promise.all([
    prisma.pickingList.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { items: { select: { orderedQty: true, pickedQty: true } } } }),
    prisma.pickingList.count({ where }),
  ]);
  const sos = await prisma.salesOrder.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.salesOrderId))] } }, select: { id: true, docNo: true, customerId: true } });
  await enrich(sos as unknown as Record<string, unknown>[], { customerId: 'customer' });
  const soMap = new Map(sos.map((s) => [s.id, s]));
  const out = rows.map((r) => {
    const ordered = r.items.reduce((s, i) => s + num(i.orderedQty), 0);
    const picked = r.items.reduce((s, i) => s + num(i.pickedQty), 0);
    return { ...r, items: undefined, orderedQty: r3(ordered), pickedQty: r3(picked), pendingQty: r3(ordered - picked), salesOrder: soMap.get(r.salesOrderId) ?? null };
  });
  await enrich(out as unknown as Record<string, unknown>[], { warehouseId: 'warehouse' });
  res.json(paged(out, total, q));
}));
router.get('/:id', can('picking', 'view'), ah(async (req, res) => res.json(await detail(intParam(req)))));

/** How much of each order line may still be put on a NEW picking list. */
export async function pickableByLine(tx: typeof prisma | import('../lib/prisma').Tx, orderId: number) {
  const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: { orderBy: { id: 'asc' } } } });
  const alloc = allocateReserved(so.items, await reservedByProduct(tx, orderId));
  const active = await tx.pickingListItem.findMany({ where: { picking: { salesOrderId: orderId, status: { in: ['OPEN', 'PARTIALLY_PICKED', 'PICKED'] } } } });
  const planned = new Map<number, number>();
  for (const a of active) planned.set(a.orderItemId, (planned.get(a.orderItemId) ?? 0) + Math.max(0, num(a.orderedQty) - num(a.pickedQty)));
  const out = new Map<number, { item: (typeof so.items)[number]; reserved: number; capacity: number }>();
  for (const it of so.items) {
    const picked = num(it.pickedQty);
    const delivered = num(it.deliveredQty);
    const unpicked = num(it.qty) - Math.max(picked, delivered) - (planned.get(it.id) ?? 0);
    const reserved = alloc.get(it.id) ?? 0;
    const resvCap = reserved - Math.max(0, picked - delivered) - (planned.get(it.id) ?? 0);
    out.set(it.id, { item: it, reserved, capacity: Math.max(0, r3(Math.min(unpicked, resvCap))) });
  }
  return { so, lines: out };
}

const createSchema = z.object({
  items: z.array(z.object({ orderItemId: z.coerce.number().int(), qty: z.coerce.number().positive() })).optional(),
  pickedBy: z.string().optional(),
  remarks: z.string().optional(),
});

const fromOrder = Router();
fromOrder.post('/:id/create-picking', can('picking', 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(createSchema, req.body ?? {});
  const pid = await prisma.$transaction(async (tx) => {
    const { so, lines } = await pickableByLine(tx, id);
    mustStatus(so, ['APPROVED', 'PARTIALLY_DELIVERED'], 'create picking list');
    const wanted = new Map<number, number>();
    if (b.items?.length) {
      for (const w of b.items) {
        const l = lines.get(w.orderItemId);
        if (!l) throw badRequest(`Order item ${w.orderItemId} does not belong to ${so.docNo}`);
        if (w.qty > l.capacity + 0.0005) throw badRequest(`Cannot pick ${w.qty} of order line ${w.orderItemId}: only ${l.capacity} left to pick (reserved & unpicked)`);
        wanted.set(w.orderItemId, (wanted.get(w.orderItemId) ?? 0) + w.qty);
      }
    } else {
      for (const [k, l] of lines) if (l.capacity > 0) wanted.set(k, l.capacity);
    }
    if (!wanted.size) throw badRequest('Nothing left to pick: all order quantities are already picked/planned, delivered, or not reserved');
    const prods = new Map((await tx.product.findMany({ where: { id: { in: [...lines.values()].map((l) => l.item.productId) } } })).map((p) => [p.id, p]));
    const defLoc = await tx.warehouseLocation.findFirst({ where: { warehouseId: so.warehouseId, isActive: true }, orderBy: { id: 'asc' } });
    const docNo = await nextNumber(tx, 'PICKING_LIST');
    const p = await tx.pickingList.create({
      data: {
        docNo, docDate: new Date(), salesOrderId: so.id, warehouseId: so.warehouseId, pickedBy: b.pickedBy ?? null, remarks: b.remarks ?? null, createdBy: req.user?.id,
        items: {
          create: [...wanted].map(([orderItemId, qty]) => {
            const l = lines.get(orderItemId)!;
            const pr = prods.get(l.item.productId)!;
            return {
              orderItemId, productId: pr.id, rack: pr.rack ?? defLoc?.rack ?? null, shelf: pr.shelf ?? defLoc?.shelf ?? null, bin: pr.bin ?? defLoc?.bin ?? null,
              orderedQty: qty, reservedQty: l.reserved, pickedQty: 0,
            };
          }),
        },
      },
    });
    await linkDocs(tx, { type: 'SALES_ORDER', id: so.id, no: so.docNo }, { type: 'PICKING_LIST', id: p.id, no: p.docNo });
    await audit(tx, req.user, 'CREATE', 'PickingList', p.id, { docNo, order: so.docNo });
    return p.id;
  }, { timeout: 30000 });
  res.status(201).json(await detail(pid));
}));

/* PUT /:id/pick  { pickedBy?, remarks?, items:[{id, pickedQty}] }  (pickedQty = cumulative picked on that list line) */
const pickSchema = z.object({
  pickedBy: z.string().optional(),
  remarks: z.string().optional(),
  items: z.array(z.object({ id: z.coerce.number().int(), pickedQty: z.coerce.number().min(0) })).min(1),
});
router.put('/:id/pick', can('picking', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(pickSchema, req.body);
  await prisma.$transaction(async (tx) => {
    const p = mustFound(await tx.pickingList.findUnique({ where: { id }, include: { items: true } }), 'Picking list');
    mustStatus(p, ['OPEN', 'PARTIALLY_PICKED', 'PICKED'], 'record picking');
    const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: p.salesOrderId }, include: { items: true } });
    mustStatus(so, ['APPROVED', 'PARTIALLY_DELIVERED'], 'record picking (sales order)');
    const alloc = allocateReserved(so.items, await reservedByProduct(tx, so.id));
    const soItems = new Map(so.items.map((i) => [i.id, i]));
    const own = new Map(p.items.map((i) => [i.id, i]));
    for (const row of b.items) {
      const it = own.get(row.id);
      if (!it) throw badRequest(`Picking line ${row.id} is not on ${p.docNo}`);
      if (row.pickedQty > num(it.orderedQty) + 0.0005) throw badRequest(`Picked qty ${row.pickedQty} exceeds the quantity on the list (${num(it.orderedQty)})`);
      const delta = r3(row.pickedQty - num(it.pickedQty));
      if (!delta) continue;
      const si = soItems.get(it.orderItemId)!;
      const newSo = r3(num(si.pickedQty) + delta);
      if (newSo > num(si.qty) + 0.0005) throw badRequest(`Picked qty exceeds the ordered qty (${num(si.qty)}) of order line ${si.id}`);
      if (delta > 0 && newSo > num(si.deliveredQty) + (alloc.get(si.id) ?? 0) + 0.0005) {
        throw badRequest(`Cannot pick ${row.pickedQty}: only ${alloc.get(si.id) ?? 0} reserved for this order line`);
      }
      if (delta < 0) {
        const dn = await tx.deliveryNoteItem.findMany({ where: { orderItemId: si.id, delivery: { pickingId: id, status: { not: 'CANCELLED' } } } });
        const used = dn.reduce((s, d) => s + num(d.qty), 0);
        if (row.pickedQty < used - 0.0005) throw badRequest(`Cannot reduce picked qty below ${used}: already on delivery notes`);
      }
      await tx.pickingListItem.update({ where: { id: it.id }, data: { pickedQty: row.pickedQty } });
      await tx.salesOrderItem.update({ where: { id: si.id }, data: { pickedQty: newSo } });
      si.pickedQty = newSo as never;
      it.pickedQty = row.pickedQty as never;
    }
    const all = p.items;
    const status = all.every((i) => num(i.pickedQty) >= num(i.orderedQty) - 0.0005) ? 'PICKED' : all.some((i) => num(i.pickedQty) > 0) ? 'PARTIALLY_PICKED' : 'OPEN';
    await tx.pickingList.update({ where: { id }, data: { status, pickedBy: b.pickedBy ?? p.pickedBy, remarks: b.remarks ?? p.remarks } });
    await audit(tx, req.user, 'PICK', 'PickingList', id, { items: b.items, status });
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

router.post('/:id/cancel', can('picking', 'cancel'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const p = mustFound(await tx.pickingList.findUnique({ where: { id }, include: { items: true } }), 'Picking list');
    mustStatus(p, ['OPEN', 'PARTIALLY_PICKED', 'PICKED'], 'cancel');
    const dn = await tx.deliveryNote.findFirst({ where: { pickingId: id, status: { not: 'CANCELLED' } } });
    if (dn) throw badRequest(`Delivery note ${dn.docNo} is based on this picking list; cancel it first`);
    const pk = await tx.packingList.findFirst({ where: { pickingId: id, status: { not: 'CANCELLED' } } });
    if (pk) throw badRequest(`Packing list ${pk.docNo} is based on this picking list; cancel it first`);
    for (const it of p.items) {
      if (num(it.pickedQty) > 0) {
        const si = await tx.salesOrderItem.findUnique({ where: { id: it.orderItemId } });
        if (si) await tx.salesOrderItem.update({ where: { id: si.id }, data: { pickedQty: Math.max(0, r3(num(si.pickedQty) - num(it.pickedQty))) } });
      }
    }
    await tx.pickingList.update({ where: { id }, data: { status: 'CANCELLED' } });
    await audit(tx, req.user, 'CANCEL', 'PickingList', id);
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

router.delete('/:id', can('picking', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const p = mustFound(await tx.pickingList.findUnique({ where: { id }, include: { items: true } }), 'Picking list');
    mustStatus(p, ['OPEN'], 'delete');
    if (p.items.some((i) => num(i.pickedQty) > 0)) throw badRequest('Picking already recorded; cancel instead');
    await tx.documentLink.deleteMany({ where: { toType: 'PICKING_LIST', toId: id } });
    await tx.pickingList.delete({ where: { id } });
    await audit(tx, req.user, 'DELETE', 'PickingList', id, { docNo: p.docNo });
  });
  res.json({ ok: true });
}));

export default [
  { path: '/picking-lists', router },
  { path: '/sales-orders', router: fromOrder },
] satisfies ModuleDef[];
