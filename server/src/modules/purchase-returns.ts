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
import { postStock } from '../services/stock';
import { postJournal, reverseJournal } from '../services/accounting';
import { enrich } from '../lib/enrich';
import { num, r2, r3, r4 } from '../lib/calc';
import { assertStatus, deleteLinks, finishDoc, findSourceJournal, listDocs } from '../services/purchase-common';
import type { ModuleDef } from '../app';

const T = { timeout: 30000 };
const R = 'purchase_return';
const REASONS = ['DAMAGED', 'WRONG_ITEM', 'EXCESS_QUANTITY', 'QUALITY_ISSUE', 'WARRANTY', 'OTHER'] as const;
type Db = Tx | typeof prisma;

/** All returns amounts are in BASE currency (PurchaseReturn has no currency columns). */

async function returnedQty(db: Db, where: any, excludeReturnId?: number) {
  const rows = await db.purchaseReturnItem.findMany({
    where: { ...where, return: { status: { not: 'CANCELLED' }, ...(excludeReturnId ? { id: { not: excludeReturnId } } : {}) } },
    select: { qty: true, return: { select: { invoiceId: true } } },
  });
  return { all: rows.reduce((s, r) => s + num(r.qty), 0), grnBased: rows.filter((r) => !r.return.invoiceId).reduce((s, r) => s + num(r.qty), 0) };
}

interface Cand { receiptItemId: number; invoiceItemId: number | null; productId: number; maxQty: number; rate: number; vatRate: number; receiptNo: string; warehouseId: number; unitCost: number; invoicedQty: number; qtyReceived: number }

