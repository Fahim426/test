/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, intParam, parse } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import { nextNumber } from '../services/numbering';
import { linkDocs } from '../services/docLink';
import { assertStatus, deleteLinks, finishDoc, listDocs } from '../services/purchase-common';
import type { ModuleDef } from '../app';

const T = { timeout: 30000 };

const itemSchema = z.object({
  productId: z.coerce.number().int().nullish(),
  oemNumber: z.string().nullish(),
  description: z.string().nullish(),
  qty: z.coerce.number().positive(),
  unit: z.string().nullish(),
  requiredDate: z.coerce.date().nullish(),
  remarks: z.string().nullish(),
});

async function fillItems(items: z.infer<typeof itemSchema>[]) {
  const ids = [...new Set(items.map((i) => i.productId).filter((x): x is number => !!x))];
  const ps = await prisma.product.findMany({ where: { id: { in: ids } } });
  const pm = new Map(ps.map((p) => [p.id, p]));
  return items.map((i) => {
    const p = i.productId ? pm.get(i.productId) : undefined;
    if (i.productId && !p) throw badRequest(`Product ${i.productId} not found`);
    if (!p && !i.description) throw badRequest('Each item needs a product or a description');
    return { ...i, oemNumber: i.oemNumber ?? p?.oemNumber ?? null, description: i.description ?? p?.name ?? null, unit: i.unit ?? p?.purchaseUnit ?? null };
  });
}

// ------------------------------------------------------------------ MATERIAL REQUEST
const mrSchema = z.object({
  docDate: z.coerce.date().optional(),
  requestedBy: z.string().nullish(),
  department: z.string().nullish(),
  businessUnitId: z.coerce.number().int().nullish(),
  warehouseId: z.coerce.number().int().nullish(),
  requiredDate: z.coerce.date().nullish(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  remarks: z.string().nullish(),
  items: z.array(itemSchema).min(1),
});

const mr = Router();
const MR = 'material_request';
const loadMR = async (id: number) => {
  const d = await prisma.materialRequest.findUnique({ where: { id }, include: { items: true } });
  if (!d) throw notFound('Material request not found');
  return d;
};

mr.get('/', can(MR, 'view'), ah(async (req, res) => {
  res.json(await listDocs(req, { model: 'materialRequest', search: ['docNo', 'requestedBy', 'department', 'remarks'], numeric: ['warehouseId'], strings: ['priority'], include: { items: { select: { qty: true } } }, map: (r) => { const n = r.items.length; const q = r.items.reduce((s: number, i: any) => s + Number(i.qty), 0); delete r.items; return { ...r, itemCount: n, totalQty: q }; } }));
}));
mr.get('/:id', can(MR, 'view'), ah(async (req, res) => {
  const d = await loadMR(intParam(req));
  const out: any = await finishDoc(d, 'MATERIAL_REQUEST');
  out.requisitions = await prisma.purchaseRequisition.findMany({ where: { materialRequestId: d.id }, select: { id: true, docNo: true, status: true } });
  res.json(out);
}));
mr.post('/', can(MR, 'create'), ah(async (req, res) => {
  const b = parse(mrSchema, req.body);
  const items = await fillItems(b.items);
  const doc = await prisma.$transaction(async (tx) => {
    const docDate = b.docDate ?? new Date();
    const docNo = await nextNumber(tx, 'MATERIAL_REQUEST', { date: docDate });
    const { items: _i, ...h } = b;
    const d = await tx.materialRequest.create({ data: { ...h, docDate, docNo, status: 'DRAFT', createdBy: req.user!.id, items: { create: items } } });
    await audit(tx, req.user, 'CREATE', 'MaterialRequest', d.id, { docNo });
    return d;
  }, T);
  res.status(201).json(await finishDoc(await loadMR(doc.id), 'MATERIAL_REQUEST'));
}));
mr.put('/:id', can(MR, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(mrSchema.partial(), req.body);
  const items = b.items ? await fillItems(b.items) : null;
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.materialRequest.findUnique({ where: { id } }), ['DRAFT'], 'edit');
    const { items: _i, ...h } = b;
    await tx.materialRequest.update({ where: { id }, data: h });
    if (items) { await tx.materialRequestItem.deleteMany({ where: { requestId: id } }); await tx.materialRequestItem.createMany({ data: items.map((i) => ({ ...i, requestId: id })) }); }
    await audit(tx, req.user, 'UPDATE', 'MaterialRequest', id);
  }, T);
  res.json(await finishDoc(await loadMR(id), 'MATERIAL_REQUEST'));
}));
mr.delete('/:id', can(MR, 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.materialRequest.findUnique({ where: { id } }), ['DRAFT'], 'delete');
    await tx.materialRequest.delete({ where: { id } });
    await deleteLinks(tx, 'MATERIAL_REQUEST', id);
    await audit(tx, req.user, 'DELETE', 'MaterialRequest', id);
  }, T);
  res.json({ ok: true });
}));

