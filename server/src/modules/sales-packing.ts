import { Router } from 'express';
import { z } from 'zod';
import { prisma, Tx } from '../lib/prisma';
import { ah, parse, intParam, paged } from '../lib/http';
import { badRequest } from '../lib/errors';
import { can } from '../middleware/auth';
import { enrich } from '../lib/enrich';
import { nextNumber } from '../services/numbering';
import { audit } from '../services/audit';
import { linkDocs } from '../services/docLink';
import { buildListWhere, mustFound, mustStatus, approvalFor, docLinks, num, r3 } from '../services/sales-common';
import type { ModuleDef } from '../app';

const router = Router();

const bodySchema = z.object({
  pickingId: z.coerce.number().int().optional(),
  docDate: z.coerce.date().optional(),
  boxes: z.coerce.number().int().min(1).optional(),
  dimensions: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  totalWeight: z.coerce.number().min(0).optional(),
  items: z
    .array(z.object({ productId: z.coerce.number().int(), boxNo: z.coerce.number().int().min(1).default(1), qty: z.coerce.number().positive(), weight: z.coerce.number().min(0).optional() }))
    .optional(),
});
type Body = z.input<typeof bodySchema>;

async function detail(id: number) {
  const p = mustFound(await prisma.packingList.findUnique({ where: { id }, include: { items: { orderBy: [{ boxNo: 'asc' }, { id: 'asc' }] } } }), 'Packing list');
  const [row] = await enrich([p as unknown as Record<string, unknown>], { customerId: 'customer' });
  const so = await prisma.salesOrder.findUnique({ where: { id: p.salesOrderId }, select: { id: true, docNo: true, status: true } });
  const pick = p.pickingId ? await prisma.pickingList.findUnique({ where: { id: p.pickingId }, select: { id: true, docNo: true, status: true } }) : null;
  const items = await enrich(p.items as unknown as Record<string, unknown>[], { productId: 'product' });
  const boxes = new Map<number, { boxNo: number; qty: number; weight: number; lines: number }>();
  for (const i of p.items) {
    const b = boxes.get(i.boxNo) ?? { boxNo: i.boxNo, qty: 0, weight: 0, lines: 0 };
    b.qty = r3(b.qty + num(i.qty));
    b.weight = r3(b.weight + num(i.weight));
    b.lines++;
    boxes.set(i.boxNo, b);
  }
  return { ...row, salesOrder: so, picking: pick, items, boxSummary: [...boxes.values()], totalQty: r3(p.items.reduce((s, i) => s + num(i.qty), 0)), links: await docLinks('PACKING_LIST', id), approval: await approvalFor('PACKING_LIST', id) };
}

/** product -> qty still packable for a picking list (picked minus already on other live packing lists) */
async function packable(tx: Tx | typeof prisma, pickingId: number, exceptPackingId?: number) {
  const pick = await tx.pickingList.findUniqueOrThrow({ where: { id: pickingId }, include: { items: true } });
  const picked = new Map<number, number>();
  for (const i of pick.items) picked.set(i.productId, r3((picked.get(i.productId) ?? 0) + num(i.pickedQty)));
  const other = await tx.packingListItem.findMany({ where: { packing: { pickingId, status: { not: 'CANCELLED' }, ...(exceptPackingId ? { id: { not: exceptPackingId } } : {}) } } });
  const packed = new Map<number, number>();
  for (const i of other) packed.set(i.productId, r3((packed.get(i.productId) ?? 0) + num(i.qty)));
  const rem = new Map<number, number>();
  for (const [pid, q] of picked) rem.set(pid, Math.max(0, r3(q - (packed.get(pid) ?? 0))));
  return { pick, rem };
}

async function buildItems(tx: Tx, pickingId: number, b: Body, exceptPackingId?: number) {
  const { pick, rem } = await packable(tx, pickingId, exceptPackingId);
  const prods = new Map((await tx.product.findMany({ where: { id: { in: [...rem.keys()] } } })).map((p) => [p.id, p]));
  let items: { productId: number; boxNo: number; qty: number; weight: number }[];
  if (b.items?.length) {
    const used = new Map<number, number>();
    items = b.items.map((i) => {
      if (!rem.has(i.productId)) throw badRequest(`Product ${i.productId} is not on picking list ${pick.docNo}`);
      used.set(i.productId, (used.get(i.productId) ?? 0) + i.qty);
      const pr = prods.get(i.productId)!;
      return { productId: i.productId, boxNo: i.boxNo ?? 1, qty: i.qty, weight: i.weight ?? r3(num(pr.weight) * i.qty) };
    });
    for (const [pid, q] of used) {
      if (q > (rem.get(pid) ?? 0) + 0.0005) throw badRequest(`Packing qty ${q} for ${prods.get(pid)?.code ?? pid} exceeds picked & unpacked qty ${rem.get(pid)}`);
    }
  } else {
    items = [...rem]
      .filter(([, q]) => q > 0)
      .map(([pid, q]) => ({ productId: pid, boxNo: 1, qty: q, weight: r3(num(prods.get(pid)!.weight) * q) }));
  }
  if (!items.length) throw badRequest('Nothing to pack: no picked quantity left unpacked on this picking list');
  const boxes = b.boxes ?? Math.max(...items.map((i) => i.boxNo));
  const totalWeight = b.totalWeight ?? r3(items.reduce((s, i) => s + i.weight, 0));
  return { pick, items, boxes, totalWeight };
}

