import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, intParam, listQuery, parse, paged } from '../lib/http';
import { badRequest, conflict, notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { num, r2 } from '../lib/calc';
import { postJournal, reverseJournal, accountIdByKey } from '../services/accounting';
import { audit } from '../services/audit';
import { accountTotals, allAccounts, buildTree, natural, partyNames, qDate, qInt, qAsOf } from '../services/finance-common';
import type { ModuleDef } from '../app';

// =====================================================================  CHART OF ACCOUNTS
const accounts = Router();
const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COGS', 'EXPENSE'] as const;

const accSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1),
  type: z.enum(TYPES),
  parentId: z.number().int().nullable().optional(),
  isGroup: z.boolean().optional(),
  isBank: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

async function validateParent(parentId: number | null | undefined, type: string, selfId?: number) {
  if (!parentId) return;
  if (selfId && parentId === selfId) throw badRequest('Account cannot be its own parent');
  const parent = await prisma.account.findUnique({ where: { id: parentId } });
  if (!parent) throw badRequest('Parent account not found');
  if (!parent.isGroup) throw badRequest(`Parent account "${parent.name}" is not a group account`);
  if (parent.type !== type) throw badRequest(`Parent type ${parent.type} does not match account type ${type}`);
  if (selfId) {
    // cycle check
    let cur = parent.parentId;
    while (cur) {
      if (cur === selfId) throw badRequest('Circular account hierarchy');
      cur = (await prisma.account.findUnique({ where: { id: cur }, select: { parentId: true } }))?.parentId ?? null;
    }
  }
}

accounts.get(
  '/',
  can('chart_of_accounts', 'view'),
  ah(async (req, res) => {
    const withBal = req.query.balances === '1' || req.query.balances === 'true';
    const asOf = qAsOf(req);
    const totals = withBal ? await accountTotals({ to: asOf }) : new Map();
    const accs = await allAccounts();
    if (req.query.tree === '1' || req.query.tree === 'true') {
      const { roots } = buildTree(accs, totals);
      const fmt = (n: ReturnType<typeof buildTree>['roots'][number]): unknown => ({
        ...n,
        ...(withBal ? { balance: natural(n.type, n.debit, n.credit), signedBalance: r2(n.debit - n.credit) } : { debit: undefined, credit: undefined }),
        children: (n.children ?? []).map((c) => fmt(c)),
      });
      return res.json(roots.map((n) => fmt(n)));
    }
    const q = listQuery(req);
    const search = q.search.toLowerCase();
    const type = req.query.type ? String(req.query.type) : undefined;
    const isGroup = req.query.isGroup === undefined ? undefined : req.query.isGroup === '1' || req.query.isGroup === 'true';
    const isBank = req.query.isBank === undefined ? undefined : req.query.isBank === '1' || req.query.isBank === 'true';
    const active = req.query.isActive === undefined ? undefined : req.query.isActive === '1' || req.query.isActive === 'true';
    const postable = req.query.postable === '1';
    const byId = new Map(accs.map((a) => [a.id, a]));
    let list = accs.filter(
      (a) =>
        (!search || a.code.toLowerCase().includes(search) || a.name.toLowerCase().includes(search)) &&
        (!type || a.type === type) &&
        (isGroup === undefined || a.isGroup === isGroup) &&
        (isBank === undefined || a.isBank === isBank) &&
        (active === undefined || a.isActive === active) &&
        (!postable || (!a.isGroup && a.isActive)),
    );
    const total = list.length;
    if (req.query.all !== '1') list = list.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    const rows = list.map((a) => {
      const t = totals.get(a.id);
      return { ...a, parent: a.parentId ? { id: a.parentId, code: byId.get(a.parentId)?.code, name: byId.get(a.parentId)?.name } : null, ...(withBal ? { debit: t?.debit ?? 0, credit: t?.credit ?? 0, balance: natural(a.type, t?.debit ?? 0, t?.credit ?? 0) } : {}) };
    });
    res.json(req.query.all === '1' ? { rows, total, page: 1, pageSize: total } : paged(rows, total, q));
  }),
);

