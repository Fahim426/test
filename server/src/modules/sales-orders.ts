import { revisionSnapshot, auditRevision } from '../services/revisions-history';
import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma, Tx } from '../lib/prisma';
import { ah, parse, intParam, paged } from '../lib/http';
import { badRequest, conflict } from '../lib/errors';
import { can } from '../middleware/auth';
import { enrich } from '../lib/enrich';
import { nextNumber } from '../services/numbering';
import { audit } from '../services/audit';
import { linkDocs } from '../services/docLink';
import { submitForApproval, actOnApproval, registerApprovalHandler } from '../services/approval';
import { releaseOrderReservations } from '../services/stock';
import {
  buildListWhere, lineIn, prepareLines, resolveRate, defaultWarehouseId, mustCustomer, mustFound, mustStatus, num, r2, LineIn,
} from '../services/sales-common';
import { approveOrderTx, rejectOrderTx, creditCheck, orderDetail, summary, backorderOverride } from '../services/sales-orders-core';
import type { ModuleDef } from '../app';

const router = Router();

const bodySchema = z.object({
  docDate: z.coerce.date().optional(),
  customerId: z.coerce.number().int(),
  salesmanId: z.coerce.number().int().optional().nullable(),
  quotationId: z.coerce.number().int().optional().nullable(),
  proformaId: z.coerce.number().int().optional().nullable(),
  warehouseId: z.coerce.number().int().optional().nullable(),
  currencyCode: z.string().optional(),
  exchangeRate: z.coerce.number().positive().optional(),
  paymentTerms: z.string().optional().nullable(),
  deliveryDate: z.coerce.date().optional().nullable(),
  customerPoNo: z.string().optional().nullable(),
  priceType: z.enum(['RETAIL', 'WHOLESALE']).optional(),
  roundOff: z.coerce.number().optional(),
  remarks: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  items: z.array(lineIn).min(1),
});
type Body = z.infer<typeof bodySchema>;

/* ---- approval handler: APPROVED => reserve stock, REJECTED => back to DRAFT ---- */
registerApprovalHandler('SALES_ORDER', async (tx, r, outcome) => {
  if (outcome === 'APPROVED') {
    const o = await tx.salesOrder.findUnique({ where: { id: r.docId } });
    if (!o || o.status !== 'PENDING_APPROVAL') return;
    await approveOrderTx(tx, r.docId);
  } else {
    await rejectOrderTx(tx, r.docId);
    await audit(tx, undefined, 'REJECT', 'SalesOrder', r.docId, { via: 'approval workflow' });
  }
});

export async function createOrderTx(tx: Tx, user: Request['user'], b: Body) {
  const cust = await mustCustomer(tx, b.customerId);
  const docDate = b.docDate ?? new Date();
  const warehouseId = await defaultWarehouseId(tx, b.warehouseId);
  const { lines, totals } = await prepareLines(tx, b.items as LineIn[], { priceType: b.priceType, roundOff: b.roundOff });
  const currencyCode = b.currencyCode ?? cust.currencyCode ?? 'AED';
  const docNo = await nextNumber(tx, 'SALES_ORDER', { date: docDate });
  const o = await tx.salesOrder.create({
    data: {
      docNo, docDate, customerId: b.customerId, salesmanId: b.salesmanId ?? cust.salesmanId ?? null, quotationId: b.quotationId ?? null, proformaId: b.proformaId ?? null,
      warehouseId, currencyCode, exchangeRate: await resolveRate(tx, currencyCode, b.exchangeRate), paymentTerms: b.paymentTerms ?? null,
      deliveryDate: b.deliveryDate ?? null, customerPoNo: b.customerPoNo ?? null, subtotal: totals.subtotal, discount: totals.discount, vatAmount: totals.vatAmount,
      roundOff: totals.roundOff, total: totals.total, remarks: b.remarks ?? null, terms: b.terms ?? null, createdBy: user?.id, items: { create: lines },
    },
  });
  await audit(tx, user, 'CREATE', 'SalesOrder', o.id, { docNo });
  return o;
}

