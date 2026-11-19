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
import { enrich } from '../lib/enrich';
import { num, r2, r3 } from '../lib/calc';
import {
  approveOrder, rejectOrder, assertStatus, baseCurrency, buildOrderData, createPurchaseOrder, deleteLinks, finishDoc, IMPORT_RECEIVABLE, listDocs, orderDetail, orderQtys, orderRow, poSchema, resolveRate, submitOrder,
} from '../services/purchase-common';
import type { ModuleDef } from '../app';

const T = { timeout: 30000 };
const IMP = 'import_purchase';

// ================================================================== IMPORT REQUEST
const irItem = z.object({ productId: z.coerce.number().int().nullish(), description: z.string().nullish(), qty: z.coerce.number().positive(), unit: z.string().nullish() });
const irSchema = z.object({ docDate: z.coerce.date().optional(), supplierId: z.coerce.number().int().nullish(), warehouseId: z.coerce.number().int().nullish(), remarks: z.string().nullish(), items: z.array(irItem).min(1) });

async function fillItems<T extends { productId?: number | null; description?: string | null; unit?: string | null }>(items: T[]) {
  const ids = [...new Set(items.map((i) => i.productId).filter((x): x is number => !!x))];
  const pm = new Map((await prisma.product.findMany({ where: { id: { in: ids } } })).map((p) => [p.id, p]));
  return items.map((i) => {
    const p = i.productId ? pm.get(i.productId) : undefined;
    if (i.productId && !p) throw badRequest(`Product ${i.productId} not found`);
    if (!p && !i.description) throw badRequest('Each item needs a product or a description');
    return { ...i, description: i.description ?? p?.name ?? null, unit: i.unit ?? p?.purchaseUnit ?? null };
  });
}
const loadIR = async (id: number) => {
  const d = await prisma.importRequest.findUnique({ where: { id }, include: { items: true } });
  if (!d) throw notFound('Import request not found');
  return d;
};
async function irDetail(id: number) {
  const d: any = await finishDoc(await loadIR(id), 'IMPORT_REQUEST');
  d.proformas = await prisma.supplierProforma.findMany({ where: { importRequestId: id }, select: { id: true, docNo: true, supplierId: true, status: true, total: true, currencyCode: true } });
  await enrich(d.proformas, { supplierId: 'supplier' });
  return d;
}

const ir = Router();
ir.get('/', can(IMP, 'view'), ah(async (req, res) => {
  res.json(await listDocs(req, { model: 'importRequest', search: ['docNo', 'remarks'], supplierSearch: true, numeric: ['supplierId', 'warehouseId'], include: { items: { select: { qty: true } } }, map: (r) => { const o = { ...r, itemCount: r.items.length, totalQty: r3(r.items.reduce((s: number, i: any) => s + num(i.qty), 0)) }; delete o.items; return o; } }));
}));
ir.get('/:id', can(IMP, 'view'), ah(async (req, res) => res.json(await irDetail(intParam(req)))));
ir.post('/', can(IMP, 'create'), ah(async (req, res) => {
  const b = parse(irSchema, req.body);
  const items = await fillItems(b.items);
  const id = await prisma.$transaction(async (tx) => {
    const docDate = b.docDate ?? new Date();
    const docNo = await nextNumber(tx, 'IMPORT_REQUEST', { date: docDate });
    const d = await tx.importRequest.create({ data: { docNo, docDate, supplierId: b.supplierId, warehouseId: b.warehouseId, remarks: b.remarks, status: 'DRAFT', createdBy: req.user!.id, items: { create: items } } });
    await audit(tx, req.user, 'CREATE', 'ImportRequest', d.id, { docNo });
    return d.id;
  }, T);
  res.status(201).json(await irDetail(id));
}));
ir.put('/:id', can(IMP, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(irSchema.partial(), req.body);
  const items = b.items ? await fillItems(b.items) : null;
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.importRequest.findUnique({ where: { id } }), ['DRAFT'], 'edit');
    await tx.importRequest.update({ where: { id }, data: { docDate: b.docDate, supplierId: b.supplierId, warehouseId: b.warehouseId, remarks: b.remarks } });
    if (items) { await tx.importRequestItem.deleteMany({ where: { requestId: id } }); await tx.importRequestItem.createMany({ data: items.map((i) => ({ ...i, requestId: id })) }); }
    await audit(tx, req.user, 'UPDATE', 'ImportRequest', id);
  }, T);
  res.json(await irDetail(id));
}));
ir.delete('/:id', can(IMP, 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.importRequest.findUnique({ where: { id } }), ['DRAFT'], 'delete');
    await tx.importRequest.delete({ where: { id } });
    await deleteLinks(tx, 'IMPORT_REQUEST', id);
    await audit(tx, req.user, 'DELETE', 'ImportRequest', id);
  }, T);
  res.json({ ok: true });
}));
const irTr = (path: string, perm: string, from: string[], to: string, action: string) =>
  ir.post(`/:id${path}`, can(IMP, perm), ah(async (req, res) => {
    const id = intParam(req);
    await prisma.$transaction(async (tx) => {
      assertStatus(await tx.importRequest.findUnique({ where: { id } }), from, action.toLowerCase());
      await tx.importRequest.update({ where: { id }, data: { status: to } });
      await audit(tx, req.user, action, 'ImportRequest', id, { comment: req.body?.comment });
    }, T);
    res.json(await irDetail(id));
  }));
