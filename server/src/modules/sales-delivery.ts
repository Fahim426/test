import { revisionSnapshot, auditRevision } from '../services/revisions-history';
import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma, Tx } from '../lib/prisma';
import { ah, parse, intParam, paged } from '../lib/http';
import { badRequest } from '../lib/errors';
import { can } from '../middleware/auth';
import { enrich } from '../lib/enrich';
import { nextNumber } from '../services/numbering';
import { audit } from '../services/audit';
import { linkDocs } from '../services/docLink';
import { postStock, fulfillReservation, reserveStock } from '../services/stock';
import {
  buildListWhere, mustFound, mustStatus, approvalFor, docLinks, reservedByProduct, refreshOrderStatus, boolSetting, num, r3, r4,
} from '../services/sales-common';
import type { ModuleDef } from '../app';

const router = Router();

/** qty still deliverable per order item (ordered - delivered - already on DRAFT delivery notes) */
async function remainingByItem(tx: Tx | typeof prisma, orderId: number, exceptDnId?: number) {
  const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: { orderBy: { id: 'asc' } } } });
  const drafts = await tx.deliveryNoteItem.findMany({ where: { delivery: { salesOrderId: orderId, status: 'DRAFT', ...(exceptDnId ? { id: { not: exceptDnId } } : {}) } } });
  const dq = new Map<number, number>();
  for (const d of drafts) dq.set(d.orderItemId, (dq.get(d.orderItemId) ?? 0) + num(d.qty));
  const rem = new Map<number, number>();
  for (const it of so.items) rem.set(it.id, Math.max(0, r3(num(it.qty) - num(it.deliveredQty) - (dq.get(it.id) ?? 0))));
  return { so, rem };
}

const itemsIn = z.array(z.object({ orderItemId: z.coerce.number().int(), qty: z.coerce.number().positive() })).optional();
const headerSchema = z.object({
  docDate: z.coerce.date().optional(),
  deliveryAddress: z.string().optional().nullable(),
  driver: z.string().optional().nullable(),
  vehicleNo: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  items: itemsIn,
});
type Header = z.infer<typeof headerSchema>;

async function detail(id: number) {
  const d = mustFound(await prisma.deliveryNote.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } }), 'Delivery note');
  const [row] = await enrich([d as unknown as Record<string, unknown>], { customerId: 'customer', warehouseId: 'warehouse' });
  const so = await prisma.salesOrder.findUnique({ where: { id: d.salesOrderId }, include: { items: true } });
  const items = await enrich(d.items as unknown as Record<string, unknown>[], { productId: 'product' });
  const soItems = new Map((so?.items ?? []).map((i) => [i.id, i]));
  for (const it of items) {
    const si = soItems.get(it.orderItemId as number);
    it.orderedQty = si ? num(si.qty) : null;
    it.rate = si ? num(si.rate) : null;
    it.pendingInvoiceQty = r3(num(it.qty) - num(it.invoicedQty));
  }
  const pick = d.pickingId ? await prisma.pickingList.findUnique({ where: { id: d.pickingId }, select: { id: true, docNo: true } }) : null;
  const pack = d.packingId ? await prisma.packingList.findUnique({ where: { id: d.packingId }, select: { id: true, docNo: true } }) : null;
  const proforma = so?.proformaId ? await prisma.proformaInvoice.findUnique({ where: { id: so.proformaId }, select: { id: true, docNo: true } }) : null;
  return {
    ...row, salesOrder: so ? { id: so.id, docNo: so.docNo, status: so.status } : null, proforma, picking: pick, packing: pack, items,
    totalQty: r3(d.items.reduce((s, i) => s + num(i.qty), 0)), totalCost: d.status === 'POSTED' ? r3(d.items.reduce((s, i) => s + num(i.qty) * num(i.unitCost), 0)) : null,
    links: await docLinks('DELIVERY_NOTE', id), approval: await approvalFor('DELIVERY_NOTE', id),
  };
}