/* ---------------- list / open / detail ---------------- */
router.get('/', can('sales_order', 'view'), ah(async (req, res) => {
  const { q, where, orderBy } = await buildListWhere(req, { searchFields: ['docNo', 'customerPoNo', 'remarks'] });
  const [rows, total] = await Promise.all([
    prisma.salesOrder.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { items: { select: { qty: true, pickedQty: true, deliveredQty: true, invoicedQty: true } } } }),
    prisma.salesOrder.count({ where }),
  ]);
  const out = rows.map((r) => {
    const s = summary(r.items);
    return { ...r, items: undefined, ...s, itemCount: r.items.length };
  });
  await enrich(out as unknown as Record<string, unknown>[], { customerId: 'customer', salesmanId: 'salesman', warehouseId: 'warehouse' });
  res.json(paged(out, total, q));
}));

// Orders that can still be delivered or invoiced (for pick-lists / invoice screens)
router.get('/open', can('sales_order', 'view'), ah(async (req, res) => {
  const where: Record<string, unknown> = { status: { in: ['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED'] } };
  if (req.query.customerId) where.customerId = Number(req.query.customerId);
  const rows = await prisma.salesOrder.findMany({ where, orderBy: { id: 'desc' }, take: 500, include: { items: true } });
  const out = rows
    .map((r) => {
      const toDeliver = r.items.reduce((s, i) => s + Math.max(0, num(i.qty) - num(i.deliveredQty)), 0);
      const toInvoice = r.items.reduce((s, i) => s + Math.max(0, num(i.deliveredQty) - num(i.invoicedQty)), 0);
      return { ...r, items: undefined, pendingDeliveryQty: toDeliver, pendingInvoiceQty: toInvoice, ...summary(r.items) };
    })
    .filter((r) => r.pendingDeliveryQty > 0 || r.pendingInvoiceQty > 0);
  await enrich(out as unknown as Record<string, unknown>[], { customerId: 'customer', warehouseId: 'warehouse' });
  res.json(out);
}));

router.get('/:id', can('sales_order', 'view'), ah(async (req, res) => {
  res.json(mustFound(await orderDetail(intParam(req)), 'Sales order'));
}));

/* ---------------- create / edit / delete ---------------- */
router.post('/', can('sales_order', 'create'), ah(async (req, res) => {
  const b = parse(bodySchema, req.body);
  const o = await prisma.$transaction((tx) => createOrderTx(tx, req.user, b), { timeout: 30000 });
  res.status(201).json(await orderDetail(o.id));
}));

router.put('/:id', can('sales_order', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(bodySchema, req.body);
  await prisma.$transaction(async (tx) => {
    const revisionBefore = await revisionSnapshot(tx, 'SalesOrder', id);
    const o = mustFound(await tx.salesOrder.findUnique({ where: { id } }), 'Sales order');
    mustStatus(o, ['DRAFT'], 'edit');
    const cust = await mustCustomer(tx, b.customerId);
    const warehouseId = await defaultWarehouseId(tx, b.warehouseId ?? o.warehouseId);
    const { lines, totals } = await prepareLines(tx, b.items as LineIn[], { priceType: b.priceType, roundOff: b.roundOff });
    const currencyCode = b.currencyCode ?? o.currencyCode;
    await tx.salesOrderItem.deleteMany({ where: { orderId: id } });
    await tx.salesOrder.update({
      where: { id },
      data: {
        docDate: b.docDate ?? o.docDate, customerId: b.customerId, salesmanId: b.salesmanId ?? cust.salesmanId ?? null, warehouseId, currencyCode,
        exchangeRate: await resolveRate(tx, currencyCode, b.exchangeRate ?? (b.currencyCode ? undefined : num(o.exchangeRate))), paymentTerms: b.paymentTerms ?? null,
        deliveryDate: b.deliveryDate ?? null, customerPoNo: b.customerPoNo ?? null, subtotal: totals.subtotal, discount: totals.discount, vatAmount: totals.vatAmount,
        roundOff: totals.roundOff, total: totals.total, remarks: b.remarks ?? null, terms: b.terms ?? null, items: { create: lines },
      },
    });
    await auditRevision(tx, req.user, 'SalesOrder', id, revisionBefore, req.body?.changeReason);
    await audit(tx, req.user, 'UPDATE', 'SalesOrder', id);
  }, { timeout: 30000 });
  res.json(await orderDetail(id));
}));