accounts.get(
  '/:id',
  can('chart_of_accounts', 'view'),
  ah(async (req, res) => {
    const id = intParam(req);
    const a = await prisma.account.findUnique({ where: { id }, include: { parent: { select: { id: true, code: true, name: true } } } });
    if (!a) throw notFound('Account not found');
    const agg = await prisma.journalLine.aggregate({ where: { accountId: id }, _sum: { debit: true, credit: true }, _count: true });
    res.json({ ...a, debit: num(agg._sum.debit), credit: num(agg._sum.credit), balance: natural(a.type, num(agg._sum.debit), num(agg._sum.credit)), lineCount: agg._count });
  }),
);

accounts.post(
  '/',
  can('chart_of_accounts', 'create'),
  ah(async (req, res) => {
    const b = parse(accSchema, req.body);
    await validateParent(b.parentId, b.type);
    const dup = await prisma.account.findUnique({ where: { code: b.code } });
    if (dup) throw conflict(`Account code ${b.code} already exists`);
    const a = await prisma.$transaction(async (tx) => {
      const row = await tx.account.create({ data: { code: b.code, name: b.name, type: b.type, parentId: b.parentId ?? null, isGroup: b.isGroup ?? false, isBank: b.isGroup ? false : b.isBank ?? false, isActive: b.isActive ?? true } });
      await audit(tx, req.user, 'CREATE', 'Account', row.id, { code: b.code, name: b.name });
      return row;
    });
    res.status(201).json(a);
  }),
);

accounts.put(
  '/:id',
  can('chart_of_accounts', 'edit'),
  ah(async (req, res) => {
    const id = intParam(req);
    const b = parse(accSchema.partial(), req.body);
    const cur = await prisma.account.findUnique({ where: { id } });
    if (!cur) throw notFound('Account not found');
    const lineCount = await prisma.journalLine.count({ where: { accountId: id } });
    const childCount = await prisma.account.count({ where: { parentId: id } });
    const type = b.type ?? cur.type;
    if (b.type && b.type !== cur.type) {
      if (cur.systemKey) throw badRequest('Cannot change the type of a system account');
      if (lineCount) throw badRequest('Cannot change the type of an account with journal lines');
      if (childCount) throw badRequest('Cannot change the type of an account with children');
    }
    if (b.isGroup !== undefined && b.isGroup !== cur.isGroup) {
      if (cur.systemKey) throw badRequest('Cannot change group status of a system account');
      if (b.isGroup && lineCount) throw badRequest('Cannot convert an account with journal lines into a group');
      if (!b.isGroup && childCount) throw badRequest('Cannot convert a group with children into a posting account');
    }
    if (b.parentId !== undefined) await validateParent(b.parentId, type, id);
    else if (b.type && cur.parentId) await validateParent(cur.parentId, type, id);
    if (b.code && b.code !== cur.code) {
      const dup = await prisma.account.findUnique({ where: { code: b.code } });
      if (dup) throw conflict(`Account code ${b.code} already exists`);
    }
    if (b.isActive === false && cur.systemKey) throw badRequest('System accounts cannot be deactivated');
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.account.update({ where: { id }, data: { ...b } });
      await audit(tx, req.user, 'UPDATE', 'Account', id, b);
      return r;
    });
    res.json(row);
  }),
);

accounts.delete(
  '/:id',
  can('chart_of_accounts', 'delete'),
  ah(async (req, res) => {
    const id = intParam(req);
    const cur = await prisma.account.findUnique({ where: { id } });
    if (!cur) throw notFound('Account not found');
    if (cur.systemKey) throw badRequest(`System account (${cur.systemKey}) cannot be deleted`);
    if (await prisma.journalLine.count({ where: { accountId: id } })) throw badRequest('Account has journal lines; deactivate it instead');
    if (await prisma.account.count({ where: { parentId: id } })) throw badRequest('Account has child accounts');
    if (await prisma.voucher.count({ where: { OR: [{ accountId: id }, { counterAccountId: id }] } })) throw badRequest('Account is used by vouchers');
    await prisma.$transaction(async (tx) => {
      await tx.account.delete({ where: { id } });
      await audit(tx, req.user, 'DELETE', 'Account', id, { code: cur.code, name: cur.name });
    });
    res.json({ ok: true });
  }),
);

// =====================================================================  JOURNAL VOUCHERS
const journals = Router();

