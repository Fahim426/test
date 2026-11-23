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
import { buildListWhere, lineIn, prepareLines, mustCustomer, mustFound, mustStatus, approvalFor, docLinks, availabilityFor, num, r3, LineIn } from '../services/sales-common';
import { backorderOverride, summary } from '../services/sales-orders-core';
import { cancelOrderTx, orderFromProformaTx, submitOrderTx } from './sales-orders';
import { forbidden, unauthorized } from '../lib/errors';
import type { NextFunction, Response } from 'express';
import type { ModuleDef } from '../app';

/**
 * The proforma is the user-facing sales order: Confirm creates the (hidden) sales order behind it, submits it for
 * approval and reserves stock. Deliveries and invoices are created from the proforma and run on that order.
 */
const router = Router();

const canAny = (modules: string[], action: string) => (req: Request, _res: Response, next: NextFunction) => {
  const u = req.user;
  if (!u) return next(unauthorized());
  if (u.role === 'Admin' || modules.some((m) => u.permissions.has(`${m}:${action}`))) return next();
  next(forbidden(`Missing permission ${modules[0]}:${action}`));
};

const bodySchema = z.object({
  docDate: z.coerce.date().optional(),
  customerId: z.coerce.number().int(),
  salesmanId: z.coerce.number().int().optional().nullable(),
  quotationId: z.coerce.number().int().optional().nullable(),
  warehouseId: z.coerce.number().int().optional().nullable(),
  currencyCode: z.string().optional(),
  paymentTerms: z.string().optional().nullable(),
  priceType: z.enum(['RETAIL', 'WHOLESALE']).optional(),
  remarks: z.string().optional().nullable(),
  items: z.array(lineIn).min(1),
});
type Body = z.infer<typeof bodySchema>;

export async function createProformaTx(tx: Tx, user: Request['user'], b: Body) {
  const cust = await mustCustomer(tx, b.customerId);
  const docDate = b.docDate ?? new Date();
  const { lines, totals } = await prepareLines(tx, b.items as LineIn[], { priceType: b.priceType });
  const docNo = await nextNumber(tx, 'PROFORMA_INVOICE', { date: docDate });
  const p = await tx.proformaInvoice.create({
    data: {
      docNo, docDate, customerId: b.customerId, salesmanId: b.salesmanId ?? cust.salesmanId ?? null, quotationId: b.quotationId ?? null, warehouseId: b.warehouseId ?? null,
      currencyCode: b.currencyCode ?? cust.currencyCode ?? 'AED', paymentTerms: b.paymentTerms ?? null,
      subtotal: totals.subtotal, discount: totals.discount, vatAmount: totals.vatAmount, total: totals.total,
      remarks: b.remarks ?? null, createdBy: user?.id, items: { create: lines },
    },
  });
  await audit(tx, user, 'CREATE', 'ProformaInvoice', p.id, { docNo });
  return p;
}

/** Progress of the order behind a confirmed proforma (null before Confirm). */
async function orderInfo(salesOrderId: number | null) {
  if (!salesOrderId) return null;
  const o = await prisma.salesOrder.findUnique({ where: { id: salesOrderId }, include: { items: true } });
  if (!o || o.status === 'CANCELLED') return null;
  const s = summary(o.items);
  return {
    id: o.id, docNo: o.docNo, status: o.status, warehouseId: o.warehouseId, ...s,
    pendingDeliveryQty: r3(o.items.reduce((a, i) => a + Math.max(0, num(i.qty) - num(i.deliveredQty)), 0)),
    pendingInvoiceQty: r3(o.items.reduce((a, i) => a + Math.max(0, num(i.deliveredQty) - num(i.invoicedQty)), 0)),
    approval: await approvalFor('SALES_ORDER', o.id),
  };
}

async function detail(id: number) {
  const p = mustFound(await prisma.proformaInvoice.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } }), 'Proforma invoice');
  const [row] = await enrich([p as unknown as Record<string, unknown>], { customerId: 'customer', warehouseId: 'warehouse', salesmanId: 'salesman' });
  const items = await enrich(p.items as unknown as Record<string, unknown>[], { productId: 'product' });
  const av = await availabilityFor(prisma, [...new Set(p.items.map((i) => i.productId))], p.warehouseId);
  for (const it of items) {
    const a = av.get(it.productId as number)!;
    it.availability = { availableStock: a.onHand, reservedStock: a.reserved, availableToSell: a.availableToSell };
  }
  return { ...row, items, order: await orderInfo(p.salesOrderId), links: await docLinks('PROFORMA_INVOICE', id), approval: await approvalFor('PROFORMA_INVOICE', id) };
}

router.get('/', can('proforma_invoice', 'view'), ah(async (req, res) => {
  const { q, where, orderBy } = await buildListWhere(req);
  const [rows, total] = await Promise.all([
    prisma.proformaInvoice.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.proformaInvoice.count({ where }),
  ]);
  await enrich(rows as unknown as Record<string, unknown>[], { customerId: 'customer', warehouseId: 'warehouse', salesmanId: 'salesman' });
  res.json(paged(rows, total, q));
}));

