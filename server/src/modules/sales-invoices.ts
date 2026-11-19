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
import { postJournal, reverseJournal } from '../services/accounting';
import {
  buildListWhere, mustFound, mustStatus, approvalFor, docLinks, refreshOrderStatus, boolSetting, resolveTerm, addDays, num, r2, r3, r4, calcLine, calcTotals,
} from '../services/sales-common';
import type { ModuleDef } from '../app';

const router = Router();

/* =====================================================================
 * BILLING MODEL (duplicate-billing prevention)
 *  - SalesOrderItem.invoicedQty  = total qty billed on any non-cancelled invoice (draft or posted) for that order line.
 *  - DeliveryNoteItem.invoicedQty = qty of that delivery line that is already billed.
 *  - Both counters are bumped when the invoice is CREATED (even as DRAFT) and rolled back when a draft is deleted/cancelled
 *    or a posted invoice is cancelled, so the same quantity can never appear on two live invoices.
 *  - sales.invoiceBeforeDelivery=false (default): only delivered-and-unbilled qty can be invoiced.
 *  - sales.invoiceBeforeDelivery=true: an order (or its proforma) may be invoiced up to ordered qty before delivery.
 *    Those "billed-ahead" rows have no deliveryItemId and cost at product average cost at invoice time. When the goods are
 *    delivered later, the delivery note post marks the DN line as already invoiced (up to the billed-ahead qty) so it can
 *    not be billed (or its COGS booked) a second time.
 * ===================================================================== */

interface Row { orderItemId: number; deliveryItemId: number | null; productId: number; qty: number; unitCost: number }

const LIVE_ORDER = ['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CLOSED'];

async function rowsFromOrder(tx: Tx, orderId: number, override: Map<number, number> | null, allowPre: boolean): Promise<Row[]> {
  const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: { orderBy: { id: 'asc' } } } });
  const dnItems = await tx.deliveryNoteItem.findMany({ where: { orderItemId: { in: so.items.map((i) => i.id) }, delivery: { status: 'POSTED' } }, orderBy: { id: 'asc' } });
  const rows: Row[] = [];
  const codes = new Map((await tx.product.findMany({ where: { id: { in: so.items.map((i) => i.productId) } }, select: { id: true, code: true } })).map((p) => [p.id, p.code]));
  for (const it of so.items) {
    const allowance = Math.max(0, r3((allowPre ? num(it.qty) : num(it.deliveredQty)) - num(it.invoicedQty)));
    const want = override ? override.get(it.id) ?? 0 : allowance;
    if (want > allowance + 0.0005) {
      throw badRequest(`Cannot invoice ${want} of ${codes.get(it.productId)}: only ${allowance} can be billed (ordered ${num(it.qty)}, delivered ${num(it.deliveredQty)}, already invoiced ${num(it.invoicedQty)})`);
    }
    if (want <= 0) continue;
    let left = want;
    for (const dn of dnItems.filter((d) => d.orderItemId === it.id)) {
      const take = Math.min(left, num(dn.qty) - num(dn.invoicedQty));
      if (take > 0.0005) {
        rows.push({ orderItemId: it.id, deliveryItemId: dn.id, productId: it.productId, qty: r3(take), unitCost: num(dn.unitCost) });
        dn.invoicedQty = (num(dn.invoicedQty) + take) as never; // local running balance so a line is not allocated twice
        left = r3(left - take);
      }
    }
    if (left > 0.0005) {
      if (!allowPre) throw badRequest(`Cannot invoice ${codes.get(it.productId)}: ${left} not covered by delivered stock`);
      rows.push({ orderItemId: it.id, deliveryItemId: null, productId: it.productId, qty: left, unitCost: 0 });
    }
  }
  return rows;
}

