import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ah, listQuery, paged } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { num, r2, calcLine } from '../lib/calc';
import { accountIdByKey } from '../services/accounting';
import {
  accountTotals,
  allAccounts,
  buildTree,
  descendantIds,
  natural,
  partyNames,
  qAsOf,
  qDate,
  qInt,
  SALES_LIVE,
  TreeNode,
  AccRow,
} from '../services/finance-common';
import { drCr, partyHeads } from '../services/party-heads';
import { recordOpeningVisible } from '../lib/bu';
import type { ModuleDef } from '../app';

// =====================================================================  LEDGER REPORTS
const ledger = Router();

/** Customer (side=CUSTOMER) or supplier (side=SUPPLIER) heads under the Trade Debtors / Creditors control account. */
ledger.get(
  '/party-heads',
  can('ledger', 'view'),
  ah(async (req, res) => {
    const side = String(req.query.side ?? '').toUpperCase();
    if (side !== 'CUSTOMER' && side !== 'SUPPLIER') throw badRequest('side must be CUSTOMER or SUPPLIER');
    const ph = await partyHeads(side, { from: qDate(req.query.from), to: qDate(req.query.to ?? req.query.asOf, true), includeZero: req.query.includeZero === '1' });
    res.json(ph);
  }),
);

ledger.get(
  '/general',
  can('ledger', 'view'),
  ah(async (req, res) => {
    const accountId = qInt(req.query.accountId);
    if (!accountId) throw badRequest('accountId is required');
    const accs = await allAccounts();
    const acc = accs.find((a) => a.id === accountId);
    if (!acc) throw notFound('Account not found');
    const from = qDate(req.query.from);
    const to = qDate(req.query.to, true);
    const ids = descendantIds(accs, accountId);
    const partyWhere: Record<string, unknown> = {};
    if (req.query.partyType) partyWhere.partyType = String(req.query.partyType).toUpperCase();
    const pid = qInt(req.query.partyId);
    if (pid) partyWhere.partyId = pid;
    const base = { accountId: { in: ids }, ...partyWhere };
    let openDr = 0;
    let openCr = 0;
    if (from) {
      const o = await prisma.journalLine.aggregate({ where: { ...base, journal: { entryDate: { lt: from } } }, _sum: { debit: true, credit: true } });
      openDr = num(o._sum.debit);
      openCr = num(o._sum.credit);
    }
    const lines = await prisma.journalLine.findMany({
      where: { ...base, ...(from || to ? { journal: { entryDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } } : {}) },
      include: { journal: true, account: { select: { id: true, code: true, name: true } } },
      orderBy: [{ journal: { entryDate: 'asc' } }, { journalId: 'asc' }, { id: 'asc' }],
    });
    const pn = await partyNames(lines);
    // one customer / supplier on its control account: its opening balance on the record belongs to the opening
    // (the opening journal carries it only as an untagged lump sum on the control account)
    let recordOpening = 0;
    if (pid && (acc.systemKey === 'AR' || acc.systemKey === 'AP')) {
      const side = String(req.query.partyType ?? '').toUpperCase();
      const p =
        side === 'CUSTOMER' && acc.systemKey === 'AR' ? await prisma.customer.findUnique({ where: { id: pid }, select: { openingBalance: true } })
        : side === 'SUPPLIER' && acc.systemKey === 'AP' ? await prisma.supplier.findUnique({ where: { id: pid }, select: { openingBalance: true } })
        : null;
      recordOpening = (await recordOpeningVisible()) ? num(p?.openingBalance) : 0; // natural sign for both (customer Dr, supplier Cr)
    }
    const opening = r2(natural(acc.type, openDr, openCr) + recordOpening);
    let running = opening;
    let totDr = 0;
    let totCr = 0;
    const entries = lines.map((l) => {
      const d = num(l.debit);
      const c = num(l.credit);
      totDr += d;
      totCr += c;
      running = r2(running + natural(acc.type, d, c));
      return {
        id: l.id,
        date: l.journal.entryDate,
        entryNo: l.journal.entryNo,
        journalId: l.journalId,
        entryType: l.journal.entryType,
        sourceType: l.journal.sourceType,
        sourceNo: l.journal.sourceNo,
        narration: l.description || l.journal.narration,
        status: l.journal.status,
        account: l.account,
        debit: d,
        credit: c,
        partner: pn(l.partyType, l.partyId),
        partyType: l.partyType,
        partyId: l.partyId,
        balance: running,
      };
    });
    res.json({
      account: acc,
      includesChildren: ids.length > 1,
      from: from ?? null,
      to: to ?? null,
      balanceBasis: DEBIT_BASIS.has(acc.type) ? 'DEBIT' : 'CREDIT',
      openingBalance: opening,
      totalDebit: r2(totDr),
      totalCredit: r2(totCr),
      closingBalance: running,
      entries,
    });
  }),
);
const DEBIT_BASIS = new Set(['ASSET', 'EXPENSE', 'COGS']);

