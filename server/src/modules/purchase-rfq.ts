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
import { calcLine, calcTotals, num, r2, r4 } from '../lib/calc';
import { enrich } from '../lib/enrich';
import { assertStatus, baseCurrency, createPurchaseOrder, deleteLinks, finishDoc, listDocs, resolveRate } from '../services/purchase-common';
import type { ModuleDef } from '../app';

const T = { timeout: 30000 };

// ================================================================== ENQUIRY / RFQ
const E = 'purchase_enquiry';
const eItem = z.object({ productId: z.coerce.number().int().nullish(), description: z.string().nullish(), qty: z.coerce.number().positive(), unit: z.string().nullish() });
const eSchema = z.object({
  docDate: z.coerce.date().optional(),
  requiredDate: z.coerce.date().nullish(),
  requisitionId: z.coerce.number().int().nullish(),
  warehouseId: z.coerce.number().int().nullish(),
  remarks: z.string().nullish(),
  supplierIds: z.array(z.coerce.number().int()).default([]),
  items: z.array(eItem).min(1),
});
async function fillEItems(items: z.infer<typeof eItem>[]) {
  const ids = [...new Set(items.map((i) => i.productId).filter((x): x is number => !!x))];
  const pm = new Map((await prisma.product.findMany({ where: { id: { in: ids } } })).map((p) => [p.id, p]));
  return items.map((i) => {
    const p = i.productId ? pm.get(i.productId) : undefined;
    if (i.productId && !p) throw badRequest(`Product ${i.productId} not found`);
    if (!p && !i.description) throw badRequest('Each item needs a product or a description');
    return { ...i, description: i.description ?? p?.name ?? null, unit: i.unit ?? p?.purchaseUnit ?? null };
  });
}
async function checkSuppliers(ids: number[]) {
  const u = [...new Set(ids)];
  if (u.length && (await prisma.supplier.count({ where: { id: { in: u } } })) !== u.length) throw badRequest('Unknown supplier in supplierIds');
  return u;
}
async function loadE(id: number) {
  const d = await prisma.purchaseEnquiry.findUnique({ where: { id }, include: { items: true, suppliers: true } });
  if (!d) throw notFound('Enquiry not found');
  return d;
}
async function enquiryDetail(id: number) {
  const d: any = await finishDoc(await loadE(id), 'PURCHASE_ENQUIRY');
  await enrich(d.suppliers, { supplierId: 'supplier' });
  d.quotations = await prisma.supplierQuotation.findMany({ where: { enquiryId: id }, select: { id: true, docNo: true, supplierId: true, status: true, total: true, currencyCode: true } });
  return d;
}

