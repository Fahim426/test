import { revisionSnapshot, auditRevision } from '../services/revisions-history';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import { z } from 'zod';
import { prisma, Tx } from '../lib/prisma';
import { ah, intParam, parse } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import { nextNumber } from '../services/numbering';
import { linkDocs } from '../services/docLink';
import { postStock } from '../services/stock';
import { postJournal, reverseJournal } from '../services/accounting';
import { enrich } from '../lib/enrich';
import { num, r2, r3, r4 } from '../lib/calc';
import {
  assertStatus, deleteLinks, findSourceJournal, finishDoc, getSetting, IMPORT_RECEIVABLE, listDocs, poUnitCostBase, refreshOrderStatus,
} from '../services/purchase-common';
import type { ModuleDef } from '../app';

const T = { timeout: 30000 };
const G = 'goods_receipt';
const TOL_KEY = 'purchase.overReceiptTolerancePct';

type Db = Tx | typeof prisma;

function assertReceivable(o: any, hasShipment: boolean) {
  if (!o) throw notFound('Purchase order not found');
  if (o.orderType === 'LOCAL') {
    if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(o.status)) throw badRequest(`Purchase order ${o.docNo} is ${o.status}; only APPROVED / PARTIALLY_RECEIVED orders can be received`);
  } else {
    if (!hasShipment) throw badRequest('Import goods receipts are created from a shipment (POST /import-shipments/:id/create-receipt)');
    if (!IMPORT_RECEIVABLE.includes(o.status) || o.status === 'RECEIVED') throw badRequest(`Import order ${o.docNo} is ${o.status}; cannot receive`);
  }
}

/** prefill = ordered / previouslyReceived / current / pending per PO line (never saved) */
export async function receiptPrefill(db: Db, orderId: number, shipmentId?: number | null) {
  const o = await db.purchaseOrder.findUnique({ where: { id: orderId }, include: { items: { orderBy: { id: 'asc' } } } });
  if (!o) throw notFound('Purchase order not found');
  const tol = await getSetting(db, TOL_KEY, 0);
  let shipment: any = null;
  let shipItems: any[] | null = null;
  if (shipmentId) {
    shipment = await db.importShipment.findUnique({ where: { id: shipmentId }, include: { items: true } });
    if (!shipment || shipment.orderId !== orderId) throw badRequest('Shipment does not belong to this order');
    shipItems = shipment.items;
  }
  let items: any[] = o.items.map((it) => {
    const ordered = num(it.qty);
    const prev = num(it.receivedQty);
    const maxQty = r3(Math.max(0, (ordered * (100 + tol)) / 100 - prev));
    let current = r3(Math.max(0, ordered - prev));
    if (shipItems) {
      const s = shipItems.find((x) => x.orderItemId === it.id);
      current = s ? r3(Math.max(0, num(s.qty) - num(s.receivedQty))) : 0;
    }
    current = Math.min(current, maxQty);
    return {
      orderItemId: it.id, productId: it.productId, oemNumber: it.oemNumber, description: it.description, unit: it.unit, orderedQty: ordered, previouslyReceived: prev,
      qty: current, pendingQty: r3(Math.max(0, ordered - prev - current)), maxQty, unitCost: poUnitCostBase(it, o.exchangeRate), rate: num(it.rate), currencyCode: o.currencyCode, exchangeRate: num(o.exchangeRate),
    };
  });
  if (shipItems) items = items.filter((i) => i.qty > 0 || shipItems!.some((s) => s.orderItemId === i.orderItemId));
  await enrich(items, { productId: 'product' });
  return {
    orderId: o.id, orderNo: o.docNo, orderType: o.orderType, orderStatus: o.status, supplierId: o.supplierId, warehouseId: o.warehouseId, currencyCode: o.currencyCode, exchangeRate: num(o.exchangeRate),
    shipmentId: shipment?.id ?? null, shipmentNo: shipment?.shipmentNo ?? null, tolerancePct: tol, items,
  };
}

