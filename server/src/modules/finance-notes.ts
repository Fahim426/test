import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, intParam, listQuery, parse, paged } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { num, r2 } from '../lib/calc';
import { postJournal, reverseJournal, JournalLineInput } from '../services/accounting';
import { nextNumber } from '../services/numbering';
import { audit } from '../services/audit';
import { partyNames, qDate, qInt, SALES_OPEN } from '../services/finance-common';
import type { ModuleDef } from '../app';

const router = Router();
const EPS = 0.005;

const noteSchema = z.object({
  noteType: z.enum(['CREDIT', 'DEBIT']),
  partyType: z.enum(['CUSTOMER', 'SUPPLIER']),
  partyId: z.number().int(),
  noteDate: z.coerce.date(),
  amount: z.number().positive(), // net amount excluding VAT
  vatCode: z.string().optional().nullable(), // VatCode.code; default VAT code from master when omitted
  accountId: z.number().int().optional().nullable(), // counter account
  reason: z.string().optional().nullable(),
  refType: z.enum(['SALES_INVOICE', 'PURCHASE_INVOICE']).optional().nullable(),
  refId: z.number().int().optional().nullable(),
  applyToInvoice: z.boolean().optional(), // credit notes only: reduce the invoice outstanding
});

function invStatus(settled: number, total: number, current: string) {
  if (['DRAFT', 'CANCELLED'].includes(current)) return current;
  if (settled <= EPS) return 'POSTED';
  return settled >= total - EPS ? 'PAID' : 'PARTIALLY_PAID';
}

async function presentNote(id: number) {
  const n = await prisma.note.findUnique({ where: { id } });
  if (!n) throw notFound('Note not found');
  const [row] = await presentNotes([n]);
  const journal = n.journalId ? await prisma.journalEntry.findUnique({ where: { id: n.journalId }, include: { lines: { include: { account: { select: { id: true, code: true, name: true } } } } } }) : null;
  return { ...row, journal };
}

async function presentNotes(notes: Awaited<ReturnType<typeof prisma.note.findMany>>) {
  const pn = await partyNames(notes);
  const jids = notes.map((n) => n.journalId).filter((x): x is number => !!x);
  const js = jids.length ? await prisma.journalEntry.findMany({ where: { id: { in: jids } }, select: { id: true, entryNo: true, sourceType: true, status: true } }) : [];
  const jm = new Map(js.map((j) => [j.id, j]));
  return notes.map((n) => ({
    ...n,
    subtotal: num(n.subtotal),
    vatAmount: num(n.vatAmount),
    total: num(n.total),
    party: pn(n.partyType, n.partyId),
    journalNo: n.journalId ? jm.get(n.journalId)?.entryNo ?? null : null,
    applied: n.journalId ? jm.get(n.journalId)?.sourceType === 'NOTE_APPLIED' : false,
    autoCreated: n.journalId ? !['NOTE', 'NOTE_APPLIED'].includes(jm.get(n.journalId)?.sourceType ?? '') : false,
  }));
}

router.get(
  '/',
  can('notes', 'view'),
  ah(async (req, res) => {
    const q = listQuery(req);
    const where: Record<string, unknown> = {};
    if (req.query.noteType) where.noteType = String(req.query.noteType).toUpperCase();
    if (req.query.partyType) where.partyType = String(req.query.partyType).toUpperCase();
    if (req.query.status) where.status = String(req.query.status);
    const pid = qInt(req.query.partyId ?? req.query.customerId ?? req.query.supplierId);
    if (pid) where.partyId = pid;
    const from = qDate(req.query.from);
    const to = qDate(req.query.to, true);
    if (from || to) where.noteDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    if (q.search) where.OR = [{ noteNo: { contains: q.search } }, { refNo: { contains: q.search } }, { reason: { contains: q.search } }];
    const sortable = ['noteNo', 'noteDate', 'total', 'status', 'id'];
    const orderBy = { [q.sort && sortable.includes(q.sort) ? q.sort : 'id']: q.dir };
    const [raw, total] = await Promise.all([prisma.note.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }), prisma.note.count({ where })]);
    res.json(paged(await presentNotes(raw), total, q));
  }),
);

router.get(
  '/:id',
  can('notes', 'view'),
  ah(async (req, res) => {
    res.json(await presentNote(intParam(req)));
  }),
);