irTr('/submit', 'edit', ['DRAFT'], 'SUBMITTED', 'SUBMIT');
irTr('/approve', 'approve', ['SUBMITTED'], 'APPROVED', 'APPROVE');
irTr('/reject', 'reject', ['SUBMITTED'], 'DRAFT', 'REJECT');
irTr('/cancel', 'cancel', ['DRAFT', 'SUBMITTED', 'APPROVED', 'PROFORMA_RECEIVED'], 'CANCELLED', 'CANCEL');

// ================================================================== SUPPLIER PROFORMA
const spItem = z.object({ productId: z.coerce.number().int().nullish(), description: z.string().nullish(), qty: z.coerce.number().positive(), unit: z.string().nullish(), rate: z.coerce.number().min(0) });
const spSchema = z.object({
  importRequestId: z.coerce.number().int().nullish(),
  supplierId: z.coerce.number().int(),
  supplierRef: z.string().nullish(),
  docDate: z.coerce.date().optional(),
  currencyCode: z.string().optional(),
  exchangeRate: z.coerce.number().positive().optional(),
  incoterms: z.string().nullish(),
  remarks: z.string().nullish(),
  items: z.array(spItem).optional(),
});
async function createProforma(tx: Tx, raw: any, user: { id: number; username: string }) {
  const b = parse(spSchema, raw);
  const supplier = await tx.supplier.findUnique({ where: { id: b.supplierId } });
  if (!supplier) throw badRequest('Supplier not found');
  let items: any[] | undefined = b.items;
  let reqDoc: any = null;
  if (b.importRequestId) {
    reqDoc = await tx.importRequest.findUnique({ where: { id: b.importRequestId }, include: { items: true } });
    assertStatus(reqDoc, ['APPROVED', 'PROFORMA_RECEIVED'], 'receive proforma (import request must be APPROVED)');
    if (!items?.length) items = reqDoc.items.map((i: any) => ({ productId: i.productId, description: i.description, qty: num(i.qty), unit: i.unit, rate: 0 }));
  }
  if (!items?.length) throw badRequest('Proforma needs at least one item');
  const filled = await fillItems(items);
  const base = await baseCurrency(tx);
  const currencyCode = b.currencyCode ?? supplier.currencyCode ?? base;
  const exchangeRate = await resolveRate(tx, currencyCode, b.exchangeRate, base);
  const lines = filled.map((i: any) => ({ ...i, amount: r2(num(i.qty) * num(i.rate)) }));
  const total = r2(lines.reduce((s, l) => s + l.amount, 0));
  const docDate = b.docDate ?? new Date();
  const docNo = await nextNumber(tx, 'SUPPLIER_PROFORMA', { date: docDate });
  const { items: _i, ...h } = b;
  const p = await tx.supplierProforma.create({ data: { ...h, docNo, docDate, currencyCode, exchangeRate, total, status: 'RECEIVED', items: { create: lines } } });
  if (reqDoc) {
    await tx.importRequest.update({ where: { id: reqDoc.id }, data: { status: 'PROFORMA_RECEIVED' } });
    await linkDocs(tx, { type: 'IMPORT_REQUEST', id: reqDoc.id, no: reqDoc.docNo }, { type: 'SUPPLIER_PROFORMA', id: p.id, no: p.docNo });
  }
  await audit(tx, user, 'CREATE', 'SupplierProforma', p.id, { docNo, total });
  return p;
}
async function spDetail(id: number) {
  const d = await prisma.supplierProforma.findUnique({ where: { id }, include: { items: true } });
  if (!d) throw notFound('Proforma not found');
  const out: any = await finishDoc(d, 'SUPPLIER_PROFORMA', { supplierId: 'supplier' });
  out.baseTotal = r2(num(d.total) * num(d.exchangeRate));
  return out;
}
const sp = Router();
sp.get('/', can(IMP, 'view'), ah(async (req, res) => {
  res.json(await listDocs(req, { model: 'supplierProforma', search: ['docNo', 'supplierRef', 'remarks'], supplierSearch: true, numeric: ['supplierId', 'importRequestId'], enrich: { supplierId: 'supplier' }, map: (r) => ({ ...r, baseTotal: r2(num(r.total) * num(r.exchangeRate)) }) }));
}));
sp.get('/:id', can(IMP, 'view'), ah(async (req, res) => res.json(await spDetail(intParam(req)))));
sp.post('/', can(IMP, 'create'), ah(async (req, res) => {
  const p = await prisma.$transaction((tx) => createProforma(tx, req.body, req.user!), T);
  res.status(201).json(await spDetail(p.id));
}));
sp.put('/:id', can(IMP, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(spSchema.partial(), req.body);
  await prisma.$transaction(async (tx) => {
    const cur: any = assertStatus(await tx.supplierProforma.findUnique({ where: { id } }), ['RECEIVED'], 'edit');
    const { items, importRequestId: _r, ...h } = b;
    const data: any = { ...h };
    if (b.currencyCode || b.exchangeRate) {
      const code = b.currencyCode ?? cur.currencyCode;
      data.currencyCode = code;
      data.exchangeRate = await resolveRate(tx, code, b.exchangeRate ?? (code === cur.currencyCode ? num(cur.exchangeRate) : undefined));
    }
    if (items) {
      const lines = (await fillItems(items)).map((i: any) => ({ ...i, amount: r2(num(i.qty) * num(i.rate)) }));
      data.total = r2(lines.reduce((s, l) => s + l.amount, 0));
      await tx.supplierProformaItem.deleteMany({ where: { proformaId: id } });
      await tx.supplierProformaItem.createMany({ data: lines.map((l) => ({ ...l, proformaId: id })) });
    }
    await tx.supplierProforma.update({ where: { id }, data });
    await audit(tx, req.user, 'UPDATE', 'SupplierProforma', id);
  }, T);
  res.json(await spDetail(id));
}));
sp.delete('/:id', can(IMP, 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.supplierProforma.findUnique({ where: { id } }), ['RECEIVED', 'CANCELLED'], 'delete');
    await tx.supplierProforma.delete({ where: { id } });
    await deleteLinks(tx, 'SUPPLIER_PROFORMA', id);
    await audit(tx, req.user, 'DELETE', 'SupplierProforma', id);
  }, T);
  res.json({ ok: true });
}));
sp.post('/:id/cancel', can(IMP, 'cancel'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.supplierProforma.findUnique({ where: { id } }), ['RECEIVED'], 'cancel');
    await tx.supplierProforma.update({ where: { id }, data: { status: 'CANCELLED' } });
    await audit(tx, req.user, 'CANCEL', 'SupplierProforma', id);
  }, T);
  res.json(await spDetail(id));
}));
sp.post('/:id/create-order', can(IMP, 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const o = parse(z.object({
    warehouseId: z.coerce.number().int().nullish(), docDate: z.coerce.date().optional(), expectedDate: z.coerce.date().nullish(), supplierCountry: z.string().nullish(), incoterms: z.string().nullish(),
    portOfLoading: z.string().nullish(), portOfDestination: z.string().nullish(), shippingMethod: z.string().nullish(), shippingAgent: z.string().nullish(), clearingAgent: z.string().nullish(),
    paymentTerms: z.string().nullish(), deliveryTerms: z.string().nullish(), remarks: z.string().nullish(),
  }), req.body ?? {});
  const po = await prisma.$transaction(async (tx) => {
    const p: any = await tx.supplierProforma.findUnique({ where: { id }, include: { items: true } });
    assertStatus(p, ['RECEIVED'], 'create order');
    if (p.items.some((i: any) => !i.productId)) throw badRequest('All proforma items must be linked to a product before creating the import PO');
    const reqDoc = p.importRequestId ? await tx.importRequest.findUnique({ where: { id: p.importRequestId } }) : null;
    const created = await createPurchaseOrder(tx, {
      ...o, roundOff: 0, docDate: o.docDate, supplierId: p.supplierId, quotationRef: p.supplierRef ?? p.docNo, importRequestId: p.importRequestId, warehouseId: o.warehouseId ?? reqDoc?.warehouseId ?? null,
      currencyCode: p.currencyCode, exchangeRate: num(p.exchangeRate), incoterms: o.incoterms ?? p.incoterms, remarks: o.remarks ?? p.remarks,
      items: p.items.map((i: any) => ({ productId: i.productId, description: i.description, qty: num(i.qty), unit: i.unit, rate: num(i.rate), discount: 0, vatRate: 0 })),
    }, 'IMPORT', req.user!.id);
    await tx.supplierProforma.update({ where: { id }, data: { status: 'CONVERTED' } });
    if (reqDoc) await tx.importRequest.update({ where: { id: reqDoc.id }, data: { status: 'CONVERTED' } });
    await linkDocs(tx, { type: 'SUPPLIER_PROFORMA', id, no: p.docNo }, { type: 'IMPORT_PURCHASE_ORDER', id: created.id, no: created.docNo });
    await audit(tx, req.user, 'CREATE', 'PurchaseOrder', created.id, { from: p.docNo, orderType: 'IMPORT' });
    return created;
  }, T);
  res.status(201).json(await orderDetail(po.id));
}));
ir.post('/:id/create-proforma', can(IMP, 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const p = await prisma.$transaction((tx) => createProforma(tx, { ...req.body, importRequestId: id, supplierId: req.body?.supplierId ?? undefined }, req.user!), T);
  res.status(201).json(await spDetail(p.id));
}));