const grnItemIn = z.object({ orderItemId: z.coerce.number().int(), qty: z.coerce.number().min(0), locationId: z.coerce.number().int().nullish() });
const grnSchema = z.object({
  orderId: z.coerce.number().int(),
  shipmentId: z.coerce.number().int().nullish(),
  docDate: z.coerce.date().optional(),
  warehouseId: z.coerce.number().int().nullish(),
  supplierDeliveryNo: z.string().nullish(),
  remarks: z.string().nullish(),
  items: z.array(grnItemIn).optional(),
});

async function createReceipt(tx: Tx, raw: z.infer<typeof grnSchema>, user: { id: number; username: string }) {
  const o = await tx.purchaseOrder.findUnique({ where: { id: raw.orderId } });
  assertReceivable(o, !!raw.shipmentId);
  const pre = await receiptPrefill(tx, raw.orderId, raw.shipmentId);
  const dup = await tx.goodsReceipt.findFirst({ where: { orderId: raw.orderId, status: 'DRAFT', shipmentId: raw.shipmentId ?? null } });
  if (dup) throw badRequest(`A draft goods receipt (${dup.docNo}) already exists for this ${raw.shipmentId ? 'shipment' : 'order'}; post or delete it first`);
  const warehouseId = raw.warehouseId ?? o!.warehouseId;
  if (!warehouseId) throw badRequest('Warehouse is required');
  if (!(await tx.warehouse.findUnique({ where: { id: warehouseId } }))) throw badRequest('Warehouse not found');
  const req = new Map<number, { qty: number; locationId?: number | null }>();
  if (raw.items?.length) for (const i of raw.items) req.set(i.orderItemId, i);
  const lines: any[] = [];
  for (const p of pre.items) {
    let qty = p.qty;
    let loc: number | null | undefined;
    if (raw.items?.length) {
      const r = req.get(p.orderItemId);
      qty = r ? r.qty : 0;
      loc = r?.locationId;
    }
    if (qty <= 0) continue;
    if (qty > p.maxQty + 0.0005) throw badRequest(`Cannot over-receive ${p.product?.code ?? p.productId}: ordered ${p.orderedQty}, already received ${p.previouslyReceived}, tolerance ${pre.tolerancePct}% (max receivable ${p.maxQty}, requested ${qty})`);
    lines.push({ orderItemId: p.orderItemId, productId: p.productId, orderedQty: p.orderedQty, previouslyReceived: p.previouslyReceived, qty, unitCost: p.unitCost, landedUnitCost: p.unitCost, locationId: loc ?? null });
  }
  for (const id of req.keys()) if (!pre.items.some((p) => p.orderItemId === id)) throw badRequest(`Order item ${id} is not part of this ${raw.shipmentId ? 'shipment' : 'order'}`);
  if (!lines.length) throw badRequest('Nothing left to receive');
  const docDate = raw.docDate ?? new Date();
  const docNo = await nextNumber(tx, 'GOODS_RECEIPT', { date: docDate });
  const g = await tx.goodsReceipt.create({
    data: { docNo, grnType: o!.orderType, docDate, orderId: o!.id, supplierId: o!.supplierId, shipmentId: raw.shipmentId ?? null, warehouseId, supplierDeliveryNo: raw.supplierDeliveryNo, remarks: raw.remarks, status: 'DRAFT', createdBy: user.id, items: { create: lines } },
  });
  await linkDocs(tx, { type: o!.orderType === 'IMPORT' ? 'IMPORT_PURCHASE_ORDER' : 'PURCHASE_ORDER', id: o!.id, no: o!.docNo }, { type: 'GOODS_RECEIPT', id: g.id, no: g.docNo });
  if (raw.shipmentId) {
    const s = await tx.importShipment.findUnique({ where: { id: raw.shipmentId } });
    await linkDocs(tx, { type: 'IMPORT_SHIPMENT', id: s!.id, no: s!.shipmentNo }, { type: 'GOODS_RECEIPT', id: g.id, no: g.docNo });
  }
  await audit(tx, user, 'CREATE', 'GoodsReceipt', g.id, { docNo, orderId: o!.id, shipmentId: raw.shipmentId });
  return g;
}