const lineSchema = z.object({
  accountId: z.number().int(),
  debit: z.number().min(0).optional(),
  credit: z.number().min(0).optional(),
  partyType: z.enum(['CUSTOMER', 'SUPPLIER']).optional().nullable(),
  partyId: z.number().int().optional().nullable(),
  description: z.string().optional().nullable(),
});
const journalSchema = z.object({
  date: z.coerce.date(),
  narration: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(2),
});

async function presentJournal(id: number) {
  const j = await prisma.journalEntry.findUnique({ where: { id }, include: { lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } }, orderBy: { id: 'asc' } } } });
  if (!j) throw notFound('Journal not found');
  const pn = await partyNames(j.lines);
  const user = j.createdBy ? await prisma.user.findUnique({ where: { id: j.createdBy }, select: { id: true, username: true } }) : null;
  return {
    ...j,
    totalDebit: num(j.totalDebit),
    createdByUser: user,
    lines: j.lines.map((l) => ({ ...l, debit: num(l.debit), credit: num(l.credit), vatAmount: num(l.vatAmount), party: pn(l.partyType, l.partyId) })),
  };
}

journals.get(
  '/',
  can('journal', 'view'),
  ah(async (req, res) => {
    const q = listQuery(req);
    const where: Record<string, unknown> = {};
    if (req.query.entryType) where.entryType = String(req.query.entryType);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.sourceType) where.sourceType = String(req.query.sourceType);
    const from = qDate(req.query.from);
    const to = qDate(req.query.to, true);
    if (from || to) where.entryDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    const acc = qInt(req.query.accountId);
    if (acc) where.lines = { some: { accountId: acc } };
    if (q.search) where.OR = [{ entryNo: { contains: q.search } }, { narration: { contains: q.search } }, { sourceNo: { contains: q.search } }];
    const sortable = ['entryNo', 'entryDate', 'totalDebit', 'status', 'id'];
    const orderBy = { [q.sort && sortable.includes(q.sort) ? q.sort : 'id']: q.dir };
    const [rows, total] = await Promise.all([
      prisma.journalEntry.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.journalEntry.count({ where }),
    ]);
    res.json(paged(rows.map((r) => ({ ...r, totalDebit: num(r.totalDebit) })), total, q));
  }),
);

journals.get(
  '/:id',
  can('journal', 'view'),
  ah(async (req, res) => {
    res.json(await presentJournal(intParam(req)));
  }),
);

/** validates party requirements on subledger control accounts */
async function checkLines(lines: z.infer<typeof lineSchema>[]) {
  const ar = await accountIdByKey(prisma, 'AR');
  const ap = await accountIdByKey(prisma, 'AP');
  for (const l of lines) {
    if ((l.debit ?? 0) > 0 && (l.credit ?? 0) > 0) throw badRequest('A line cannot have both debit and credit');
    if (!(l.debit ?? 0) && !(l.credit ?? 0)) throw badRequest('Each line needs a debit or a credit amount');
    const acc = await prisma.account.findUnique({ where: { id: l.accountId } });
    if (!acc) throw badRequest(`Account ${l.accountId} not found`);
    if (acc.isGroup) throw badRequest(`Cannot post to group account ${acc.code} ${acc.name}`);
    if (!acc.isActive) throw badRequest(`Account ${acc.code} is inactive`);
    if (acc.id === ar && (l.partyType !== 'CUSTOMER' || !l.partyId)) throw badRequest('Accounts Receivable lines require a customer');
    if (acc.id === ap && (l.partyType !== 'SUPPLIER' || !l.partyId)) throw badRequest('Accounts Payable lines require a supplier');
    if (l.partyType && l.partyId) {
      const ok = l.partyType === 'CUSTOMER' ? await prisma.customer.count({ where: { id: l.partyId } }) : await prisma.supplier.count({ where: { id: l.partyId } });
      if (!ok) throw badRequest(`${l.partyType} ${l.partyId} not found`);
    }
  }
}

journals.post(
  '/',
  can('journal', 'create'),
  ah(async (req, res) => {
    const b = parse(journalSchema, req.body);
    await checkLines(b.lines);
    const j = await prisma.$transaction(
      async (tx) => {
        const row = await postJournal(tx, {
          date: b.date,
          entryType: 'JOURNAL',
          sourceType: 'JOURNAL_VOUCHER',
          narration: b.narration ?? undefined,
          userId: req.user?.id,
          lines: b.lines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            partyType: l.partyType ?? undefined,
            partyId: l.partyId ?? undefined,
            description: l.description ?? undefined,
          })),
        });
        await audit(tx, req.user, 'POST', 'JournalEntry', row.id, { entryNo: row.entryNo, totalDebit: num(row.totalDebit) });
        return row;
      },
      { timeout: 30000 },
    );
    res.status(201).json(await presentJournal(j.id));
  }),
);