const eq = Router();
eq.get('/', can(E, 'view'), ah(async (req, res) => {
  res.json(await listDocs(req, {
    model: 'purchaseEnquiry', search: ['docNo', 'remarks'], numeric: ['warehouseId', 'requisitionId'],
    include: { suppliers: true, items: { select: { id: true } } },
    map: (r) => ({ ...r, itemCount: r.items.length, supplierCount: r.suppliers.length, respondedCount: r.suppliers.filter((s: any) => s.responseStatus === 'RESPONDED').length, items: undefined, suppliers: undefined }),
  }));
}));
eq.get('/:id', can(E, 'view'), ah(async (req, res) => res.json(await enquiryDetail(intParam(req)))));
eq.post('/', can(E, 'create'), ah(async (req, res) => {
  const b = parse(eSchema, req.body);
  const items = await fillEItems(b.items);
  const sup = await checkSuppliers(b.supplierIds ?? []);
  const d = await prisma.$transaction(async (tx) => {
    const docDate = b.docDate ?? new Date();
    const docNo = await nextNumber(tx, 'PURCHASE_ENQUIRY', { date: docDate });
    const e = await tx.purchaseEnquiry.create({
      data: { docNo, docDate, requiredDate: b.requiredDate, requisitionId: b.requisitionId, warehouseId: b.warehouseId, remarks: b.remarks, status: 'DRAFT', createdBy: req.user!.id, items: { create: items }, suppliers: { create: sup.map((supplierId) => ({ supplierId })) } },
    });
    await audit(tx, req.user, 'CREATE', 'PurchaseEnquiry', e.id, { docNo });
    return e;
  }, T);
  res.status(201).json(await enquiryDetail(d.id));
}));
eq.put('/:id', can(E, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(eSchema.partial(), req.body);
  const items = b.items ? await fillEItems(b.items) : null;
  const sup = b.supplierIds ? await checkSuppliers(b.supplierIds) : null;
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.purchaseEnquiry.findUnique({ where: { id } }), ['DRAFT'], 'edit');
    await tx.purchaseEnquiry.update({ where: { id }, data: { docDate: b.docDate, requiredDate: b.requiredDate, warehouseId: b.warehouseId, remarks: b.remarks } });
    if (items) { await tx.purchaseEnquiryItem.deleteMany({ where: { enquiryId: id } }); await tx.purchaseEnquiryItem.createMany({ data: items.map((i) => ({ ...i, enquiryId: id })) }); }
    if (sup) { await tx.purchaseEnquirySupplier.deleteMany({ where: { enquiryId: id } }); await tx.purchaseEnquirySupplier.createMany({ data: sup.map((supplierId) => ({ enquiryId: id, supplierId })) }); }
    await audit(tx, req.user, 'UPDATE', 'PurchaseEnquiry', id);
  }, T);
  res.json(await enquiryDetail(id));
}));
eq.delete('/:id', can(E, 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.purchaseEnquiry.findUnique({ where: { id } }), ['DRAFT'], 'delete');
    await tx.purchaseEnquiry.delete({ where: { id } });
    await deleteLinks(tx, 'PURCHASE_ENQUIRY', id);
    await audit(tx, req.user, 'DELETE', 'PurchaseEnquiry', id);
  }, T);
  res.json({ ok: true });
}));
eq.post('/:id/suppliers', can(E, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const { supplierId } = parse(z.object({ supplierId: z.coerce.number().int() }), req.body);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.purchaseEnquiry.findUnique({ where: { id } }), ['DRAFT', 'SENT', 'QUOTED'], 'add supplier');
    if (!(await tx.supplier.findUnique({ where: { id: supplierId } }))) throw badRequest('Supplier not found');
    if (await tx.purchaseEnquirySupplier.findFirst({ where: { enquiryId: id, supplierId } })) throw badRequest('Supplier already on this enquiry');
    await tx.purchaseEnquirySupplier.create({ data: { enquiryId: id, supplierId } });
    await audit(tx, req.user, 'UPDATE', 'PurchaseEnquiry', id, { addSupplier: supplierId });
  }, T);
  res.json(await enquiryDetail(id));
}));
eq.delete('/:id/suppliers/:supplierId', can(E, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const supplierId = intParam(req, 'supplierId');
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.purchaseEnquiry.findUnique({ where: { id } }), ['DRAFT', 'SENT'], 'remove supplier');
    if (await tx.supplierQuotation.count({ where: { enquiryId: id, supplierId } })) throw badRequest('Supplier already has a quotation on this enquiry');
    await tx.purchaseEnquirySupplier.deleteMany({ where: { enquiryId: id, supplierId } });
  }, T);
  res.json(await enquiryDetail(id));
}));
eq.post('/:id/send', can(E, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const e = assertStatus(await tx.purchaseEnquiry.findUnique({ where: { id }, include: { suppliers: true } }), ['DRAFT'], 'send') as any;
    if (!e.suppliers.length) throw badRequest('Add at least one supplier before sending the enquiry');
    await tx.purchaseEnquiry.update({ where: { id }, data: { status: 'SENT' } });
    await audit(tx, req.user, 'SEND', 'PurchaseEnquiry', id, { suppliers: e.suppliers.length });
  }, T);
  res.json(await enquiryDetail(id));
}));
eq.post('/:id/suppliers/:supplierId/response', can(E, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const supplierId = intParam(req, 'supplierId');
  const b = parse(z.object({ responseStatus: z.enum(['RESPONDED', 'DECLINED', 'PENDING']).default('RESPONDED'), responseDate: z.coerce.date().optional(), responseNotes: z.string().nullish() }), req.body ?? {});
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.purchaseEnquiry.findUnique({ where: { id } }), ['SENT', 'QUOTED'], 'record response');
    const row = await tx.purchaseEnquirySupplier.findFirst({ where: { enquiryId: id, supplierId } });
    if (!row) throw notFound('Supplier is not part of this enquiry');
    await tx.purchaseEnquirySupplier.update({ where: { id: row.id }, data: { responseStatus: b.responseStatus, responseDate: b.responseStatus === 'PENDING' ? null : b.responseDate ?? new Date(), responseNotes: b.responseNotes } });
    await audit(tx, req.user, 'RESPONSE', 'PurchaseEnquiry', id, { supplierId, ...b });
  }, T);
  res.json(await enquiryDetail(id));
}));
const eqTr = (path: string, perm: string, from: string[], to: string, action: string) =>
  eq.post(`/:id${path}`, can(E, perm), ah(async (req, res) => {
    const id = intParam(req);
    await prisma.$transaction(async (tx) => {
      assertStatus(await tx.purchaseEnquiry.findUnique({ where: { id } }), from, action.toLowerCase());
      if (to === 'CANCELLED' && (await tx.supplierQuotation.count({ where: { enquiryId: id, status: { in: ['SELECTED', 'CONVERTED'] } } }))) throw badRequest('Enquiry has a selected/converted quotation');
      await tx.purchaseEnquiry.update({ where: { id }, data: { status: to } });
      await audit(tx, req.user, action, 'PurchaseEnquiry', id);
    }, T);
    res.json(await enquiryDetail(id));
  }));
