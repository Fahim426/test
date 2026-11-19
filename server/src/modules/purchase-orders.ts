import { revisionSnapshot, auditRevision } from '../services/revisions-history';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ah, intParam, parse } from '../lib/http';
import { badRequest } from '../lib/errors';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import { enrich } from '../lib/enrich';
import { r3 } from '../lib/calc';
import {
  approveOrder, rejectOrder, assertStatus, buildOrderData, deleteLinks, listDocs, orderDetail, orderQtys, orderRow, poSchema, submitOrder, LOCAL_RECEIVABLE,
} from '../services/purchase-common';
import { nextNumber } from '../services/numbering';
import type { ModuleDef } from '../app';

const T = { timeout: 30000 };
const P = 'purchase_order';
const router = Router();

router.get('/', can(P, 'view'), ah(async (req, res) => {
  const ot = String(req.query.orderType || 'LOCAL').toUpperCase();
  res.json(await listDocs(req, {
    model: 'purchaseOrder', search: ['docNo', 'quotationRef', 'remarks'], supplierSearch: true, numeric: ['supplierId', 'warehouseId'],
    base: ot === 'ALL' ? {} : { orderType: ot }, include: { items: { select: { qty: true, receivedQty: true, invoicedQty: true } } }, map: orderRow,
  }));
}));

// PO picker: orders with quantity still to receive
router.get('/open', can(P, 'view'), ah(async (req, res) => {
  const ot = String(req.query.orderType || 'LOCAL').toUpperCase();
  const where: any = { status: ot === 'IMPORT' ? { in: ['CONFIRMED', 'PAYMENT_PENDING', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS'] } : { in: ['APPROVED', 'PARTIALLY_RECEIVED'] } };
  if (ot !== 'ALL') where.orderType = ot;
  if (ot === 'ALL') where.status = { in: [...LOCAL_RECEIVABLE.slice(0, 2), 'CONFIRMED', 'PAYMENT_PENDING', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS'] };
  if (req.query.supplierId) where.supplierId = Number(req.query.supplierId);
  const rows: any[] = (await prisma.purchaseOrder.findMany({ where, include: { items: { select: { qty: true, receivedQty: true, invoicedQty: true } } }, orderBy: { id: 'desc' }, take: 200 })).map(orderRow).filter((r) => r.pendingQty > 0);
  await enrich(rows, { supplierId: 'supplier', warehouseId: 'warehouse' });
  res.json({ rows });
}));

router.get('/:id', can(P, 'view'), ah(async (req, res) => res.json(await orderDetail(intParam(req)))));

router.post('/', can(P, 'create'), ah(async (req, res) => {
  const b = parse(poSchema, req.body);
  const id = await prisma.$transaction(async (tx) => {
    const { data, items } = await buildOrderData(tx, b, 'LOCAL');
    const docNo = await nextNumber(tx, 'PURCHASE_ORDER', { date: data.docDate });
    const o = await tx.purchaseOrder.create({ data: { ...data, docNo, status: 'DRAFT', createdBy: req.user!.id, items: { create: items } } });
    await audit(tx, req.user, 'CREATE', 'PurchaseOrder', o.id, { docNo, total: data.total });
    return o.id;
  }, T);
  res.status(201).json(await orderDetail(id));
}));

router.put('/:id', can(P, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const revisionBefore = await revisionSnapshot(tx, 'PurchaseOrder', id);
    const cur: any = assertStatus(await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } }), ['DRAFT'], 'edit');
    if (cur.orderType !== 'LOCAL') throw badRequest('Use /import-orders for import orders');
    const b = parse(poSchema, { ...req.body, supplierId: req.body.supplierId ?? cur.supplierId });
    const { data, items } = await buildOrderData(tx, b, 'LOCAL');
    const { orderType: _o, ...upd } = data;
    await tx.purchaseOrder.update({ where: { id }, data: upd });
    await tx.purchaseOrderItem.deleteMany({ where: { orderId: id } });
    await tx.purchaseOrderItem.createMany({ data: items.map((i) => ({ ...i, orderId: id })) });
    await auditRevision(tx, req.user, 'PurchaseOrder', id, revisionBefore, req.body?.changeReason);
    await audit(tx, req.user, 'UPDATE', 'PurchaseOrder', id, { total: data.total });
  }, T);
  res.json(await orderDetail(id));
}));

router.delete('/:id', can(P, 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.purchaseOrder.findUnique({ where: { id } }), ['DRAFT'], 'delete');
    const q = await tx.documentLink.findFirst({ where: { toType: 'PURCHASE_ORDER', toId: id, fromType: 'SUPPLIER_QUOTATION' } });
    if (q) await tx.supplierQuotation.updateMany({ where: { id: q.fromId, status: 'CONVERTED' }, data: { status: 'SELECTED' } });
    await tx.purchaseOrder.delete({ where: { id } });
    await deleteLinks(tx, 'PURCHASE_ORDER', id);
    await audit(tx, req.user, 'DELETE', 'PurchaseOrder', id);
  }, T);
  res.json({ ok: true });
}));

router.post('/:id/submit', can(P, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction((tx) => submitOrder(tx, id, req.user!), T);
  res.json(await orderDetail(id));
}));

router.post('/:id/approve', can(P, 'approve'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction((tx) => approveOrder(tx, id, req.user!, req.body?.comment), T);
  res.json(await orderDetail(id));
}));

router.post('/:id/reject', can(P, 'reject'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction((tx) => rejectOrder(tx, id, req.user!, req.body?.comment), T);
  res.json(await orderDetail(id));
}));

router.post('/:id/cancel', can(P, 'cancel'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const o: any = assertStatus(await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } }), ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'APPROVED'], 'cancel');
    if (orderQtys(o.items).receivedQty > 0) throw badRequest('Order has received goods; close it instead');
    if (await tx.goodsReceipt.count({ where: { orderId: id, status: { not: 'CANCELLED' } } })) throw badRequest('Cancel or delete the goods receipt(s) of this order first');
    if (await tx.purchaseInvoice.count({ where: { orderId: id, status: { not: 'CANCELLED' } } })) throw badRequest('Order has purchase invoices');
    await tx.approvalRequest.updateMany({ where: { docType: 'PURCHASE_ORDER', docId: id, status: 'PENDING' }, data: { status: 'REJECTED' } });
    await tx.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await tx.supplierQuotation.updateMany({ where: { id: o.quotationId ?? -1, status: 'CONVERTED' }, data: { status: 'SELECTED' } });
    await audit(tx, req.user, 'CANCEL', 'PurchaseOrder', id, { reason: req.body?.reason });
  }, T);
  res.json(await orderDetail(id));
}));

router.post('/:id/close', can(P, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const o: any = assertStatus(await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } }), LOCAL_RECEIVABLE, 'close');
    if (await tx.goodsReceipt.count({ where: { orderId: id, status: 'DRAFT' } })) throw badRequest('Post or delete the draft goods receipt(s) first');
    await tx.purchaseOrder.update({ where: { id }, data: { status: 'CLOSED' } });
    await audit(tx, req.user, 'CLOSE', 'PurchaseOrder', id, { pendingQty: r3(orderQtys(o.items).pendingQty) });
  }, T);
  res.json(await orderDetail(id));
}));

export default [{ path: '/purchase-orders', router }] as ModuleDef[];