router.delete('/:id', can('sales_order', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const o = mustFound(await tx.salesOrder.findUnique({ where: { id } }), 'Sales order');
    mustStatus(o, ['DRAFT'], 'delete');
    await tx.documentLink.deleteMany({ where: { toType: 'SALES_ORDER', toId: id } });
    await tx.salesOrder.delete({ where: { id } });
    await detachSources(tx, o);
    await audit(tx, req.user, 'DELETE', 'SalesOrder', id, { docNo: o.docNo });
  });
  res.json({ ok: true });
}));

/** When an order created from a quotation / proforma goes away, re-open its source. */
async function detachSources(tx: Tx, o: { id: number; quotationId: number | null; proformaId: number | null }) {
  if (o.proformaId) {
    await tx.proformaInvoice.updateMany({ where: { id: o.proformaId, status: 'CONVERTED' }, data: { status: 'ISSUED', salesOrderId: null } });
  }
  if (o.quotationId) {
    const live = await tx.salesOrder.count({ where: { quotationId: o.quotationId, status: { not: 'CANCELLED' }, id: { not: o.id } } });
    if (!live) await tx.salesQuotation.updateMany({ where: { id: o.quotationId, status: 'CONVERTED' }, data: { status: 'ACCEPTED' } });
  }
}

/* ---------------- workflow ---------------- */
router.post('/:id/submit', can('sales_order', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const allow = req.query.allowBackorder !== undefined ? String(req.query.allowBackorder) !== 'false' : undefined;
  if (allow !== undefined) backorderOverride.set(id, allow);
  let warnings: string[] = [];
  let autoApproved = false;
  try {
    await prisma.$transaction(async (tx) => {
      const o = mustFound(await tx.salesOrder.findUnique({ where: { id }, include: { items: true } }), 'Sales order');
      mustStatus(o, ['DRAFT'], 'submit');
      if (!o.items.length) throw badRequest('Order has no items');
      warnings = await creditCheck(tx, o);
      await tx.salesOrder.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } });
      const baseTotal = r2(num(o.total) * (num(o.exchangeRate) || 1));
      const sub = await submitForApproval(tx, { docType: 'SALES_ORDER', docId: id, docNo: o.docNo, amount: baseTotal, userId: req.user?.id });
      await audit(tx, req.user, 'SUBMIT', 'SalesOrder', id, { required: sub.required, baseTotal });
      if (!sub.required) {
        await approveOrderTx(tx, id, req.user);
        autoApproved = true;
      }
    }, { timeout: 30000 });
  } finally {
    backorderOverride.delete(id);
  }
  res.json({ ...(await orderDetail(id)), warnings, autoApproved });
}));

router.post('/:id/approve', can('sales_order', 'approve'), ah(async (req, res) => {
  const id = intParam(req);
  const comment = typeof req.body?.comment === 'string' ? req.body.comment : undefined;
  const allow = req.query.allowBackorder !== undefined ? String(req.query.allowBackorder) !== 'false' : req.body?.allowBackorder === true ? true : undefined;
  if (allow !== undefined) backorderOverride.set(id, allow);
  let warnings: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const o = mustFound(await tx.salesOrder.findUnique({ where: { id } }), 'Sales order');
      mustStatus(o, ['PENDING_APPROVAL'], 'approve');
      warnings = await creditCheck(tx, o);
      const pending = await tx.approvalRequest.findFirst({ where: { docType: 'SALES_ORDER', docId: id, status: 'PENDING' }, orderBy: { id: 'desc' } });
      if (pending) await actOnApproval(tx, pending.id, req.user!, 'APPROVED', comment);
      else await approveOrderTx(tx, id, req.user);
      await audit(tx, req.user, 'APPROVE_ACTION', 'SalesOrder', id, { comment });
    }, { timeout: 30000 });
  } finally {
    backorderOverride.delete(id);
  }
  res.json({ ...(await orderDetail(id)), warnings });
}));