eqTr('/close', 'edit', ['SENT', 'QUOTED'], 'CLOSED', 'CLOSE');
eqTr('/cancel', 'cancel', ['DRAFT', 'SENT', 'QUOTED'], 'CANCELLED', 'CANCEL');

// prefilled quotation for a supplier of this enquiry
eq.post('/:id/create-quotation', can('supplier_quotation', 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(z.object({ supplierId: z.coerce.number().int() }).passthrough(), req.body);
  const out = await prisma.$transaction((tx) => createQuotation(tx, { ...(req.body as any), enquiryId: id, supplierId: b.supplierId }, req.user!));
  res.status(201).json(await quotationDetail(out.id));
}));

// ================================================================== SUPPLIER QUOTATION
const Q = 'supplier_quotation';
const qItem = z.object({
  productId: z.coerce.number().int().nullish(),
  description: z.string().nullish(),
  qty: z.coerce.number().positive(),
  unit: z.string().nullish(),
  rate: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).default(0),
  vatRate: z.coerce.number().min(0).optional(),
});
const qSchema = z.object({
  enquiryId: z.coerce.number().int().nullish(),
  supplierId: z.coerce.number().int(),
  supplierRef: z.string().nullish(),
  docDate: z.coerce.date().optional(),
  validUntil: z.coerce.date().nullish(),
  currencyCode: z.string().optional(),
  exchangeRate: z.coerce.number().positive().optional(),
  paymentTerms: z.string().nullish(),
  deliveryTerms: z.string().nullish(),
  expectedDeliveryDate: z.coerce.date().nullish(),
  deliveryDays: z.coerce.number().int().min(0).nullish(),
  remarks: z.string().nullish(),
  items: z.array(qItem).optional(),
});

async function buildQItems(tx: Tx, supplierVat: string, items: z.input<typeof qItem>[]) {
  const ids = [...new Set(items.map((i) => i.productId).filter((x): x is number => !!x))];
  const pm = new Map((await tx.product.findMany({ where: { id: { in: ids } } })).map((p) => [p.id, p]));
  return items.map((i) => {
    const p = i.productId ? pm.get(i.productId) : undefined;
    if (i.productId && !p) throw badRequest(`Product ${i.productId} not found`);
    const vatRate = i.vatRate ?? (supplierVat !== 'TAXABLE' ? 0 : num(p?.vatRate));
    const c = calcLine({ qty: i.qty, rate: i.rate, discount: i.discount ?? 0, vatRate });
    return { productId: i.productId ?? null, description: i.description ?? p?.name ?? null, qty: i.qty, unit: i.unit ?? p?.purchaseUnit ?? null, rate: i.rate, discount: i.discount ?? 0, vatRate, vatAmount: c.vatAmount, amount: c.amount };
  });
}

