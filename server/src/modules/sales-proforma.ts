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
import { buildListWhere, lineIn, prepareLines, mustCustomer, mustFound, mustStatus, approvalFor, docLinks, availabilityFor, num, LineIn } from '../services/sales-common';
import type { ModuleDef } from '../app';

const router = Router();

const bodySchema = z.object({
  docDate: z.coerce.date().optional(),
  customerId: z.coerce.number().int(),
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
      docNo, docDate, customerId: b.customerId, quotationId: b.quotationId ?? null, warehouseId: b.warehouseId ?? null,
      currencyCode: b.currencyCode ?? cust.currencyCode ?? 'AED', paymentTerms: b.paymentTerms ?? null,
      subtotal: totals.subtotal, discount: totals.discount, vatAmount: totals.vatAmount, total: totals.total,
      remarks: b.remarks ?? null, createdBy: user?.id, items: { create: lines },
    },
  });
  await audit(tx, user, 'CREATE', 'ProformaInvoice', p.id, { docNo });
  return p;
}

async function detail(id: number) {
  const p = mustFound(await prisma.proformaInvoice.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } }), 'Proforma invoice');
  const [row] = await enrich([p as unknown as Record<string, unknown>], { customerId: 'customer', warehouseId: 'warehouse' });
  const items = await enrich(p.items as unknown as Record<string, unknown>[], { productId: 'product' });
  const av = await availabilityFor(prisma, [...new Set(p.items.map((i) => i.productId))], p.warehouseId);
  for (const it of items) {
    const a = av.get(it.productId as number)!;
    it.availability = { availableStock: a.onHand, reservedStock: a.reserved, availableToSell: a.availableToSell };
  }
  return { ...row, items, links: await docLinks('PROFORMA_INVOICE', id), approval: await approvalFor('PROFORMA_INVOICE', id) };
}

router.get('/', can('proforma_invoice', 'view'), ah(async (req, res) => {
  const { q, where, orderBy } = await buildListWhere(req);
  const [rows, total] = await Promise.all([
    prisma.proformaInvoice.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.proformaInvoice.count({ where }),
  ]);
  await enrich(rows as unknown as Record<string, unknown>[], { customerId: 'customer', warehouseId: 'warehouse' });
  res.json(paged(rows, total, q));
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
        docDate: b.docDate ?? p.docDate, customerId: b.customerId, warehouseId: b.warehouseId ?? null, currencyCode: b.currencyCode ?? p.currencyCode,
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
      if (p.salesOrderId) {
        const so = await tx.salesOrder.findUnique({ where: { id: p.salesOrderId } });
        if (so && so.status !== 'CANCELLED') throw badRequest(`Proforma is converted to sales order ${so.docNo}; cancel that first`);
      }
    }
    await tx.proformaInvoice.update({ where: { id }, data: { status: to } });
    await audit(tx, req.user, action, 'ProformaInvoice', id, { from: p.status, to });
  });
  return detail(id);
}
router.post('/:id/issue', can('proforma_invoice', 'edit'), ah(async (req, res) => res.json(await transition(req, ['DRAFT'], 'ISSUED', 'ISSUE'))));
router.post('/:id/submit', can('proforma_invoice', 'edit'), ah(async (req, res) => res.json(await transition(req, ['DRAFT'], 'ISSUED', 'ISSUE'))));
router.post('/:id/cancel', can('proforma_invoice', 'cancel'), ah(async (req, res) => res.json(await transition(req, ['DRAFT', 'ISSUED', 'CONVERTED'], 'CANCELLED', 'CANCEL'))));

/* ---------------- quotation -> proforma (mounted on /sales-quotations) ---------------- */
const fromQuotation = Router();
fromQuotation.post('/:id/create-proforma', can('proforma_invoice', 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const pid = await prisma.$transaction(async (tx) => {
    const q = mustFound(await tx.salesQuotation.findUnique({ where: { id }, include: { items: true } }), 'Sales quotation');
    mustStatus(q, ['DRAFT', 'SENT', 'ACCEPTED', 'CONVERTED'], 'create proforma');
    const dup = await tx.proformaInvoice.findFirst({ where: { quotationId: id, status: { not: 'CANCELLED' } } });
    if (dup) throw conflict(`Quotation already has proforma ${dup.docNo}`);
    const p = await createProformaTx(tx, req.user, {
      customerId: q.customerId, quotationId: q.id, warehouseId: q.warehouseId, currencyCode: q.currencyCode, paymentTerms: q.paymentTerms, remarks: q.remarks,
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