async function candidates(db: Db, src: { invoiceId?: number | null; receiptId?: number | null }, excludeReturnId?: number) {
  const out: Cand[] = [];
  let supplierId = 0;
  let invoice: any = null;
  let receipt: any = null;
  if (src.invoiceId) {
    invoice = await db.purchaseInvoice.findUnique({ where: { id: src.invoiceId }, include: { items: true } });
    if (!invoice) throw notFound('Invoice not found');
    if (!['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(invoice.status)) throw badRequest(`Invoice ${invoice.docNo} is ${invoice.status}; only posted invoices can be returned`);
    supplierId = invoice.supplierId;
    for (const ii of invoice.items) {
      if (!ii.receiptItemId) continue;
      const gi: any = await db.goodsReceiptItem.findUnique({ where: { id: ii.receiptItemId }, include: { receipt: true } });
      if (!gi) continue;
      const byInv = await returnedQty(db, { invoiceItemId: ii.id }, excludeReturnId);
      const byGi = await returnedQty(db, { receiptItemId: gi.id }, excludeReturnId);
      const maxQty = r3(Math.min(num(ii.qty) - byInv.all, num(gi.qty) - byGi.all));
      const qty = num(ii.qty) || 1;
      const net = num(ii.qty) * num(ii.rate) - num(ii.discount);
      out.push({
        receiptItemId: gi.id, invoiceItemId: ii.id, productId: gi.productId, maxQty: Math.max(0, maxQty), rate: r4((net / qty) * num(invoice.exchangeRate)), vatRate: num(ii.vatRate),
        receiptNo: gi.receipt.docNo, warehouseId: gi.receipt.warehouseId, unitCost: num(gi.unitCost), invoicedQty: num(ii.qty), qtyReceived: num(gi.qty),
      });
    }
  } else if (src.receiptId) {
    receipt = await db.goodsReceipt.findUnique({ where: { id: src.receiptId }, include: { items: true } });
    if (!receipt) throw notFound('Goods receipt not found');
    if (receipt.status !== 'POSTED') throw badRequest(`Goods receipt ${receipt.docNo} is ${receipt.status}; only posted receipts can be returned`);
    supplierId = receipt.supplierId;
    for (const gi of receipt.items) {
      const rt = await returnedQty(db, { receiptItemId: gi.id }, excludeReturnId);
      const maxQty = r3(Math.min(num(gi.qty) - num(gi.invoicedQty) - rt.grnBased, num(gi.qty) - rt.all));
      out.push({ receiptItemId: gi.id, invoiceItemId: null, productId: gi.productId, maxQty: Math.max(0, maxQty), rate: num(gi.unitCost), vatRate: 0, receiptNo: receipt.docNo, warehouseId: receipt.warehouseId, unitCost: num(gi.unitCost), invoicedQty: num(gi.invoicedQty), qtyReceived: num(gi.qty) });
    }
  } else throw badRequest('invoiceId or receiptId is required');
  return { cands: out, supplierId, invoice, receipt };
}

const itemIn = z.object({ receiptItemId: z.coerce.number().int().nullish(), invoiceItemId: z.coerce.number().int().nullish(), qty: z.coerce.number().positive() });
const retSchema0 = z.object({
  invoiceId: z.coerce.number().int().nullish(),
  receiptId: z.coerce.number().int().nullish(),
  docDate: z.coerce.date().optional(),
  warehouseId: z.coerce.number().int().nullish(),
  reason: z.enum(REASONS).default('OTHER'),
  remarks: z.string().nullish(),
  items: z.array(itemIn).optional(),
});

const retSchema = retSchema0;
type RetIn = z.input<typeof retSchema0>;

async function buildItems(db: Db, b: RetIn, excludeReturnId?: number) {
  const { cands, supplierId, invoice, receipt } = await candidates(db, b, excludeReturnId);
  const chosen: Array<{ c: Cand; qty: number }> = [];
  if (b.items?.length) {
    for (const i of b.items) {
      const c = cands.find((x) => (i.invoiceItemId ? x.invoiceItemId === i.invoiceItemId : x.receiptItemId === i.receiptItemId));
      if (!c) throw badRequest('Item is not part of the source document');
      if (i.qty > c.maxQty + 0.0005) throw badRequest(`Cannot return ${i.qty}: only ${c.maxQty} can still be returned for this line (received ${c.qtyReceived}, invoiced ${c.invoicedQty})`);
      chosen.push({ c, qty: i.qty });
    }
  } else for (const c of cands) if (c.maxQty > 0) chosen.push({ c, qty: c.maxQty });
  if (!chosen.length) throw badRequest('Nothing left to return');
  const lines = chosen.map(({ c, qty }) => {
    const net = r2(qty * c.rate);
    const vatAmount = r2((net * c.vatRate) / 100);
    return { productId: c.productId, receiptItemId: c.receiptItemId, invoiceItemId: c.invoiceItemId, qty, rate: c.rate, vatRate: c.vatRate, vatAmount, amount: r2(net + vatAmount), _wh: c.warehouseId };
  });
  const subtotal = r2(lines.reduce((s, l) => s + l.amount - l.vatAmount, 0));
  const vatAmount = r2(lines.reduce((s, l) => s + l.vatAmount, 0));
  return { lines, subtotal, vatAmount, total: r2(subtotal + vatAmount), supplierId, invoice, receipt, warehouseId: b.warehouseId ?? lines[0]._wh };
}

async function createReturn(tx: Tx, b: RetIn, user: { id: number; username: string }) {
  const x = await buildItems(tx, b);
  const docDate = b.docDate ?? new Date();
  const docNo = await nextNumber(tx, 'PURCHASE_RETURN', { date: docDate });
  const receiptId = b.receiptId ?? null;
  const r = await tx.purchaseReturn.create({
    data: {
      docNo, docDate, supplierId: x.supplierId, invoiceId: b.invoiceId ?? null, receiptId, warehouseId: x.warehouseId, reason: b.reason ?? 'OTHER', subtotal: x.subtotal, vatAmount: x.vatAmount, total: x.total,
      status: 'DRAFT', remarks: b.remarks, createdBy: user.id, items: { create: x.lines.map(({ _wh, ...l }) => l) },
    },
  });
  if (x.invoice) await linkDocs(tx, { type: 'PURCHASE_INVOICE', id: x.invoice.id, no: x.invoice.docNo }, { type: 'PURCHASE_RETURN', id: r.id, no: r.docNo });
  else await linkDocs(tx, { type: 'GOODS_RECEIPT', id: x.receipt.id, no: x.receipt.docNo }, { type: 'PURCHASE_RETURN', id: r.id, no: r.docNo });
  await audit(tx, user, 'CREATE', 'PurchaseReturn', r.id, { docNo, total: x.total });
  return r;
}

async function returnDetail(id: number) {
  const r = await prisma.purchaseReturn.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });
  if (!r) throw notFound('Purchase return not found');
  const d: any = await finishDoc(r, 'PURCHASE_RETURN');
  d.invoice = r.invoiceId ? await prisma.purchaseInvoice.findUnique({ where: { id: r.invoiceId }, select: { id: true, docNo: true, status: true } }) : null;
  d.receipt = r.receiptId ? await prisma.goodsReceipt.findUnique({ where: { id: r.receiptId }, select: { id: true, docNo: true } }) : null;
  d.creditNote = r.creditNoteId ? await prisma.note.findUnique({ where: { id: r.creditNoteId } }) : null;
  return d;
}