router.get('/', can('delivery_note', 'view'), ah(async (req, res) => {
  const { q, where, orderBy } = await buildListWhere(req, { searchFields: ['docNo', 'remarks', 'driver', 'vehicleNo'] });
  if (req.query.invoiced === 'true' || req.query.invoiced === 'false') (where as Record<string, unknown>).invoiced = req.query.invoiced === 'true';
  const [rows, total] = await Promise.all([
    prisma.deliveryNote.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { items: { select: { qty: true, invoicedQty: true } } } }),
    prisma.deliveryNote.count({ where }),
  ]);
  const sos = await prisma.salesOrder.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.salesOrderId))] } }, select: { id: true, docNo: true, proformaId: true } });
  const m = new Map(sos.map((s) => [s.id, s]));
  const pfs = await prisma.proformaInvoice.findMany({ where: { id: { in: sos.map((s) => s.proformaId).filter((x): x is number => x != null) } }, select: { id: true, docNo: true } });
  const pm = new Map(pfs.map((p) => [p.id, p]));
  const out = rows.map((r) => {
    const so = m.get(r.salesOrderId);
    return {
      ...r, items: undefined, totalQty: r3(r.items.reduce((s, i) => s + num(i.qty), 0)), invoicedQty: r3(r.items.reduce((s, i) => s + num(i.invoicedQty), 0)),
      salesOrder: so ? { id: so.id, docNo: so.docNo } : null, proforma: so?.proformaId ? pm.get(so.proformaId) ?? null : null,
    };
  });
  await enrich(out as unknown as Record<string, unknown>[], { customerId: 'customer', warehouseId: 'warehouse' });
  res.json(paged(out, total, q));
}));
router.get('/:id', can('delivery_note', 'view'), ah(async (req, res) => res.json(await detail(intParam(req)))));

async function createDeliveryTx(tx: Tx, req: Request, orderId: number, h: Header, lines: Map<number, number> | null, ctx: { pickingId?: number; packingId?: number }) {
  const { so, rem } = await remainingByItem(tx, orderId);
  mustStatus(so, ['APPROVED', 'PARTIALLY_DELIVERED'], 'create delivery note (order must be approved)');
  const want = new Map<number, number>();
  if (lines) for (const [k, v] of lines) want.set(k, v);
  else if (h.items?.length) for (const i of h.items) want.set(i.orderItemId, (want.get(i.orderItemId) ?? 0) + i.qty);
  else for (const [k, v] of rem) if (v > 0) want.set(k, v);
  const items: { orderItemId: number; productId: number; qty: number }[] = [];
  const soItems = new Map(so.items.map((i) => [i.id, i]));
  for (const [oid, qty] of want) {
    const si = soItems.get(oid);
    if (!si) throw badRequest(`Order item ${oid} does not belong to ${so.docNo}`);
    if (qty <= 0) continue;
    if (qty > (rem.get(oid) ?? 0) + 0.0005) throw badRequest(`Cannot deliver ${qty} of order line ${oid}: only ${rem.get(oid) ?? 0} remaining (ordered ${num(si.qty)}, delivered ${num(si.deliveredQty)})`);
    items.push({ orderItemId: oid, productId: si.productId, qty });
  }
  if (!items.length) throw badRequest('Nothing left to deliver on this order');
  const cust = await tx.customer.findUniqueOrThrow({ where: { id: so.customerId } });
  const docDate = h.docDate ?? new Date();
  const docNo = await nextNumber(tx, 'DELIVERY_NOTE', { date: docDate });
  const dn = await tx.deliveryNote.create({
    data: {
      docNo, docDate, salesOrderId: so.id, pickingId: ctx.pickingId ?? null, packingId: ctx.packingId ?? null, customerId: so.customerId, warehouseId: so.warehouseId,
      deliveryAddress: h.deliveryAddress ?? ([cust.address, cust.city, cust.country].filter(Boolean).join(', ') || null), driver: h.driver ?? null, vehicleNo: h.vehicleNo ?? null,
      remarks: h.remarks ?? null, createdBy: req.user?.id, items: { create: items },
    },
  });
  await linkDocs(tx, { type: 'SALES_ORDER', id: so.id, no: so.docNo }, { type: 'DELIVERY_NOTE', id: dn.id, no: dn.docNo });
  if (so.proformaId) {
    const pf = await tx.proformaInvoice.findUnique({ where: { id: so.proformaId }, select: { id: true, docNo: true } });
    if (pf) await linkDocs(tx, { type: 'PROFORMA_INVOICE', id: pf.id, no: pf.docNo }, { type: 'DELIVERY_NOTE', id: dn.id, no: dn.docNo });
  }
  if (ctx.pickingId) {
    const pk = await tx.pickingList.findUniqueOrThrow({ where: { id: ctx.pickingId } });
    await linkDocs(tx, { type: 'PICKING_LIST', id: pk.id, no: pk.docNo }, { type: 'DELIVERY_NOTE', id: dn.id, no: dn.docNo });
  }
  if (ctx.packingId) {
    const pl = await tx.packingList.findUniqueOrThrow({ where: { id: ctx.packingId } });
    await linkDocs(tx, { type: 'PACKING_LIST', id: pl.id, no: pl.docNo }, { type: 'DELIVERY_NOTE', id: dn.id, no: dn.docNo });
  }
  await audit(tx, req.user, 'CREATE', 'DeliveryNote', dn.id, { docNo, order: so.docNo });
  return dn.id;
}