async function createQuotation(tx: Tx, raw: any, user: { id: number; username: string }) {
  const b = parse(qSchema, raw);
  const supplier = await tx.supplier.findUnique({ where: { id: b.supplierId } });
  if (!supplier) throw badRequest('Supplier not found');
  let srcItems = b.items;
  if (b.enquiryId) {
    const e = await tx.purchaseEnquiry.findUnique({ where: { id: b.enquiryId }, include: { items: true, suppliers: true } });
    assertStatus(e, ['DRAFT', 'SENT', 'QUOTED'], 'add quotation to enquiry');
    if (!srcItems?.length) {
      const ps = await tx.product.findMany({ where: { id: { in: e!.items.map((i) => i.productId ?? 0) } } });
      const pm = new Map(ps.map((p) => [p.id, p]));
      srcItems = e!.items.map((i) => ({ productId: i.productId, description: i.description, qty: num(i.qty), unit: i.unit, rate: num(i.productId ? pm.get(i.productId)?.lastPurchasePrice : 0), discount: 0 }));
    }
    const row = e!.suppliers.find((s) => s.supplierId === b.supplierId);
    if (row) await tx.purchaseEnquirySupplier.update({ where: { id: row.id }, data: { responseStatus: 'RESPONDED', responseDate: new Date() } });
    else await tx.purchaseEnquirySupplier.create({ data: { enquiryId: e!.id, supplierId: b.supplierId, responseStatus: 'RESPONDED', responseDate: new Date() } });
    if (e!.status !== 'QUOTED') await tx.purchaseEnquiry.update({ where: { id: e!.id }, data: { status: 'QUOTED' } });
  }
  if (!srcItems?.length) throw badRequest('Quotation needs at least one item');
  const base = await baseCurrency(tx);
  const currencyCode = b.currencyCode ?? supplier.currencyCode ?? base;
  const exchangeRate = await resolveRate(tx, currencyCode, b.exchangeRate, base);
  const items = await buildQItems(tx, supplier.vatCategory, srcItems);
  const t = calcTotals(items, 0);
  const docDate = b.docDate ?? new Date();
  const docNo = await nextNumber(tx, 'SUPPLIER_QUOTATION', { date: docDate });
  const { items: _i, ...h } = b;
  const q = await tx.supplierQuotation.create({
    data: { ...h, docNo, docDate, currencyCode, exchangeRate, subtotal: t.subtotal, discount: t.discount, vatAmount: t.vatAmount, total: t.total, status: 'RECEIVED', createdBy: user.id, items: { create: items } },
  });
  if (b.enquiryId) {
    const e = await tx.purchaseEnquiry.findUnique({ where: { id: b.enquiryId } });
    await linkDocs(tx, { type: 'PURCHASE_ENQUIRY', id: e!.id, no: e!.docNo }, { type: 'SUPPLIER_QUOTATION', id: q.id, no: q.docNo });
  }
  await audit(tx, user, 'CREATE', 'SupplierQuotation', q.id, { docNo, enquiryId: b.enquiryId });
  return q;
}

async function loadQ(id: number) {
  const d = await prisma.supplierQuotation.findUnique({ where: { id }, include: { items: true } });
  if (!d) throw notFound('Quotation not found');
  return d;
}
async function quotationDetail(id: number) {
  const q = await loadQ(id);
  const d: any = await finishDoc(q, 'SUPPLIER_QUOTATION', { supplierId: 'supplier' });
  d.baseTotal = r2(num(q.total) * num(q.exchangeRate));
  d.enquiry = q.enquiryId ? await prisma.purchaseEnquiry.findUnique({ where: { id: q.enquiryId }, select: { id: true, docNo: true, status: true } }) : null;
  return d;
}

