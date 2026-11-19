import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ah, intParam, listQuery, paged } from '../lib/http';
import { notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { num, r2 } from '../lib/calc';
import { accountIdByKey } from '../services/accounting';
import { classifyEntry, dayEnd, daysBetween, qAsOf, qDate, qInt, SALES_OPEN } from '../services/finance-common';
import type { ModuleDef } from '../app';

type Side = 'CUSTOMER' | 'SUPPLIER';
const BUCKETS = ['current', '0-30', '31-60', '61-90', '91-120', '120+'] as const;
type Bucket = (typeof BUCKETS)[number];
const bucketOf = (daysPastDue: number): Bucket => (daysPastDue < 0 ? 'current' : daysPastDue <= 30 ? '0-30' : daysPastDue <= 60 ? '31-60' : daysPastDue <= 90 ? '61-90' : daysPastDue <= 120 ? '91-120' : '120+');
const emptyBuckets = () => Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;

interface OpenDoc {
  id: number;
  docNo: string;
  docDate: Date;
  dueDate: Date | null;
  partyId: number;
  currencyCode: string;
  baseTotal: number;
  settled: number;
  outstanding: number;
  status: string;
}

async function openDocs(side: Side, asOf: Date, partyId?: number): Promise<OpenDoc[]> {
  if (side === 'CUSTOMER') {
    const l = await prisma.salesInvoice.findMany({ where: { status: { in: SALES_OPEN }, docDate: { lte: asOf }, ...(partyId ? { customerId: partyId } : {}) }, orderBy: { docDate: 'asc' } });
    return l.map((i) => ({ id: i.id, docNo: i.docNo, docDate: i.docDate, dueDate: i.dueDate, partyId: i.customerId, currencyCode: i.currencyCode, baseTotal: num(i.baseTotal), settled: num(i.receivedAmount), outstanding: r2(num(i.baseTotal) - num(i.receivedAmount)), status: i.status })).filter((i) => i.outstanding > 0.005);
  }
  const l = await prisma.purchaseInvoice.findMany({ where: { status: { in: SALES_OPEN }, docDate: { lte: asOf }, ...(partyId ? { supplierId: partyId } : {}) }, orderBy: { docDate: 'asc' } });
  return l.map((i) => ({ id: i.id, docNo: i.docNo, docDate: i.docDate, dueDate: i.dueDate, partyId: i.supplierId, currencyCode: i.currencyCode, baseTotal: num(i.baseTotal), settled: num(i.paidAmount), outstanding: r2(num(i.baseTotal) - num(i.paidAmount)), status: i.status })).filter((i) => i.outstanding > 0.005);
}

async function partyMap(side: Side, ids: number[]) {
  const rows = ids.length
    ? side === 'CUSTOMER'
      ? await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, creditLimit: true, openingBalance: true } })
      : await prisma.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, creditLimit: true, openingBalance: true } })
    : [];
  return new Map(rows.map((r) => [r.id, r]));
}

/** unapplied (on-account) voucher amounts per party */
async function unapplied(side: Side, partyId?: number) {
  const vs = await prisma.voucher.findMany({
    where: { voucherType: side === 'CUSTOMER' ? 'RECEIPT' : 'PAYMENT', partyType: side, status: 'POSTED', ...(partyId ? { partyId } : {}) },
    include: { allocations: true },
  });
  const m = new Map<number, number>();
  for (const v of vs) {
    const left = r2(num(v.amount) - v.allocations.reduce((s, a) => s + num(a.amount), 0));
    if (left > 0.005 && v.partyId) m.set(v.partyId, r2((m.get(v.partyId) ?? 0) + left));
  }
  return m;
}

