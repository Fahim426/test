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
import {
  buildListWhere, lineIn, prepareLines, resolveRate, mustCustomer, mustFound, mustStatus, approvalFor, docLinks, availabilityFor, num, r3, LineIn,
} from '../services/sales-common';
import { syncParentsMiddleware, syncSourceStatus, takePending } from '../services/pending';
import type { ModuleDef } from '../app';

const router = Router();
router.use('/:id', syncParentsMiddleware('SALES_QUOTATION'));

const bodySchema = z.object({
  docDate: z.coerce.date().optional(),
  validUntil: z.coerce.date().optional().nullable(),
  customerId: z.coerce.number().int(),
  salesmanId: z.coerce.number().int().optional().nullable(),
  enquiryId: z.coerce.number().int().optional().nullable(),
  warehouseId: z.coerce.number().int().optional().nullable(),
  currencyCode: z.string().optional(),
  exchangeRate: z.coerce.number().positive().optional(),
  paymentTerms: z.string().optional().nullable(),
  priceType: z.enum(['RETAIL', 'WHOLESALE']).optional(),
  roundOff: z.coerce.number().optional(),
  remarks: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  items: z.array(lineIn).min(1),
});
type Body = z.infer<typeof bodySchema>;

async function expireOverdue() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  await prisma.salesQuotation.updateMany({ where: { status: { in: ['DRAFT', 'SENT'] }, validUntil: { lt: today } }, data: { status: 'EXPIRED' } });
}

export async function createQuotationTx(tx: Tx, user: Request['user'], b: Body) {
  const cust = await mustCustomer(tx, b.customerId);
  const docDate = b.docDate ?? new Date();
  const { lines, totals } = await prepareLines(tx, b.items as LineIn[], { priceType: b.priceType, roundOff: b.roundOff });
  const currencyCode = b.currencyCode ?? cust.currencyCode ?? 'AED';
  const docNo = await nextNumber(tx, 'SALES_QUOTATION', { date: docDate });
  const q = await tx.salesQuotation.create({
    data: {
      docNo, docDate, validUntil: b.validUntil ?? null, customerId: b.customerId, salesmanId: b.salesmanId ?? cust.salesmanId ?? null,
      enquiryId: b.enquiryId ?? null, warehouseId: b.warehouseId ?? null, currencyCode, exchangeRate: await resolveRate(tx, currencyCode, b.exchangeRate),
      paymentTerms: b.paymentTerms ?? null, subtotal: totals.subtotal, discount: totals.discount, vatAmount: totals.vatAmount, roundOff: totals.roundOff,
      total: totals.total, remarks: b.remarks ?? null, terms: b.terms ?? null, createdBy: user?.id,
      items: { create: lines },
    },
  });
  await audit(tx, user, 'CREATE', 'SalesQuotation', q.id, { docNo });
  return q;
}

async function detail(id: number) {
  await expireOverdue();
  const q = mustFound(await prisma.salesQuotation.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } }), 'Sales quotation');
  const [row] = await enrich([q as unknown as Record<string, unknown>], { customerId: 'customer', salesmanId: 'salesman', warehouseId: 'warehouse' });
  const items = await enrich(q.items as unknown as Record<string, unknown>[], { productId: 'product' });
  const av = await availabilityFor(prisma, [...new Set(q.items.map((i) => i.productId))], q.warehouseId);
  for (const it of items) {
    const a = av.get(it.productId as number)!;
    it.availability = { availableStock: a.onHand, reservedStock: a.reserved, availableToSell: a.availableToSell };
    it.shortfall = r3(Math.max(0, num(it.qty) - a.availableToSell));
  }
  return { ...row, items, links: await docLinks('SALES_QUOTATION', id), approval: await approvalFor('SALES_QUOTATION', id) };
}

router.get('/', can('sales_quotation', 'view'), ah(async (req, res) => {
  await expireOverdue();
  const { q, where, orderBy } = await buildListWhere(req);
  const [rows, total] = await Promise.all([
    prisma.salesQuotation.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.salesQuotation.count({ where }),
  ]);
  await enrich(rows as unknown as Record<string, unknown>[], { customerId: 'customer', salesmanId: 'salesman', warehouseId: 'warehouse' });
  res.json(paged(rows, total, q));
}));

router.get('/:id', can('sales_quotation', 'view'), ah(async (req, res) => res.json(await detail(intParam(req)))));

router.post('/', can('sales_quotation', 'create'), ah(async (req, res) => {
  const b = parse(bodySchema, req.body);
  const q = await prisma.$transaction((tx) => createQuotationTx(tx, req.user, b), { timeout: 30000 });
  res.status(201).json(await detail(q.id));
}));