/** flat code-ordered statement rows for the given types with natural-sign amounts */
function statement(accs: AccRow[], totals: Map<number, { debit: number; credit: number }>, types: string[], includeZero: boolean) {
  const { flat } = buildTree(accs, totals);
  const rows = flat
    .filter((n) => types.includes(n.type))
    .filter((n) => includeZero || n.debit !== 0 || n.credit !== 0)
    .map((n) => ({ id: n.id, code: n.code, name: n.name, type: n.type, parentId: n.parentId, isGroup: n.isGroup, level: n.level, amount: natural(n.type, n.debit, n.credit) }));
  const total = r2(
    accs
      .filter((a) => types.includes(a.type) && !a.isGroup)
      .reduce((s, a) => {
        const t = totals.get(a.id);
        return s + natural(a.type, t?.debit ?? 0, t?.credit ?? 0);
      }, 0),
  );
  return { rows, total };
}

ledger.get(
  '/trial-balance',
  can('ledger', 'view'),
  ah(async (req, res) => {
    const asOf = qAsOf(req);
    const from = qDate(req.query.from);
    const includeZero = req.query.includeZero === '1';
    const accs = await allAccounts();
    const totals = await accountTotals({ from, to: asOf });
    const opening = from ? await accountTotals({ to: new Date(from.getTime() - 1) }) : new Map();
    const { flat } = buildTree(accs, totals);
    const openTree = buildTree(accs, opening).flat;
    const openById = new Map(openTree.map((n) => [n.id, n]));
    const rows = flat
      .filter((n) => includeZero || n.debit !== 0 || n.credit !== 0 || (openById.get(n.id)?.debit ?? 0) !== 0 || (openById.get(n.id)?.credit ?? 0) !== 0)
      .map((n) => {
        const o = openById.get(n.id);
        const od = o?.debit ?? 0;
        const oc = o?.credit ?? 0;
        const net = r2(od - oc + n.debit - n.credit);
        return {
          id: n.id,
          code: n.code,
          name: n.name,
          type: n.type,
          parentId: n.parentId,
          isGroup: n.isGroup,
          level: n.level,
          openingDebit: r2(Math.max(od - oc, 0)),
          openingCredit: r2(Math.max(oc - od, 0)),
          debit: n.debit,
          credit: n.credit,
          closingDebit: net > 0 ? net : 0,
          closingCredit: net < 0 ? -net : 0,
        };
      });
    // ?parties=1: customer / supplier heads under Trade Debtors / Trade Creditors (breakdown only, not in totals)
    if (req.query.parties === '1') {
      for (const side of ['CUSTOMER', 'SUPPLIER'] as const) {
        const ph = await partyHeads(side, { from, to: asOf });
        if (!ph.control) continue;
        const at = rows.findIndex((r) => r.id === ph.control!.id);
        if (at < 0) continue;
        const lvl = rows[at].level + 1;
        const heads = [...ph.rows, ...(ph.unallocated ? [ph.unallocated] : [])].map((h) => {
          const o = drCr(side, h.opening);
          const c = drCr(side, h.closing);
          return {
            id: -(h.partyId ?? 0) - (side === 'SUPPLIER' ? 1e7 : 0) - 1, code: h.code, name: h.name, type: rows[at].type, parentId: ph.control!.id, isGroup: false, level: lvl,
            party: true, partyType: side, partyId: h.partyId,
            openingDebit: from && h.partyId ? o.debit : 0, openingCredit: from && h.partyId ? o.credit : 0, debit: h.debit, credit: h.credit, closingDebit: c.debit, closingCredit: c.credit,
          };
        });
        rows.splice(at + 1, 0, ...(heads as typeof rows));
      }
    }
    const leaves = accs.filter((a) => !a.isGroup);
    let td = 0;
    let tc = 0;
    let cd = 0;
    let cc = 0;
    for (const a of leaves) {
      const t = totals.get(a.id) ?? { debit: 0, credit: 0 };
      const o = opening.get(a.id) ?? { debit: 0, credit: 0 };
      td += t.debit;
      tc += t.credit;
      const net = r2(o.debit - o.credit + t.debit - t.credit);
      if (net > 0) cd += net;
      else cc += -net;
    }
    const totalsOut = { debit: r2(td), credit: r2(tc), closingDebit: r2(cd), closingCredit: r2(cc) };
    res.json({ asOf, from: from ?? null, rows, totals: totalsOut, balanced: Math.abs(totalsOut.closingDebit - totalsOut.closingCredit) < 0.005 && Math.abs(totalsOut.debit - totalsOut.credit) < 0.005 });
  }),
);

async function plFigures(from: Date | undefined, to: Date | undefined, includeZero: boolean) {
  const accs = await allAccounts();
  const totals = await accountTotals({ from, to });
  const rev = statement(accs, totals, ['REVENUE'], includeZero);
  const cogs = statement(accs, totals, ['COGS'], includeZero);
  const exp = statement(accs, totals, ['EXPENSE'], includeZero);
  const grossProfit = r2(rev.total - cogs.total);
  return { revenue: rev, cogs, expenses: exp, grossProfit, netProfit: r2(grossProfit - exp.total) };
}