// ================================================================== IMPORT ORDERS
const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PAYMENT_PENDING', 'IN_TRANSIT', 'CANCELLED'],
  PAYMENT_PENDING: ['CONFIRMED', 'IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['ARRIVED'],
  ARRIVED: ['CUSTOMS'],
  CUSTOMS: [],
  RECEIVED: ['COMPLETED'],
  COMPLETED: [],
  PENDING_APPROVAL: ['CANCELLED'],
  CANCELLED: [],
};
const io = Router();
io.get('/', can(IMP, 'view'), ah(async (req, res) => {
  res.json(await listDocs(req, {
    model: 'purchaseOrder', search: ['docNo', 'quotationRef', 'remarks', 'incoterms'], supplierSearch: true, numeric: ['supplierId', 'warehouseId'], strings: ['incoterms', 'shippingMethod'],
    base: { orderType: 'IMPORT' }, include: { items: { select: { qty: true, receivedQty: true, invoicedQty: true } } }, map: orderRow,
    after: async (rows) => {
      const al = await prisma.voucherAllocation.findMany({ where: { docType: 'PURCHASE_ORDER', docId: { in: rows.map((r) => r.id) }, voucher: { status: { not: 'CANCELLED' } } } });
      for (const r of rows) r.advancePaid = r2(al.filter((a) => a.docId === r.id).reduce((s, a) => s + num(a.amount), 0));
    },
  }));
}));
io.get('/:id', can(IMP, 'view'), ah(async (req, res) => res.json(await orderDetail(intParam(req)))));
io.post('/', can(IMP, 'create'), ah(async (req, res) => {
  const b = parse(poSchema, req.body);
  const id = await prisma.$transaction(async (tx) => {
    const o = await createPurchaseOrder(tx, b, 'IMPORT', req.user!.id);
    await audit(tx, req.user, 'CREATE', 'PurchaseOrder', o.id, { docNo: o.docNo, orderType: 'IMPORT' });
    return o.id;
  }, T);
  res.status(201).json(await orderDetail(id));
}));
io.put('/:id', can(IMP, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const cur: any = assertStatus(await tx.purchaseOrder.findUnique({ where: { id } }), ['DRAFT'], 'edit');
    if (cur.orderType !== 'IMPORT') throw badRequest('Not an import order');
    const b = parse(poSchema, { ...req.body, supplierId: req.body?.supplierId ?? cur.supplierId });
    const { data, items } = await buildOrderData(tx, b, 'IMPORT');
    const { orderType: _o, ...upd } = data;
    await tx.purchaseOrder.update({ where: { id }, data: upd });
    await tx.purchaseOrderItem.deleteMany({ where: { orderId: id } });
    await tx.purchaseOrderItem.createMany({ data: items.map((i) => ({ ...i, orderId: id })) });
    await audit(tx, req.user, 'UPDATE', 'PurchaseOrder', id);
  }, T);
  res.json(await orderDetail(id));
}));
io.delete('/:id', can(IMP, 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const o: any = assertStatus(await tx.purchaseOrder.findUnique({ where: { id } }), ['DRAFT'], 'delete');
    if (o.orderType !== 'IMPORT') throw badRequest('Not an import order');
    const l = await tx.documentLink.findFirst({ where: { toType: 'IMPORT_PURCHASE_ORDER', toId: id, fromType: 'SUPPLIER_PROFORMA' } });
    if (l) await tx.supplierProforma.updateMany({ where: { id: l.fromId, status: 'CONVERTED' }, data: { status: 'RECEIVED' } });
    await tx.purchaseOrder.delete({ where: { id } });
    await deleteLinks(tx, 'IMPORT_PURCHASE_ORDER', id);
    await audit(tx, req.user, 'DELETE', 'PurchaseOrder', id);
  }, T);
  res.json({ ok: true });
}));
io.post('/:id/submit', can(IMP, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction((tx) => submitOrder(tx, id, req.user!), T);
  res.json(await orderDetail(id));
}));
io.post('/:id/approve', can(IMP, 'approve'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.purchaseOrder.findFirst({ where: { id, orderType: 'IMPORT' } }), ['DRAFT', 'PENDING_APPROVAL'], 'approve');
    await approveOrder(tx, id, req.user!, req.body?.comment);
  }, T);
  res.json(await orderDetail(id));
}));
io.post('/:id/reject', can(IMP, 'reject'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.purchaseOrder.findFirst({ where: { id, orderType: 'IMPORT' } }), ['PENDING_APPROVAL'], 'reject');
    await rejectOrder(tx, id, req.user!, req.body?.comment);
  }, T);
  res.json(await orderDetail(id));
}));
const statusHandler = ah(async (req, res) => {
  const id = intParam(req);
  const { status, comment } = parse(z.object({ status: z.string(), comment: z.string().nullish() }), req.body);
  await prisma.$transaction(async (tx) => {
    const o: any = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!o || o.orderType !== 'IMPORT') throw notFound('Import order not found');
    const allowed = TRANSITIONS[o.status] ?? [];
    if (!allowed.includes(status)) throw badRequest(`Invalid status transition ${o.status} -> ${status}. Allowed: ${allowed.join(', ') || 'none'}`);
    if (status === 'CONFIRMED' && o.status === 'DRAFT') { await submitOrder(tx, id, req.user!); return; }
    if (status === 'CANCELLED') {
      if (orderQtys(o.items).receivedQty > 0 || (await tx.goodsReceipt.count({ where: { orderId: id, status: { not: 'CANCELLED' } } }))) throw badRequest('Order has goods receipts');
      if (await tx.importShipment.count({ where: { orderId: id } })) throw badRequest('Delete the shipment(s) of this order first');
      if (await tx.purchaseInvoice.count({ where: { orderId: id, status: { not: 'CANCELLED' } } })) throw badRequest('Order has purchase invoices');
      await tx.approvalRequest.updateMany({ where: { docType: 'PURCHASE_ORDER', docId: id, status: 'PENDING' }, data: { status: 'REJECTED' } });
    }
    await tx.purchaseOrder.update({ where: { id }, data: { status } });
    await audit(tx, req.user, 'STATUS', 'PurchaseOrder', id, { from: o.status, to: status, comment });
  }, T);
  res.json(await orderDetail(id));
});
io.post('/:id/status', can(IMP, 'edit'), statusHandler);
io.post('/:id/cancel', can(IMP, 'cancel'), (req, res, next) => { req.body = { status: 'CANCELLED', comment: req.body?.comment }; statusHandler(req, res, next); });

