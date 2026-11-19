import { Request } from 'express';
import { prisma } from '../lib/prisma';
import { badRequest, forbidden } from '../lib/errors';
import { num, r2 } from '../lib/calc';

/** Parses a query date. Date-only strings (YYYY-MM-DD) are treated as UTC days; `endOfDay` makes the upper bound inclusive. */
export function qDate(v: unknown, endOfDay = false): Date | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  const d = new Date(s);
  if (isNaN(d.getTime())) throw badRequest(`Invalid date: ${s}`);
  return d;
}
export const qFrom = (req: Request) => qDate(req.query.from);
export const qTo = (req: Request) => qDate(req.query.to, true);
export const qAsOf = (req: Request, key = 'asOf') => qDate(req.query[key], true) ?? new Date();
export const qInt = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw badRequest(`Invalid number: ${v}`);
  return n;
};
export const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const dayEnd = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
export const daysBetween = (a: Date, b: Date) => Math.floor((dayStart(a).getTime() - dayStart(b).getTime()) / 86400000);

/** manual permission check (for routes whose module depends on the payload) */
export function assertCan(req: Request, module: string, action: string) {
  const u = req.user;
  if (!u) throw forbidden('Not authenticated');
  if (u.role === 'Admin' || u.permissions.has(`${module}:${action}`)) return;
  throw forbidden(`Missing permission ${module}:${action}`);
}
export const hasCan = (req: Request, module: string, action: string) => {
  const u = req.user;
  return !!u && (u.role === 'Admin' || u.permissions.has(`${module}:${action}`));
};

export const DEBIT_NATURE = new Set(['ASSET', 'EXPENSE', 'COGS']);
/** natural-sign balance: debit-natural accounts = debit-credit, credit-natural = credit-debit */
export const natural = (type: string, debit: number, credit: number) => r2(DEBIT_NATURE.has(type) ? debit - credit : credit - debit);

export interface DR {
  from?: Date;
  to?: Date;
}
export const entryDateWhere = (r: DR) => {
  if (!r.from && !r.to) return undefined;
  return { entryDate: { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lte: r.to } : {}) } };
};

/** Σ debit / credit per account for journals in the range. */
export async function accountTotals(r: DR, extraLineWhere: Record<string, unknown> = {}) {
  const jw = entryDateWhere(r);
  const rows = await prisma.journalLine.groupBy({
    by: ['accountId'],
    where: { ...(jw ? { journal: jw } : {}), ...extraLineWhere },
    _sum: { debit: true, credit: true },
  });
  const m = new Map<number, { debit: number; credit: number }>();
  for (const x of rows) m.set(x.accountId, { debit: num(x._sum.debit), credit: num(x._sum.credit) });
  return m;
}

export interface AccRow {
  id: number;
  code: string;
  name: string;
  type: string;
  parentId: number | null;
  isGroup: boolean;
  isBank: boolean;
  systemKey: string | null;
  isActive: boolean;
}
export async function allAccounts(): Promise<AccRow[]> {
  return prisma.account.findMany({ orderBy: { code: 'asc' } });
}

/** all descendant account ids (including itself) */
export function descendantIds(accounts: AccRow[], id: number): number[] {
  const out = [id];
  const walk = (pid: number) => {
    for (const a of accounts) if (a.parentId === pid) { out.push(a.id); walk(a.id); }
  };
  walk(id);
  return out;
}

export interface TreeNode extends AccRow {
  level: number;
  debit: number;
  credit: number;
  children?: TreeNode[];
}
/** flat code-ordered tree with rolled-up debit/credit for groups */
export function buildTree(accounts: AccRow[], totals: Map<number, { debit: number; credit: number }>) {
  const byParent = new Map<number | null, AccRow[]>();
  for (const a of accounts) {
    const k = a.parentId ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(a);
  }
  const flat: TreeNode[] = [];
  const build = (parent: number | null, level: number): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const a of byParent.get(parent) ?? []) {
      const own = totals.get(a.id) ?? { debit: 0, credit: 0 };
      const node: TreeNode = { ...a, level, debit: own.debit, credit: own.credit };
      flat.push(node);
      node.children = build(a.id, level + 1);
      for (const c of node.children) {
        node.debit += c.debit;
        node.credit += c.credit;
      }
      node.debit = r2(node.debit);
      node.credit = r2(node.credit);
      out.push(node);
    }
    return out;
  };
  const roots = build(null, 0);
  return { roots, flat };
}

export async function partyNames(lines: Array<{ partyType?: string | null; partyId?: number | null }>) {
  const cids = [...new Set(lines.filter((l) => l.partyType === 'CUSTOMER' && l.partyId).map((l) => l.partyId as number))];
  const sids = [...new Set(lines.filter((l) => l.partyType === 'SUPPLIER' && l.partyId).map((l) => l.partyId as number))];
  const [cs, ss] = await Promise.all([
    cids.length ? prisma.customer.findMany({ where: { id: { in: cids } }, select: { id: true, code: true, name: true } }) : [],
    sids.length ? prisma.supplier.findMany({ where: { id: { in: sids } }, select: { id: true, code: true, name: true } }) : [],
  ]);
  const cm = new Map(cs.map((c) => [c.id, c]));
  const sm = new Map(ss.map((c) => [c.id, c]));
  return (type?: string | null, id?: number | null) => (!type || !id ? null : type === 'CUSTOMER' ? cm.get(id) ?? null : type === 'SUPPLIER' ? sm.get(id) ?? null : null);
}

export const SALES_OPEN = ['POSTED', 'PARTIALLY_PAID'];
export const SALES_LIVE = ['POSTED', 'PARTIALLY_PAID', 'PAID'];

/** classify an AR/AP journal line for statements */
export function classifyEntry(j: { entryType: string; sourceType: string | null }): string {
  switch (j.entryType) {
    case 'RECEIPT':
      return 'RECEIPT';
    case 'PAYMENT':
      return 'PAYMENT';
    case 'CREDIT_NOTE':
      return 'CREDIT_NOTE';
    case 'DEBIT_NOTE':
      return 'DEBIT_NOTE';
    case 'JOURNAL':
    case 'OPENING':
      return 'ADJUSTMENT';
  }
  const s = (j.sourceType ?? '').toUpperCase();
  if (s.includes('RETURN')) return 'CREDIT_NOTE';
  if (s.includes('INVOICE')) return 'INVOICE';
  if (s.includes('NOTE')) return j.entryType === 'DEBIT_NOTE' ? 'DEBIT_NOTE' : 'CREDIT_NOTE';
  return 'OTHER';
}