router.post(
  '/',
  can('notes', 'create'),
  ah(async (req, res) => {
    const b = parse(noteSchema, req.body);
    const note = await prisma.$transaction(
      async (tx) => {
        const party = b.partyType === 'CUSTOMER' ? await tx.customer.findUnique({ where: { id: b.partyId } }) : await tx.supplier.findUnique({ where: { id: b.partyId } });
        if (!party) throw badRequest(`${b.partyType} not found`);

        // VAT from the VatCode master — never hard-coded
        const vc = b.vatCode ? await tx.vatCode.findUnique({ where: { code: b.vatCode } }) : await tx.vatCode.findFirst({ where: { isDefault: true, isActive: true } });
        if (b.vatCode && !vc) throw badRequest(`VAT code ${b.vatCode} not found`);
        const rate = num(vc?.rate);
        const subtotal = r2(b.amount);
        const vatAmount = r2((subtotal * rate) / 100);
        const total = r2(subtotal + vatAmount);

        // counter account
        let counterId = b.accountId ?? null;
        if (counterId) {
          const ca = await tx.account.findUnique({ where: { id: counterId } });
          if (!ca || ca.isGroup) throw badRequest('Invalid counter account');
        }
        const key = async (k: string) => (await tx.account.findUnique({ where: { systemKey: k } }))?.id;
        if (!counterId) {
          if (b.partyType === 'CUSTOMER') counterId = (await key(b.noteType === 'CREDIT' ? 'SALES_RETURNS' : 'SALES')) ?? null;
          else counterId = (await key('INVENTORY')) ?? null;
          if (!counterId) throw badRequest('Counter account not configured; specify accountId');
        }

        // optional reference / application against an invoice
        let refNo: string | undefined;
        let applied = false;
        if (b.refType && b.refId) {
          if (b.refType === 'SALES_INVOICE') {
            if (b.partyType !== 'CUSTOMER') throw badRequest('SALES_INVOICE reference requires a customer note');
            const inv = await tx.salesInvoice.findUnique({ where: { id: b.refId } });
            if (!inv || inv.customerId !== b.partyId) throw badRequest('Invoice not found for this customer');
            refNo = inv.docNo;
            if (b.applyToInvoice) {
              if (b.noteType !== 'CREDIT') throw badRequest('Only credit notes can be applied against an invoice');
              if (!SALES_OPEN.includes(inv.status)) throw badRequest(`Invoice ${inv.docNo} is ${inv.status}`);
              const out = r2(num(inv.baseTotal) - num(inv.receivedAmount));
              if (total > out + EPS) throw badRequest(`Credit note total ${total} exceeds invoice outstanding ${out}`);
              const rec = r2(num(inv.receivedAmount) + total);
              await tx.salesInvoice.update({ where: { id: inv.id }, data: { receivedAmount: rec, status: invStatus(rec, num(inv.baseTotal), inv.status) } });
              applied = true;
            }
          } else {
            if (b.partyType !== 'SUPPLIER') throw badRequest('PURCHASE_INVOICE reference requires a supplier note');
            const inv = await tx.purchaseInvoice.findUnique({ where: { id: b.refId } });
            if (!inv || inv.supplierId !== b.partyId) throw badRequest('Invoice not found for this supplier');
            refNo = inv.docNo;
            if (b.applyToInvoice) {
              if (b.noteType !== 'CREDIT') throw badRequest('Only credit notes can be applied against an invoice');
              if (!SALES_OPEN.includes(inv.status)) throw badRequest(`Invoice ${inv.docNo} is ${inv.status}`);
              const out = r2(num(inv.baseTotal) - num(inv.paidAmount));
              if (total > out + EPS) throw badRequest(`Credit note total ${total} exceeds invoice outstanding ${out}`);
              const paid = r2(num(inv.paidAmount) + total);
              await tx.purchaseInvoice.update({ where: { id: inv.id }, data: { paidAmount: paid, status: invStatus(paid, num(inv.baseTotal), inv.status) } });
              applied = true;
            }
          }
        } else if (b.applyToInvoice) throw badRequest('applyToInvoice requires refType and refId');

        const noteNo = await nextNumber(tx, b.noteType === 'CREDIT' ? 'CREDIT_NOTE' : 'DEBIT_NOTE', { date: b.noteDate });
        const n = await tx.note.create({
          data: { noteNo, noteType: b.noteType, partyType: b.partyType, partyId: b.partyId, noteDate: b.noteDate, refType: b.refType ?? null, refId: b.refId ?? null, refNo, subtotal, vatAmount, total, reason: b.reason, status: 'POSTED', createdBy: req.user?.id },
        });

        // journal
        const p = { partyType: b.partyType, partyId: b.partyId } as const;
        const vatLine = vatAmount ? { vatCode: vc?.code, vatAmount } : {};
        const lines: JournalLineInput[] = [];
        const d = `${noteNo}${b.reason ? ' ' + b.reason : ''}`;
        if (b.partyType === 'CUSTOMER') {
          if (b.noteType === 'CREDIT') {
            lines.push({ accountId: counterId, debit: subtotal, description: d, vatCode: vc?.code });
            lines.push({ accountKey: 'VAT_OUTPUT', debit: vatAmount, description: `VAT ${d}`, ...vatLine });
            lines.push({ accountKey: 'AR', credit: total, ...p, description: d });
          } else {
            lines.push({ accountKey: 'AR', debit: total, ...p, description: d });
            lines.push({ accountId: counterId, credit: subtotal, description: d, vatCode: vc?.code });
            lines.push({ accountKey: 'VAT_OUTPUT', credit: vatAmount, description: `VAT ${d}`, ...vatLine });
          }
        } else if (b.noteType === 'CREDIT') {
          lines.push({ accountKey: 'AP', debit: total, ...p, description: d });
          lines.push({ accountId: counterId, credit: subtotal, description: d, vatCode: vc?.code });
          lines.push({ accountKey: 'VAT_INPUT', credit: vatAmount, description: `VAT ${d}`, ...vatLine });
        } else {
          lines.push({ accountId: counterId, debit: subtotal, description: d, vatCode: vc?.code });
          lines.push({ accountKey: 'VAT_INPUT', debit: vatAmount, description: `VAT ${d}`, ...vatLine });
          lines.push({ accountKey: 'AP', credit: total, ...p, description: d });
        }
        const j = await postJournal(tx, {
          date: b.noteDate,
          entryType: b.noteType === 'CREDIT' ? 'CREDIT_NOTE' : 'DEBIT_NOTE',
          sourceType: applied ? 'NOTE_APPLIED' : 'NOTE',
          sourceId: n.id,
          sourceNo: noteNo,
          narration: `${b.noteType === 'CREDIT' ? 'Credit' : 'Debit'} note ${noteNo} - ${party.name}`,
          userId: req.user?.id,
          lines,
        });
        await tx.note.update({ where: { id: n.id }, data: { journalId: j.id } });
        await audit(tx, req.user, 'POST', 'Note', n.id, { noteNo, noteType: b.noteType, partyType: b.partyType, partyId: b.partyId, total, applied });
        return n;
      },
      { timeout: 30000 },
    );
    res.status(201).json(await presentNote(note.id));
  }),
);