async function postReturn(tx: Tx, id: number, user: { id: number; username: string }) {
  const r: any = await tx.purchaseReturn.findUnique({ where: { id }, include: { items: true } });
  assertStatus(r, ['DRAFT'], 'post');
  // revalidate quantities against current state
  await buildItems(tx, { invoiceId: r.invoiceId, receiptId: r.receiptId, reason: r.reason, items: r.items.map((i: any) => ({ receiptItemId: i.receiptItemId, invoiceItemId: i.invoiceItemId, qty: num(i.qty) })) }, id).catch((e) => { throw e; });
  let stockValue = 0;
  for (const it of r.items) {
    const gi: any = await tx.goodsReceiptItem.findUnique({ where: { id: it.receiptItemId }, include: { receipt: true } });
    const st = await postStock(tx, {
      txType: 'PURCHASE_RETURN', productId: it.productId, warehouseId: gi.receipt.warehouseId, qty: -num(it.qty), unitCost: num(gi.unitCost), refType: 'PURCHASE_RETURN', refId: id, refNo: r.docNo,
      date: r.docDate, userId: user.id, remarks: `Return to supplier (${r.reason})`, allowNegative: false,
    });
    stockValue += Math.abs(num(st.value));
  }
  stockValue = r2(stockValue);
  let journal;
  let note: any = null;
  let applied = 0;
  if (r.invoiceId) {
    const net = r2(num(r.subtotal));
    const vat = r2(num(r.vatAmount));
    const total = r2(net + vat);
    const noteNo = await nextNumber(tx, 'CREDIT_NOTE', { date: r.docDate });
    journal = await postJournal(tx, {
      date: r.docDate, entryType: 'CREDIT_NOTE', sourceType: 'PURCHASE_RETURN', sourceId: id, sourceNo: r.docNo, narration: `Supplier credit note ${noteNo} for return ${r.docNo}`, userId: user.id,
      lines: [
        { accountKey: 'AP', debit: total, partyType: 'SUPPLIER', partyId: r.supplierId, description: `Credit note ${noteNo}` },
        { accountKey: 'INVENTORY', credit: net, description: 'Purchase return' },
        { accountKey: 'VAT_INPUT', credit: vat, vatAmount: -vat, description: 'Input VAT reversal' },
      ],
    });
    note = await tx.note.create({
      data: { noteNo, noteType: 'CREDIT', partyType: 'SUPPLIER', partyId: r.supplierId, noteDate: r.docDate, refType: 'PURCHASE_RETURN', refId: id, refNo: r.docNo, subtotal: net, vatAmount: vat, total, reason: r.reason, status: 'POSTED', journalId: journal.id, createdBy: user.id },
    });
    // apply the credit against the invoice so that invoice outstanding stays consistent with the AP ledger
    const inv = await tx.purchaseInvoice.findUnique({ where: { id: r.invoiceId } });
    if (inv) {
      const out = Math.max(0, num(inv.baseTotal) - num(inv.paidAmount));
      applied = r2(Math.min(total, out));
      if (applied > 0) {
        const paid = r2(num(inv.paidAmount) + applied);
        await tx.purchaseInvoice.update({ where: { id: inv.id }, data: { paidAmount: paid, status: paid >= num(inv.baseTotal) - 0.005 ? 'PAID' : 'PARTIALLY_PAID' } });
      }
    }
  } else {
    // goods not yet invoiced: reverse the goods-received-not-invoiced accrual, no payable exists
    journal = await postJournal(tx, {
      date: r.docDate, entryType: 'AUTO', sourceType: 'PURCHASE_RETURN', sourceId: id, sourceNo: r.docNo, narration: `Purchase return ${r.docNo} (uninvoiced goods)`, userId: user.id,
      lines: [
        { accountKey: 'GRNI', debit: stockValue, description: `Return ${r.docNo}` },
        { accountKey: 'INVENTORY', credit: stockValue },
      ],
    });
  }
  await tx.purchaseReturn.update({ where: { id }, data: { status: 'POSTED', creditNoteId: note?.id ?? null, ...(r.invoiceId ? {} : { subtotal: stockValue, vatAmount: 0, total: stockValue }) } });
  await audit(tx, user, 'POST', 'PurchaseReturn', id, { journal: journal.entryNo, creditNote: note?.noteNo, stockValue, appliedToInvoice: applied });
  return { journal, note };
}