/** Confirmed proformas with quantity still to deliver or to invoice (Delivery Note / Sales Invoice "New" pickers). */
router.get('/open', canAny(['proforma_invoice', 'delivery_note', 'sales_invoice'], 'view'), ah(async (req, res) => {
  const where: Record<string, unknown> = { proformaId: { not: null }, status: { in: ['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED'] } };
  if (req.query.customerId) where.customerId = Number(req.query.customerId);
  const orders = await prisma.salesOrder.findMany({ where, orderBy: { id: 'desc' }, take: 500, include: { items: true } });
  const pfs = await prisma.proformaInvoice.findMany({ where: { id: { in: orders.map((o) => o.proformaId!) } }, select: { id: true, docNo: true, docDate: true, total: true, currencyCode: true } });
  const pf = new Map(pfs.map((p) => [p.id, p]));
  const out = orders
    .map((o) => {
      const p = pf.get(o.proformaId!);
      return {
        id: o.proformaId, docNo: p?.docNo ?? o.docNo, docDate: p?.docDate ?? o.docDate, total: p?.total ?? o.total, currencyCode: p?.currencyCode ?? o.currencyCode,
        customerId: o.customerId, warehouseId: o.warehouseId, orderStatus: o.status,
        pendingDeliveryQty: r3(o.items.reduce((s, i) => s + Math.max(0, num(i.qty) - num(i.deliveredQty)), 0)),
        pendingInvoiceQty: r3(o.items.reduce((s, i) => s + Math.max(0, num(i.deliveredQty) - num(i.invoicedQty)), 0)),
        ...summary(o.items),
      };
    })
    .filter((r) => r.pendingDeliveryQty > 0 || r.pendingInvoiceQty > 0);
  await enrich(out as unknown as Record<string, unknown>[], { customerId: 'customer', warehouseId: 'warehouse' });
  res.json(out);
}));
router.get('/:id', can('proforma_invoice', 'view'), ah(async (req, res) => res.json(await detail(intParam(req)))));

router.post('/', can('proforma_invoice', 'create'), ah(async (req, res) => {
  const b = parse(bodySchema, req.body);
  const p = await prisma.$transaction((tx) => createProformaTx(tx, req.user, b), { timeout: 30000 });
  res.status(201).json(await detail(p.id));
}));