ledger.get(
  '/profit-loss',
  can('ledger', 'view'),
  ah(async (req, res) => {
    const from = qDate(req.query.from);
    const to = qDate(req.query.to, true);
    const f = await plFigures(from, to, req.query.includeZero === '1');
    res.json({
      from: from ?? null,
      to: to ?? null,
      revenue: { total: f.revenue.total, lines: f.revenue.rows },
      cogs: { total: f.cogs.total, lines: f.cogs.rows },
      grossProfit: f.grossProfit,
      grossMarginPct: f.revenue.total ? r2((f.grossProfit / f.revenue.total) * 100) : 0,
      expenses: { total: f.expenses.total, lines: f.expenses.rows },
      netProfit: f.netProfit,
    });
  }),
);

ledger.get(
  '/balance-sheet',
  can('ledger', 'view'),
  ah(async (req, res) => {
    const asOf = qAsOf(req);
    const includeZero = req.query.includeZero === '1';
    const accs = await allAccounts();
    const totals = await accountTotals({ to: asOf });
    const assets = statement(accs, totals, ['ASSET'], includeZero);
    const liabilities = statement(accs, totals, ['LIABILITY'], includeZero);
    const equity = statement(accs, totals, ['EQUITY'], includeZero);
    const rev = statement(accs, totals, ['REVENUE'], false).total;
    const cogs = statement(accs, totals, ['COGS'], false).total;
    const exp = statement(accs, totals, ['EXPENSE'], false).total;
    const currentEarnings = r2(rev - cogs - exp);
    const totalEquity = r2(equity.total + currentEarnings);
    const totalLE = r2(liabilities.total + totalEquity);
    res.json({
      asOf,
      assets: { total: assets.total, lines: assets.rows },
      liabilities: { total: liabilities.total, lines: liabilities.rows },
      equity: { accountsTotal: equity.total, currentPeriodEarnings: currentEarnings, total: totalEquity, lines: equity.rows },
      totalLiabilitiesAndEquity: totalLE,
      difference: r2(assets.total - totalLE),
      balanced: Math.abs(assets.total - totalLE) < 0.005,
    });
  }),
);

ledger.get(
  '/cash-flow',
  can('ledger', 'view'),
  ah(async (req, res) => {
    const from = qDate(req.query.from);
    const to = qDate(req.query.to, true);
    const accs = await allAccounts();
    const cash = accs.filter((a) => !a.isGroup && (a.isBank || a.systemKey === 'CASH'));
    const ids = cash.map((a) => a.id);
    let opening = 0;
    if (from) {
      const o = await prisma.journalLine.aggregate({ where: { accountId: { in: ids }, journal: { entryDate: { lt: from } } }, _sum: { debit: true, credit: true } });
      opening = r2(num(o._sum.debit) - num(o._sum.credit));
    }
    const lines = await prisma.journalLine.findMany({
      where: { accountId: { in: ids }, ...(from || to ? { journal: { entryDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } } : {}) },
      include: { journal: { select: { id: true, entryType: true, sourceType: true, lines: { select: { accountId: true, partyType: true } } } } },
    });
    const idSet = new Set(ids);
    const cats: Record<string, { key: string; label: string; group: 'OPERATING_RECEIPTS' | 'OPERATING_PAYMENTS' | 'OTHER'; inflow: number; outflow: number }> = {};
    const add = (key: string, label: string, group: 'OPERATING_RECEIPTS' | 'OPERATING_PAYMENTS' | 'OTHER', net: number) => {
      const c = (cats[key] ??= { key, label, group, inflow: 0, outflow: 0 });
      if (net >= 0) c.inflow += net;
      else c.outflow += -net;
    };
    for (const l of lines) {
      const net = num(l.debit) - num(l.credit);
      const others = l.journal.lines.filter((x) => !idSet.has(x.accountId));
      const hasCust = others.some((x) => x.partyType === 'CUSTOMER');
      const hasSupp = others.some((x) => x.partyType === 'SUPPLIER');
      const t = l.journal.entryType;
      if (t === 'RECEIPT') {
        if (hasCust) add('CUSTOMER_RECEIPTS', 'Receipts from customers', 'OPERATING_RECEIPTS', net);
        else if (hasSupp) add('SUPPLIER_REFUNDS', 'Refunds from suppliers', 'OPERATING_RECEIPTS', net);
        else add('OTHER_RECEIPTS', 'Other receipts', 'OPERATING_RECEIPTS', net);
      } else if (t === 'PAYMENT') {
        if (hasSupp) add('SUPPLIER_PAYMENTS', 'Payments to suppliers', 'OPERATING_PAYMENTS', net);
        else if (hasCust) add('CUSTOMER_REFUNDS', 'Refunds to customers', 'OPERATING_PAYMENTS', net);
        else add('OTHER_PAYMENTS', 'Other payments (expenses etc.)', 'OPERATING_PAYMENTS', net);
      } else {
        add('OTHER', 'Other cash movements (journals / transfers / cash sales)', 'OTHER', net);
      }
    }
    const sections = Object.values(cats).map((c) => ({ ...c, inflow: r2(c.inflow), outflow: r2(c.outflow), net: r2(c.inflow - c.outflow) }));
    const totalIn = r2(sections.reduce((s, c) => s + c.inflow, 0));
    const totalOut = r2(sections.reduce((s, c) => s + c.outflow, 0));
    const perAccount = cash.map((a) => {
      const ls = lines.filter((l) => l.accountId === a.id);
      return { id: a.id, code: a.code, name: a.name, inflow: r2(ls.reduce((s, l) => s + num(l.debit), 0)), outflow: r2(ls.reduce((s, l) => s + num(l.credit), 0)) };
    });
    res.json({ from: from ?? null, to: to ?? null, method: 'DIRECT', openingBalance: opening, sections, totalInflow: totalIn, totalOutflow: totalOut, netChange: r2(totalIn - totalOut), closingBalance: r2(opening + totalIn - totalOut), accounts: perAccount });
  }),
);