// ================================================================== SHIPMENTS
const shipSchema = z.object({
  orderId: z.coerce.number().int(),
  containerNo: z.string().nullish(),
  billOfLading: z.string().nullish(),
  awb: z.string().nullish(),
  etd: z.coerce.date().nullish(),
  eta: z.coerce.date().nullish(),
  actualArrival: z.coerce.date().nullish(),
  shippingAgent: z.string().nullish(),
  clearingAgent: z.string().nullish(),
  remarks: z.string().nullish(),
  items: z.array(z.object({ orderItemId: z.coerce.number().int(), qty: z.coerce.number().positive() })).optional(),
});

async function shippedQty(tx: Tx | typeof prisma, orderItemId: number, excludeShipmentId?: number) {
  const rows = await tx.importShipmentItem.findMany({ where: { orderItemId, ...(excludeShipmentId ? { shipmentId: { not: excludeShipmentId } } : {}) }, select: { qty: true } });
  return rows.reduce((s, r) => s + num(r.qty), 0);
}
async function shipLines(tx: Tx, order: any, items: Array<{ orderItemId: number; qty: number }> | undefined, excludeShipmentId?: number) {
  const out: any[] = [];
  if (items?.length) {
    for (const i of items) {
      const poi = order.items.find((x: any) => x.id === i.orderItemId);
      if (!poi) throw badRequest(`Order item ${i.orderItemId} does not belong to the order`);
      const free = r3(num(poi.qty) - (await shippedQty(tx, poi.id, excludeShipmentId)));
      if (i.qty > free + 0.0005) throw badRequest(`Cannot ship ${i.qty} of "${poi.description ?? poi.productId}": only ${Math.max(0, free)} not yet on a shipment`);
      out.push({ orderItemId: poi.id, productId: poi.productId, qty: i.qty });
    }
  } else {
    for (const poi of order.items) {
      const free = r3(num(poi.qty) - (await shippedQty(tx, poi.id, excludeShipmentId)));
      if (free > 0) out.push({ orderItemId: poi.id, productId: poi.productId, qty: free });
    }
  }
  if (!out.length) throw badRequest('Nothing left to ship on this order');
  return out;
}
const RANK = ['CONFIRMED', 'PAYMENT_PENDING', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS'];
const SHIP_TO_PO: Record<string, string> = { IN_TRANSIT: 'IN_TRANSIT', ARRIVED: 'ARRIVED', CUSTOMS: 'CUSTOMS', CLEARED: 'CUSTOMS' };
async function advanceOrder(tx: Tx, orderId: number, shipStatus: string, user: any) {
  const target = SHIP_TO_PO[shipStatus];
  if (!target) return;
  const o = await tx.purchaseOrder.findUnique({ where: { id: orderId } });
  if (!o || !RANK.includes(o.status)) return;
  if (RANK.indexOf(target) > RANK.indexOf(o.status)) {
    await tx.purchaseOrder.update({ where: { id: orderId }, data: { status: target } });
    await audit(tx, user, 'STATUS', 'PurchaseOrder', orderId, { from: o.status, to: target, via: 'shipment' });
  }
}
async function shipDetail(id: number) {
  const s = await prisma.importShipment.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });
  if (!s) throw notFound('Shipment not found');
  const { order: _o, ...rest } = s as any;
  const d: any = await finishDoc({ ...rest }, 'IMPORT_SHIPMENT', {});
  d.order = await prisma.purchaseOrder.findUnique({ where: { id: s.orderId }, select: { id: true, docNo: true, status: true, supplierId: true, currencyCode: true, warehouseId: true } });
  if (d.order) await enrich([d.order], { supplierId: 'supplier', warehouseId: 'warehouse' });
  for (const i of d.items) i.pendingQty = r3(num(i.qty) - num(i.receivedQty));
  d.receipts = await prisma.goodsReceipt.findMany({ where: { shipmentId: id }, select: { id: true, docNo: true, status: true } });
  return d;
}
const sh = Router();
const sRow = (r: any) => {
  const o = { ...r, quantity: r3(r.items.reduce((s: number, i: any) => s + num(i.qty), 0)), receivedQty: r3(r.items.reduce((s: number, i: any) => s + num(i.receivedQty), 0)) };
  o.pendingQty = r3(o.quantity - o.receivedQty);
  delete o.items;
  return o;
};
const withOrder = async (rows: any[]) => {
  const os = await prisma.purchaseOrder.findMany({ where: { id: { in: rows.map((r) => r.orderId) } }, select: { id: true, docNo: true, supplierId: true, status: true } });
  await enrich(os as any[], { supplierId: 'supplier' });
  const m = new Map(os.map((o) => [o.id, o]));
  rows.forEach((r) => (r.order = m.get(r.orderId) ?? null));
};
sh.get('/', can(IMP, 'view'), ah(async (req, res) => {
  res.json(await listDocs(req, { model: 'importShipment', search: ['shipmentNo', 'containerNo', 'billOfLading', 'awb'], numeric: ['orderId'], dateField: 'createdAt', include: { items: { select: { qty: true, receivedQty: true } } }, map: sRow, enrich: {}, after: withOrder }));
}));
sh.get('/:id', can(IMP, 'view'), ah(async (req, res) => res.json(await shipDetail(intParam(req)))));
sh.post('/', can(IMP, 'create'), ah(async (req, res) => {
  const b = parse(shipSchema, req.body);
  const id = await prisma.$transaction(async (tx) => {
    const o: any = await tx.purchaseOrder.findUnique({ where: { id: b.orderId }, include: { items: true } });
    if (!o || o.orderType !== 'IMPORT') throw badRequest('Import order not found');
    if (!['CONFIRMED', 'PAYMENT_PENDING', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS'].includes(o.status)) throw badRequest(`Import order is ${o.status}; shipments can be created for confirmed orders only`);
    const lines = await shipLines(tx, o, b.items);
    const shipmentNo = await nextNumber(tx, 'IMPORT_SHIPMENT');
    const { items: _i, ...h } = b;
    const s = await tx.importShipment.create({ data: { ...h, shippingAgent: b.shippingAgent ?? o.shippingAgent, clearingAgent: b.clearingAgent ?? o.clearingAgent, shipmentNo, status: 'BOOKED', items: { create: lines } } });
    await linkDocs(tx, { type: 'IMPORT_PURCHASE_ORDER', id: o.id, no: o.docNo }, { type: 'IMPORT_SHIPMENT', id: s.id, no: s.shipmentNo });
    await audit(tx, req.user, 'CREATE', 'ImportShipment', s.id, { shipmentNo, orderId: o.id });
    return s.id;
  }, T);
  res.status(201).json(await shipDetail(id));
}));
sh.put('/:id', can(IMP, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(shipSchema.partial().omit({ orderId: true }), req.body);
  await prisma.$transaction(async (tx) => {
    const cur: any = assertStatus(await tx.importShipment.findUnique({ where: { id } }), ['BOOKED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED'], 'edit');
    const { items, ...h } = b;
    await tx.importShipment.update({ where: { id }, data: h });
    if (items) {
      if (cur.status !== 'BOOKED') throw badRequest('Items can only be changed while the shipment is BOOKED');
      const o: any = await tx.purchaseOrder.findUnique({ where: { id: cur.orderId }, include: { items: true } });
      const lines = await shipLines(tx, o, items, id);
      await tx.importShipmentItem.deleteMany({ where: { shipmentId: id } });
      await tx.importShipmentItem.createMany({ data: lines.map((l) => ({ ...l, shipmentId: id })) });
    }
    await audit(tx, req.user, 'UPDATE', 'ImportShipment', id);
  }, T);
  res.json(await shipDetail(id));
}));
sh.delete('/:id', can(IMP, 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.importShipment.findUnique({ where: { id } }), ['BOOKED'], 'delete');
    if (await tx.goodsReceipt.count({ where: { shipmentId: id, status: { not: 'CANCELLED' } } })) throw badRequest('Shipment has goods receipts');
    await tx.importShipment.delete({ where: { id } });
    await deleteLinks(tx, 'IMPORT_SHIPMENT', id);
    await audit(tx, req.user, 'DELETE', 'ImportShipment', id);
  }, T);
  res.json({ ok: true });
}));
const SHIP_NEXT: Record<string, string[]> = { BOOKED: ['IN_TRANSIT'], IN_TRANSIT: ['ARRIVED'], ARRIVED: ['CUSTOMS', 'CLEARED'], CUSTOMS: ['CLEARED'], CLEARED: [], RECEIVED: [] };
sh.post('/:id/status', can(IMP, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(z.object({ status: z.string(), actualArrival: z.coerce.date().nullish(), remarks: z.string().nullish() }), req.body);
  await prisma.$transaction(async (tx) => {
    const s: any = await tx.importShipment.findUnique({ where: { id } });
    if (!s) throw notFound('Shipment not found');
    if (!(SHIP_NEXT[s.status] ?? []).includes(b.status)) throw badRequest(`Invalid shipment status transition ${s.status} -> ${b.status}. Allowed: ${(SHIP_NEXT[s.status] ?? []).join(', ') || 'none (RECEIVED is set by the goods receipt)'}`);
    await tx.importShipment.update({ where: { id }, data: { status: b.status, actualArrival: b.status === 'ARRIVED' ? b.actualArrival ?? new Date() : b.actualArrival ?? undefined, remarks: b.remarks ?? undefined } });
    await advanceOrder(tx, s.orderId, b.status, req.user);
    await audit(tx, req.user, 'STATUS', 'ImportShipment', id, { from: s.status, to: b.status });
  }, T);
  res.json(await shipDetail(id));
}));