const sq = Router();
sq.get('/', can(Q, 'view'), ah(async (req, res) => {
  res.json(await listDocs(req, { model: 'supplierQuotation', search: ['docNo', 'supplierRef', 'remarks'], supplierSearch: true, numeric: ['supplierId', 'enquiryId'], enrich: { supplierId: 'supplier' }, map: (r) => ({ ...r, baseTotal: r2(num(r.total) * num(r.exchangeRate)) }) }));
}));
sq.get('/prefill/:enquiryId', can(Q, 'view'), ah(async (req, res) => {
  const e = await loadE(intParam(req, 'enquiryId'));
  const items: any[] = e.items.map((i) => ({ productId: i.productId, description: i.description, qty: num(i.qty), unit: i.unit, rate: 0, discount: 0 }));
  await enrich(items, { productId: 'product' });
  const sups: any[] = e.suppliers.map((s) => ({ ...s }));
  await enrich(sups, { supplierId: 'supplier' });
  res.json({ enquiryId: e.id, enquiryNo: e.docNo, suppliers: sups, items });
}));
sq.get('/:id', can(Q, 'view'), ah(async (req, res) => res.json(await quotationDetail(intParam(req)))));
sq.post('/', can(Q, 'create'), ah(async (req, res) => {
  const q = await prisma.$transaction((tx) => createQuotation(tx, req.body, req.user!), T);
  res.status(201).json(await quotationDetail(q.id));
}));
sq.put('/:id', can(Q, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(qSchema.partial(), req.body);
  await prisma.$transaction(async (tx) => {
    const cur = assertStatus(await tx.supplierQuotation.findUnique({ where: { id } }), ['RECEIVED'], 'edit') as any;
    const supplier = await tx.supplier.findUnique({ where: { id: b.supplierId ?? cur.supplierId } });
    const { items: srcItems, enquiryId: _e, ...h } = b;
    const data: any = { ...h };
    if (b.currencyCode || b.exchangeRate) {
      const base = await baseCurrency(tx);
      const code = b.currencyCode ?? cur.currencyCode;
      data.currencyCode = code;
      data.exchangeRate = await resolveRate(tx, code, b.exchangeRate ?? (code === cur.currencyCode ? num(cur.exchangeRate) : undefined), base);
    }
    if (srcItems) {
      const items = await buildQItems(tx, supplier!.vatCategory, srcItems);
      const t = calcTotals(items, 0);
      Object.assign(data, { subtotal: t.subtotal, discount: t.discount, vatAmount: t.vatAmount, total: t.total });
      await tx.supplierQuotationItem.deleteMany({ where: { quotationId: id } });
      await tx.supplierQuotationItem.createMany({ data: items.map((i) => ({ ...i, quotationId: id })) });
    }
    await tx.supplierQuotation.update({ where: { id }, data });
    await audit(tx, req.user, 'UPDATE', 'SupplierQuotation', id);
  }, T);
  res.json(await quotationDetail(id));
}));
sq.delete('/:id', can(Q, 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.supplierQuotation.findUnique({ where: { id } }), ['RECEIVED', 'REJECTED', 'EXPIRED'], 'delete');
    await tx.supplierQuotation.delete({ where: { id } });
    await deleteLinks(tx, 'SUPPLIER_QUOTATION', id);
    await audit(tx, req.user, 'DELETE', 'SupplierQuotation', id);
  }, T);
  res.json({ ok: true });
}));
sq.post('/:id/reject', can(Q, 'reject'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.supplierQuotation.findUnique({ where: { id } }), ['RECEIVED', 'SELECTED'], 'reject');
    await tx.supplierQuotation.update({ where: { id }, data: { status: 'REJECTED' } });
    await audit(tx, req.user, 'REJECT', 'SupplierQuotation', id);
  }, T);
  res.json(await quotationDetail(id));
}));
sq.post('/:id/create-order', can('purchase_order', 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const o = parse(z.object({ warehouseId: z.coerce.number().int().nullish(), docDate: z.coerce.date().optional(), expectedDate: z.coerce.date().nullish(), remarks: z.string().nullish() }), req.body ?? {});
  const po = await prisma.$transaction(async (tx) => {
    const q = await tx.supplierQuotation.findUnique({ where: { id }, include: { items: true } });
    if (!q) throw notFound('Quotation not found');
    if (q.status === 'CONVERTED') throw badRequest('Quotation was already converted to a purchase order');
    assertStatus(q, q.enquiryId ? ['SELECTED'] : ['RECEIVED', 'SELECTED'], 'create order (select the quotation in the comparative statement first)');
    if (q.items.some((i) => !i.productId)) throw badRequest('All quotation items must be linked to a product before creating a PO');
    const enquiry = q.enquiryId ? await tx.purchaseEnquiry.findUnique({ where: { id: q.enquiryId } }) : null;
    const created = await createPurchaseOrder(tx, {
      docDate: o.docDate, supplierId: q.supplierId, quotationId: q.id, quotationRef: q.supplierRef ?? q.docNo, warehouseId: o.warehouseId ?? enquiry?.warehouseId ?? null,
      currencyCode: q.currencyCode, exchangeRate: num(q.exchangeRate), paymentTerms: q.paymentTerms, deliveryTerms: q.deliveryTerms,
      expectedDate: o.expectedDate ?? q.expectedDeliveryDate ?? (q.deliveryDays ? new Date(Date.now() + q.deliveryDays * 86400000) : null), remarks: o.remarks ?? q.remarks, roundOff: 0,
      items: q.items.map((i) => ({ productId: i.productId!, description: i.description, qty: num(i.qty), unit: i.unit, rate: num(i.rate), discount: num(i.discount), vatRate: num(i.vatRate) })),
    }, 'LOCAL', req.user!.id);
    await tx.supplierQuotation.update({ where: { id }, data: { status: 'CONVERTED' } });
    if (enquiry && enquiry.status !== 'CLOSED') await tx.purchaseEnquiry.update({ where: { id: enquiry.id }, data: { status: 'CLOSED' } });
    await linkDocs(tx, { type: 'SUPPLIER_QUOTATION', id, no: q.docNo }, { type: 'PURCHASE_ORDER', id: created.id, no: created.docNo });
    await audit(tx, req.user, 'CREATE', 'PurchaseOrder', created.id, { from: q.docNo });
    return created;
  }, T);
  const full = await prisma.purchaseOrder.findUnique({ where: { id: po.id }, include: { items: true } });
  res.status(201).json(await finishDoc(full, 'PURCHASE_ORDER'));
}));

