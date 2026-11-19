import { prisma } from '../lib/prisma';

type Db = typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Next sequential code like C0001 / V0001 / BP-00001 based on the highest numeric suffix currently used. */
export async function nextCode(tx: Db, model: 'customer' | 'supplier' | 'product', prefix: string, pad: number): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: { code: string }[] = await (tx as any)[model].findMany({
    where: { code: { startsWith: prefix } },
    select: { code: true },
  });
  let max = 0;
  for (const r of rows) {
    const rest = r.code.slice(prefix.length);
    if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest));
  }
  return prefix + String(max + 1).padStart(pad, '0');
}

/** Builds id->name maps for the dimension tables used by customer/supplier rows. */
export async function dimensionMaps() {
  const [terms, salesmen, territories, areas] = await Promise.all([
    prisma.paymentTerm.findMany({ select: { id: true, name: true, days: true } }),
    prisma.salesman.findMany({ select: { id: true, name: true } }),
    prisma.territory.findMany({ select: { id: true, name: true } }),
    prisma.area.findMany({ select: { id: true, name: true } }),
  ]);
  return {
    term: new Map(terms.map((t) => [t.id, t])),
    salesman: new Map(salesmen.map((t) => [t.id, t.name])),
    territory: new Map(territories.map((t) => [t.id, t.name])),
    area: new Map(areas.map((t) => [t.id, t.name])),
  };
}

export const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