router.put('/:id', can('sales_quotation', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(bodySchema, req.body);
  await prisma.$transaction(async (tx) => {
    const revisionBefore = await revisionSnapshot(tx, 'SalesQuotation', id);
    const q = mustFound(await tx.salesQuotation.findUnique({ where: { id } }), 'Sales quotation');
    mustStatus(q, ['DRAFT'], 'edit');
    const cust = await mustCustomer(tx, b.customerId);
    const { lines, totals } = await prepareLines(tx, b.items as LineIn[], { priceType: b.priceType, roundOff: b.roundOff });
    const currencyCode = b.currencyCode ?? q.currencyCode;
    await tx.salesQuotationItem.deleteMany({ where: { quotationId: id } });
    await tx.salesQuotation.update({
      where: { id },
      data: {
        docDate: b.docDate ?? q.docDate, validUntil: b.validUntil ?? null, customerId: b.customerId, salesmanId: b.salesmanId ?? cust.salesmanId ?? null,
        warehouseId: b.warehouseId ?? null, currencyCode, exchangeRate: await resolveRate(tx, currencyCode, b.exchangeRate ?? (b.currencyCode ? undefined : num(q.exchangeRate))),
        paymentTerms: b.paymentTerms ?? null, subtotal: totals.subtotal, discount: totals.discount, vatAmount: totals.vatAmount, roundOff: totals.roundOff,
        total: totals.total, remarks: b.remarks ?? null, terms: b.terms ?? null, items: { create: lines },
      },
    });
    await auditRevision(tx, req.user, 'SalesQuotation', id, revisionBefore, req.body?.changeReason);
    await audit(tx, req.user, 'UPDATE', 'SalesQuotation', id);
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

router.delete('/:id', can('sales_quotation', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const q = mustFound(await tx.salesQuotation.findUnique({ where: { id } }), 'Sales quotation');
    mustStatus(q, ['DRAFT'], 'delete');
    await tx.salesQuotation.delete({ where: { id } });
    // enquiry goes back to OPEN when its only quotation is removed
    if (q.enquiryId) {
      await tx.documentLink.deleteMany({ where: { toType: 'SALES_QUOTATION', toId: id } });
      const others = await tx.salesQuotation.count({ where: { enquiryId: q.enquiryId, status: { not: 'CANCELLED' } } });
      if (!others) await tx.salesEnquiry.updateMany({ where: { id: q.enquiryId, status: 'QUOTED' }, data: { status: 'OPEN' } });
    }
    await audit(tx, req.user, 'DELETE', 'SalesQuotation', id, { docNo: q.docNo });
  });
  res.json({ ok: true });
}));

async function transition(req: Request, perm: string, from: string[], to: string, action: string) {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const q = mustFound(await tx.salesQuotation.findUnique({ where: { id } }), 'Sales quotation');
    mustStatus(q, from, action.toLowerCase());
    await tx.salesQuotation.update({ where: { id }, data: { status: to } });
    await audit(tx, req.user, action, 'SalesQuotation', id, { from: q.status, to });
  });
  return detail(id);
}
router.post('/:id/send', can('sales_quotation', 'edit'), ah(async (req, res) => res.json(await transition(req, 'edit', ['DRAFT'], 'SENT', 'SEND'))));
router.post('/:id/submit', can('sales_quotation', 'edit'), ah(async (req, res) => res.json(await transition(req, 'edit', ['DRAFT'], 'SENT', 'SEND'))));
router.post('/:id/accept', can('sales_quotation', 'edit'), ah(async (req, res) => res.json(await transition(req, 'edit', ['SENT'], 'ACCEPTED', 'ACCEPT'))));
router.post('/:id/reject', can('sales_quotation', 'edit'), ah(async (req, res) => res.json(await transition(req, 'edit', ['SENT', 'ACCEPTED'], 'REJECTED', 'REJECT'))));
router.post('/:id/cancel', can('sales_quotation', 'cancel'), ah(async (req, res) => res.json(await transition(req, 'cancel', ['DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED'], 'CANCELLED', 'CANCEL'))));
router.post('/:id/reopen', can('sales_quotation', 'edit'), ah(async (req, res) => res.json(await transition(req, 'edit', ['REJECTED', 'EXPIRED', 'CANCELLED'], 'DRAFT', 'REOPEN'))));

/* ---------------- /sales helpers ---------------- */
const helpers = Router();