/* ---- conversions ---- */
const fromOrder = Router();
fromOrder.post('/:id/create-delivery', can('delivery_note', 'create'), ah(async (req, res) => {
  const h = parse(headerSchema, req.body ?? {});
  const id = await prisma.$transaction((tx) => createDeliveryTx(tx, req, intParam(req), h, null, {}), { timeout: 30000 });
  res.status(201).json(await detail(id));
}));

/** Delivery from a confirmed proforma (runs on the order behind it): everything still to deliver unless items are given. */
const fromProforma = Router();
fromProforma.post('/:id/create-delivery', can('delivery_note', 'create'), ah(async (req, res) => {
  const h = parse(headerSchema, req.body ?? {});
  const id = await prisma.$transaction(async (tx) => {
    const p = mustFound(await tx.proformaInvoice.findUnique({ where: { id: intParam(req) } }), 'Proforma invoice');
    if (!p.salesOrderId || p.status === 'CANCELLED') throw badRequest(`Confirm proforma ${p.docNo} first`);
    const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: p.salesOrderId } });
    if (so.status === 'PENDING_APPROVAL') throw badRequest(`Proforma ${p.docNo} is waiting for approval`);
    if (!['APPROVED', 'PARTIALLY_DELIVERED'].includes(so.status)) throw badRequest(`Nothing left to deliver on proforma ${p.docNo}`);
    return createDeliveryTx(tx, req, so.id, h, null, {});
  }, { timeout: 30000 });
  res.status(201).json(await detail(id));
}));

async function pickedNotDelivered(tx: Tx, pickingId: number) {
  const pk = await tx.pickingList.findUniqueOrThrow({ where: { id: pickingId }, include: { items: true } });
  const used = await tx.deliveryNoteItem.findMany({ where: { delivery: { pickingId, status: { not: 'CANCELLED' } } } });
  const u = new Map<number, number>();
  for (const x of used) u.set(x.orderItemId, (u.get(x.orderItemId) ?? 0) + num(x.qty));
  const lines = new Map<number, number>();
  for (const it of pk.items) lines.set(it.orderItemId, r3((lines.get(it.orderItemId) ?? 0) + num(it.pickedQty)));
  for (const [k, v] of lines) lines.set(k, Math.max(0, r3(v - (u.get(k) ?? 0))));
  return { pk, lines };
}