router.post('/:id/reject', can('sales_order', 'reject'), ah(async (req, res) => {
  const id = intParam(req);
  const comment = typeof req.body?.comment === 'string' ? req.body.comment : undefined;
  await prisma.$transaction(async (tx) => {
    const o = mustFound(await tx.salesOrder.findUnique({ where: { id } }), 'Sales order');
    mustStatus(o, ['PENDING_APPROVAL'], 'reject');
    const pending = await tx.approvalRequest.findFirst({ where: { docType: 'SALES_ORDER', docId: id, status: 'PENDING' }, orderBy: { id: 'desc' } });
    if (pending) await actOnApproval(tx, pending.id, req.user!, 'REJECTED', comment);
    else await rejectOrderTx(tx, id);
    await audit(tx, req.user, 'REJECT_ACTION', 'SalesOrder', id, { comment });
  }, { timeout: 30000 });
  res.json(await orderDetail(id));
}));

router.post('/:id/cancel', can('sales_order', 'cancel'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const o = mustFound(await tx.salesOrder.findUnique({ where: { id }, include: { items: true } }), 'Sales order');
    mustStatus(o, ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'], 'cancel');
    if (o.items.some((i) => num(i.deliveredQty) > 0 || num(i.invoicedQty) > 0)) throw badRequest('Order has deliveries or invoices; close it instead of cancelling');
    const pick = await tx.pickingList.count({ where: { salesOrderId: id, status: { not: 'CANCELLED' } } });
    const dn = await tx.deliveryNote.count({ where: { salesOrderId: id, status: { not: 'CANCELLED' } } });
    const pk = await tx.packingList.count({ where: { salesOrderId: id, status: { not: 'CANCELLED' } } });
    const inv = await tx.salesInvoice.count({ where: { salesOrderId: id, status: { not: 'CANCELLED' } } });
    if (pick || dn || pk || inv) throw badRequest('Cancel the order\'s picking lists, packing lists, delivery notes and invoices first');
    await releaseOrderReservations(tx, id);
    await tx.approvalRequest.updateMany({ where: { docType: 'SALES_ORDER', docId: id, status: 'PENDING' }, data: { status: 'REJECTED' } });
    await tx.salesOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await detachSources(tx, o);
    await audit(tx, req.user, 'CANCEL', 'SalesOrder', id, { from: o.status });
  }, { timeout: 30000 });
  res.json(await orderDetail(id));
}));

router.post('/:id/close', can('sales_order', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const o = mustFound(await tx.salesOrder.findUnique({ where: { id } }), 'Sales order');
    mustStatus(o, ['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'INVOICED'], 'close');
    await releaseOrderReservations(tx, id);
    await tx.salesOrder.update({ where: { id }, data: { status: 'CLOSED' } });
    await audit(tx, req.user, 'CLOSE', 'SalesOrder', id, { from: o.status });
  }, { timeout: 30000 });
  res.json(await orderDetail(id));
}));

/* ---------------- conversions into orders ---------------- */
const optsSchema = z.object({
  warehouseId: z.coerce.number().int().optional(),
  customerPoNo: z.string().optional(),
  deliveryDate: z.coerce.date().optional(),
  remarks: z.string().optional(),
});