async function persistInvoice(
  tx: Tx, req: Request, orderId: number, rows: Row[],
  ctx: { deliveryId?: number | null; proformaId?: number | null; docDate?: Date; roundOff?: number; remarks?: string | null; paymentTerms?: string | null; dueDate?: Date | null },
) {
  if (!rows.length) throw badRequest('Nothing to invoice: all delivered quantity is already billed');
  const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  if (!LIVE_ORDER.includes(so.status)) throw badRequest(`Cannot invoice: sales order ${so.docNo} is ${so.status}`);
  const cust = await tx.customer.findUniqueOrThrow({ where: { id: so.customerId } });
  const soItems = new Map(so.items.map((i) => [i.id, i]));
  const prods = new Map((await tx.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } } })).map((p) => [p.id, p]));
  const lines = rows.map((r) => {
    const si = soItems.get(r.orderItemId)!;
    const discount = r2((num(si.discount) * r.qty) / num(si.qty));
    const c = calcLine({ qty: r.qty, rate: si.rate, discount, vatRate: si.vatRate });
    return {
      orderItemId: r.orderItemId, deliveryItemId: r.deliveryItemId, productId: r.productId, oemNumber: si.oemNumber ?? prods.get(r.productId)?.oemNumber ?? null,
      description: si.description, qty: r.qty, unit: si.unit, rate: num(si.rate), discount, vatRate: num(si.vatRate), vatAmount: c.vatAmount, amount: c.amount, unitCost: r.unitCost,
    };
  });
  const totals = calcTotals(lines, ctx.roundOff ?? 0);
  const docDate = ctx.docDate ?? new Date();
  const termText = ctx.paymentTerms ?? so.paymentTerms;
  const term = await resolveTerm(tx, termText, cust.paymentTermId);
  const rate = num(so.exchangeRate) || 1;
  const docNo = await nextNumber(tx, 'SALES_INVOICE', { date: docDate });
  const inv = await tx.salesInvoice.create({
    data: {
      docNo, docDate, dueDate: ctx.dueDate ?? addDays(docDate, term.days), customerId: so.customerId, salesmanId: so.salesmanId, salesOrderId: so.id,
      deliveryId: ctx.deliveryId ?? null, proformaId: ctx.proformaId ?? null, trn: cust.trn, address: [cust.address, cust.city, cust.country].filter(Boolean).join(', ') || null,
      currencyCode: so.currencyCode, exchangeRate: rate, paymentTerms: term.name, subtotal: totals.subtotal, discount: totals.discount, vatAmount: totals.vatAmount,
      roundOff: totals.roundOff, total: totals.total, baseTotal: r2(totals.total * rate), remarks: ctx.remarks ?? null, createdBy: req.user?.id, items: { create: lines },
    },
  });
  // bump billing counters
  const perSo = new Map<number, number>();
  const dnTouched = new Set<number>();
  for (const r of rows) {
    perSo.set(r.orderItemId, (perSo.get(r.orderItemId) ?? 0) + r.qty);
    if (r.deliveryItemId) {
      const d = await tx.deliveryNoteItem.update({ where: { id: r.deliveryItemId }, data: { invoicedQty: { increment: r.qty } } });
      if (num(d.invoicedQty) > num(d.qty) + 0.0005) throw badRequest('Delivery line would be over-invoiced');
      dnTouched.add(d.deliveryId);
    }
  }
  for (const [id, q] of perSo) {
    const u = await tx.salesOrderItem.update({ where: { id }, data: { invoicedQty: { increment: q } } });
    if (num(u.invoicedQty) > num(u.qty) + 0.0005) throw badRequest(`Order line ${id} would be over-invoiced (${num(u.invoicedQty)} of ${num(u.qty)})`);
  }
  for (const id of dnTouched) await syncDnInvoiced(tx, id);
  await refreshOrderStatus(tx, so.id);
  await linkDocs(tx, { type: 'SALES_ORDER', id: so.id, no: so.docNo }, { type: 'SALES_INVOICE', id: inv.id, no: inv.docNo });
  await audit(tx, req.user, 'CREATE', 'SalesInvoice', inv.id, { docNo, order: so.docNo, total: totals.total });
  return inv;
}

async function syncDnInvoiced(tx: Tx, dnId: number) {
  const items = await tx.deliveryNoteItem.findMany({ where: { deliveryId: dnId } });
  await tx.deliveryNote.update({ where: { id: dnId }, data: { invoiced: items.length > 0 && items.every((i) => num(i.invoicedQty) >= num(i.qty) - 0.0005) } });
}

/** After SO invoicedQty dropped, DN lines that were marked billed-ahead may exceed it: pull them back (LIFO). */
async function reconcileOrderItem(tx: Tx, orderItemId: number) {
  const si = await tx.salesOrderItem.findUnique({ where: { id: orderItemId } });
  if (!si) return;
  const dns = await tx.deliveryNoteItem.findMany({ where: { orderItemId }, orderBy: { id: 'desc' } });
  let excess = r3(dns.reduce((s, d) => s + num(d.invoicedQty), 0) - num(si.invoicedQty));
  for (const d of dns) {
    if (excess <= 0.0005) break;
    const cut = Math.min(excess, num(d.invoicedQty));
    if (cut > 0) {
      await tx.deliveryNoteItem.update({ where: { id: d.id }, data: { invoicedQty: r3(num(d.invoicedQty) - cut) } });
      await syncDnInvoiced(tx, d.deliveryId);
      excess = r3(excess - cut);
    }
  }
}