router.put('/:id', can('proforma_invoice', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(bodySchema, req.body);
  await prisma.$transaction(async (tx) => {
    const revisionBefore = await revisionSnapshot(tx, 'ProformaInvoice', id);
    const p = mustFound(await tx.proformaInvoice.findUnique({ where: { id } }), 'Proforma invoice');
    mustStatus(p, ['DRAFT'], 'edit');
    await mustCustomer(tx, b.customerId);
    const { lines, totals } = await prepareLines(tx, b.items as LineIn[], { priceType: b.priceType });
    await tx.proformaInvoiceItem.deleteMany({ where: { proformaId: id } });
    await tx.proformaInvoice.update({
      where: { id },
      data: {
        docDate: b.docDate ?? p.docDate, customerId: b.customerId, salesmanId: b.salesmanId ?? null, warehouseId: b.warehouseId ?? null, currencyCode: b.currencyCode ?? p.currencyCode,
        paymentTerms: b.paymentTerms ?? null, subtotal: totals.subtotal, discount: totals.discount, vatAmount: totals.vatAmount, total: totals.total,
        remarks: b.remarks ?? null, items: { create: lines },
      },
    });
    await auditRevision(tx, req.user, 'ProformaInvoice', id, revisionBefore, req.body?.changeReason);
    await audit(tx, req.user, 'UPDATE', 'ProformaInvoice', id);
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

router.delete('/:id', can('proforma_invoice', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const p = mustFound(await tx.proformaInvoice.findUnique({ where: { id } }), 'Proforma invoice');
    mustStatus(p, ['DRAFT'], 'delete');
    await tx.documentLink.deleteMany({ where: { toType: 'PROFORMA_INVOICE', toId: id } });
    await tx.proformaInvoice.delete({ where: { id } });
    await audit(tx, req.user, 'DELETE', 'ProformaInvoice', id, { docNo: p.docNo });
  });
  res.json({ ok: true });
}));

async function transition(req: Request, from: string[], to: string, action: string) {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const p = mustFound(await tx.proformaInvoice.findUnique({ where: { id } }), 'Proforma invoice');
    mustStatus(p, from, action.toLowerCase());
    if (to === 'CANCELLED') {
      const inv = await tx.salesInvoice.count({ where: { proformaId: id, status: { not: 'CANCELLED' } } });
      if (inv) throw badRequest('Proforma has a live sales invoice; cancel that first');
      // the order behind a confirmed proforma goes with it (releases reserved stock)
      const orders = await tx.salesOrder.findMany({ where: { proformaId: id, status: { not: 'CANCELLED' } } });
      for (const so of orders) {
        if (!['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(so.status)) throw badRequest('Proforma has deliveries; cancel its delivery notes first');
        await cancelOrderTx(tx, so.id, req.user);
      }
    }
    await tx.proformaInvoice.update({ where: { id }, data: { status: to } });
    await audit(tx, req.user, action, 'ProformaInvoice', id, { from: p.status, to });
  }, { timeout: 30000 });
  return detail(id);
}
router.post('/:id/issue', can('proforma_invoice', 'edit'), ah(async (req, res) => res.json(await transition(req, ['DRAFT'], 'ISSUED', 'ISSUE'))));
router.post('/:id/submit', can('proforma_invoice', 'edit'), ah(async (req, res) => res.json(await transition(req, ['DRAFT'], 'ISSUED', 'ISSUE'))));
router.post('/:id/cancel', can('proforma_invoice', 'cancel'), ah(async (req, res) => res.json(await transition(req, ['DRAFT', 'ISSUED', 'PARTIALLY_CONVERTED', 'CONVERTED'], 'CANCELLED', 'CANCEL'))));

/**
 * Confirm: creates the sales order behind the proforma, runs the credit check and the SALES_ORDER approval workflow,
 * and (when no approval is required) reserves the stock. All or nothing: a stock shortage rolls everything back.
 * ?allowBackorder=true|false overrides the sales.allowBackorder setting.
 */
router.post('/:id/confirm', can('proforma_invoice', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const allow = req.query.allowBackorder !== undefined ? String(req.query.allowBackorder) !== 'false' : undefined;
  let out = { warnings: [] as string[], autoApproved: false };
  let orderId: number | undefined;
  let pNo = '';
  try {
    await prisma.$transaction(async (tx) => {
      const p = mustFound(await tx.proformaInvoice.findUnique({ where: { id } }), 'Proforma invoice');
      pNo = p.docNo;
      mustStatus(p, ['DRAFT', 'ISSUED'], 'confirm');
      const o = await orderFromProformaTx(tx, req.user, id);
      orderId = o.id;
      if (allow !== undefined) backorderOverride.set(o.id, allow);
      out = await submitOrderTx(tx, o.id, req.user);
      await audit(tx, req.user, 'CONFIRM', 'ProformaInvoice', id, { order: o.docNo, autoApproved: out.autoApproved });
    }, { timeout: 30000 });
  } catch (e) {
    // the order was rolled back: word the error in terms of the proforma
    if (e instanceof Error && /^Cannot approve [^:]+:/.test(e.message)) e.message = e.message.replace(/^Cannot approve [^:]+:/, `Cannot confirm ${pNo}:`);
    throw e;
  } finally {
    if (orderId) backorderOverride.delete(orderId);
  }
  res.json({ ...(await detail(id)), ...out });
}));

/* ---------------- quotation -> proforma (mounted on /sales-quotations) ---------------- */
const fromQuotation = Router();
fromQuotation.post('/:id/create-proforma', can('proforma_invoice', 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const pid = await prisma.$transaction(async (tx) => {
    const q = mustFound(await tx.salesQuotation.findUnique({ where: { id }, include: { items: true } }), 'Sales quotation');
    mustStatus(q, ['DRAFT', 'SENT', 'ACCEPTED', 'PARTIALLY_CONVERTED', 'CONVERTED'], 'create proforma');
    const dup = await tx.proformaInvoice.findFirst({ where: { quotationId: id, status: { not: 'CANCELLED' } } });
    if (dup) throw conflict(`Quotation already has proforma ${dup.docNo}`);
    const p = await createProformaTx(tx, req.user, {
      customerId: q.customerId, salesmanId: q.salesmanId, quotationId: q.id, warehouseId: q.warehouseId, currencyCode: q.currencyCode, paymentTerms: q.paymentTerms, remarks: q.remarks,
      items: q.items.map((i) => ({ productId: i.productId, qty: num(i.qty), rate: num(i.rate), discount: num(i.discount), vatRate: num(i.vatRate), description: i.description, oemNumber: i.oemNumber, unit: i.unit })),
    });
    await linkDocs(tx, { type: 'SALES_QUOTATION', id: q.id, no: q.docNo }, { type: 'PROFORMA_INVOICE', id: p.id, no: p.docNo });
    await audit(tx, req.user, 'CREATE_PROFORMA', 'SalesQuotation', id, { proforma: p.docNo });
    return p.id;
  }, { timeout: 30000 });
  res.status(201).json(await detail(pid));
}));

export default [
  { path: '/proforma-invoices', router },
  { path: '/sales-quotations', router: fromQuotation },
] satisfies ModuleDef[];