const fromQuotation = Router();
fromQuotation.post('/:id/create-order', can('sales_order', 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const opts = parse(optsSchema, req.body ?? {});
  const oid = await prisma.$transaction(async (tx) => {
    const q = mustFound(await tx.salesQuotation.findUnique({ where: { id }, include: { items: true } }), 'Sales quotation');
    mustStatus(q, ['DRAFT', 'SENT', 'ACCEPTED'], 'create order');
    if (q.validUntil && q.validUntil < new Date(new Date().setHours(0, 0, 0, 0))) {
      await tx.salesQuotation.update({ where: { id }, data: { status: 'EXPIRED' } });
      throw badRequest(`Quotation ${q.docNo} expired on ${q.validUntil.toISOString().slice(0, 10)}`);
    }
    const dup = await tx.salesOrder.findFirst({ where: { quotationId: id, status: { not: 'CANCELLED' } } });
    if (dup) throw conflict(`Quotation already converted to order ${dup.docNo}`);
    const o = await createOrderTx(tx, req.user, {
      customerId: q.customerId, salesmanId: q.salesmanId, quotationId: q.id, warehouseId: opts.warehouseId ?? q.warehouseId, currencyCode: q.currencyCode,
      exchangeRate: num(q.exchangeRate), paymentTerms: q.paymentTerms, customerPoNo: opts.customerPoNo, deliveryDate: opts.deliveryDate,
      remarks: opts.remarks ?? q.remarks, terms: q.terms, roundOff: num(q.roundOff),
      items: q.items.map((i) => ({ productId: i.productId, qty: num(i.qty), rate: num(i.rate), discount: num(i.discount), vatRate: num(i.vatRate), description: i.description, oemNumber: i.oemNumber, unit: i.unit })),
    });
    await tx.salesQuotation.update({ where: { id }, data: { status: 'CONVERTED' } });
    await linkDocs(tx, { type: 'SALES_QUOTATION', id: q.id, no: q.docNo }, { type: 'SALES_ORDER', id: o.id, no: o.docNo });
    await audit(tx, req.user, 'CREATE_ORDER', 'SalesQuotation', id, { order: o.docNo });
    return o.id;
  }, { timeout: 30000 });
  res.status(201).json(await orderDetail(oid));
}));

const fromProforma = Router();
fromProforma.post('/:id/create-order', can('sales_order', 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const opts = parse(optsSchema, req.body ?? {});
  const oid = await prisma.$transaction(async (tx) => {
    const p = mustFound(await tx.proformaInvoice.findUnique({ where: { id }, include: { items: true } }), 'Proforma invoice');
    mustStatus(p, ['DRAFT', 'ISSUED'], 'create order');
    if (p.salesOrderId) {
      const ex = await tx.salesOrder.findUnique({ where: { id: p.salesOrderId } });
      if (ex && ex.status !== 'CANCELLED') throw conflict(`Proforma already converted to order ${ex.docNo}`);
    }
    const q = p.quotationId ? await tx.salesQuotation.findUnique({ where: { id: p.quotationId } }) : null;
    const o = await createOrderTx(tx, req.user, {
      customerId: p.customerId, salesmanId: q?.salesmanId, quotationId: p.quotationId, proformaId: p.id, warehouseId: opts.warehouseId ?? p.warehouseId ?? q?.warehouseId,
      currencyCode: p.currencyCode, exchangeRate: q ? num(q.exchangeRate) : undefined, paymentTerms: p.paymentTerms, customerPoNo: opts.customerPoNo, deliveryDate: opts.deliveryDate,
      remarks: opts.remarks ?? p.remarks, terms: q?.terms,
      items: p.items.map((i) => ({ productId: i.productId, qty: num(i.qty), rate: num(i.rate), discount: num(i.discount), vatRate: num(i.vatRate), description: i.description, oemNumber: i.oemNumber, unit: i.unit })),
    });
    await tx.proformaInvoice.update({ where: { id }, data: { status: 'CONVERTED', salesOrderId: o.id } });
    if (p.quotationId) await tx.salesQuotation.updateMany({ where: { id: p.quotationId, status: { in: ['DRAFT', 'SENT', 'ACCEPTED'] } }, data: { status: 'CONVERTED' } });
    await linkDocs(tx, { type: 'PROFORMA_INVOICE', id: p.id, no: p.docNo }, { type: 'SALES_ORDER', id: o.id, no: o.docNo });
    await audit(tx, req.user, 'CREATE_ORDER', 'ProformaInvoice', id, { order: o.docNo });
    return o.id;
  }, { timeout: 30000 });
  res.status(201).json(await orderDetail(oid));
}));

export default [
  { path: '/sales-orders', router },
  { path: '/sales-quotations', router: fromQuotation },
  { path: '/proforma-invoices', router: fromProforma },
] satisfies ModuleDef[];