// =====================================================================  REGISTERS
const registers = Router();

async function bookRegister(accountIds: number[], from: Date | undefined, to: Date | undefined) {
  let opening = 0;
  if (from) {
    const o = await prisma.journalLine.aggregate({ where: { accountId: { in: accountIds }, journal: { entryDate: { lt: from } } }, _sum: { debit: true, credit: true } });
    opening = r2(num(o._sum.debit) - num(o._sum.credit));
  }
  const lines = await prisma.journalLine.findMany({
    where: { accountId: { in: accountIds }, ...(from || to ? { journal: { entryDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } } : {}) },
    include: { journal: { include: { lines: { include: { account: { select: { code: true, name: true } } } } } }, account: { select: { id: true, code: true, name: true } } },
    orderBy: [{ journal: { entryDate: 'asc' } }, { journalId: 'asc' }, { id: 'asc' }],
  });
  const pn = await partyNames(lines.flatMap((l) => l.journal.lines));
  let run = opening;
  let totDr = 0;
  let totCr = 0;
  const idSet = new Set(accountIds);
  const entries = lines.map((l) => {
    const d = num(l.debit);
    const c = num(l.credit);
    totDr += d;
    totCr += c;
    run = r2(run + d - c);
    const others = l.journal.lines.filter((x) => !idSet.has(x.accountId));
    const party = others.find((x) => x.partyType && x.partyId);
    return {
      date: l.journal.entryDate,
      entryNo: l.journal.entryNo,
      entryType: l.journal.entryType,
      sourceNo: l.journal.sourceNo,
      account: l.account,
      particulars: others.map((x) => `${x.account.code} ${x.account.name}`).join(', '),
      partner: party ? pn(party.partyType, party.partyId) : null,
      narration: l.description || l.journal.narration,
      receipt: d,
      payment: c,
      balance: run,
    };
  });
  return { openingBalance: opening, totalReceipts: r2(totDr), totalPayments: r2(totCr), closingBalance: run, entries };
}