/** Gives the billed quantity of invoice item rows back (delete / cancel). */
async function unbill(tx: Tx, items: { orderItemId: number | null; deliveryItemId: number | null; qty: unknown }[], orderId: number | null) {
  const soTouched = new Set<number>();
  const dnTouched = new Set<number>();
  for (const it of items) {
    const q = num(it.qty);
    if (it.deliveryItemId) {
      const d = await tx.deliveryNoteItem.findUnique({ where: { id: it.deliveryItemId } });
      if (d) {
        await tx.deliveryNoteItem.update({ where: { id: d.id }, data: { invoicedQty: Math.max(0, r3(num(d.invoicedQty) - q)) } });
        dnTouched.add(d.deliveryId);
      }
    }
    if (it.orderItemId) {
      const s = await tx.salesOrderItem.findUnique({ where: { id: it.orderItemId } });
      if (s) await tx.salesOrderItem.update({ where: { id: s.id }, data: { invoicedQty: Math.max(0, r3(num(s.invoicedQty) - q)) } });
      soTouched.add(it.orderItemId);
    }
  }
  for (const id of soTouched) await reconcileOrderItem(tx, id);
  for (const id of dnTouched) await syncDnInvoiced(tx, id);
  if (orderId) await refreshOrderStatus(tx, orderId);
}

/* ---------------- detail / list ---------------- */
function money(inv: { baseTotal: unknown; receivedAmount: unknown; status: string; dueDate: Date | null }) {
  const outstanding = ['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(inv.status) ? Math.max(0, r2(num(inv.baseTotal) - num(inv.receivedAmount))) : 0;
  const overdue = outstanding > 0.005 && inv.dueDate !== null && inv.dueDate < new Date(new Date().setHours(0, 0, 0, 0));
  return { outstanding, overdue, overdueDays: overdue ? Math.floor((Date.now() - inv.dueDate!.getTime()) / 86400000) : 0 };
}

async function detail(id: number) {
  const inv = mustFound(await prisma.salesInvoice.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } }), 'Sales invoice');
  const [row] = await enrich([inv as unknown as Record<string, unknown>], { customerId: 'customer', salesmanId: 'salesman' });
  const items = await enrich(inv.items as unknown as Record<string, unknown>[], { productId: 'product' });
  const so = inv.salesOrderId ? await prisma.salesOrder.findUnique({ where: { id: inv.salesOrderId }, select: { id: true, docNo: true, customerPoNo: true } }) : null;
  const dn = inv.deliveryId ? await prisma.deliveryNote.findUnique({ where: { id: inv.deliveryId }, select: { id: true, docNo: true } }) : null;
  const journals = await prisma.journalEntry.findMany({ where: { sourceType: 'SALES_INVOICE', sourceId: id }, select: { id: true, entryNo: true, narration: true, status: true, totalDebit: true } });
  const returned = await prisma.salesReturnItem.findMany({ where: { invoiceItemId: { in: inv.items.map((i) => i.id) }, return: { status: { not: 'CANCELLED' } } } });
  const retMap = new Map<number, number>();
  for (const r of returned) retMap.set(r.invoiceItemId!, (retMap.get(r.invoiceItemId!) ?? 0) + num(r.qty));
  for (const it of items) {
    it.returnedQty = retMap.get(it.id as number) ?? 0;
    it.returnableQty = r3(num(it.qty) - (retMap.get(it.id as number) ?? 0));
  }
  return {
    ...row, items, salesOrder: so, delivery: dn, journals, ...money(inv), vatBase: r2(num(inv.vatAmount) * num(inv.exchangeRate)),
    links: await docLinks('SALES_INVOICE', id), approval: await approvalFor('SALES_INVOICE', id),
  };
}