async function postReceipt(tx: Tx, id: number, user: { id: number; username: string }) {
  const g: any = await tx.goodsReceipt.findUnique({ where: { id }, include: { items: true } });
  assertStatus(g, ['DRAFT'], 'post');
  const o: any = await tx.purchaseOrder.findUnique({ where: { id: g.orderId }, include: { items: true } });
  assertReceivable(o, !!g.shipmentId);
  const tol = await getSetting(tx, TOL_KEY, 0);
  let total = 0;
  const shipItems: any[] = g.shipmentId ? await tx.importShipmentItem.findMany({ where: { shipmentId: g.shipmentId } }) : [];
  for (const it of g.items) {
    const poi = o.items.find((x: any) => x.id === it.orderItemId);
    if (!poi) throw badRequest('Order line no longer exists');
    const prev = num(poi.receivedQty);
    const qty = num(it.qty);
    const max = (num(poi.qty) * (100 + tol)) / 100;
    if (prev + qty > max + 0.0005) throw badRequest(`Cannot over-receive: ${poi.description ?? poi.productId} ordered ${num(poi.qty)}, received ${prev}, this receipt ${qty} (tolerance ${tol}%)`);
    if (g.shipmentId) {
      const s = shipItems.find((x) => x.orderItemId === it.orderItemId);
      if (!s || qty > num(s.qty) - num(s.receivedQty) + 0.0005) throw badRequest('Receipt quantity exceeds the shipped quantity');
    }
    const unitCost = poUnitCostBase(poi, o.exchangeRate);
    const st = await postStock(tx, {
      txType: 'PURCHASE_RECEIPT', productId: it.productId, warehouseId: g.warehouseId, qty, unitCost, locationId: it.locationId ?? undefined,
      refType: 'GOODS_RECEIPT', refId: g.id, refNo: g.docNo, date: g.docDate, userId: user.id, remarks: `Receipt against ${o.docNo}`,
    });
    total += num(st.value);
    await tx.purchaseOrderItem.update({ where: { id: poi.id }, data: { receivedQty: r3(prev + qty) } });
    await tx.goodsReceiptItem.update({ where: { id: it.id }, data: { orderedQty: poi.qty, previouslyReceived: r3(prev), unitCost, landedUnitCost: unitCost } });
    poi.receivedQty = r3(prev + qty);
    if (g.shipmentId) {
      const s = shipItems.find((x) => x.orderItemId === it.orderItemId)!;
      s.receivedQty = r3(num(s.receivedQty) + qty);
      await tx.importShipmentItem.update({ where: { id: s.id }, data: { receivedQty: s.receivedQty } });
    }
  }
  total = r2(total);
  const j = await postJournal(tx, {
    date: g.docDate, entryType: 'AUTO', sourceType: 'GOODS_RECEIPT', sourceId: g.id, sourceNo: g.docNo, narration: `GRN ${g.docNo} against ${o.docNo}`, userId: user.id,
    lines: [
      { accountKey: 'INVENTORY', debit: total, description: `Goods received ${g.docNo}` },
      { accountKey: 'GRNI', credit: total, description: `GRNI ${g.docNo}` },
    ],
  });
  await tx.goodsReceipt.update({ where: { id }, data: { status: 'POSTED' } });
  if (g.shipmentId && shipItems.every((s) => num(s.receivedQty) >= num(s.qty) - 0.0005)) await tx.importShipment.update({ where: { id: g.shipmentId }, data: { status: 'RECEIVED', actualArrival: undefined } });
  const st = await refreshOrderStatus(tx, g.orderId);
  await audit(tx, user, 'POST', 'GoodsReceipt', id, { value: total, journal: j.entryNo, orderStatus: st });
  return { journal: j, value: total };
}