const mrTransition = (path: string, perm: string, from: string[], to: string, action: string) =>
  mr.post(`/:id${path}`, can(MR, perm), ah(async (req, res) => {
    const id = intParam(req);
    await prisma.$transaction(async (tx) => {
      const d: any = assertStatus(await tx.materialRequest.findUnique({ where: { id } }), from, action.toLowerCase());
      if (to === 'CANCELLED') {
        const active = await tx.purchaseRequisition.count({ where: { materialRequestId: id, status: { notIn: ['CANCELLED', 'REJECTED'] } } });
        if (active) throw badRequest('Cancel the linked purchase requisition(s) first');
      }
      await tx.materialRequest.update({ where: { id }, data: { status: to, remarks: req.body?.comment ? `${d.remarks ?? ''}\n[${action}] ${req.body.comment}`.trim() : undefined } });
      await audit(tx, req.user, action, 'MaterialRequest', id, { from: d.status, to, comment: req.body?.comment });
    }, T);
    res.json(await finishDoc(await loadMR(id), 'MATERIAL_REQUEST'));
  }));
mrTransition('/submit', 'edit', ['DRAFT'], 'SUBMITTED', 'SUBMIT');
mrTransition('/approve', 'approve', ['SUBMITTED'], 'APPROVED', 'APPROVE');
mrTransition('/reject', 'reject', ['SUBMITTED'], 'REJECTED', 'REJECT');
mrTransition('/close', 'edit', ['APPROVED'], 'CLOSED', 'CLOSE');
mrTransition('/cancel', 'cancel', ['DRAFT', 'SUBMITTED', 'APPROVED'], 'CANCELLED', 'CANCEL');

mr.post('/:id/create-requisition', can('purchase_requisition', 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const out = await prisma.$transaction(async (tx) => {
    const m = await tx.materialRequest.findUnique({ where: { id }, include: { items: true } });
    assertStatus(m, ['APPROVED'], 'create a requisition (material request must be APPROVED)');
    const dup = await tx.purchaseRequisition.findFirst({ where: { materialRequestId: id, status: { notIn: ['CANCELLED', 'REJECTED'] } } });
    if (dup) throw badRequest(`Requisition ${dup.docNo} already exists for this material request`);
    const docDate = new Date();
    const docNo = await nextNumber(tx, 'PURCHASE_REQUISITION', { date: docDate });
    const pr = await tx.purchaseRequisition.create({
      data: {
        docNo, docDate, materialRequestId: id, department: m!.department, warehouseId: m!.warehouseId, requestedBy: m!.requestedBy, priority: m!.priority, status: 'DRAFT', createdBy: req.user!.id,
        remarks: m!.remarks,
        items: { create: m!.items.map((i) => ({ productId: i.productId, description: i.description, qty: i.qty, unit: i.unit, requiredDate: i.requiredDate ?? m!.requiredDate, remarks: i.remarks })) },
      },
    });
    await linkDocs(tx, { type: 'MATERIAL_REQUEST', id, no: m!.docNo }, { type: 'PURCHASE_REQUISITION', id: pr.id, no: pr.docNo });
    await audit(tx, req.user, 'CREATE', 'PurchaseRequisition', pr.id, { from: m!.docNo });
    return pr;
  }, T);
  res.status(201).json(await finishDoc(await loadPR(out.id), 'PURCHASE_REQUISITION'));
}));

