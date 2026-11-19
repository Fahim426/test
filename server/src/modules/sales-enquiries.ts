import { revisionSnapshot, auditRevision } from '../services/revisions-history';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, parse, intParam, paged } from '../lib/http';
import { badRequest } from '../lib/errors';
import { can } from '../middleware/auth';
import { enrich } from '../lib/enrich';
import { nextNumber } from '../services/numbering';
import { audit } from '../services/audit';
import { buildListWhere, mustCustomer, mustFound, mustStatus, approvalFor, docLinks } from '../services/sales-common';
import type { ModuleDef } from '../app';

const router = Router();

const itemIn = z.object({
  productId: z.coerce.number().int().optional().nullable(),
  description: z.string().optional().nullable(),
  qty: z.coerce.number().positive(),
  remarks: z.string().optional().nullable(),
});
const bodySchema = z.object({
  docDate: z.coerce.date().optional(),
  customerId: z.coerce.number().int(),
  salesmanId: z.coerce.number().int().optional().nullable(),
  requiredDate: z.coerce.date().optional().nullable(),
  remarks: z.string().optional().nullable(),
  items: z.array(itemIn).min(1),
});

async function detail(id: number) {
  const e = mustFound(await prisma.salesEnquiry.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } }), 'Sales enquiry');
  const [row] = await enrich([e as unknown as Record<string, unknown>], { customerId: 'customer', salesmanId: 'salesman' });
  const items = await enrich(e.items as unknown as Record<string, unknown>[], { productId: 'product' });
  return { ...row, items, links: await docLinks('SALES_ENQUIRY', id), approval: await approvalFor('SALES_ENQUIRY', id) };
}

router.get('/', can('sales_enquiry', 'view'), ah(async (req, res) => {
  const { q, where, orderBy } = await buildListWhere(req);
  const [rows, total] = await Promise.all([
    prisma.salesEnquiry.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { items: { select: { qty: true } } } }),
    prisma.salesEnquiry.count({ where }),
  ]);
  const out = rows.map((r) => ({ ...r, itemCount: r.items.length, totalQty: r.items.reduce((s, i) => s + Number(i.qty), 0), items: undefined }));
  await enrich(out as unknown as Record<string, unknown>[], { customerId: 'customer', salesmanId: 'salesman' });
  res.json(paged(out, total, q));
}));

router.get('/:id', can('sales_enquiry', 'view'), ah(async (req, res) => res.json(await detail(intParam(req)))));

router.post('/', can('sales_enquiry', 'create'), ah(async (req, res) => {
  const b = parse(bodySchema, req.body);
  const id = await prisma.$transaction(async (tx) => {
    await mustCustomer(tx, b.customerId);
    const docDate = b.docDate ?? new Date();
    const docNo = await nextNumber(tx, 'SALES_ENQUIRY', { date: docDate });
    const e = await tx.salesEnquiry.create({
      data: {
        docNo, docDate, customerId: b.customerId, salesmanId: b.salesmanId ?? null, requiredDate: b.requiredDate ?? null,
        remarks: b.remarks ?? null, createdBy: req.user?.id,
        items: { create: b.items.map((i) => ({ productId: i.productId ?? null, description: i.description ?? null, qty: i.qty, remarks: i.remarks ?? null })) },
      },
    });
    await audit(tx, req.user, 'CREATE', 'SalesEnquiry', e.id, { docNo });
    return e.id;
  }, { timeout: 30000 });
  res.status(201).json(await detail(id));
}));

router.put('/:id', can('sales_enquiry', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(bodySchema, req.body);
  await prisma.$transaction(async (tx) => {
    const revisionBefore = await revisionSnapshot(tx, 'SalesEnquiry', id);
    const e = mustFound(await tx.salesEnquiry.findUnique({ where: { id } }), 'Sales enquiry');
    mustStatus(e, ['OPEN'], 'edit (only OPEN enquiries are editable)');
    if (await tx.documentLink.count({ where: { fromType: 'SALES_ENQUIRY', fromId: id } })) throw badRequest('Enquiry already has a quotation; it cannot be edited');
    await mustCustomer(tx, b.customerId);
    await tx.salesEnquiryItem.deleteMany({ where: { enquiryId: id } });
    await tx.salesEnquiry.update({
      where: { id },
      data: {
        docDate: b.docDate ?? e.docDate, customerId: b.customerId, salesmanId: b.salesmanId ?? null, requiredDate: b.requiredDate ?? null, remarks: b.remarks ?? null,
        items: { create: b.items.map((i) => ({ productId: i.productId ?? null, description: i.description ?? null, qty: i.qty, remarks: i.remarks ?? null })) },
      },
    });
    await auditRevision(tx, req.user, 'SalesEnquiry', id, revisionBefore, req.body?.changeReason);
    await audit(tx, req.user, 'UPDATE', 'SalesEnquiry', id);
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

router.delete('/:id', can('sales_enquiry', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const e = mustFound(await tx.salesEnquiry.findUnique({ where: { id } }), 'Sales enquiry');
    mustStatus(e, ['OPEN'], 'delete');
    if (await tx.documentLink.count({ where: { fromType: 'SALES_ENQUIRY', fromId: id } })) throw badRequest('Enquiry already has a quotation; cancel it instead');
    await tx.salesEnquiry.delete({ where: { id } });
    await audit(tx, req.user, 'DELETE', 'SalesEnquiry', id, { docNo: e.docNo });
  });
  res.json({ ok: true });
}));

async function setStatus(req: import('express').Request, to: string, from: string[], action: string) {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const e = mustFound(await tx.salesEnquiry.findUnique({ where: { id } }), 'Sales enquiry');
    mustStatus(e, from, action.toLowerCase());
    await tx.salesEnquiry.update({ where: { id }, data: { status: to } });
    await audit(tx, req.user, action, 'SalesEnquiry', id, { from: e.status, to });
  });
  return detail(id);
}
router.post('/:id/cancel', can('sales_enquiry', 'cancel'), ah(async (req, res) => res.json(await setStatus(req, 'CANCELLED', ['OPEN', 'QUOTED'], 'CANCEL'))));
router.post('/:id/close', can('sales_enquiry', 'edit'), ah(async (req, res) => res.json(await setStatus(req, 'CLOSED', ['OPEN', 'QUOTED'], 'CLOSE'))));
router.post('/:id/reopen', can('sales_enquiry', 'edit'), ah(async (req, res) => res.json(await setStatus(req, 'OPEN', ['CLOSED', 'CANCELLED'], 'REOPEN'))));

// POST /:id/create-quotation lives in sales-quotations.ts (mounted on /sales-enquiries too)

export default [{ path: '/sales-enquiries', router }] satisfies ModuleDef[];