async function cancelReturn(tx: Tx, id: number, user: { id: number; username: string }) {
  const r: any = await tx.purchaseReturn.findUnique({ where: { id }, include: { items: true } });
  assertStatus(r, ['DRAFT', 'POSTED'], 'cancel');
  if (r.status === 'POSTED') {
    for (const it of r.items) {
      const gi: any = await tx.goodsReceiptItem.findUnique({ where: { id: it.receiptItemId }, include: { receipt: true } });
      await postStock(tx, {
        txType: 'ADJUSTMENT', productId: it.productId, warehouseId: gi.receipt.warehouseId, qty: num(it.qty), unitCost: num(gi.unitCost), refType: 'PURCHASE_RETURN', refId: id, refNo: r.docNo,
        userId: user.id, remarks: `Cancellation of return ${r.docNo}`,
      });
    }
    const j = await findSourceJournal(tx, 'PURCHASE_RETURN', id);
    if (j) await reverseJournal(tx, j.id, user.id);
    if (r.creditNoteId) await tx.note.update({ where: { id: r.creditNoteId }, data: { status: 'CANCELLED' } });
    if (r.invoiceId) {
      const log = await tx.auditLog.findFirst({ where: { entity: 'PurchaseReturn', entityId: String(id), action: 'POST' }, orderBy: { id: 'desc' } });
      let applied = 0;
      try { applied = num(JSON.parse(log?.details ?? '{}').appliedToInvoice); } catch { applied = 0; }
      const inv = await tx.purchaseInvoice.findUnique({ where: { id: r.invoiceId } });
      if (inv && applied > 0) {
        const paid = r2(Math.max(0, num(inv.paidAmount) - applied));
        await tx.purchaseInvoice.update({ where: { id: inv.id }, data: { paidAmount: paid, status: paid <= 0.004 ? 'POSTED' : 'PARTIALLY_PAID' } });
      }
    }
  }
  await tx.purchaseReturn.update({ where: { id }, data: { status: 'CANCELLED' } });
  await audit(tx, user, 'CANCEL', 'PurchaseReturn', id, { wasStatus: r.status });
}

