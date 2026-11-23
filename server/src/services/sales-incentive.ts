/**
 * Salesman incentive: each salesman has a monthly sales target (SalesTarget for the month, else the SalesTargetDefault in effect).
 * Achievement % = net sales of the month / target. The highest IncentiveSlab whose fromPct <= achievement gives
 * the rate, paid on the month's gross profit (net sales - cost of sales, after posted returns).
 */
import { prisma } from '../lib/prisma';
import { num } from '../lib/calc';

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface Slab {
  fromPct: number;
  ratePct: number;
}

export async function loadSlabs(): Promise<Slab[]> {
  const rows = await prisma.incentiveSlab.findMany({ orderBy: { fromPct: 'asc' } });
  return rows.map((r) => ({ fromPct: num(r.fromPct), ratePct: num(r.ratePct) }));
}

/** Rate of the highest slab reached (slabs sorted ascending); 0 below the first slab. */
export function rateFor(slabs: Slab[], achievementPct: number): number {
  let rate = 0;
  for (const s of slabs) if (achievementPct + 1e-9 >= s.fromPct) rate = s.ratePct;
  return rate;
}

/** fromPeriod of the initial default: applies to every month before the first change. */
export const BASE_PERIOD = '0000-00';

export interface DefaultRow {
  fromPeriod: string;
  target: number;
}

/** Default-target history per salesman, each list sorted by fromPeriod ascending. */
export async function loadDefaults(salesmanId?: number): Promise<Map<number, DefaultRow[]>> {
  const rows = await prisma.salesTargetDefault.findMany({ where: salesmanId ? { salesmanId } : {}, orderBy: [{ salesmanId: 'asc' }, { fromPeriod: 'asc' }] });
  const m = new Map<number, DefaultRow[]>();
  for (const r of rows) {
    if (!m.has(r.salesmanId)) m.set(r.salesmanId, []);
    m.get(r.salesmanId)!.push({ fromPeriod: r.fromPeriod, target: num(r.target) });
  }
  return m;
}

/** The default row in effect for a month (the latest change on or before it), and the next later change. */
export function defaultAt(hist: DefaultRow[] | undefined, period: string): { row: DefaultRow | null; next: DefaultRow | null } {
  let row: DefaultRow | null = null;
  for (const h of hist ?? []) {
    if (h.fromPeriod <= period) row = h;
    else return { row, next: h };
  }
  return { row, next: null };
}

/** Target for a salesman and month: the month override, else the default in effect for that month, else 0. */
export async function loadTargets(periods: string[], salesmanId?: number) {
  const [salesmen, overrides, defaults] = await Promise.all([
    prisma.salesman.findMany({ where: salesmanId ? { id: salesmanId } : {}, select: { id: true, code: true, name: true, isActive: true } }),
    prisma.salesTarget.findMany({ where: { period: { in: periods }, ...(salesmanId ? { salesmanId } : {}) } }),
    loadDefaults(salesmanId),
  ]);
  const ov = new Map(overrides.map((o) => [`${o.salesmanId}|${o.period}`, num(o.target)]));
  const target = (sid: number, period: string) => ov.get(`${sid}|${period}`) ?? defaultAt(defaults.get(sid), period).row?.target ?? 0;
  return { salesmen, target };
}

/** YYYY-MM of a date (local time, same as report date filters). */
export const periodOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Every month between two dates, inclusive. */
export function periodsBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (d <= end && out.length < 120) {
    out.push(periodOf(d));
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

export const previousPeriod = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return periodOf(new Date(y, m - 2, 1));
};