const fromPicking = Router();
fromPicking.post('/:id/create-delivery', can('delivery_note', 'create'), ah(async (req, res) => {
  const pid = intParam(req);
  const h = parse(headerSchema, req.body ?? {});
  const id = await prisma.$transaction(async (tx) => {
    const { pk, lines } = await pickedNotDelivered(tx, pid);
    mustStatus(pk, ['PARTIALLY_PICKED', 'PICKED'], 'create delivery (picking has no picked qty)');
    let want = new Map([...lines].filter(([, v]) => v > 0));
    if (h.items?.length) {
      want = new Map();
      for (const i of h.items) {
        if (i.qty > (lines.get(i.orderItemId) ?? 0) + 0.0005) throw badRequest(`Cannot deliver ${i.qty} of order line ${i.orderItemId}: only ${lines.get(i.orderItemId) ?? 0} picked and undelivered on ${pk.docNo}`);
        want.set(i.orderItemId, (want.get(i.orderItemId) ?? 0) + i.qty);
      }
    }
    if (!want.size) throw badRequest('Nothing picked and undelivered on this picking list');
    const pack = await tx.packingList.findFirst({ where: { pickingId: pid, status: 'PACKED' }, orderBy: { id: 'desc' } });
    return createDeliveryTx(tx, req, pk.salesOrderId, h, want, { pickingId: pid, packingId: pack?.id });
  }, { timeout: 30000 });
  res.status(201).json(await detail(id));
}));

const fromPacking = Router();
fromPacking.post('/:id/create-delivery', can('delivery_note', 'create'), ah(async (req, res) => {
  const plId = intParam(req);
  const h = parse(headerSchema, req.body ?? {});
  const id = await prisma.$transaction(async (tx) => {
    const pl = mustFound(await tx.packingList.findUnique({ where: { id: plId }, include: { items: true } }), 'Packing list');
    mustStatus(pl, ['PACKED', 'DRAFT'], 'create delivery');
    if (!pl.pickingId) throw badRequest('Packing list has no picking list');
    const prior = await tx.deliveryNote.findFirst({ where: { packingId: plId, status: { not: 'CANCELLED' } } });
    if (prior) throw badRequest(`Packing list already has delivery note ${prior.docNo}`);
    const { lines } = await pickedNotDelivered(tx, pl.pickingId);
    const pk = await tx.pickingList.findUniqueOrThrow({ where: { id: pl.pickingId }, include: { items: true } });
    const want = new Map<number, number>();
    const byProduct = new Map<number, number>();
    for (const i of pl.items) byProduct.set(i.productId, (byProduct.get(i.productId) ?? 0) + num(i.qty));
    for (const [pid, qty] of byProduct) {
      let left = qty;
      for (const it of pk.items.filter((x) => x.productId === pid)) {
        const cap = lines.get(it.orderItemId) ?? 0;
        const take = Math.min(left, cap - (want.get(it.orderItemId) ?? 0));
        if (take > 0) {
          want.set(it.orderItemId, (want.get(it.orderItemId) ?? 0) + take);
          left = r3(left - take);
        }
      }
      if (left > 0.0005) throw badRequest(`Packed qty of product ${pid} exceeds the picked & undelivered qty`);
    }
    return createDeliveryTx(tx, req, pl.salesOrderId, h, want, { pickingId: pl.pickingId, packingId: plId });
  }, { timeout: 30000 });
  res.status(201).json(await detail(id));
}));