async function cancelReceipt(tx: Tx, id: number, user: { id: number; username: string }) {
  const g: any = await tx.goodsReceipt.findUnique({ where: { id }, include: { items: true } });
  assertStatus(g, ['DRAFT', 'POSTED'], 'cancel');
  if (g.status === 'DRAFT') {
    await tx.goodsReceipt.update({ where: { id }, data: { status: 'CANCELLED' } });
    await audit(tx, user, 'CANCEL', 'GoodsReceipt', id);
    return;
  }
  if (g.items.some((i: any) => num(i.invoicedQty) > 0)) throw badRequest('Goods receipt is (partly) invoiced; cancel the purchase invoice first');
  if (await tx.purchaseReturnItem.count({ where: { receiptItemId: { in: g.items.map((i: any) => i.id) }, return: { status: { not: 'CANCELLED' } } } })) throw badRequest('Goods receipt has purchase returns');
  if (await tx.landedCost.count({ where: { receiptId: id, status: 'POSTED' } })) throw badRequest('Cancel the landed cost document(s) of this receipt first');
  for (const it of g.items) {
    await postStock(tx, {
      txType: 'PURCHASE_RETURN', productId: it.productId, warehouseId: g.warehouseId, qty: -num(it.qty), unitCost: num(it.unitCost), refType: 'GOODS_RECEIPT', refId: g.id, refNo: g.docNo,
      userId: user.id, remarks: `Cancellation of ${g.docNo}`, allowNegative: false,
    });
    const poi = await tx.purchaseOrderItem.findUnique({ where: { id: it.orderItemId } });
    if (poi) await tx.purchaseOrderItem.update({ where: { id: poi.id }, data: { receivedQty: r3(Math.max(0, num(poi.receivedQty) - num(it.qty))) } });
    if (g.shipmentId) {
      const s = await tx.importShipmentItem.findFirst({ where: { shipmentId: g.shipmentId, orderItemId: it.orderItemId } });
      if (s) await tx.importShipmentItem.update({ where: { id: s.id }, data: { receivedQty: r3(Math.max(0, num(s.receivedQty) - num(it.qty))) } });
    }
  }
  const j = await findSourceJournal(tx, 'GOODS_RECEIPT', id);
  if (j) await reverseJournal(tx, j.id, user.id);
  await tx.goodsReceipt.update({ where: { id }, data: { status: 'CANCELLED' } });
  if (g.shipmentId) {
    const s = await tx.importShipment.findUnique({ where: { id: g.shipmentId } });
    if (s?.status === 'RECEIVED') await tx.importShipment.update({ where: { id: s.id }, data: { status: 'CLEARED' } });
  }
  await refreshOrderStatus(tx, g.orderId);
  await audit(tx, user, 'CANCEL', 'GoodsReceipt', id, { reversedStock: true });
}

async function receiptDetail(id: number) {
  const g = await prisma.goodsReceipt.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });
  if (!g) throw notFound('Goods receipt not found');
  const d: any = await finishDoc(g, g.grnType === 'IMPORT' ? 'GOODS_RECEIPT' : 'GOODS_RECEIPT');
  const order = await prisma.purchaseOrder.findUnique({ where: { id: g.orderId }, select: { id: true, docNo: true, orderType: true, currencyCode: true, exchangeRate: true, status: true } });
  d.order = order;
  d.shipment = g.shipmentId ? await prisma.importShipment.findUnique({ where: { id: g.shipmentId }, select: { id: true, shipmentNo: true, containerNo: true, billOfLading: true, awb: true, status: true } }) : null;
  for (const it of d.items) {
    it.pendingQty = r3(Math.max(0, num(it.orderedQty) - num(it.previouslyReceived) - num(it.qty)));
    it.uninvoicedQty = r3(num(it.qty) - num(it.invoicedQty));
    it.value = r2(num(it.qty) * num(it.unitCost));
    it.landedValue = r2(num(it.qty) * num(it.landedUnitCost));
  }
  d.totalQty = r3(d.items.reduce((s: number, i: any) => s + num(i.qty), 0));
  d.totalValue = r2(d.items.reduce((s: number, i: any) => s + i.value, 0));
  d.invoices = await prisma.purchaseInvoice.findMany({ where: { receiptId: id }, select: { id: true, docNo: true, status: true } });
  d.landedCosts = await prisma.landedCost.findMany({ where: { receiptId: id }, select: { id: true, docNo: true, status: true, totalAdditional: true } });
  return d;
}