router.post(
  '/:id/cancel',
  can('notes', 'cancel'),
  ah(async (req, res) => {
    const id = intParam(req);
    await prisma.$transaction(
      async (tx) => {
        const n = await tx.note.findUnique({ where: { id } });
        if (!n) throw notFound('Note not found');
        if (n.status !== 'POSTED') throw badRequest(`Note is ${n.status}`);
        const j = n.journalId ? await tx.journalEntry.findUnique({ where: { id: n.journalId } }) : null;
        if (!j || !['NOTE', 'NOTE_APPLIED'].includes(j.sourceType ?? '')) throw badRequest('This note was created automatically by a return; cancel the return document instead');
        await reverseJournal(tx, j.id, req.user?.id);
        if (j.sourceType === 'NOTE_APPLIED' && n.refId) {
          const total = num(n.total);
          if (n.refType === 'SALES_INVOICE') {
            const inv = await tx.salesInvoice.findUnique({ where: { id: n.refId } });
            if (inv) {
              const rec = Math.max(0, r2(num(inv.receivedAmount) - total));
              await tx.salesInvoice.update({ where: { id: inv.id }, data: { receivedAmount: rec, status: invStatus(rec, num(inv.baseTotal), inv.status) } });
            }
          } else if (n.refType === 'PURCHASE_INVOICE') {
            const inv = await tx.purchaseInvoice.findUnique({ where: { id: n.refId } });
            if (inv) {
              const paid = Math.max(0, r2(num(inv.paidAmount) - total));
              await tx.purchaseInvoice.update({ where: { id: inv.id }, data: { paidAmount: paid, status: invStatus(paid, num(inv.baseTotal), inv.status) } });
            }
          }
        }
        await tx.note.update({ where: { id }, data: { status: 'CANCELLED' } });
        await audit(tx, req.user, 'CANCEL', 'Note', id, { noteNo: n.noteNo, reason: req.body?.reason });
      },
      { timeout: 30000 },
    );
    res.json(await presentNote(id));
  }),
);

export default [{ path: '/notes', router }] satisfies ModuleDef[];
