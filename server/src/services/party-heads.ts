/**
 * Customer / supplier heads under the Trade Debtors (AR) / Trade Creditors (AP) control accounts.
 *
 * Postings stay on the control account, tagged with partyType/partyId (sub-ledger). A party's head balance is
 * its opening balance on the customer/supplier record plus its tagged lines. The legacy opening journal holds the
 * record opening balances as one untagged lump sum on the control account, so the heads add up to the control
 * account; any difference (e.g. an opening balance edited on a record later) is reported as "Not allocated".
 *
 * Amounts in natural sign: customers Dr-positive, suppliers Cr-positive (same as Customer/Supplier.openingBalance).
 */
import { prisma } from '../lib/prisma';
import { num, r2 } from '../lib/calc';
import { recordOpeningVisible } from '../lib/bu';

export type Side = 'CUSTOMER' | 'SUPPLIER';
export const SIDE_KEY: Record<Side, 'AR' | 'AP'> = { CUSTOMER: 'AR', SUPPLIER: 'AP' };

export interface ControlAccount {
  id: number;
  code: string;
  name: string;
  /** root first, the control account last */
  path: { id: number; code: string; name: string }[];
}

export async function controlAccount(side: Side): Promise<ControlAccount | null> {
  const all = await prisma.account.findMany({ select: { id: true, code: true, name: true, parentId: true, systemKey: true } });
  const acc = all.find((a) => a.systemKey === SIDE_KEY[side]);
  if (!acc) return null;
  const byId = new Map(all.map((a) => [a.id, a]));
  const path: ControlAccount['path'] = [];
  for (let a: (typeof all)[number] | undefined = acc; a && path.length < 20; a = a.parentId ? byId.get(a.parentId) : undefined) path.unshift({ id: a.id, code: a.code, name: a.name });
  return { id: acc.id, code: acc.code, name: acc.name, path };
}

export interface PartyHead {
  partyType: Side;
  partyId: number | null; // null = "Not allocated" difference row
  code: string;
  name: string;
  isActive: boolean;
  /** natural sign */
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}

/**
 * One head per customer/supplier. Opening = record opening balance + tagged lines before `from`;
 * debit/credit = tagged lines from `from` (or the beginning) to `to`. Without `from` the record opening balance is
 * returned in `opening` and the period covers every posted line up to `to`.
 */
export async function partyHeads(side: Side, opts: { from?: Date; to?: Date; includeZero?: boolean } = {}) {
  const ctl = await controlAccount(side);
  if (!ctl) return { control: null, rows: [] as PartyHead[], unallocated: null as PartyHead | null };
  const dr = side === 'CUSTOMER' ? 1 : -1; // natural = dr * (debit - credit)
  const parties =
    side === 'CUSTOMER'
      ? await prisma.customer.findMany({ select: { id: true, code: true, name: true, isActive: true, openingBalance: true }, orderBy: { code: 'asc' } })
      : await prisma.supplier.findMany({ select: { id: true, code: true, name: true, isActive: true, openingBalance: true }, orderBy: { code: 'asc' } });
  const base = { accountId: ctl.id, partyType: side };
  const period = { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) };
  const [before, during, ctlBefore, ctlDuring] = await Promise.all([
    opts.from ? prisma.journalLine.groupBy({ by: ['partyId'], where: { ...base, journal: { entryDate: { lt: opts.from } } }, _sum: { debit: true, credit: true } }) : Promise.resolve([]),
    prisma.journalLine.groupBy({ by: ['partyId'], where: { ...base, ...(opts.from || opts.to ? { journal: { entryDate: period } } : {}) }, _sum: { debit: true, credit: true } }),
    opts.from ? prisma.journalLine.aggregate({ where: { accountId: ctl.id, journal: { entryDate: { lt: opts.from } } }, _sum: { debit: true, credit: true } }) : Promise.resolve(null),
    prisma.journalLine.aggregate({ where: { accountId: ctl.id, ...(opts.from || opts.to ? { journal: { entryDate: period } } : {}) }, _sum: { debit: true, credit: true } }),
  ]);
  const bMap = new Map(before.map((g) => [g.partyId, g._sum]));
  const dMap = new Map(during.map((g) => [g.partyId, g._sum]));

  const of = (await recordOpeningVisible()) ? 1 : 0; // record opening balances belong to the default BU
  const rows: PartyHead[] = [];
  for (const p of parties) {
    const b = bMap.get(p.id);
    const d = dMap.get(p.id);
    const opening = r2(of * num(p.openingBalance) + (b ? dr * (num(b.debit) - num(b.credit)) : 0));
    const debit = r2(num(d?.debit));
    const credit = r2(num(d?.credit));
    const closing = r2(opening + dr * (debit - credit));
    if (!opts.includeZero && Math.abs(opening) < 0.005 && debit < 0.005 && credit < 0.005) continue;
    rows.push({ partyType: side, partyId: p.id, code: p.code, name: p.name, isActive: p.isActive, opening, debit, credit, closing });
  }

  // control account totals vs the heads: without `from`, the control's own opening lump sits inside its lines
  const ctlOpening = ctlBefore ? r2(dr * (num(ctlBefore._sum.debit) - num(ctlBefore._sum.credit))) : 0;
  const ctlDebit = r2(num(ctlDuring._sum.debit));
  const ctlCredit = r2(num(ctlDuring._sum.credit));
  const ctlClosing = r2(ctlOpening + dr * (ctlDebit - ctlCredit));
  const recordOpening = r2(of * parties.reduce((s, p) => s + num(p.openingBalance), 0));
  // heads' totals including parties hidden as zero
  const headsClosing = r2(recordOpening + [...dMap.entries()].filter(([k]) => k != null).reduce((s, [, v]) => s + dr * (num(v.debit) - num(v.credit)), 0) + [...bMap.entries()].filter(([k]) => k != null).reduce((s, [, v]) => s + dr * (num(v.debit) - num(v.credit)), 0));
  const diff = r2(ctlClosing - headsClosing);
  const unallocated: PartyHead | null =
    Math.abs(diff) >= 0.005
      ? { partyType: side, partyId: null, code: '', name: 'Not allocated to a ' + (side === 'CUSTOMER' ? 'customer' : 'supplier'), isActive: true, opening: 0, debit: 0, credit: 0, closing: diff }
      : null;
  return { control: ctl, rows, unallocated, totals: { opening: ctlOpening, debit: ctlDebit, credit: ctlCredit, closing: ctlClosing } };
}

/** The ledger head a customer/supplier is linked to: control account path + the party's balance (natural sign). */
export async function linkedLedger(side: Side, partyId: number, balance: number) {
  const ctl = await controlAccount(side);
  if (!ctl) return null;
  return { accountId: ctl.id, code: ctl.code, name: ctl.name, path: ctl.path, partyType: side, partyId, balance, ...drCr(side, balance) };
}

/** Natural-sign balance -> Dr/Cr columns for the given side. */
export function drCr(side: Side, natural: number) {
  const signedDr = side === 'CUSTOMER' ? natural : -natural; // + means debit
  return { debit: signedDr > 0 ? r2(signedDr) : 0, credit: signedDr < 0 ? r2(-signedDr) : 0 };
}