registers.get(
  '/:kind',
  can('ledger', 'view'),
  ah(async (req, res) => {
    const kind = String(req.params.kind);
    const from = qDate(req.query.from);
    const to = qDate(req.query.to, true);
    const q = listQuery(req);
    const range = from || to ? { gte: from, lte: to } : undefined;
    const accs = await allAccounts();

    if (kind === 'cash-book' || kind === 'bank-book') {
      const accountId = qInt(req.query.accountId);
      let ids: number[];
      if (accountId) {
        const a = accs.find((x) => x.id === accountId);
        if (!a) throw notFound('Account not found');
        ids = descendantIds(accs, accountId).filter((i) => !accs.find((x) => x.id === i)!.isGroup);
      } else if (kind === 'cash-book') ids = [await accountIdByKey(prisma, 'CASH')];
      else ids = accs.filter((a) => a.isBank && !a.isGroup).map((a) => a.id);
      const book = await bookRegister(ids, from, to);
      return res.json({ kind, from: from ?? null, to: to ?? null, accounts: accs.filter((a) => ids.includes(a.id)).map((a) => ({ id: a.id, code: a.code, name: a.name })), ...book });
    }

    if (kind === 'sales' || kind === 'purchase') {
      const isSales = kind === 'sales';
      const where: Record<string, unknown> = { status: { in: req.query.status ? [String(req.query.status)] : SALES_LIVE }, ...(range ? { docDate: range } : {}) };
      const party = qInt(req.query.partyId ?? req.query.customerId ?? req.query.supplierId);
      if (party) where[isSales ? 'customerId' : 'supplierId'] = party;
      if (q.search) where.docNo = { contains: q.search };
      const all = isSales
        ? await prisma.salesInvoice.findMany({ where, orderBy: [{ docDate: 'asc' }, { id: 'asc' }] })
        : await prisma.purchaseInvoice.findMany({ where, orderBy: [{ docDate: 'asc' }, { id: 'asc' }] });
      const names = await partyNames(all.map((i) => ({ partyType: isSales ? 'CUSTOMER' : 'SUPPLIER', partyId: isSales ? (i as { customerId: number }).customerId : (i as { supplierId: number }).supplierId })));
      const rowsAll = all.map((i) => {
        const pid = isSales ? (i as { customerId: number }).customerId : (i as { supplierId: number }).supplierId;
        const settled = isSales ? num((i as { receivedAmount: unknown }).receivedAmount) : num((i as { paidAmount: unknown }).paidAmount);
        const ex = num(i.exchangeRate);
        return {
          id: i.id,
          docNo: i.docNo,
          docDate: i.docDate,
          party: names(isSales ? 'CUSTOMER' : 'SUPPLIER', pid),
          currencyCode: i.currencyCode,
          subtotal: r2(num(i.subtotal) * ex),
          discount: r2(num(i.discount) * ex),
          vatAmount: r2(num(i.vatAmount) * ex),
          total: num(i.baseTotal),
          settled,
          outstanding: r2(num(i.baseTotal) - settled),
          status: i.status,
        };
      });
      const totals = { subtotal: r2(rowsAll.reduce((s, r) => s + r.subtotal, 0)), discount: r2(rowsAll.reduce((s, r) => s + r.discount, 0)), vatAmount: r2(rowsAll.reduce((s, r) => s + r.vatAmount, 0)), total: r2(rowsAll.reduce((s, r) => s + r.total, 0)), settled: r2(rowsAll.reduce((s, r) => s + r.settled, 0)), outstanding: r2(rowsAll.reduce((s, r) => s + r.outstanding, 0)) };
      return res.json({ kind, from: from ?? null, to: to ?? null, ...paged(rowsAll.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), rowsAll.length, q), totals });
    }

    if (kind === 'receipts' || kind === 'payments') {
      const where: Record<string, unknown> = { voucherType: kind === 'receipts' ? 'RECEIPT' : 'PAYMENT', status: req.query.status ? String(req.query.status) : 'POSTED', ...(range ? { voucherDate: range } : {}) };
      const accountId = qInt(req.query.accountId);
      if (accountId) where.accountId = accountId;
      if (req.query.mode) where.mode = String(req.query.mode);
      const all = await prisma.voucher.findMany({ where, orderBy: [{ voucherDate: 'asc' }, { id: 'asc' }] });
      const names = await partyNames(all);
      const accNames = new Map(accs.map((a) => [a.id, a]));
      const rows = all.map((v) => ({ id: v.id, voucherNo: v.voucherNo, voucherDate: v.voucherDate, mode: v.mode, party: names(v.partyType, v.partyId), partyType: v.partyType, account: { id: v.accountId, code: accNames.get(v.accountId)?.code, name: accNames.get(v.accountId)?.name }, reference: v.reference, narration: v.narration, amount: num(v.amount), status: v.status }));
      return res.json({ kind, from: from ?? null, to: to ?? null, ...paged(rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), rows.length, q), totals: { amount: r2(rows.reduce((s, r) => s + r.amount, 0)), cash: r2(rows.filter((r) => r.mode === 'CASH').reduce((s, r) => s + r.amount, 0)), bank: r2(rows.filter((r) => r.mode === 'BANK').reduce((s, r) => s + r.amount, 0)) } });
    }

    if (kind === 'journal') {
      const where: Record<string, unknown> = { ...(range ? { entryDate: range } : {}) };
      if (req.query.entryType) where.entryType = String(req.query.entryType);
      if (q.search) where.OR = [{ entryNo: { contains: q.search } }, { narration: { contains: q.search } }, { sourceNo: { contains: q.search } }];
      const withLines = req.query.lines === '1';
      const [raw, total, agg] = await Promise.all([
        prisma.journalEntry.findMany({ where, orderBy: [{ entryDate: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: withLines ? { lines: { include: { account: { select: { code: true, name: true } } } } } : undefined }),
        prisma.journalEntry.count({ where }),
        prisma.journalEntry.aggregate({ where, _sum: { totalDebit: true } }),
      ]);
      return res.json({ kind, from: from ?? null, to: to ?? null, ...paged(raw.map((j) => ({ ...j, totalDebit: num(j.totalDebit) })), total, q), totals: { amount: r2(num(agg._sum.totalDebit)) } });
    }
    throw badRequest('Unknown register. Use cash-book | bank-book | sales | purchase | receipts | payments | journal');
  }),
);

// =====================================================================  VAT
const vat = Router();

type Cat = 'TAXABLE' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE';
async function vatResolver() {
  const codes = await prisma.vatCode.findMany({ orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] });
  const byCode = new Map(codes.map((c) => [c.code, c]));
  const firstOf = (cat: string) => codes.find((c) => c.category === cat);
  /** resolve (rate, party vat category) to a VAT code / category from the master */
  const resolve = (rate: number, partyCat?: string | null) => {
    if (rate > 0) {
      const c = codes.find((x) => x.category === 'TAXABLE' && num(x.rate) === rate) ?? codes.find((x) => num(x.rate) === rate);
      return { code: c?.code ?? null, category: (c?.category ?? 'TAXABLE') as Cat, rate };
    }
    const cat = partyCat && ['ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'].includes(partyCat) ? partyCat : 'ZERO_RATED';
    const c = firstOf(cat);
    return { code: c?.code ?? null, category: cat as Cat, rate: 0 };
  };
  return { codes, byCode, resolve };
}