// GET /sales/availability?productId=&warehouseId=  (productId may be comma-separated)
helpers.get('/availability', can('sales_quotation', 'view'), ah(async (req, res) => {
  const ids = String(req.query.productId ?? req.query.productIds ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) throw badRequest('productId is required');
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
  const total = await availabilityFor(prisma, ids, warehouseId);
  const balances = await prisma.stockBalance.findMany({ where: { productId: { in: ids } } });
  const whs = await enrich(balances.map((b) => ({ ...b })) as unknown as Record<string, unknown>[], { warehouseId: 'warehouse' });
  const shape = (id: number) => {
    const a = total.get(id)!;
    return {
      productId: id,
      warehouseId,
      availableStock: a.onHand, // physical
      reservedStock: a.reserved,
      availableToSell: a.availableToSell,
      onHand: a.onHand,
      reserved: a.reserved,
      available: a.available,
      byWarehouse: whs
        .filter((b) => b.productId === id)
        .map((b) => ({ warehouse: b.warehouse, onHand: num(b.onHand), reserved: num(b.reserved), available: r3(num(b.onHand) - num(b.reserved)) })),
    };
  };
  res.json(ids.length === 1 ? shape(ids[0]) : ids.map(shape));
}));

helpers.get('/pipeline-summary', can('sales_order', 'view'), ah(async (_req, res) => {
  await expireOverdue();
  const [quotations, orders, delivering, pendingApproval, dnUninvoiced, draftInvoices, deliveredOrders] = await Promise.all([
    prisma.salesQuotation.count({ where: { status: { in: ['DRAFT', 'SENT', 'ACCEPTED'] } } }),
    prisma.salesOrder.count({ where: { status: { in: ['DRAFT', 'PENDING_APPROVAL'] } } }),
    prisma.salesOrder.count({ where: { status: { in: ['APPROVED', 'PARTIALLY_DELIVERED'] } } }),
    prisma.salesOrder.count({ where: { status: 'PENDING_APPROVAL' } }),
    prisma.deliveryNote.count({ where: { status: 'POSTED', invoiced: false } }),
    prisma.salesInvoice.count({ where: { status: 'DRAFT' } }),
    prisma.salesOrder.count({ where: { status: { in: ['DELIVERED', 'PARTIALLY_DELIVERED'] } } }),
  ]);
  const openEnq = await prisma.salesEnquiry.count({ where: { status: 'OPEN' } });
  res.json({
    pendingEnquiries: openEnq,
    pendingQuotations: quotations,
    pendingSalesOrders: orders,
    pendingApprovals: pendingApproval,
    pendingDeliveries: delivering,
    pendingInvoices: dnUninvoiced,
    draftInvoices,
    ordersDeliveredAwaitingInvoice: deliveredOrders,
  });
}));

/* ---------------- enquiry -> quotation (mounted on /sales-enquiries) ---------------- */
const enquiryConv = Router();
enquiryConv.post('/:id/create-quotation', can('sales_quotation', 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const over = z.object({ warehouseId: z.coerce.number().int().optional(), validUntil: z.coerce.date().optional(), priceType: z.enum(['RETAIL', 'WHOLESALE']).optional(), paymentTerms: z.string().optional() }).parse(req.body ?? {});
  const qId = await prisma.$transaction(async (tx) => {
    const e = mustFound(await tx.salesEnquiry.findUnique({ where: { id }, include: { items: true } }), 'Sales enquiry');
    mustStatus(e, ['OPEN', 'QUOTED', 'PARTIALLY_QUOTED'], 'create quotation');
    const missing = e.items.filter((i) => !i.productId);
    if (missing.length) throw badRequest(`Enquiry lines without a product cannot be quoted: ${missing.map((m) => m.description ?? `#${m.id}`).join(', ')}. Edit the enquiry and select products.`);
    const cust = await mustCustomer(tx, e.customerId);
    const validUntil = over.validUntil ?? new Date(Date.now() + 30 * 86400000);
    const terms = over.paymentTerms ?? (cust.paymentTermId ? (await tx.paymentTerm.findUnique({ where: { id: cust.paymentTermId } }))?.name : undefined);
    const q = await createQuotationTx(tx, req.user, {
      customerId: e.customerId, salesmanId: e.salesmanId, enquiryId: e.id, warehouseId: over.warehouseId ?? null, validUntil,
      priceType: over.priceType, paymentTerms: terms ?? null, remarks: e.remarks ?? undefined,
      items: await takePending(tx, 'SE_SQ', id, e.items, (i, qty) => ({ productId: i.productId!, qty, description: i.description ?? undefined }), `enquiry ${e.docNo}`),
    });
    await linkDocs(tx, { type: 'SALES_ENQUIRY', id: e.id, no: e.docNo }, { type: 'SALES_QUOTATION', id: q.id, no: q.docNo });
    await tx.salesEnquiry.update({ where: { id }, data: { status: 'QUOTED' } });
    await syncSourceStatus(tx, 'SALES_ENQUIRY', id);
    await audit(tx, req.user, 'CREATE_QUOTATION', 'SalesEnquiry', id, { quotation: q.docNo });
    return q.id;
  }, { timeout: 30000 });
  res.status(201).json(await detail(qId));
}));

export default [
  { path: '/sales-quotations', router },
  { path: '/sales', router: helpers },
  { path: '/sales-enquiries', router: enquiryConv },
] satisfies ModuleDef[];