const router = Router();
router.get('/', can(R, 'view'), ah(async (req, res) => {
  res.json(await listDocs(req, { model: 'purchaseReturn', search: ['docNo', 'remarks'], supplierSearch: true, numeric: ['supplierId', 'invoiceId', 'receiptId', 'warehouseId'], strings: ['reason'] }));
}));
router.get('/prefill', can(R, 'view'), ah(async (req, res) => {
  const src = { invoiceId: req.query.invoiceId ? Number(req.query.invoiceId) : null, receiptId: req.query.receiptId ? Number(req.query.receiptId) : null };
  const { cands, supplierId } = await candidates(prisma, src);
  const items: any[] = cands.map((c) => ({ ...c, qty: c.maxQty }));
  await enrich(items, { productId: 'product' });
  res.json({ ...src, supplierId, reasons: REASONS, items });
}));
router.get('/:id', can(R, 'view'), ah(async (req, res) => res.json(await returnDetail(intParam(req)))));
router.post('/', can(R, 'create'), ah(async (req, res) => {
  const b = parse(retSchema, req.body);
  const r = await prisma.$transaction((tx) => createReturn(tx, b, req.user!), T);
  res.status(201).json(await returnDetail(r.id));
}));
router.put('/:id', can(R, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(retSchema.partial(), req.body);
  await prisma.$transaction(async (tx) => {
    const cur: any = assertStatus(await tx.purchaseReturn.findUnique({ where: { id } }), ['DRAFT'], 'edit');
    const data: any = { docDate: b.docDate, reason: b.reason, remarks: b.remarks };
    if (b.items) {
      const x = await buildItems(tx, { invoiceId: cur.invoiceId, receiptId: cur.receiptId, reason: cur.reason, items: b.items }, id);
      Object.assign(data, { subtotal: x.subtotal, vatAmount: x.vatAmount, total: x.total });
      await tx.purchaseReturnItem.deleteMany({ where: { returnId: id } });
      await tx.purchaseReturnItem.createMany({ data: x.lines.map(({ _wh, ...l }) => ({ ...l, returnId: id })) });
    }
    await tx.purchaseReturn.update({ where: { id }, data });
    await audit(tx, req.user, 'UPDATE', 'PurchaseReturn', id);
  }, T);
  res.json(await returnDetail(id));
}));
router.delete('/:id', can(R, 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.purchaseReturn.findUnique({ where: { id } }), ['DRAFT'], 'delete');
    await tx.purchaseReturn.delete({ where: { id } });
    await deleteLinks(tx, 'PURCHASE_RETURN', id);
    await audit(tx, req.user, 'DELETE', 'PurchaseReturn', id);
  }, T);
  res.json({ ok: true });
}));
router.post('/:id/post', can(R, 'post'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction((tx) => postReturn(tx, id, req.user!), T);
  res.json(await returnDetail(id));
}));
router.post('/:id/cancel', can(R, 'cancel'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction((tx) => cancelReturn(tx, id, req.user!), T);
  res.json(await returnDetail(id));
}));

const bodyNoSrc = retSchema.omit({ invoiceId: true, receiptId: true });
const fromInvoice = Router();
fromInvoice.post('/:id/create-return', can(R, 'create'), ah(async (req, res) => {
  const b = parse(bodyNoSrc, req.body ?? {});
  const r = await prisma.$transaction((tx) => createReturn(tx, { ...b, invoiceId: intParam(req) }, req.user!), T);
  res.status(201).json(await returnDetail(r.id));
}));
const fromGrn = Router();
fromGrn.post('/:id/create-return', can(R, 'create'), ah(async (req, res) => {
  const b = parse(bodyNoSrc, req.body ?? {});
  const r = await prisma.$transaction((tx) => createReturn(tx, { ...b, receiptId: intParam(req) }, req.user!), T);
  res.status(201).json(await returnDetail(r.id));
}));

export default [
  { path: '/purchase-returns', router },
  { path: '/purchase-invoices', router: fromInvoice },
  { path: '/goods-receipts', router: fromGrn },
] as ModuleDef[];