interface VatRow {
  type: string; // SALES | PURCHASE | SALES_CREDIT_NOTE | SALES_DEBIT_NOTE | PURCHASE_CREDIT_NOTE | PURCHASE_DEBIT_NOTE
  docType: string;
  docId: number;
  docNo: string;
  date: Date;
  partyType: 'CUSTOMER' | 'SUPPLIER';
  partyId: number;
  party?: { id: number; code: string; name: string } | null;
  trn?: string | null;
  vatCode: string | null;
  category: Cat;
  rate: number;
  taxable: number; // base currency, signed for the VAT return (credit notes negative on their side)
  vatAmount: number;
}

async function vatRows(from: Date | undefined, to: Date | undefined, typeFilter?: string): Promise<VatRow[]> {
  const { resolve, byCode } = await vatResolver();
  const out: VatRow[] = [];
  const range = from || to ? { gte: from, lte: to } : undefined;
  const want = (t: string) => !typeFilter || typeFilter === t || (typeFilter === 'CREDIT_NOTE' && t.endsWith('CREDIT_NOTE')) || (typeFilter === 'DEBIT_NOTE' && t.endsWith('DEBIT_NOTE'));

  if (want('SALES')) {
    const invs = await prisma.salesInvoice.findMany({ where: { status: { in: SALES_LIVE }, ...(range ? { docDate: range } : {}) }, include: { items: true }, orderBy: { docDate: 'asc' } });
    const custs = await prisma.customer.findMany({ where: { id: { in: [...new Set(invs.map((i) => i.customerId))] } }, select: { id: true, vatCategory: true, trn: true } });
    const cm = new Map(custs.map((c) => [c.id, c]));
    for (const inv of invs) {
      const ex = num(inv.exchangeRate) || 1;
      const groups = new Map<number, { taxable: number; vat: number }>();
      for (const it of inv.items) {
        const c = calcLine({ qty: it.qty, rate: it.rate, discount: it.discount, vatRate: it.vatRate });
        const g = groups.get(num(it.vatRate)) ?? { taxable: 0, vat: 0 };
        g.taxable += c.net;
        g.vat += num(it.vatAmount);
        groups.set(num(it.vatRate), g);
      }
      const cust = cm.get(inv.customerId);
      for (const [rate, g] of groups) {
        const r = resolve(rate, inv.vatExempt ? 'EXEMPT' : cust?.vatCategory);
        out.push({ type: 'SALES', docType: 'SALES_INVOICE', docId: inv.id, docNo: inv.docNo, date: inv.docDate, partyType: 'CUSTOMER', partyId: inv.customerId, trn: inv.trn ?? cust?.trn, vatCode: r.code, category: r.category, rate, taxable: r2(g.taxable * ex), vatAmount: r2(g.vat * ex) });
      }
    }
  }
  if (want('PURCHASE')) {
    const invs = await prisma.purchaseInvoice.findMany({ where: { status: { in: SALES_LIVE }, ...(range ? { docDate: range } : {}) }, include: { items: true }, orderBy: { docDate: 'asc' } });
    const sups = await prisma.supplier.findMany({ where: { id: { in: [...new Set(invs.map((i) => i.supplierId))] } }, select: { id: true, vatCategory: true, trn: true } });
    const sm = new Map(sups.map((c) => [c.id, c]));
    for (const inv of invs) {
      const ex = num(inv.exchangeRate) || 1;
      const groups = new Map<number, { taxable: number; vat: number }>();
      for (const it of inv.items) {
        const c = calcLine({ qty: it.qty, rate: it.rate, discount: it.discount, vatRate: it.vatRate });
        const g = groups.get(num(it.vatRate)) ?? { taxable: 0, vat: 0 };
        g.taxable += c.net;
        g.vat += num(it.vatAmount);
        groups.set(num(it.vatRate), g);
      }
      const sup = sm.get(inv.supplierId);
      for (const [rate, g] of groups) {
        const r = resolve(rate, sup?.vatCategory);
        out.push({ type: 'PURCHASE', docType: 'PURCHASE_INVOICE', docId: inv.id, docNo: inv.docNo, date: inv.docDate, partyType: 'SUPPLIER', partyId: inv.supplierId, trn: sup?.trn, vatCode: r.code, category: r.category, rate, taxable: r2(g.taxable * ex), vatAmount: r2(g.vat * ex) });
      }
    }
  }
  const noteTypes = ['SALES_CREDIT_NOTE', 'SALES_DEBIT_NOTE', 'PURCHASE_CREDIT_NOTE', 'PURCHASE_DEBIT_NOTE'];
  if (noteTypes.some(want)) {
    const notes = await prisma.note.findMany({ where: { status: 'POSTED', ...(range ? { noteDate: range } : {}) }, orderBy: { noteDate: 'asc' } });
    const jids = notes.map((n) => n.journalId).filter((x): x is number => !!x);
    const vlines = jids.length ? await prisma.journalLine.findMany({ where: { journalId: { in: jids }, vatCode: { not: null } }, select: { journalId: true, vatCode: true } }) : [];
    const vm = new Map<number, string>();
    for (const l of vlines) if (l.vatCode) vm.set(l.journalId, l.vatCode);
    const custs = await prisma.customer.findMany({ select: { id: true, vatCategory: true, trn: true } });
    const sups = await prisma.supplier.findMany({ select: { id: true, vatCategory: true, trn: true } });
    const cm = new Map(custs.map((c) => [c.id, c]));
    const sm = new Map(sups.map((c) => [c.id, c]));
    for (const n of notes) {
      const type = `${n.partyType === 'CUSTOMER' ? 'SALES' : 'PURCHASE'}_${n.noteType}_NOTE`;
      if (!want(type)) continue;
      const sub = num(n.subtotal);
      const vatAmt = num(n.vatAmount);
      const code = n.journalId ? vm.get(n.journalId) : undefined;
      const master = code ? byCode.get(code) : undefined;
      const rate = master ? num(master.rate) : sub ? r2((vatAmt / sub) * 100) : 0;
      const party = n.partyType === 'CUSTOMER' ? cm.get(n.partyId) : sm.get(n.partyId);
      const r = master ? { code: master.code, category: master.category as Cat } : resolve(rate, party?.vatCategory);
      out.push({ type, docType: n.noteType === 'CREDIT' ? 'CREDIT_NOTE' : 'DEBIT_NOTE', docId: n.id, docNo: n.noteNo, date: n.noteDate, partyType: n.partyType as 'CUSTOMER' | 'SUPPLIER', partyId: n.partyId, trn: party?.trn, vatCode: r.code, category: r.category, rate, taxable: sub, vatAmount: vatAmt });
    }
  }
  return out;
}