// ================================================================== /goods-receipts
const router = Router();
router.get('/', can(G, 'view'), ah(async (req, res) => {
  res.json(await listDocs(req, {
    model: 'goodsReceipt', search: ['docNo', 'supplierDeliveryNo', 'remarks'], supplierSearch: true, numeric: ['supplierId', 'warehouseId', 'orderId', 'shipmentId'], strings: ['grnType'],
    include: { items: { select: { qty: true, unitCost: true, invoicedQty: true } } },
    map: (r) => {
      const totalQty = r3(r.items.reduce((s: number, i: any) => s + num(i.qty), 0));
      const invoicedQty = r3(r.items.reduce((s: number, i: any) => s + num(i.invoicedQty), 0));
      const totalValue = r2(r.items.reduce((s: number, i: any) => s + num(i.qty) * num(i.unitCost), 0));
      const out = { ...r, totalQty, invoicedQty, totalValue, invoiceStatus: invoicedQty <= 0 ? 'NOT_INVOICED' : invoicedQty >= totalQty - 0.0005 ? 'INVOICED' : 'PARTIALLY_INVOICED' };
      delete out.items;
      return out;
    },
    after: async (rows) => {
      const ids = [...new Set(rows.map((r) => r.orderId))];
      const os = await prisma.purchaseOrder.findMany({ where: { id: { in: ids } }, select: { id: true, docNo: true, orderType: true } });
      const m = new Map(os.map((o) => [o.id, o]));
      rows.forEach((r) => (r.order = m.get(r.orderId) ?? null));
    },
  }));
}));
router.get('/prefill/:orderId', can(G, 'view'), ah(async (req, res) => {
  const sid = req.query.shipmentId ? Number(req.query.shipmentId) : null;
  res.json(await receiptPrefill(prisma, intParam(req, 'orderId'), sid));
}));
router.get('/pending-invoice', can(G, 'view'), ah(async (req, res) => {
  const where: any = { status: 'POSTED' };
  if (req.query.supplierId) where.supplierId = Number(req.query.supplierId);
  if (req.query.grnType) where.grnType = String(req.query.grnType);
  const gs: any[] = await prisma.goodsReceipt.findMany({ where, include: { items: true }, orderBy: { id: 'desc' }, take: 300 });
  const rows = gs
    .map((g) => {
      const pendingQty = r3(g.items.reduce((s: number, i: any) => s + Math.max(0, num(i.qty) - num(i.invoicedQty)), 0));
      const pendingValue = r2(g.items.reduce((s: number, i: any) => s + Math.max(0, num(i.qty) - num(i.invoicedQty)) * num(i.unitCost), 0));
      return { id: g.id, docNo: g.docNo, docDate: g.docDate, grnType: g.grnType, supplierId: g.supplierId, warehouseId: g.warehouseId, orderId: g.orderId, shipmentId: g.shipmentId, pendingQty, pendingValue };
    })
    .filter((g) => g.pendingQty > 0);
  await enrich(rows, { supplierId: 'supplier', warehouseId: 'warehouse' });
  res.json({ rows });
}));
router.get('/:id', can(G, 'view'), ah(async (req, res) => res.json(await receiptDetail(intParam(req)))));