/* ---- edit / delete ---- */
router.put('/:id', can('delivery_note', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const h = parse(headerSchema, req.body);
  await prisma.$transaction(async (tx) => {
    const revisionBefore = await revisionSnapshot(tx, 'DeliveryNote', id);
    const d = mustFound(await tx.deliveryNote.findUnique({ where: { id } }), 'Delivery note');
    mustStatus(d, ['DRAFT'], 'edit');
    const data: Record<string, unknown> = {};
    for (const k of ['docDate', 'deliveryAddress', 'driver', 'vehicleNo', 'remarks'] as const) if (h[k] !== undefined) data[k] = h[k];
    if (h.items?.length) {
      const { so, rem } = await remainingByItem(tx, d.salesOrderId, id);
      const ids = new Set(so.items.map((i) => i.id));
      const agg = new Map<number, number>();
      for (const i of h.items) {
        if (!ids.has(i.orderItemId)) throw badRequest(`Order item ${i.orderItemId} does not belong to the order`);
        agg.set(i.orderItemId, (agg.get(i.orderItemId) ?? 0) + i.qty);
      }
      for (const [k, q] of agg) if (q > (rem.get(k) ?? 0) + 0.0005) throw badRequest(`Cannot deliver ${q} of order line ${k}: only ${rem.get(k)} remaining`);
      const pm = new Map(so.items.map((i) => [i.id, i.productId]));
      await tx.deliveryNoteItem.deleteMany({ where: { deliveryId: id } });
      data.items = { create: [...agg].map(([orderItemId, qty]) => ({ orderItemId, productId: pm.get(orderItemId)!, qty })) };
    }
    await tx.deliveryNote.update({ where: { id }, data });
    await auditRevision(tx, req.user, 'DeliveryNote', id, revisionBefore, req.body?.changeReason);
    await audit(tx, req.user, 'UPDATE', 'DeliveryNote', id);
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

router.delete('/:id', can('delivery_note', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const d = mustFound(await tx.deliveryNote.findUnique({ where: { id } }), 'Delivery note');
    mustStatus(d, ['DRAFT'], 'delete');
    await tx.documentLink.deleteMany({ where: { toType: 'DELIVERY_NOTE', toId: id } });
    await tx.deliveryNote.delete({ where: { id } });
    await audit(tx, req.user, 'DELETE', 'DeliveryNote', id, { docNo: d.docNo });
  });
  res.json({ ok: true });
}));

/* ---- POST: stock decreases (avg cost), reservation consumed, cost stored for COGS ---- */
router.post('/:id/post', can('delivery_note', 'post'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const d = mustFound(await tx.deliveryNote.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } }), 'Delivery note');
    mustStatus(d, ['DRAFT'], 'post');
    const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: d.salesOrderId } });
    mustStatus(so, ['APPROVED', 'PARTIALLY_DELIVERED'], `post delivery (sales order ${so.docNo} is ${so.status})`);
    const codes = new Map((await tx.product.findMany({ where: { id: { in: d.items.map((i) => i.productId) } }, select: { id: true, code: true } })).map((p) => [p.id, p.code]));
    // temporary until go-live: System Settings sales.allowNegativeStock lets deliveries take stock below zero
    const allowNeg = await boolSetting('sales.allowNegativeStock', false, tx);
    let allBilled = true;
    for (const it of d.items) {
      const q = num(it.qty);
      const si = await tx.salesOrderItem.findUniqueOrThrow({ where: { id: it.orderItemId } });
      if (q > num(si.qty) - num(si.deliveredQty) + 0.0005) throw badRequest(`Cannot deliver ${q} of ${codes.get(it.productId)}: only ${r3(num(si.qty) - num(si.deliveredQty))} left to deliver on ${so.docNo}`);
      // stock availability: consuming own reservation first, anything above must be free stock
      const mine = (await reservedByProduct(tx, so.id)).get(it.productId) ?? 0;
      const extra = Math.max(0, r3(q - mine));
      const bal = await tx.stockBalance.findUnique({ where: { productId_warehouseId: { productId: it.productId, warehouseId: d.warehouseId } } });
      const onHand = num(bal?.onHand);
      if (!allowNeg && onHand < q - 0.0005) throw badRequest(`Insufficient stock for ${codes.get(it.productId)}: on hand ${onHand}, delivering ${q}`);
      if (!allowNeg && extra > 0 && onHand - num(bal?.reserved) < extra - 0.0005) {
        throw badRequest(`Insufficient unreserved stock for ${codes.get(it.productId)}: delivering ${q}, ${mine} reserved for ${so.docNo}, free stock ${r3(onHand - num(bal?.reserved))}`);
      }
      const row = await postStock(tx, {
        txType: 'SALES_DELIVERY', productId: it.productId, warehouseId: d.warehouseId, qty: -q, consumesReservation: true, allowNegative: allowNeg,
        refType: 'DELIVERY_NOTE', refId: d.id, refNo: d.docNo, userId: req.user?.id, date: d.docDate, remarks: `Delivery to customer, order ${so.docNo}`,
      });
      await fulfillReservation(tx, so.id, it.productId, q);
      // billed-ahead qty (invoiced before delivery under sales.invoiceBeforeDelivery) is marked as already invoiced on this DN line
      const others = await tx.deliveryNoteItem.findMany({ where: { orderItemId: it.orderItemId, id: { not: it.id } } });
      const billedViaDn = others.reduce((s, o) => s + num(o.invoicedQty), 0);
      const ahead = Math.max(0, r3(num(si.invoicedQty) - billedViaDn));
      const billed = Math.min(q, ahead);
      if (billed < q - 0.0005) allBilled = false;
      await tx.deliveryNoteItem.update({ where: { id: it.id }, data: { unitCost: r4(num(row.unitCost)), invoicedQty: billed } });
      await tx.salesOrderItem.update({ where: { id: si.id }, data: { deliveredQty: r3(num(si.deliveredQty) + q) } });
    }
    await tx.deliveryNote.update({ where: { id }, data: { status: 'POSTED', invoiced: allBilled } });
    if (d.packingId) await tx.packingList.updateMany({ where: { id: d.packingId, status: { in: ['PACKED', 'DRAFT'] } }, data: { status: 'DELIVERED' } });
    await refreshOrderStatus(tx, so.id);
    await audit(tx, req.user, 'POST', 'DeliveryNote', id, { docNo: d.docNo, order: so.docNo });
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