vat.get(
  '/transactions',
  can('vat', 'view'),
  ah(async (req, res) => {
    const from = qDate(req.query.from);
    const to = qDate(req.query.to, true);
    const type = req.query.type ? String(req.query.type).toUpperCase() : undefined;
    const category = req.query.category ? String(req.query.category).toUpperCase() : undefined;
    const q = listQuery(req);
    let rows = await vatRows(from, to, type);
    if (category) rows = rows.filter((r) => r.category === category);
    if (req.query.vatCode) rows = rows.filter((r) => r.vatCode === String(req.query.vatCode));
    if (q.search) rows = rows.filter((r) => r.docNo.toLowerCase().includes(q.search.toLowerCase()));
    rows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.docNo.localeCompare(b.docNo));
    const totals = { taxable: r2(rows.reduce((s, r) => s + r.taxable, 0)), vatAmount: r2(rows.reduce((s, r) => s + r.vatAmount, 0)) };
    const slice = rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    const pn = await partyNames(slice);
    res.json({ ...paged(slice.map((r) => ({ ...r, party: pn(r.partyType, r.partyId) })), rows.length, q), totals });
  }),
);

vat.get(
  '/summary',
  can('vat', 'view'),
  ah(async (req, res) => {
    const from = qDate(req.query.from);
    const to = qDate(req.query.to, true);
    const rows = await vatRows(from, to);
    const sum = (f: (r: VatRow) => boolean) => ({ taxable: r2(rows.filter(f).reduce((s, r) => s + r.taxable, 0)), vat: r2(rows.filter(f).reduce((s, r) => s + r.vatAmount, 0)), count: new Set(rows.filter(f).map((r) => `${r.docType}:${r.docId}`)).size });
    const byCat = (f: (r: VatRow) => boolean) =>
      (['TAXABLE', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'] as Cat[]).map((category) => ({ category, ...sum((r) => f(r) && r.category === category) }));
    const byCode = (f: (r: VatRow) => boolean) => {
      const m = new Map<string, { vatCode: string | null; category: Cat; rate: number; taxable: number; vat: number }>();
      for (const r of rows.filter(f)) {
        const k = `${r.vatCode}|${r.rate}`;
        const e = m.get(k) ?? { vatCode: r.vatCode, category: r.category, rate: r.rate, taxable: 0, vat: 0 };
        e.taxable = r2(e.taxable + r.taxable);
        e.vat = r2(e.vat + r.vatAmount);
        m.set(k, e);
      }
      return [...m.values()];
    };
    const sales = sum((r) => r.type === 'SALES');
    const salesCN = sum((r) => r.type === 'SALES_CREDIT_NOTE');
    const salesDN = sum((r) => r.type === 'SALES_DEBIT_NOTE');
    const purch = sum((r) => r.type === 'PURCHASE');
    const purchCN = sum((r) => r.type === 'PURCHASE_CREDIT_NOTE');
    const purchDN = sum((r) => r.type === 'PURCHASE_DEBIT_NOTE');
    const outputVat = r2(sales.vat - salesCN.vat + salesDN.vat);
    const inputVat = r2(purch.vat - purchCN.vat + purchDN.vat);
    res.json({
      from: from ?? null,
      to: to ?? null,
      output: { sales, creditNotes: salesCN, debitNotes: salesDN, netTaxable: r2(sales.taxable - salesCN.taxable + salesDN.taxable), netVat: outputVat, byCategory: byCat((r) => r.type.startsWith('SALES')), byCode: byCode((r) => r.type.startsWith('SALES')) },
      input: { purchases: purch, creditNotes: purchCN, debitNotes: purchDN, netTaxable: r2(purch.taxable - purchCN.taxable + purchDN.taxable), netVat: inputVat, byCategory: byCat((r) => r.type.startsWith('PURCHASE')), byCode: byCode((r) => r.type.startsWith('PURCHASE')) },
      outputVat,
      inputVat,
      netPayable: r2(outputVat - inputVat),
    });
  }),
);

// =====================================================================  DASHBOARD METRICS
const fin = Router();
fin.get(
  '/dashboard-metrics',
  ah(async (_req, res) => {
    const ar = await accountIdByKey(prisma, 'AR');
    const ap = await accountIdByKey(prisma, 'AP');
    const accs = await allAccounts();
    const cashIds = accs.filter((a) => !a.isGroup && (a.isBank || a.systemKey === 'CASH')).map((a) => a.id);
    const [arAgg, apAgg, cashAgg, custOpen, suppOpen] = await Promise.all([
      prisma.journalLine.aggregate({ where: { accountId: ar, partyType: 'CUSTOMER' }, _sum: { debit: true, credit: true } }),
      prisma.journalLine.aggregate({ where: { accountId: ap, partyType: 'SUPPLIER' }, _sum: { debit: true, credit: true } }),
      prisma.journalLine.groupBy({ by: ['accountId'], where: { accountId: { in: cashIds } }, _sum: { debit: true, credit: true } }),
      prisma.customer.aggregate({ _sum: { openingBalance: true } }),
      prisma.supplier.aggregate({ _sum: { openingBalance: true } }),
    ]);
    const of = (await recordOpeningVisible()) ? 1 : 0; // record opening balances belong to the default BU
    const receivables = r2(of * num(custOpen._sum.openingBalance) + num(arAgg._sum.debit) - num(arAgg._sum.credit));
    const payables = r2(of * num(suppOpen._sum.openingBalance) + num(apAgg._sum.credit) - num(apAgg._sum.debit));
    const cashBank = cashAgg.map((c) => ({ accountId: c.accountId, balance: r2(num(c._sum.debit) - num(c._sum.credit)) }));
    const cashBankTotal = r2(cashBank.reduce((s, c) => s + c.balance, 0));

    // monthly series, last 12 months
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
    const months: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    const series: Record<string, { month: string; sales: number; purchases: number; receipts: number; payments: number }> = {};
    for (const m of months) series[m] = { month: m, sales: 0, purchases: 0, receipts: 0, payments: 0 };
    const mk = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const keys = await prisma.account.findMany({ where: { systemKey: { in: ['SALES', 'SALES_RETURNS'] } }, select: { id: true, systemKey: true } });
    const salesIds = keys.map((k) => k.id);
    const salesLines = await prisma.journalLine.findMany({ where: { accountId: { in: salesIds }, journal: { entryDate: { gte: start } } }, select: { accountId: true, debit: true, credit: true, journal: { select: { entryDate: true } } } });
    for (const l of salesLines) {
      const s = series[mk(l.journal.entryDate)];
      if (s) s.sales += num(l.credit) - num(l.debit);
    }
    const apLines = await prisma.journalLine.findMany({ where: { accountId: ap, journal: { entryDate: { gte: start }, entryType: 'AUTO', NOT: { sourceType: 'ADVANCE_SETTLEMENT' } } }, select: { debit: true, credit: true, journal: { select: { entryDate: true } } } });
    for (const l of apLines) {
      const s = series[mk(l.journal.entryDate)];
      if (s) s.purchases += num(l.credit) - num(l.debit);
    }
    const vs = await prisma.voucher.findMany({ where: { status: 'POSTED', voucherDate: { gte: start } }, select: { voucherType: true, voucherDate: true, amount: true } });
    for (const v of vs) {
      const s = series[mk(v.voucherDate)];
      if (!s) continue;
      if (v.voucherType === 'RECEIPT') s.receipts += num(v.amount);
      else s.payments += num(v.amount);
    }
    const monthly = months.map((m) => ({ ...series[m], sales: r2(series[m].sales), purchases: r2(series[m].purchases), receipts: r2(series[m].receipts), payments: r2(series[m].payments) }));
    const cur = monthly[monthly.length - 1];
    res.json({ receivables, payables, cashBankBalance: cashBankTotal, cashBank, currentMonth: cur, monthly });
  }),
);

export default [
  { path: '/ledger', router: ledger },
  { path: '/registers', router: registers },
  { path: '/vat', router: vat },
  { path: '/finance', router: fin },
] satisfies ModuleDef[];
void (null as unknown as TreeNode);