// ------------------------------------------------------------------ PURCHASE REQUISITION
const prSchema = z.object({
  docDate: z.coerce.date().optional(),
  materialRequestId: z.coerce.number().int().nullish(),
  department: z.string().nullish(),
  warehouseId: z.coerce.number().int().nullish(),
  requestedBy: z.string().nullish(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  remarks: z.string().nullish(),
  items: z.array(itemSchema).min(1),
});
const PR = 'purchase_requisition';
const pr = Router();
const loadPR = async (id: number) => {
  const d = await prisma.purchaseRequisition.findUnique({ where: { id }, include: { items: true } });
  if (!d) throw notFound('Purchase requisition not found');
  return d;
};
const prItems = (items: any[]) => items.map(({ oemNumber, ...i }) => i);

pr.get('/', can(PR, 'view'), ah(async (req, res) => {
  res.json(await listDocs(req, { model: 'purchaseRequisition', search: ['docNo', 'requestedBy', 'department', 'remarks'], numeric: ['warehouseId', 'materialRequestId'], strings: ['priority'], include: { items: { select: { qty: true } } }, map: (r) => { const n = r.items.length; const q = r.items.reduce((s: number, i: any) => s + Number(i.qty), 0); delete r.items; return { ...r, itemCount: n, totalQty: q }; } }));
}));
pr.get('/:id', can(PR, 'view'), ah(async (req, res) => {
  const d = await loadPR(intParam(req));
  const out: any = await finishDoc(d, 'PURCHASE_REQUISITION');
  out.enquiries = await prisma.purchaseEnquiry.findMany({ where: { requisitionId: d.id }, select: { id: true, docNo: true, status: true } });
  res.json(out);
}));
pr.post('/', can(PR, 'create'), ah(async (req, res) => {
  const b = parse(prSchema, req.body);
  const items = prItems(await fillItems(b.items));
  const doc = await prisma.$transaction(async (tx) => {
    const docDate = b.docDate ?? new Date();
    const docNo = await nextNumber(tx, 'PURCHASE_REQUISITION', { date: docDate });
    const { items: _i, ...h } = b;
    const d = await tx.purchaseRequisition.create({ data: { ...h, docDate, docNo, status: 'DRAFT', createdBy: req.user!.id, items: { create: items } } });
    await audit(tx, req.user, 'CREATE', 'PurchaseRequisition', d.id, { docNo });
    return d;
  }, T);
  res.status(201).json(await finishDoc(await loadPR(doc.id), 'PURCHASE_REQUISITION'));
}));
pr.put('/:id', can(PR, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(prSchema.partial(), req.body);
  const items = b.items ? prItems(await fillItems(b.items)) : null;
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.purchaseRequisition.findUnique({ where: { id } }), ['DRAFT'], 'edit');
    const { items: _i, ...h } = b;
    await tx.purchaseRequisition.update({ where: { id }, data: h });
    if (items) { await tx.purchaseRequisitionItem.deleteMany({ where: { requisitionId: id } }); await tx.purchaseRequisitionItem.createMany({ data: items.map((i) => ({ ...i, requisitionId: id })) }); }
    await audit(tx, req.user, 'UPDATE', 'PurchaseRequisition', id);
  }, T);
  res.json(await finishDoc(await loadPR(id), 'PURCHASE_REQUISITION'));
}));
pr.delete('/:id', can(PR, 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.purchaseRequisition.findUnique({ where: { id } }), ['DRAFT'], 'delete');
    await tx.purchaseRequisition.delete({ where: { id } });
    await deleteLinks(tx, 'PURCHASE_REQUISITION', id);
    await audit(tx, req.user, 'DELETE', 'PurchaseRequisition', id);
  }, T);
  res.json({ ok: true });
}));
const prTransition = (path: string, perm: string, from: string[], to: string, action: string) =>
  pr.post(`/:id${path}`, can(PR, perm), ah(async (req, res) => {
    const id = intParam(req);
    await prisma.$transaction(async (tx) => {
      const d = assertStatus(await tx.purchaseRequisition.findUnique({ where: { id } }), from, action.toLowerCase());
      if (to === 'CANCELLED') {
        const active = await tx.purchaseEnquiry.count({ where: { requisitionId: id, status: { notIn: ['CANCELLED'] } } });
        if (active) throw badRequest('Cancel the linked enquiry first');
      }
      await tx.purchaseRequisition.update({ where: { id }, data: { status: to } });
      await audit(tx, req.user, action, 'PurchaseRequisition', id, { from: d.status, to, comment: req.body?.comment });
    }, T);
    res.json(await finishDoc(await loadPR(id), 'PURCHASE_REQUISITION'));
  }));