router.post('/', can(G, 'create'), ah(async (req, res) => {
  const b = parse(grnSchema, req.body);
  const g = await prisma.$transaction((tx) => createReceipt(tx, b, req.user!), T);
  res.status(201).json(await receiptDetail(g.id));
}));
router.put('/:id', can(G, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(z.object({ docDate: z.coerce.date().optional(), warehouseId: z.coerce.number().int().optional(), supplierDeliveryNo: z.string().nullish(), remarks: z.string().nullish(), items: z.array(grnItemIn).optional() }), req.body);
  await prisma.$transaction(async (tx) => {
    const revisionBefore = await revisionSnapshot(tx, 'GoodsReceipt', id);
    const g: any = assertStatus(await tx.goodsReceipt.findUnique({ where: { id }, include: { items: true } }), ['DRAFT'], 'edit');
    const { items, ...h } = b;
    await tx.goodsReceipt.update({ where: { id }, data: h });
    if (items) {
      const pre = await receiptPrefill(tx, g.orderId, g.shipmentId);
      const lines: any[] = [];
      for (const i of items) {
        if (i.qty <= 0) continue;
        const p = pre.items.find((x) => x.orderItemId === i.orderItemId);
        if (!p) throw badRequest(`Order item ${i.orderItemId} is not receivable here`);
        if (i.qty > p.maxQty + 0.0005) throw badRequest(`Cannot over-receive ${p.product?.code ?? p.productId}: max receivable ${p.maxQty}`);
        lines.push({ receiptId: id, orderItemId: p.orderItemId, productId: p.productId, orderedQty: p.orderedQty, previouslyReceived: p.previouslyReceived, qty: i.qty, unitCost: p.unitCost, landedUnitCost: p.unitCost, locationId: i.locationId ?? null });
      }
      if (!lines.length) throw badRequest('Receipt needs at least one line with quantity');
      await tx.goodsReceiptItem.deleteMany({ where: { receiptId: id } });
      await tx.goodsReceiptItem.createMany({ data: lines });
    }
    await auditRevision(tx, req.user, 'GoodsReceipt', id, revisionBefore, req.body?.changeReason);
    await audit(tx, req.user, 'UPDATE', 'GoodsReceipt', id);
  }, T);
  res.json(await receiptDetail(id));
}));
router.delete('/:id', can(G, 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.goodsReceipt.findUnique({ where: { id } }), ['DRAFT'], 'delete');
    await tx.goodsReceipt.delete({ where: { id } });
    await deleteLinks(tx, 'GOODS_RECEIPT', id);
    await audit(tx, req.user, 'DELETE', 'GoodsReceipt', id);
  }, T);
  res.json({ ok: true });
}));
router.post('/:id/post', can(G, 'post'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction((tx) => postReceipt(tx, id, req.user!), T);
  res.json(await receiptDetail(id));
}));
router.post('/:id/cancel', can(G, 'cancel'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction((tx) => cancelReceipt(tx, id, req.user!), T);
  res.json(await receiptDetail(id));
}));

// ================================================================== conversions mounted on other paths
const fromPo = Router();
fromPo.post('/:id/create-receipt', can(G, 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(grnSchema.omit({ orderId: true, shipmentId: true }), req.body ?? {});
  const g = await prisma.$transaction((tx) => createReceipt(tx, { ...b, orderId: id }, req.user!), T);
  res.status(201).json(await receiptDetail(g.id));
}));

const fromShipment = Router();
fromShipment.post('/:id/create-receipt', can(G, 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(grnSchema.omit({ orderId: true, shipmentId: true }), req.body ?? {});
  const g = await prisma.$transaction(async (tx) => {
    const s = await tx.importShipment.findUnique({ where: { id } });
    assertStatus(s, ['ARRIVED', 'CUSTOMS', 'CLEARED'], 'receive (shipment must have ARRIVED)');
    return createReceipt(tx, { ...b, orderId: s!.orderId, shipmentId: id }, req.user!);
  }, T);
  res.status(201).json(await receiptDetail(g.id));
}));

export default [
  { path: '/goods-receipts', router },
  { path: '/purchase-orders', router: fromPo },
  { path: '/import-shipments', router: fromShipment },
] as ModuleDef[];
void r4;