journals.put('/:id', can('journal', 'edit'), ah(async () => {
  throw badRequest('Posted journals cannot be edited. Reverse the journal (POST /journals/:id/reverse) and post a new one.');
}));

journals.post(
  '/:id/reverse',
  can('journal', 'cancel'),
  ah(async (req, res) => {
    const id = intParam(req);
    const date = req.body?.date ? new Date(req.body.date) : new Date();
    const rev = await prisma.$transaction(async (tx) => {
      const j = await tx.journalEntry.findUnique({ where: { id } });
      if (!j) throw notFound('Journal not found');
      if (!['JOURNAL', 'OPENING'].includes(j.entryType) || j.sourceType === 'ADVANCE_SETTLEMENT') {
        throw badRequest('Only manual journal / opening-balance entries can be reversed here; cancel the source document instead');
      }
      if ((j.narration ?? '').startsWith('Reversal of ')) throw badRequest('This entry is itself a reversal');
      const r = await reverseJournal(tx, id, req.user?.id, date);
      await audit(tx, req.user, 'REVERSE', 'JournalEntry', id, { entryNo: j.entryNo, reversalNo: r.entryNo });
      return r;
    });
    res.json({ reversal: await presentJournal(rev.id), original: await presentJournal(id) });
  }),
);

// ---- opening balances (account level vs OPENING_EQUITY)
const openingSchema = z.object({
  date: z.coerce.date(),
  narration: z.string().optional().nullable(),
  lines: z.array(z.object({ accountId: z.number().int(), debit: z.number().min(0).optional(), credit: z.number().min(0).optional(), description: z.string().optional().nullable() })).min(1),
});
journals.post(
  '/opening-balance',
  can('journal', 'create'),
  ah(async (req, res) => {
    const b = parse(openingSchema, req.body);
    const eq = await accountIdByKey(prisma, 'OPENING_EQUITY');
    const blocked = new Map<number, string>();
    for (const k of ['AR', 'AP', 'INVENTORY']) blocked.set(await accountIdByKey(prisma, k), k);
    for (const l of b.lines) {
      if (l.accountId === eq) throw badRequest('Opening equity is balanced automatically; do not include it');
      const k = blocked.get(l.accountId);
      if (k === 'AR') throw badRequest('Customer opening balances are entered on the customer master (openingBalance)');
      if (k === 'AP') throw badRequest('Supplier opening balances are entered on the supplier master (openingBalance)');
      if (k === 'INVENTORY') throw badRequest('Opening stock must be entered through a Stock Adjustment of type OPENING');
      if ((l.debit ?? 0) > 0 && (l.credit ?? 0) > 0) throw badRequest('A line cannot have both debit and credit');
      if (!(l.debit ?? 0) && !(l.credit ?? 0)) throw badRequest('Each line needs a debit or credit amount');
    }
    const dr = r2(b.lines.reduce((s, l) => s + (l.debit ?? 0), 0));
    const cr = r2(b.lines.reduce((s, l) => s + (l.credit ?? 0), 0));
    const diff = r2(dr - cr);
    const j = await prisma.$transaction(
      async (tx) => {
        const row = await postJournal(tx, {
          date: b.date,
          entryType: 'OPENING',
          sourceType: 'OPENING_BALANCE',
          narration: b.narration ?? 'Opening balances',
          userId: req.user?.id,
          lines: [
            ...b.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description ?? undefined })),
            { accountId: eq, debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0, description: 'Opening balance equity' },
          ],
        });
        await audit(tx, req.user, 'POST', 'JournalEntry', row.id, { entryNo: row.entryNo, opening: true });
        return row;
      },
      { timeout: 30000 },
    );
    res.status(201).json(await presentJournal(j.id));
  }),
);

export default [
  { path: '/accounts', router: accounts },
  { path: '/journals', router: journals },
] satisfies ModuleDef[];