router.get('/', can('sales_invoice', 'view'), ah(async (req, res) => {
  const { q, where, orderBy } = await buildListWhere(req);
  const w = where as Record<string, unknown>;
  if (req.query.overdue === 'true') {
    w.status = { in: ['POSTED', 'PARTIALLY_PAID'] };
    w.dueDate = { lt: new Date(new Date().setHours(0, 0, 0, 0)) };
  }
  const [rows, total] = await Promise.all([
    prisma.salesInvoice.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.salesInvoice.count({ where }),
  ]);
  const out = rows.map((r) => ({ ...r, ...money(r) }));
  await enrich(out as unknown as Record<string, unknown>[], { customerId: 'customer', salesmanId: 'salesman' });
  res.json(paged(out, total, q));
}));

// open (unpaid) invoices of a customer: used by receipt allocation
router.get('/outstanding', can('sales_invoice', 'view'), ah(async (req, res) => {
  const where: Record<string, unknown> = { status: { in: ['POSTED', 'PARTIALLY_PAID'] } };
  if (req.query.customerId) where.customerId = Number(req.query.customerId);
  const rows = await prisma.salesInvoice.findMany({ where, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], take: 1000 });
  const out = rows
    .map((r) => ({
      id: r.id, docNo: r.docNo, docDate: r.docDate, dueDate: r.dueDate, customerId: r.customerId, currencyCode: r.currencyCode, exchangeRate: r.exchangeRate,
      total: r.total, baseTotal: r.baseTotal, receivedAmount: r.receivedAmount, status: r.status, ...money(r),
    }))
    .filter((r) => r.outstanding > 0.005);
  await enrich(out as unknown as Record<string, unknown>[], { customerId: 'customer' });
  res.json(out);
}));

router.get('/:id', can('sales_invoice', 'view'), ah(async (req, res) => res.json(await detail(intParam(req)))));

// print-friendly document: invoice + company master + bank details (SystemSetting keys bank.*)
router.get('/:id/print', can('sales_invoice', 'print'), ah(async (req, res) => {
  const d = (await detail(intParam(req))) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const company = await prisma.company.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } });
  const settings = await prisma.systemSetting.findMany({ where: { OR: [{ key: { startsWith: 'bank.' } }, { key: { startsWith: 'company.' } }, { key: 'invoice.footer' }, { key: 'invoice.terms' }] } });
  const cfg = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const base = r2(num(d.total) * num(d.exchangeRate));
  res.json({
    invoice: d, company, bank: { name: cfg['bank.name'] ?? null, accountName: cfg['bank.accountName'] ?? company?.name ?? null, accountNo: cfg['bank.accountNo'] ?? null, iban: cfg['bank.iban'] ?? null, swift: cfg['bank.swift'] ?? null, branch: cfg['bank.branch'] ?? null },
    footer: cfg['invoice.footer'] ?? null, terms: cfg['invoice.terms'] ?? null, settings: cfg,
    taxSummary: { taxableAmount: r2(num(d.subtotal) - num(d.discount)), vatAmount: d.vatAmount, total: d.total, baseTotal: base },
    title: 'TAX INVOICE',
  });
}));

/* ---------------- creation from sources ---------------- */
const createSchema = z.object({
  docDate: z.coerce.date().optional(),
  roundOff: z.coerce.number().optional(),
  remarks: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  items: z.array(z.object({ id: z.coerce.number().int().optional(), orderItemId: z.coerce.number().int().optional(), deliveryItemId: z.coerce.number().int().optional(), qty: z.coerce.number().positive() })).optional(),
});

const fromOrder = Router();
fromOrder.post('/:id/create-invoice', can('sales_invoice', 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(createSchema, req.body ?? {});
  const invId = await prisma.$transaction(async (tx) => {
    const so = mustFound(await tx.salesOrder.findUnique({ where: { id } }), 'Sales order');
    mustStatus(so, LIVE_ORDER, 'create invoice');
    const allowPre = await boolSetting('sales.invoiceBeforeDelivery', false, tx);
    const override = b.items?.length ? new Map(b.items.map((i) => [i.orderItemId ?? i.id!, i.qty])) : null;
    const rows = await rowsFromOrder(tx, id, override, allowPre);
    if (!rows.length && !allowPre) throw badRequest('Nothing delivered-and-not-invoiced on this order. (To bill before delivery enable the setting sales.invoiceBeforeDelivery.)');
    return (await persistInvoice(tx, req, id, rows, b)).id;
  }, { timeout: 30000 });
  res.status(201).json(await detail(invId));
}));

