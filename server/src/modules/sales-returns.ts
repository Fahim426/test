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
import { postStock } from '../services/stock';
import { postJournal } from '../services/accounting';
import { buildListWhere, mustFound, mustStatus, approvalFor, docLinks, num, r2, r3, r4 } from '../services/sales-common';
import type { ModuleDef } from '../app';

const router = Router();

const POSTED_INV = ['POSTED', 'PARTIALLY_PAID', 'PAID'];

const bodySchema = z.object({
  invoiceId: z.coerce.number().int().optional(),
  docDate: z.coerce.date().optional(),
  warehouseId: z.coerce.number().int().optional().nullable(),
  reason: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  items: z.array(z.object({ invoiceItemId: z.coerce.number().int(), qty: z.coerce.number().positive() })).optional(),
});
type Body = z.infer<typeof bodySchema>;

/** returnable qty per invoice item = invoiced - qty on other non-cancelled returns */
async function returnable(tx: Tx | typeof prisma, invoiceId: number, exceptReturnId?: number) {
  const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { items: { orderBy: { id: 'asc' } } } });
  const used = await tx.salesReturnItem.findMany({ where: { invoiceItemId: { in: inv.items.map((i) => i.id) }, return: { status: { not: 'CANCELLED' }, ...(exceptReturnId ? { id: { not: exceptReturnId } } : {}) } } });
  const u = new Map<number, number>();
  for (const x of used) u.set(x.invoiceItemId!, (u.get(x.invoiceItemId!) ?? 0) + num(x.qty));
  const map = new Map<number, number>();
  for (const it of inv.items) map.set(it.id, Math.max(0, r3(num(it.qty) - (u.get(it.id) ?? 0))));
  return { inv, map };
}

/** net (excl. VAT) of `qty` units of an invoice line, proportional to the invoiced net */
function lineNet(it: { qty: unknown; rate: unknown; discount: unknown }, qty: number) {
  const invNet = num(it.qty) * num(it.rate) - num(it.discount);
  return r2((invNet * qty) / num(it.qty));
}

async function buildLines(tx: Tx, invoiceId: number, want: Map<number, number> | null, exceptReturnId?: number) {
  const { inv, map } = await returnable(tx, invoiceId, exceptReturnId);
  mustStatus(inv, POSTED_INV, 'return goods (invoice must be posted)');
  const itemMap = new Map(inv.items.map((i) => [i.id, i]));
  const codes = new Map((await tx.product.findMany({ where: { id: { in: inv.items.map((i) => i.productId) } }, select: { id: true, code: true } })).map((p) => [p.id, p.code]));
  const src = want ?? new Map([...map].filter(([, v]) => v > 0));
  const lines = [];
  for (const [itemId, qty] of src) {
    const it = itemMap.get(itemId);
    if (!it) throw badRequest(`Invoice item ${itemId} does not belong to ${inv.docNo}`);
    const max = map.get(itemId) ?? 0;
    if (qty > max + 0.0005) throw badRequest(`Cannot return ${qty} of ${codes.get(it.productId)}: invoiced ${num(it.qty)}, returnable ${max}`);
    const net = lineNet(it, qty);
    const vatAmount = r2((net * num(it.vatRate)) / 100);
    lines.push({ invoiceItemId: itemId, productId: it.productId, qty, rate: r4(net / qty), vatRate: num(it.vatRate), vatAmount, amount: r2(net + vatAmount), unitCost: num(it.unitCost) });
  }
  if (!lines.length) throw badRequest('Nothing to return: all invoiced quantity has already been returned');
  const subtotal = r2(lines.reduce((s, l) => s + r2(l.qty * l.rate), 0));
  const vat = r2(lines.reduce((s, l) => s + l.vatAmount, 0));
  return { inv, lines, subtotal, vat, total: r2(lines.reduce((s, l) => s + l.amount, 0)) };
}