// ================================================================== COMPARATIVE STATEMENT
const cs = Router();
const C = 'comparative_statement';
const keyOf = (i: { productId: number | null; description: string | null }, idx: number) => (i.productId ? `p${i.productId}` : `d${i.description ?? idx}`);

cs.get('/:enquiryId', can(C, 'view'), ah(async (req, res) => {
  const enquiryId = intParam(req, 'enquiryId');
  const e = await loadE(enquiryId);
  const base = await baseCurrency();
  const quotes = await prisma.supplierQuotation.findMany({ where: { enquiryId }, include: { items: true }, orderBy: { id: 'asc' } });
  const eligible = (s: string) => ['RECEIVED', 'SELECTED', 'CONVERTED'].includes(s);
  const rows: any[] = e.items.map((it) => ({ enquiryItemId: it.id, productId: it.productId, description: it.description, qty: num(it.qty), unit: it.unit, cells: [] as any[] }));
  const keys = e.items.map((i, idx) => keyOf(i, idx));
  const qHeads: any[] = [];
  for (const q of quotes) {
    const rate = num(q.exchangeRate);
    const used = new Set<number>();
    let covered = 0;
    rows.forEach((row, ri) => {
      const idx = q.items.findIndex((qi, k) => !used.has(k) && keyOf(qi, k) === keys[ri]);
      if (idx < 0) { row.cells.push({ quotationId: q.id, supplierId: q.supplierId, available: false }); return; }
      used.add(idx);
      covered++;
      const qi = q.items[idx];
      const qty = num(qi.qty);
      const net = r2(qty * num(qi.rate) - num(qi.discount));
      row.cells.push({
        quotationId: q.id, supplierId: q.supplierId, available: true, quotedQty: qty, unitPrice: num(qi.rate), discount: num(qi.discount), vatRate: num(qi.vatRate), vatAmount: num(qi.vatAmount),
        lineNet: net, lineTotal: num(qi.amount), baseNetUnit: qty ? r4((net / qty) * rate) : 0, baseLineTotal: r2(num(qi.amount) * rate), eligible: eligible(q.status), cheapest: false,
      });
    });
    qHeads.push({
      quotationId: q.id, docNo: q.docNo, supplierId: q.supplierId, supplierRef: q.supplierRef, status: q.status, currencyCode: q.currencyCode, exchangeRate: rate, paymentTerms: q.paymentTerms, deliveryTerms: q.deliveryTerms,
      deliveryDays: q.deliveryDays, expectedDeliveryDate: q.expectedDeliveryDate, validUntil: q.validUntil, subtotal: num(q.subtotal), discount: num(q.discount), vatAmount: num(q.vatAmount), total: num(q.total),
      baseTotal: r2(num(q.total) * rate), baseCurrency: base, coveredLines: covered, missingLines: rows.length - covered, complete: covered === rows.length, cheapestTotal: false, eligible: eligible(q.status),
    });
  }
  for (const row of rows) {
    const c = row.cells.filter((x: any) => x.available && x.eligible);
    if (c.length) { const m = Math.min(...c.map((x: any) => x.baseNetUnit)); for (const x of c) x.cheapest = x.baseNetUnit === m; }
  }
  const cand = qHeads.filter((h) => h.eligible && h.complete);
  const pool = cand.length ? cand : qHeads.filter((h) => h.eligible);
  if (pool.length) { const m = Math.min(...pool.map((h) => h.baseTotal)); for (const h of pool) h.cheapestTotal = h.baseTotal === m; }
  await enrich(rows, { productId: 'product' });
  await enrich(qHeads, { supplierId: 'supplier' });
  res.json({
    enquiry: { id: e.id, docNo: e.docNo, docDate: e.docDate, status: e.status, requiredDate: e.requiredDate, warehouseId: e.warehouseId },
    baseCurrency: base, items: rows, quotations: qHeads,
    selectedQuotationId: quotes.find((q) => q.status === 'SELECTED' || q.status === 'CONVERTED')?.id ?? null,
  });
}));