const fromDelivery = Router();
fromDelivery.post('/:id/create-invoice', can('sales_invoice', 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(createSchema, req.body ?? {});
  const invId = await prisma.$transaction(async (tx) => {
    const dn = mustFound(await tx.deliveryNote.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } }), 'Delivery note');
    mustStatus(dn, ['POSTED'], 'create invoice (delivery note must be posted)');
    const so = await tx.salesOrderItem.findMany({ where: { orderId: dn.salesOrderId } });
    const soMap = new Map(so.map((i) => [i.id, i]));
    const want = new Map<number, number>();
    if (b.items?.length) for (const i of b.items) want.set(i.deliveryItemId ?? i.id!, i.qty);
    const rows: Row[] = [];
    for (const it of dn.items) {
      const unbilled = r3(num(it.qty) - num(it.invoicedQty));
      const w = b.items?.length ? want.get(it.id) ?? 0 : unbilled;
      if (w > unbilled + 0.0005) throw badRequest(`Cannot invoice ${w} of delivery line ${it.id}: only ${unbilled} not yet invoiced`);
      if (w <= 0) continue;
      const si = soMap.get(it.orderItemId)!;
      if (w > num(si.qty) - num(si.invoicedQty) + 0.0005) throw badRequest(`Order line ${si.id} is already invoiced (${num(si.invoicedQty)} of ${num(si.qty)})`);
      rows.push({ orderItemId: it.orderItemId, deliveryItemId: it.id, productId: it.productId, qty: w, unitCost: num(it.unitCost) });
    }
    if (!rows.length) throw badRequest('Delivery note is already fully invoiced');
    const inv = await persistInvoice(tx, req, dn.salesOrderId, rows, { ...b, deliveryId: dn.id });
    await linkDocs(tx, { type: 'DELIVERY_NOTE', id: dn.id, no: dn.docNo }, { type: 'SALES_INVOICE', id: inv.id, no: inv.docNo });
    return inv.id;
  }, { timeout: 30000 });
  res.status(201).json(await detail(invId));
}));

const fromProforma = Router();
fromProforma.post('/:id/create-invoice', can('sales_invoice', 'create'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(createSchema, req.body ?? {});
  const invId = await prisma.$transaction(async (tx) => {
    const p = mustFound(await tx.proformaInvoice.findUnique({ where: { id } }), 'Proforma invoice');
    mustStatus(p, ['ISSUED', 'CONVERTED'], 'create invoice');
    if (!(await boolSetting('sales.invoiceBeforeDelivery', false, tx))) {
      throw badRequest('Invoicing a proforma before delivery is disabled (setting sales.invoiceBeforeDelivery). Create the sales order, deliver, then invoice the delivery.');
    }
    const dup = await tx.salesInvoice.findFirst({ where: { proformaId: id, status: { not: 'CANCELLED' } } });
    if (dup) throw conflict(`Proforma already invoiced on ${dup.docNo}`);
    if (!p.salesOrderId) throw badRequest('Convert the proforma to a sales order first so that stock can be reserved/delivered, then invoice');
    const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: p.salesOrderId } });
    mustStatus(so, LIVE_ORDER, `create invoice (sales order ${so.docNo} must be approved)`);
    const rows = await rowsFromOrder(tx, so.id, null, true);
    const inv = await persistInvoice(tx, req, so.id, rows, { ...b, proformaId: p.id });
    await tx.proformaInvoice.update({ where: { id }, data: { status: 'INVOICED' } });
    await linkDocs(tx, { type: 'PROFORMA_INVOICE', id: p.id, no: p.docNo }, { type: 'SALES_INVOICE', id: inv.id, no: inv.docNo });
    return inv.id;
  }, { timeout: 30000 });
  res.status(201).json(await detail(invId));
}));