async function createReturnTx(tx: Tx, req: Request, b: Body & { invoiceId: number }) {
  const want = b.items?.length ? new Map<number, number>() : null;
  if (want) for (const i of b.items!) want.set(i.invoiceItemId, (want.get(i.invoiceItemId) ?? 0) + i.qty);
  const { inv, lines, subtotal, vat, total } = await buildLines(tx, b.invoiceId, want);
  let warehouseId = b.warehouseId ?? null;
  if (!warehouseId && inv.salesOrderId) warehouseId = (await tx.salesOrder.findUnique({ where: { id: inv.salesOrderId } }))?.warehouseId ?? null;
  if (!warehouseId) warehouseId = (await tx.warehouse.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } }))?.id ?? null;
  if (!warehouseId) throw badRequest('No warehouse available for the return');
  const docDate = b.docDate ?? new Date();
  const docNo = await nextNumber(tx, 'SALES_RETURN', { date: docDate });
  const sr = await tx.salesReturn.create({
    data: { docNo, docDate, customerId: inv.customerId, invoiceId: inv.id, warehouseId, reason: b.reason ?? null, remarks: b.remarks ?? null, subtotal, vatAmount: vat, total, createdBy: req.user?.id, items: { create: lines } },
  });
  await linkDocs(tx, { type: 'SALES_INVOICE', id: inv.id, no: inv.docNo }, { type: 'SALES_RETURN', id: sr.id, no: sr.docNo });
  await audit(tx, req.user, 'CREATE', 'SalesReturn', sr.id, { docNo, invoice: inv.docNo, total });
  return sr.id;
}

async function detail(id: number) {
  const r = mustFound(await prisma.salesReturn.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } }), 'Sales return');
  const [row] = await enrich([r as unknown as Record<string, unknown>], { customerId: 'customer', warehouseId: 'warehouse' });
  const inv = await prisma.salesInvoice.findUnique({ where: { id: r.invoiceId }, include: { items: true } });
  const items = await enrich(r.items as unknown as Record<string, unknown>[], { productId: 'product' });
  const ii = new Map((inv?.items ?? []).map((i) => [i.id, i]));
  for (const it of items) {
    const x = ii.get(it.invoiceItemId as number);
    it.invoicedQty = x ? num(x.qty) : null;
    it.pendingInspectionQty = r3(num(it.receivedQty) - num(it.resalableQty) - num(it.damagedQty));
  }
  const note = r.creditNoteId ? await prisma.note.findUnique({ where: { id: r.creditNoteId } }) : null;
  return {
    ...row, invoice: inv ? { id: inv.id, docNo: inv.docNo, status: inv.status, total: inv.total, baseTotal: inv.baseTotal, receivedAmount: inv.receivedAmount, currencyCode: inv.currencyCode } : null,
    items, creditNote: note, links: await docLinks('SALES_RETURN', id), approval: await approvalFor('SALES_RETURN', id),
  };
}

router.get('/', can('sales_return', 'view'), ah(async (req, res) => {
  const { q, where, orderBy } = await buildListWhere(req, { searchFields: ['docNo', 'reason', 'remarks'] });
  const [rows, total] = await Promise.all([
    prisma.salesReturn.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.salesReturn.count({ where }),
  ]);
  const invs = await prisma.salesInvoice.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.invoiceId))] } }, select: { id: true, docNo: true } });
  const m = new Map(invs.map((i) => [i.id, i]));
  const out = rows.map((r) => ({ ...r, invoice: m.get(r.invoiceId) ?? null }));
  await enrich(out as unknown as Record<string, unknown>[], { customerId: 'customer', warehouseId: 'warehouse' });
  res.json(paged(out, total, q));
}));
router.get('/:id', can('sales_return', 'view'), ah(async (req, res) => res.json(await detail(intParam(req)))));

router.post('/', can('sales_return', 'create'), ah(async (req, res) => {
  const b = parse(bodySchema, req.body);
  if (!b.invoiceId) throw badRequest('invoiceId is required');
  const id = await prisma.$transaction((tx) => createReturnTx(tx, req, b as Body & { invoiceId: number }), { timeout: 30000 });
  res.status(201).json(await detail(id));
}));