cs.post('/:enquiryId/select', can(C, 'approve'), ah(async (req, res) => {
  const enquiryId = intParam(req, 'enquiryId');
  const { quotationId, remarks } = parse(z.object({ quotationId: z.coerce.number().int(), remarks: z.string().nullish() }), req.body);
  await prisma.$transaction(async (tx) => {
    const e = assertStatus(await tx.purchaseEnquiry.findUnique({ where: { id: enquiryId } }), ['SENT', 'QUOTED', 'CLOSED'], 'select quotation');
    void e;
    const q = await tx.supplierQuotation.findUnique({ where: { id: quotationId } });
    if (!q || q.enquiryId !== enquiryId) throw badRequest('Quotation does not belong to this enquiry');
    if (await tx.supplierQuotation.findFirst({ where: { enquiryId, status: 'CONVERTED' } })) throw badRequest('A quotation of this enquiry is already converted to a PO');
    if (q.status === 'EXPIRED') throw badRequest('Quotation is expired');
    await tx.supplierQuotation.updateMany({ where: { enquiryId, id: { not: quotationId }, status: { in: ['RECEIVED', 'SELECTED'] } }, data: { status: 'REJECTED' } });
    await tx.supplierQuotation.update({ where: { id: quotationId }, data: { status: 'SELECTED', remarks: remarks ? `${q.remarks ?? ''}\n[Selected] ${remarks}`.trim() : undefined } });
    await audit(tx, req.user, 'SELECT', 'SupplierQuotation', quotationId, { enquiryId, remarks });
  }, T);
  res.json({ ok: true, selectedQuotationId: quotationId });
}));

export default [
  { path: '/purchase-enquiries', router: eq },
  { path: '/supplier-quotations', router: sq },
  { path: '/comparative-statements', router: cs },
] as ModuleDef[];