// ================================================================== GOODS IN TRANSIT
const git = Router();
git.get('/', can(IMP, 'view'), ah(async (req, res) => {
  const includeUnshipped = req.query.includeUnshipped !== 'false';
  const supplierId = req.query.supplierId ? Number(req.query.supplierId) : undefined;
  const rows: any[] = [];
  const shipments: any[] = await prisma.importShipment.findMany({
    where: { status: req.query.status ? String(req.query.status) : { not: 'RECEIVED' }, order: { status: { notIn: ['CANCELLED', 'DRAFT'] }, ...(supplierId ? { supplierId } : {}) } },
    include: { items: true, order: true }, orderBy: [{ eta: 'asc' }, { id: 'desc' }],
  });
  const now = Date.now();
  for (const s of shipments) {
    const quantity = r3(s.items.reduce((t: number, i: any) => t + num(i.qty), 0));
    const received = r3(s.items.reduce((t: number, i: any) => t + num(i.receivedQty), 0));
    rows.push({
      kind: 'SHIPMENT', orderId: s.orderId, orderNo: s.order.docNo, orderStatus: s.order.status, supplierId: s.order.supplierId, shipmentId: s.id, shipmentNo: s.shipmentNo, containerNo: s.containerNo, billOfLading: s.billOfLading, awb: s.awb,
      blAwb: s.billOfLading || s.awb, etd: s.etd, eta: s.eta, expectedArrival: s.actualArrival ?? s.eta, actualArrival: s.actualArrival, status: s.status, shippingAgent: s.shippingAgent, clearingAgent: s.clearingAgent,
      quantity, receivedQty: received, pendingQty: r3(quantity - received), daysToArrival: s.eta ? Math.ceil((s.eta.getTime() - now) / 86400000) : null, delayed: !!s.eta && !s.actualArrival && s.eta.getTime() < now,
      items: s.items.map((i: any) => ({ orderItemId: i.orderItemId, productId: i.productId, qty: num(i.qty), receivedQty: num(i.receivedQty), pendingQty: r3(num(i.qty) - num(i.receivedQty)) })),
    });
  }
  if (includeUnshipped && !req.query.status) {
    const orders: any[] = await prisma.purchaseOrder.findMany({ where: { orderType: 'IMPORT', status: { in: ['CONFIRMED', 'PAYMENT_PENDING', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS'] }, ...(supplierId ? { supplierId } : {}) }, include: { items: true } });
    for (const o of orders) {
      const sh = await prisma.importShipmentItem.findMany({ where: { orderItemId: { in: o.items.map((i: any) => i.id) } } });
      const items = o.items.map((i: any) => ({ orderItemId: i.id, productId: i.productId, qty: r3(num(i.qty) - sh.filter((x) => x.orderItemId === i.id).reduce((t, x) => t + num(x.qty), 0)), receivedQty: 0, pendingQty: 0 })).filter((i: any) => i.qty > 0);
      if (!items.length) continue;
      const quantity = r3(items.reduce((t: number, i: any) => t + i.qty, 0));
      items.forEach((i: any) => (i.pendingQty = i.qty));
      rows.push({
        kind: 'ORDER', orderId: o.id, orderNo: o.docNo, orderStatus: o.status, supplierId: o.supplierId, shipmentId: null, shipmentNo: null, containerNo: null, billOfLading: null, awb: null, blAwb: null, etd: null, eta: null,
        expectedArrival: o.expectedDate, actualArrival: null, status: 'NOT_SHIPPED', shippingAgent: o.shippingAgent, clearingAgent: o.clearingAgent, quantity, receivedQty: 0, pendingQty: quantity, daysToArrival: null, delayed: false, items,
      });
    }
  }
  await enrich(rows, { supplierId: 'supplier' });
  for (const r of rows) await enrich(r.items, { productId: 'product' });
  res.json({ rows, total: rows.length });
}));

export default [
  { path: '/import-requests', router: ir },
  { path: '/supplier-proformas', router: sp },
  { path: '/import-orders', router: io },
  { path: '/import-shipments', router: sh },
  { path: '/goods-in-transit', router: git },
] as ModuleDef[];
void IMPORT_RECEIVABLE;