router.get('/', can('packing', 'view'), ah(async (req, res) => {
  const { q, where, orderBy } = await buildListWhere(req);
  const [rows, total] = await Promise.all([
    prisma.packingList.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.packingList.count({ where }),
  ]);
  const sos = await prisma.salesOrder.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.salesOrderId))] } }, select: { id: true, docNo: true } });
  const m = new Map(sos.map((s) => [s.id, s]));
  const out = rows.map((r) => ({ ...r, salesOrder: m.get(r.salesOrderId) ?? null }));
  await enrich(out as unknown as Record<string, unknown>[], { customerId: 'customer' });
  res.json(paged(out, total, q));
}));
router.get('/:id', can('packing', 'view'), ah(async (req, res) => res.json(await detail(intParam(req)))));

async function createFromPicking(req: import('express').Request, pickingId: number, b: Body) {
  return prisma.$transaction(async (tx) => {
    const { pick, items, boxes, totalWeight } = await buildItems(tx, pickingId, b);
    mustStatus(pick, ['PARTIALLY_PICKED', 'PICKED'], 'create packing list (picking must have picked quantity)');
    const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: pick.salesOrderId } });
    const docNo = await nextNumber(tx, 'PACKING_LIST', { date: b.docDate });
    const p = await tx.packingList.create({
      data: {
        docNo, docDate: b.docDate ?? new Date(), salesOrderId: so.id, pickingId: pick.id, customerId: so.customerId, boxes, totalWeight,
        dimensions: b.dimensions ?? null, remarks: b.remarks ?? null, createdBy: req.user?.id, items: { create: items },
      },
    });
    await linkDocs(tx, { type: 'PICKING_LIST', id: pick.id, no: pick.docNo }, { type: 'PACKING_LIST', id: p.id, no: p.docNo });
    await audit(tx, req.user, 'CREATE', 'PackingList', p.id, { docNo, picking: pick.docNo });
    return p.id;
  }, { timeout: 30000 });
}

router.post('/', can('packing', 'create'), ah(async (req, res) => {
  const b = parse(bodySchema, req.body);
  if (!b.pickingId) throw badRequest('pickingId is required (packing lists are created from a picking list)');
  res.status(201).json(await detail(await createFromPicking(req, b.pickingId, b)));
}));

const fromPicking = Router();
fromPicking.post('/:id/create-packing', can('packing', 'create'), ah(async (req, res) => {
  const b = parse(bodySchema, req.body ?? {});
  res.status(201).json(await detail(await createFromPicking(req, intParam(req), b)));
}));

router.put('/:id', can('packing', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(bodySchema, req.body);
  await prisma.$transaction(async (tx) => {
    const p = mustFound(await tx.packingList.findUnique({ where: { id } }), 'Packing list');
    mustStatus(p, ['DRAFT'], 'edit');
    const { items, boxes, totalWeight } = await buildItems(tx, p.pickingId!, b, id);
    await tx.packingListItem.deleteMany({ where: { packingId: id } });
    await tx.packingList.update({
      where: { id },
      data: { docDate: b.docDate ?? p.docDate, boxes, totalWeight, dimensions: b.dimensions ?? null, remarks: b.remarks ?? null, items: { create: items } },
    });
    await audit(tx, req.user, 'UPDATE', 'PackingList', id);
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

router.post('/:id/pack', can('packing', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const p = mustFound(await tx.packingList.findUnique({ where: { id } }), 'Packing list');
    mustStatus(p, ['DRAFT'], 'mark packed');
    await tx.packingList.update({ where: { id }, data: { status: 'PACKED' } });
    await audit(tx, req.user, 'PACK', 'PackingList', id);
  });
  res.json(await detail(id));
}));
router.post('/:id/submit', can('packing', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const p = mustFound(await tx.packingList.findUnique({ where: { id } }), 'Packing list');
    mustStatus(p, ['DRAFT'], 'mark packed');
    await tx.packingList.update({ where: { id }, data: { status: 'PACKED' } });
    await audit(tx, req.user, 'PACK', 'PackingList', id);
  });
  res.json(await detail(id));
}));

router.post('/:id/cancel', can('packing', 'cancel'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const p = mustFound(await tx.packingList.findUnique({ where: { id } }), 'Packing list');
    mustStatus(p, ['DRAFT', 'PACKED'], 'cancel');
    const dn = await tx.deliveryNote.findFirst({ where: { packingId: id, status: { not: 'CANCELLED' } } });
    if (dn) throw badRequest(`Delivery note ${dn.docNo} is based on this packing list; cancel it first`);
    await tx.packingList.update({ where: { id }, data: { status: 'CANCELLED' } });
    await audit(tx, req.user, 'CANCEL', 'PackingList', id);
  });
  res.json(await detail(id));
}));

router.delete('/:id', can('packing', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const p = mustFound(await tx.packingList.findUnique({ where: { id } }), 'Packing list');
    mustStatus(p, ['DRAFT'], 'delete');
    await tx.documentLink.deleteMany({ where: { toType: 'PACKING_LIST', toId: id } });
    await tx.packingList.delete({ where: { id } });
    await audit(tx, req.user, 'DELETE', 'PackingList', id, { docNo: p.docNo });
  });
  res.json({ ok: true });
}));

export default [
  { path: '/packing-lists', router },
  { path: '/picking-lists', router: fromPicking },
] satisfies ModuleDef[];