router.post('/:id/cancel', can('delivery_note', 'cancel'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const d = mustFound(await tx.deliveryNote.findUnique({ where: { id }, include: { items: true } }), 'Delivery note');
    mustStatus(d, ['DRAFT', 'POSTED'], 'cancel');
    if (d.status === 'POSTED') {
      if (d.items.some((i) => num(i.invoicedQty) > 0) || d.invoiced) throw badRequest('Delivery note has been invoiced (or its quantity pre-billed); cancel the invoice first');
      const live = await tx.salesInvoice.count({ where: { deliveryId: id, status: { not: 'CANCELLED' } } });
      if (live) throw badRequest('Delivery note has a live invoice; cancel the invoice first');
      const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: d.salesOrderId } });
      const reinstate = ['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'INVOICED'].includes(so.status);
      for (const it of d.items) {
        const q = num(it.qty);
        await postStock(tx, {
          txType: 'SALES_RETURN', productId: it.productId, warehouseId: d.warehouseId, qty: q, unitCost: num(it.unitCost),
          refType: 'DELIVERY_NOTE', refId: d.id, refNo: d.docNo, userId: req.user?.id, remarks: `Delivery note ${d.docNo} cancelled (reversal)`,
        });
        const si = await tx.salesOrderItem.findUniqueOrThrow({ where: { id: it.orderItemId } });
        await tx.salesOrderItem.update({ where: { id: si.id }, data: { deliveredQty: Math.max(0, r3(num(si.deliveredQty) - q)) } });
        if (reinstate) await reserveStock(tx, { salesOrderId: so.id, salesOrderNo: so.docNo, customerId: so.customerId, productId: it.productId, warehouseId: d.warehouseId, qty: q });
      }
      if (d.packingId) await tx.packingList.updateMany({ where: { id: d.packingId, status: 'DELIVERED' }, data: { status: 'PACKED' } });
      await refreshOrderStatus(tx, so.id);
    }
    await tx.deliveryNote.update({ where: { id }, data: { status: 'CANCELLED' } });
    await audit(tx, req.user, 'CANCEL', 'DeliveryNote', id, { from: d.status });
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

export default [
  { path: '/delivery-notes', router },
  { path: '/sales-orders', router: fromOrder },
  { path: '/proforma-invoices', router: fromProforma },
  { path: '/picking-lists', router: fromPicking },
  { path: '/packing-lists', router: fromPacking },
] satisfies ModuleDef[];