/* ---------------- edit (DRAFT): header + per-line rate/discount/vat/qty (qty may only go down) ---------------- */
const editSchema = z.object({
  docDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  roundOff: z.coerce.number().optional(),
  remarks: z.string().optional().nullable(),
  items: z.array(z.object({ id: z.coerce.number().int(), qty: z.coerce.number().min(0).optional(), rate: z.coerce.number().min(0).optional(), discount: z.coerce.number().min(0).optional(), vatRate: z.coerce.number().min(0).optional() })).optional(),
});
router.put('/:id', can('sales_invoice', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(editSchema, req.body);
  await prisma.$transaction(async (tx) => {
    const revisionBefore = await revisionSnapshot(tx, 'SalesInvoice', id);
    const inv = mustFound(await tx.salesInvoice.findUnique({ where: { id }, include: { items: true } }), 'Sales invoice');
    mustStatus(inv, ['DRAFT'], 'edit');
    const edits = new Map((b.items ?? []).map((e) => [e.id, e]));
    const keep: typeof inv.items = [];
    const released: typeof inv.items = [];
    for (const it of inv.items) {
      const e = edits.get(it.id);
      let qty = num(it.qty);
      if (e?.qty !== undefined) {
        if (e.qty > qty + 0.0005) throw badRequest('Invoice quantity can only be reduced; create another invoice for more');
        if (e.qty < qty - 0.0005) {
          released.push({ ...it, qty: r3(qty - e.qty) as never });
          qty = e.qty;
        }
      }
      if (qty <= 0) {
        await tx.salesInvoiceItem.delete({ where: { id: it.id } });
        continue;
      }
      const rate = e?.rate ?? num(it.rate);
      const vatRate = e?.vatRate ?? num(it.vatRate);
      const discount = e?.discount ?? (qty !== num(it.qty) ? r2((num(it.discount) * qty) / num(it.qty)) : num(it.discount));
      const c = calcLine({ qty, rate, discount, vatRate });
      const upd = await tx.salesInvoiceItem.update({ where: { id: it.id }, data: { qty, rate, discount, vatRate, vatAmount: c.vatAmount, amount: c.amount } });
      keep.push(upd);
    }
    if (!keep.length) throw badRequest('An invoice must keep at least one line; cancel it instead');
    if (released.length) await unbill(tx, released, inv.salesOrderId);
    const totals = calcTotals(keep, b.roundOff ?? num(inv.roundOff));
    const docDate = b.docDate ?? inv.docDate;
    let dueDate = b.dueDate ?? inv.dueDate;
    let paymentTerms = inv.paymentTerms;
    if (b.paymentTerms !== undefined || b.docDate) {
      const cust = await tx.customer.findUniqueOrThrow({ where: { id: inv.customerId } });
      const term = await resolveTerm(tx, b.paymentTerms ?? inv.paymentTerms, cust.paymentTermId);
      paymentTerms = term.name;
      if (!b.dueDate) dueDate = addDays(docDate, term.days);
    }
    await tx.salesInvoice.update({
      where: { id },
      data: {
        docDate, dueDate, paymentTerms, remarks: b.remarks !== undefined ? b.remarks : inv.remarks, subtotal: totals.subtotal, discount: totals.discount, vatAmount: totals.vatAmount,
        roundOff: totals.roundOff, total: totals.total, baseTotal: r2(totals.total * num(inv.exchangeRate)),
      },
    });
    await auditRevision(tx, req.user, 'SalesInvoice', id, revisionBefore, req.body?.changeReason);
    await audit(tx, req.user, 'UPDATE', 'SalesInvoice', id);
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

router.delete('/:id', can('sales_invoice', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const inv = mustFound(await tx.salesInvoice.findUnique({ where: { id }, include: { items: true } }), 'Sales invoice');
    mustStatus(inv, ['DRAFT'], 'delete');
    await unbill(tx, inv.items, inv.salesOrderId);
    await restoreProforma(tx, inv.proformaId);
    await tx.documentLink.deleteMany({ where: { toType: 'SALES_INVOICE', toId: id } });
    await tx.salesInvoice.delete({ where: { id } });
    await audit(tx, req.user, 'DELETE', 'SalesInvoice', id, { docNo: inv.docNo });
  }, { timeout: 30000 });
  res.json({ ok: true });
}));

async function restoreProforma(tx: Tx, proformaId: number | null) {
  if (!proformaId) return;
  const p = await tx.proformaInvoice.findUnique({ where: { id: proformaId } });
  if (p && p.status === 'INVOICED') await tx.proformaInvoice.update({ where: { id: p.id }, data: { status: p.salesOrderId ? 'CONVERTED' : 'ISSUED' } });
}

/* ---------------- POST: Dr AR / Cr Sales / Cr Output VAT  +  Dr COGS / Cr Inventory ---------------- */
router.post('/:id/post', can('sales_invoice', 'post'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const inv = mustFound(await tx.salesInvoice.findUnique({ where: { id }, include: { items: true } }), 'Sales invoice');
    mustStatus(inv, ['DRAFT'], 'post');
    const rate = num(inv.exchangeRate) || 1;
    const baseTotal = r2(num(inv.total) * rate);
    const salesBase = r2((num(inv.subtotal) - num(inv.discount)) * rate);
    const vatBase = r2(num(inv.vatAmount) * rate);
    const diff = r2(baseTotal - salesBase - vatBase);
    // COGS: delivery unit cost, or product average cost for lines billed without a delivery
    const prods = new Map((await tx.product.findMany({ where: { id: { in: inv.items.map((i) => i.productId) } } })).map((p) => [p.id, p]));
    let cogs = 0;
    for (const it of inv.items) {
      let uc = num(it.unitCost);
      if (!it.deliveryItemId || uc <= 0) {
        uc = num(prods.get(it.productId)?.averageCost);
        await tx.salesInvoiceItem.update({ where: { id: it.id }, data: { unitCost: r4(uc) } });
      }
      cogs += num(it.qty) * uc;
    }
    cogs = r2(cogs);
    const j = await postJournal(tx, {
      date: inv.docDate, entryType: 'AUTO', sourceType: 'SALES_INVOICE', sourceId: inv.id, sourceNo: inv.docNo, userId: req.user?.id, narration: `Sales invoice ${inv.docNo}`,
      lines: [
        { accountKey: 'AR', debit: baseTotal, partyType: 'CUSTOMER', partyId: inv.customerId, description: `Invoice ${inv.docNo}` },
        { accountKey: 'SALES', credit: salesBase, description: `Sales ${inv.docNo}` },
        { accountKey: 'VAT_OUTPUT', credit: vatBase, vatAmount: vatBase, description: `Output VAT ${inv.docNo}` },
        ...(diff > 0 ? [{ accountKey: 'ROUND_OFF', credit: diff, description: 'Round off' }] : diff < 0 ? [{ accountKey: 'ROUND_OFF', debit: -diff, description: 'Round off' }] : []),
      ],
    });
    if (cogs > 0) {
      await postJournal(tx, {
        date: inv.docDate, entryType: 'AUTO', sourceType: 'SALES_INVOICE', sourceId: inv.id, sourceNo: inv.docNo, userId: req.user?.id, narration: `COGS ${inv.docNo}`,
        lines: [
          { accountKey: 'COGS', debit: cogs, description: `COGS ${inv.docNo}` },
          { accountKey: 'INVENTORY', credit: cogs, description: `COGS ${inv.docNo}` },
        ],
      });
    }
    await tx.salesInvoice.update({ where: { id }, data: { status: 'POSTED', baseTotal, cogs, journalId: j.id } });
    await audit(tx, req.user, 'POST', 'SalesInvoice', id, { docNo: inv.docNo, baseTotal, cogs });
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

router.post('/:id/cancel', can('sales_invoice', 'cancel'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const inv = mustFound(await tx.salesInvoice.findUnique({ where: { id }, include: { items: true } }), 'Sales invoice');
    mustStatus(inv, ['DRAFT', 'POSTED'], 'cancel (only unpaid invoices can be cancelled)');
    if (inv.status === 'POSTED') {
      if (num(inv.receivedAmount) > 0.005) throw badRequest(`Invoice has received/credited amount ${num(inv.receivedAmount)}; cancel the receipts / credit notes first`);
      const alloc = await tx.voucherAllocation.count({ where: { docType: 'SALES_INVOICE', docId: id, voucher: { status: { not: 'CANCELLED' } } } });
      if (alloc) throw badRequest('Invoice has receipt allocations; cancel the receipts first');
      const ret = await tx.salesReturn.count({ where: { invoiceId: id, status: { not: 'CANCELLED' } } });
      if (ret) throw badRequest('Invoice has sales returns; it cannot be cancelled');
      const js = await tx.journalEntry.findMany({ where: { sourceType: 'SALES_INVOICE', sourceId: id, status: 'POSTED' } });
      for (const j of js) await reverseJournal(tx, j.id, req.user?.id);
    }
    await unbill(tx, inv.items, inv.salesOrderId);
    await restoreProforma(tx, inv.proformaId);
    await tx.salesInvoice.update({ where: { id }, data: { status: 'CANCELLED' } });
    await audit(tx, req.user, 'CANCEL', 'SalesInvoice', id, { from: inv.status });
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

export default [
  { path: '/sales-invoices', router },
  { path: '/sales-orders', router: fromOrder },
  { path: '/delivery-notes', router: fromDelivery },
  { path: '/proforma-invoices', router: fromProforma },
] satisfies ModuleDef[];