function buildRouter(side: Side) {
  const router = Router();
  const mod = 'ledger';
  const accountKey = side === 'CUSTOMER' ? 'AR' : 'AP';
  const sign = side === 'CUSTOMER' ? 1 : -1; // balance = sign * (debit - credit)

  // ---- balances list
  router.get(
    side === 'CUSTOMER' ? '/customers' : '/suppliers',
    can(mod, 'view'),
    ah(async (req, res) => {
      const q = listQuery(req);
      const acc = await accountIdByKey(prisma, accountKey);
      const sums = await prisma.journalLine.groupBy({ by: ['partyId'], where: { accountId: acc, partyType: side }, _sum: { debit: true, credit: true } });
      const sm = new Map(sums.map((s) => [s.partyId as number, s._sum]));
      const searchWhere = q.search ? { OR: [{ name: { contains: q.search } }, { code: { contains: q.search } }] } : {};
      const parties = side === 'CUSTOMER' ? await prisma.customer.findMany({ where: searchWhere, orderBy: { name: 'asc' } }) : await prisma.supplier.findMany({ where: searchWhere, orderBy: { name: 'asc' } });
      const un = await unapplied(side);
      const all = parties.map((p) => {
        const s = sm.get(p.id);
        const debit = num(s?.debit);
        const credit = num(s?.credit);
        const opening = num(p.openingBalance);
        const balance = r2(opening + sign * (debit - credit));
        return { id: p.id, code: p.code, name: p.name, isActive: p.isActive, openingBalance: opening, debit: r2(debit), credit: r2(credit), balance, unappliedAmount: un.get(p.id) ?? 0, creditLimit: num(p.creditLimit), overLimit: num(p.creditLimit) > 0 && balance > num(p.creditLimit) };
      });
      const nonZeroOnly = req.query.includeZero !== '1';
      const rows = nonZeroOnly ? all.filter((r) => Math.abs(r.balance) > 0.005) : all;
      if (req.query.sort === 'balance') rows.sort((a, b) => (q.dir === 'asc' ? a.balance - b.balance : b.balance - a.balance));
      res.json({ ...paged(rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), rows.length, q), totalBalance: r2(rows.reduce((s, r) => s + r.balance, 0)) });
    }),
  );

  // ---- statement
  router.get(
    '/statement/:partyId',
    can(mod, 'view'),
    ah(async (req, res) => {
      const partyId = intParam(req, 'partyId');
      const party = side === 'CUSTOMER' ? await prisma.customer.findUnique({ where: { id: partyId } }) : await prisma.supplier.findUnique({ where: { id: partyId } });
      if (!party) throw notFound(`${side === 'CUSTOMER' ? 'Customer' : 'Supplier'} not found`);
      const from = qDate(req.query.from);
      const to = qDate(req.query.to, true);
      const acc = await accountIdByKey(prisma, accountKey);
      const base = { accountId: acc, partyType: side, partyId };
      let opening = num(party.openingBalance);
      if (from) {
        const o = await prisma.journalLine.aggregate({ where: { ...base, journal: { entryDate: { lt: from } } }, _sum: { debit: true, credit: true } });
        opening = r2(opening + sign * (num(o._sum.debit) - num(o._sum.credit)));
      }
      const lines = await prisma.journalLine.findMany({
        where: { ...base, ...(from || to ? { journal: { entryDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } } : {}) },
        include: { journal: true },
        orderBy: [{ journal: { entryDate: 'asc' } }, { journalId: 'asc' }, { id: 'asc' }],
      });
      let run = opening;
      const summary: Record<string, { debit: number; credit: number; count: number }> = {};
      const entries = lines.map((l) => {
        const d = num(l.debit);
        const c = num(l.credit);
        run = r2(run + sign * (d - c));
        const kind = classifyEntry(l.journal);
        const s = (summary[kind] ??= { debit: 0, credit: 0, count: 0 });
        s.debit = r2(s.debit + d);
        s.credit = r2(s.credit + c);
        s.count++;
        return { date: l.journal.entryDate, entryNo: l.journal.entryNo, journalId: l.journalId, kind, reference: l.journal.sourceNo ?? l.journal.entryNo, sourceType: l.journal.sourceType, sourceId: l.journal.sourceId, narration: l.description || l.journal.narration, debit: d, credit: c, balance: run };
      });
      res.json({
        partyType: side,
        party: { id: party.id, code: party.code, name: party.name },
        from: from ?? null,
        to: to ?? null,
        openingBalance: opening,
        entries,
        summary,
        totalDebit: r2(lines.reduce((s, l) => s + num(l.debit), 0)),
        totalCredit: r2(lines.reduce((s, l) => s + num(l.credit), 0)),
        closingBalance: run,
      });
    }),
  );

  // ---- aging
  router.get(
    '/aging',
    can(mod, 'view'),
    ah(async (req, res) => {
      const asOf = qAsOf(req);
      const partyId = qInt(req.query.partyId ?? req.query.customerId ?? req.query.supplierId);
      const docs = await openDocs(side, asOf, partyId);
      const un = await unapplied(side, partyId);
      // ledger balance per party (as of date): anything beyond open invoices - unapplied vouchers is an unapplied credit/debit note
      const ledgerSums = await prisma.journalLine.groupBy({
        by: ['partyId'],
        where: { accountId: await accountIdByKey(prisma, accountKey), partyType: side, ...(partyId ? { partyId } : {}), journal: { entryDate: { lte: asOf } } },
        _sum: { debit: true, credit: true },
      });
      const ledgerBal = new Map(ledgerSums.filter((s) => s.partyId).map((s) => [s.partyId as number, r2(sign * (num(s._sum.debit) - num(s._sum.credit)))]));
      const openByParty = new Map<number, number>();
      for (const d of docs) openByParty.set(d.partyId, r2((openByParty.get(d.partyId) ?? 0) + d.outstanding));
      const notesAdj = new Map<number, number>();
      for (const [id, bal] of ledgerBal) {
        const adj = r2(bal - ((openByParty.get(id) ?? 0) - (un.get(id) ?? 0)));
        if (Math.abs(adj) > 0.005) notesAdj.set(id, adj);
      }
      const ids = [...new Set([...docs.map((d) => d.partyId), ...un.keys(), ...notesAdj.keys()])];
      const pm = await partyMap(side, ids);
      const byParty = new Map<number, { buckets: Record<Bucket, number>; outstanding: number; invoices: Array<OpenDoc & { daysPastDue: number; bucket: Bucket }> }>();
      for (const d of docs) {
        const dp = daysBetween(asOf, d.dueDate ?? d.docDate);
        const b = bucketOf(dp);
        const e = byParty.get(d.partyId) ?? { buckets: emptyBuckets(), outstanding: 0, invoices: [] };
        e.buckets[b] = r2(e.buckets[b] + d.outstanding);
        e.outstanding = r2(e.outstanding + d.outstanding);
        e.invoices.push({ ...d, daysPastDue: dp, bucket: b });
        byParty.set(d.partyId, e);
      }
      for (const id of [...un.keys(), ...notesAdj.keys()]) if (!byParty.has(id)) byParty.set(id, { buckets: emptyBuckets(), outstanding: 0, invoices: [] });
      const detail = req.query.detail === '1';
      const rows = [...byParty.entries()].map(([id, e]) => {
        const p = pm.get(id);
        const opening = partyId || req.query.includeOpening === '1' ? num(p?.openingBalance) : 0;
        const credit = un.get(id) ?? 0;
        return { partyId: id, party: p ? { id: p.id, code: p.code, name: p.name } : null, ...e.buckets, outstanding: e.outstanding, unappliedCredit: credit, unappliedNotes: notesAdj.get(id) ?? 0, openingBalance: opening, total: r2(e.outstanding - credit + (notesAdj.get(id) ?? 0) + opening), ...(detail ? { invoices: e.invoices } : {}) };
      });
      rows.sort((a, b) => (a.party?.name ?? '').localeCompare(b.party?.name ?? ''));
      const totals = { ...emptyBuckets(), outstanding: 0, unappliedCredit: 0, unappliedNotes: 0, openingBalance: 0, total: 0 } as Record<string, number>;
      for (const r of rows) for (const k of [...BUCKETS, 'outstanding', 'unappliedCredit', 'unappliedNotes', 'openingBalance', 'total']) totals[k] = r2(totals[k] + (r as unknown as Record<string, number>)[k]);
      res.json({ asOf, partyType: side, buckets: BUCKETS, rows, totals });
    }),
  );

  // ---- outstanding / due-today / overdue
  const listDocs = (filter: (d: OpenDoc, today: Date) => boolean, extra?: (d: OpenDoc, today: Date) => Record<string, unknown>) =>
    ah(async (req, res) => {
      const q = listQuery(req);
      const today = new Date();
      const partyId = qInt(req.query.partyId ?? req.query.customerId ?? req.query.supplierId);
      const docs = (await openDocs(side, dayEnd(today), partyId)).filter((d) => filter(d, today));
      const pm = await partyMap(side, [...new Set(docs.map((d) => d.partyId))]);
      let rows = docs.map((d) => {
        const p = pm.get(d.partyId);
        const due = d.dueDate ?? d.docDate;
        return { ...d, party: p ? { id: p.id, code: p.code, name: p.name } : null, daysPastDue: daysBetween(today, due), ...(extra ? extra(d, today) : {}) };
      });
      if (q.search) {
        const s = q.search.toLowerCase();
        rows = rows.filter((r) => r.docNo.toLowerCase().includes(s) || (r.party?.name ?? '').toLowerCase().includes(s));
      }
      rows.sort((a, b) => b.daysPastDue - a.daysPastDue);
      res.json({ ...paged(rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), rows.length, q), totalOutstanding: r2(rows.reduce((s, r) => s + r.outstanding, 0)) });
    });

  router.get('/outstanding', can(mod, 'view'), listDocs(() => true));
  if (side === 'CUSTOMER') {
    router.get('/due-today', can(mod, 'view'), listDocs((d, t) => !!d.dueDate && daysBetween(t, d.dueDate) === 0));
    router.get('/overdue', can(mod, 'view'), listDocs((d, t) => daysBetween(t, d.dueDate ?? d.docDate) > 0));
  } else {
    router.get('/due-today', can(mod, 'view'), listDocs((d, t) => !!d.dueDate && daysBetween(t, d.dueDate) === 0));
    router.get('/overdue', can(mod, 'view'), listDocs((d, t) => daysBetween(t, d.dueDate ?? d.docDate) > 0));
  }
  return router;
}

export default [
  { path: '/receivables', router: buildRouter('CUSTOMER') },
  { path: '/payables', router: buildRouter('SUPPLIER') },
] satisfies ModuleDef[];