prTransition('/submit', 'edit', ['DRAFT'], 'SUBMITTED', 'SUBMIT');
prTransition('/approve', 'approve', ['SUBMITTED'], 'APPROVED', 'APPROVE');
prTransition('/reject', 'reject', ['SUBMITTED'], 'REJECTED', 'REJECT');
prTransition('/close', 'edit', ['APPROVED', 'CONVERTED'], 'CLOSED', 'CLOSE');
prTransition('/cancel', 'cancel', ['DRAFT', 'SUBMITTED', 'APPROVED'], 'CANCELLED', 'CANCEL');

// Convert to purchase enquiry (RFQ) with optional supplier list
pr.post('/:id/create-enquiry', can('purchase_enquiry', 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(z.object({ supplierIds: z.array(z.coerce.number().int()).default([]), requiredDate: z.coerce.date().nullish() }), req.body ?? {});
  const out = await prisma.$transaction(async (tx) => {
    const p = await tx.purchaseRequisition.findUnique({ where: { id }, include: { items: true } });
    assertStatus(p, ['APPROVED'], 'create an enquiry (requisition must be APPROVED)');
    const dup = await tx.purchaseEnquiry.findFirst({ where: { requisitionId: id, status: { not: 'CANCELLED' } } });
    if (dup) throw badRequest(`Enquiry ${dup.docNo} already exists for this requisition`);
    if (b.supplierIds && b.supplierIds.length) {
      const n = await tx.supplier.count({ where: { id: { in: b.supplierIds } } });
      if (n !== new Set(b.supplierIds).size) throw badRequest('Unknown supplier in supplierIds');
    }
    const docDate = new Date();
    const docNo = await nextNumber(tx, 'PURCHASE_ENQUIRY', { date: docDate });
    const e = await tx.purchaseEnquiry.create({
      data: {
        docNo, docDate, requiredDate: b.requiredDate ?? p!.items.find((i) => i.requiredDate)?.requiredDate ?? null, requisitionId: id, warehouseId: p!.warehouseId, remarks: p!.remarks, status: 'DRAFT', createdBy: req.user!.id,
        items: { create: p!.items.map((i) => ({ productId: i.productId, description: i.description, qty: i.qty, unit: i.unit })) },
        suppliers: { create: [...new Set(b.supplierIds ?? [])].map((supplierId) => ({ supplierId })) },
      },
    });
    await tx.purchaseRequisition.update({ where: { id }, data: { status: 'CONVERTED' } });
    await linkDocs(tx, { type: 'PURCHASE_REQUISITION', id, no: p!.docNo }, { type: 'PURCHASE_ENQUIRY', id: e.id, no: e.docNo });
    await audit(tx, req.user, 'CREATE', 'PurchaseEnquiry', e.id, { from: p!.docNo });
    return e;
  }, T);
  res.status(201).json(out);
}));

export default [
  { path: '/material-requests', router: mr },
  { path: '/purchase-requisitions', router: pr },
] as ModuleDef[];