// prefilled from invoice (all returnable qty unless items given)
const fromInvoice = Router();
fromInvoice.post('/:id/create-return', can('sales_return', 'create'), ah(async (req, res) => {
  const b = parse(bodySchema, req.body ?? {});
  const id = await prisma.$transaction((tx) => createReturnTx(tx, req, { ...b, invoiceId: intParam(req) }), { timeout: 30000 });
  res.status(201).json(await detail(id));
}));
fromInvoice.get('/:id/returnable', can('sales_return', 'view'), ah(async (req, res) => {
  const { inv, map } = await returnable(prisma, intParam(req));
  const items = await enrich(inv.items.map((i) => ({ ...i })) as unknown as Record<string, unknown>[], { productId: 'product' });
  for (const it of items) it.returnableQty = map.get(it.id as number) ?? 0;
  res.json({ invoiceId: inv.id, docNo: inv.docNo, status: inv.status, items });
}));

router.put('/:id', can('sales_return', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(bodySchema, req.body);
  await prisma.$transaction(async (tx) => {
    const r = mustFound(await tx.salesReturn.findUnique({ where: { id } }), 'Sales return');
    mustStatus(r, ['DRAFT'], 'edit');
    const data: Record<string, unknown> = {};
    if (b.docDate) data.docDate = b.docDate;
    if (b.warehouseId) data.warehouseId = b.warehouseId;
    if (b.reason !== undefined) data.reason = b.reason;
    if (b.remarks !== undefined) data.remarks = b.remarks;
    if (b.items?.length) {
      const want = new Map<number, number>();
      for (const i of b.items) want.set(i.invoiceItemId, (want.get(i.invoiceItemId) ?? 0) + i.qty);
      const { lines, subtotal, vat, total } = await buildLines(tx, r.invoiceId, want, id);
      await tx.salesReturnItem.deleteMany({ where: { returnId: id } });
      data.items = { create: lines };
      data.subtotal = subtotal;
      data.vatAmount = vat;
      data.total = total;
    }
    await tx.salesReturn.update({ where: { id }, data });
    await audit(tx, req.user, 'UPDATE', 'SalesReturn', id);
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

router.delete('/:id', can('sales_return', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const r = mustFound(await tx.salesReturn.findUnique({ where: { id } }), 'Sales return');
    mustStatus(r, ['DRAFT'], 'delete');
    await tx.documentLink.deleteMany({ where: { toType: 'SALES_RETURN', toId: id } });
    await tx.salesReturn.delete({ where: { id } });
    await audit(tx, req.user, 'DELETE', 'SalesReturn', id, { docNo: r.docNo });
  });
  res.json({ ok: true });
}));

/* ---------------- Return receipt ---------------- */
const receiveSchema = z.object({
  receivedDate: z.coerce.date().optional(),
  items: z.array(z.object({ id: z.coerce.number().int(), receivedQty: z.coerce.number().min(0) })).optional(),
});
router.post('/:id/receive', can('sales_return', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(receiveSchema, req.body ?? {});
  await prisma.$transaction(async (tx) => {
    const r = mustFound(await tx.salesReturn.findUnique({ where: { id }, include: { items: true } }), 'Sales return');
    mustStatus(r, ['DRAFT'], 'receive');
    const given = new Map((b.items ?? []).map((i) => [i.id, i.receivedQty]));
    for (const g of given.keys()) if (!r.items.some((i) => i.id === g)) throw badRequest(`Return line ${g} is not on ${r.docNo}`);
    let any = false;
    for (const it of r.items) {
      const rq = given.has(it.id) ? given.get(it.id)! : num(it.qty);
      if (rq > num(it.qty) + 0.0005) throw badRequest(`Received qty ${rq} exceeds the return qty ${num(it.qty)}`);
      if (rq > 0) any = true;
      await tx.salesReturnItem.update({ where: { id: it.id }, data: { receivedQty: rq } });
    }
    if (!any) throw badRequest('Received quantity is zero for all lines');
    await tx.salesReturn.update({ where: { id }, data: { status: 'RECEIVED', receivedDate: b.receivedDate ?? new Date() } });
    await audit(tx, req.user, 'RECEIVE', 'SalesReturn', id);
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

/* ---------------- Inspection: resalable + damaged = received ---------------- */
const inspectSchema = z.object({
  inspectedDate: z.coerce.date().optional(),
  items: z.array(z.object({ id: z.coerce.number().int(), resalableQty: z.coerce.number().min(0), damagedQty: z.coerce.number().min(0) })).min(1),
});
router.post('/:id/inspect', can('sales_return', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(inspectSchema, req.body);
  await prisma.$transaction(async (tx) => {
    const r = mustFound(await tx.salesReturn.findUnique({ where: { id }, include: { items: true } }), 'Sales return');
    mustStatus(r, ['RECEIVED', 'INSPECTED'], 'inspect');
    const given = new Map(b.items.map((i) => [i.id, i]));
    for (const g of given.keys()) if (!r.items.some((i) => i.id === g)) throw badRequest(`Return line ${g} is not on ${r.docNo}`);
    for (const it of r.items) {
      const g = given.get(it.id);
      const rcv = num(it.receivedQty);
      if (!g) {
        if (rcv > 0) throw badRequest(`Inspection missing for return line ${it.id}`);
        continue;
      }
      if (Math.abs(g.resalableQty + g.damagedQty - rcv) > 0.0005) throw badRequest(`Line ${it.id}: resalable (${g.resalableQty}) + damaged (${g.damagedQty}) must equal received qty (${rcv})`);
      await tx.salesReturnItem.update({ where: { id: it.id }, data: { resalableQty: g.resalableQty, damagedQty: g.damagedQty } });
    }
    await tx.salesReturn.update({ where: { id }, data: { status: 'INSPECTED', inspectedDate: b.inspectedDate ?? new Date() } });
    await audit(tx, req.user, 'INSPECT', 'SalesReturn', id);
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

/* ---------------- Post: inventory update + credit note ---------------- */
router.post('/:id/post', can('sales_return', 'post'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const r = mustFound(await tx.salesReturn.findUnique({ where: { id }, include: { items: true } }), 'Sales return');
    mustStatus(r, ['INSPECTED'], 'post');
    const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: r.invoiceId }, include: { items: true } });
    mustStatus(inv, POSTED_INV, 'post return (invoice not posted)');
    const iim = new Map(inv.items.map((i) => [i.id, i]));
    const rate = num(inv.exchangeRate) || 1;
    // stock + amounts on the RECEIVED qty
    let subtotal = 0;
    let vat = 0;
    let costIn = 0;
    let damageValue = 0;
    for (const it of r.items) {
      const rcv = num(it.receivedQty);
      if (rcv <= 0) continue;
      const resalable = num(it.resalableQty);
      const damaged = num(it.damagedQty);
      if (Math.abs(resalable + damaged - rcv) > 0.0005) throw badRequest('Inspection incomplete: resalable + damaged must equal received qty');
      const src = iim.get(it.invoiceItemId!);
      const net = src ? lineNet(src, rcv) : r2(rcv * num(it.rate));
      const vatAmount = r2((net * num(it.vatRate)) / 100);
      await tx.salesReturnItem.update({ where: { id: it.id }, data: { rate: r4(net / rcv), vatAmount, amount: r2(net + vatAmount) } });
      subtotal += net;
      vat += vatAmount;
      const uc = num(it.unitCost);
      const common = { productId: it.productId, warehouseId: r.warehouseId, refType: 'SALES_RETURN', refId: r.id, refNo: r.docNo, userId: req.user?.id, date: r.docDate };
      if (resalable > 0) {
        const t = await postStock(tx, { ...common, txType: 'SALES_RETURN', qty: resalable, unitCost: uc, remarks: `Resalable return ${r.docNo}` });
        costIn += num(t.value);
      }
      if (damaged > 0) {
        const t = await postStock(tx, { ...common, txType: 'SALES_RETURN', qty: damaged, unitCost: uc, remarks: `Damaged return ${r.docNo} (received)` });
        costIn += num(t.value);
        const d = await postStock(tx, { ...common, txType: 'DAMAGE', qty: -damaged, remarks: `Damaged return ${r.docNo} (written off)` });
        damageValue += Math.abs(num(d.value));
      }
    }
    subtotal = r2(subtotal);
    vat = r2(vat);
    if (subtotal <= 0 && vat <= 0) throw badRequest('Nothing received: cannot post a zero credit note');
    const netBase = r2(subtotal * rate);
    const vatBase = r2(vat * rate);
    const totalBase = r2(netBase + vatBase);
    costIn = r2(costIn);
    damageValue = r2(damageValue);

    const noteNo = await nextNumber(tx, 'CREDIT_NOTE', { date: r.docDate });
    const note = await tx.note.create({
      data: {
        noteNo, noteType: 'CREDIT', partyType: 'CUSTOMER', partyId: r.customerId, noteDate: r.docDate, refType: 'SALES_RETURN', refId: r.id, refNo: r.docNo,
        subtotal: netBase, vatAmount: vatBase, total: totalBase, reason: r.reason ?? `Sales return ${r.docNo} against ${inv.docNo}`, status: 'POSTED', createdBy: req.user?.id,
      },
    });
    // the journal below IS the credit-note posting (Note.journalId points to it)
    const j = await postJournal(tx, {
      date: r.docDate, entryType: 'CREDIT_NOTE', sourceType: 'CREDIT_NOTE', sourceId: note.id, sourceNo: noteNo, userId: req.user?.id, narration: `Credit note ${noteNo} for ${r.docNo} / ${inv.docNo}`,
      lines: [
        { accountKey: 'SALES_RETURNS', debit: netBase, description: `Sales return ${r.docNo}` },
        { accountKey: 'VAT_OUTPUT', debit: vatBase, vatAmount: -vatBase, description: `VAT reversal ${r.docNo}` },
        { accountKey: 'AR', credit: totalBase, partyType: 'CUSTOMER', partyId: r.customerId, description: `Credit note ${noteNo}` },
      ],
    });
    await tx.note.update({ where: { id: note.id }, data: { journalId: j.id } });
    // inventory side: reverse COGS for everything that came back, then write off the damaged part as stock adjustment loss
    if (costIn > 0 || damageValue > 0) {
      await postJournal(tx, {
        date: r.docDate, entryType: 'AUTO', sourceType: 'SALES_RETURN', sourceId: r.id, sourceNo: r.docNo, userId: req.user?.id, narration: `Inventory/COGS for return ${r.docNo}`,
        lines: [
          { accountKey: 'INVENTORY', debit: costIn, description: `Returned stock ${r.docNo}` },
          { accountKey: 'COGS', credit: costIn, description: `COGS reversal ${r.docNo}` },
          { accountKey: 'STOCK_ADJUSTMENT', debit: damageValue, description: `Damaged return write-off ${r.docNo}` },
          { accountKey: 'INVENTORY', credit: damageValue, description: `Damaged return write-off ${r.docNo}` },
        ],
      });
    }
    // reduce invoice outstanding by the credit (receivedAmount is in base currency)
    // (only up to the outstanding amount: the rest of the credit note stays as unapplied customer credit)
    const outstandingBase = Math.max(0, r2(num(inv.baseTotal) - num(inv.receivedAmount)));
    const received = r2(num(inv.receivedAmount) + Math.min(totalBase, outstandingBase));
    const status = received >= num(inv.baseTotal) - 0.005 ? 'PAID' : received > 0.005 ? 'PARTIALLY_PAID' : inv.status;
    await tx.salesInvoice.update({ where: { id: inv.id }, data: { receivedAmount: received, status } });
    await tx.salesReturn.update({ where: { id }, data: { status: 'POSTED', creditNoteId: note.id, subtotal, vatAmount: vat, total: r2(subtotal + vat) } });
    await linkDocs(tx, { type: 'SALES_RETURN', id: r.id, no: r.docNo }, { type: 'CREDIT_NOTE', id: note.id, no: noteNo });
    await audit(tx, req.user, 'POST', 'SalesReturn', id, { docNo: r.docNo, creditNote: noteNo, totalBase, costIn, damageValue });
  }, { timeout: 30000 });
  res.json(await detail(id));
}));

router.post('/:id/cancel', can('sales_return', 'cancel'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const r = mustFound(await tx.salesReturn.findUnique({ where: { id } }), 'Sales return');
    mustStatus(r, ['DRAFT', 'RECEIVED', 'INSPECTED'], 'cancel (posted returns cannot be cancelled; they have a credit note)');
    await tx.salesReturn.update({ where: { id }, data: { status: 'CANCELLED' } });
    await audit(tx, req.user, 'CANCEL', 'SalesReturn', id, { from: r.status });
  });
  res.json(await detail(id));
}));

export default [
  { path: '/sales-returns', router },
  { path: '/sales-invoices', router: fromInvoice },
] satisfies ModuleDef[];
