/** Salesman monthly sales targets and incentive slabs (see services/sales-incentive.ts for the calculation). */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, parse } from '../lib/http';
import { badRequest } from '../lib/errors';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import { num } from '../lib/calc';
import { BASE_PERIOD, PERIOD_RE, defaultAt, loadDefaults, loadSlabs } from '../services/sales-incentive';
import type { ModuleDef } from '../app';

const M = 'sales_incentive';
const periodParam = (v: unknown) => {
  const p = String(v ?? '');
  if (!PERIOD_RE.test(p)) throw badRequest('Period must be YYYY-MM');
  return p;
};
const money = z.coerce.number().min(0).max(1e12);

// ------------------------------------------------------------------ targets
const targets = Router();

/**
 * Active salesmen (plus inactive ones that have a target this month) with the default in effect for the month
 * (defaultFrom: month it took effect, null = initial / none; defaultUntil: month of the next later change), the month
 * override and the effective target.
 */
targets.get('/:period', can(M, 'view'), ah(async (req, res) => {
  const period = periodParam(req.params.period);
  const [salesmen, ov, defaults] = await Promise.all([
    prisma.salesman.findMany({ orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, isActive: true } }),
    prisma.salesTarget.findMany({ where: { period } }),
    loadDefaults(),
  ]);
  const byId = new Map(ov.map((o) => [o.salesmanId, num(o.target)]));
  const rows = salesmen
    .filter((s) => s.isActive || byId.has(s.id))
    .map((s) => {
      const { row, next } = defaultAt(defaults.get(s.id), period);
      const def = row?.target ?? 0;
      const override = byId.has(s.id) ? byId.get(s.id)! : null;
      return {
        salesmanId: s.id, code: s.code, name: s.name, isActive: s.isActive,
        hasDefault: !!defaults.get(s.id)?.length,
        defaultTarget: def, defaultFrom: row && row.fromPeriod !== BASE_PERIOD ? row.fromPeriod : null, defaultUntil: next?.fromPeriod ?? null,
        target: override, effective: override ?? def,
      };
    });
  res.json({ period, rows });
}));

const targetsBody = z.object({
  rows: z
    .array(
      z.object({
        salesmanId: z.coerce.number().int().positive(),
        // new default from this period on (the first default ever set applies to all months)
        defaultTarget: money.optional(),
        target: money.nullable().optional(), // null = remove the month override (use the default)
      }),
    )
    .max(2000),
});

targets.put('/:period', can(M, 'edit'), ah(async (req, res) => {
  const period = periodParam(req.params.period);
  const { rows } = parse(targetsBody, req.body);
  const ids = [...new Set(rows.map((r) => r.salesmanId))];
  const found = await prisma.salesman.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw badRequest('Unknown salesman in the list');
  const defaults = await loadDefaults();
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      if (r.defaultTarget !== undefined) {
        const hist = defaults.get(r.salesmanId);
        const cur = defaultAt(hist, period).row;
        if (!cur || cur.target !== r.defaultTarget) {
          // first default ever -> all months; otherwise a change effective from this month until the next later change
          const fromPeriod = hist?.length ? period : BASE_PERIOD;
          await tx.salesTargetDefault.upsert({
            where: { salesmanId_fromPeriod: { salesmanId: r.salesmanId, fromPeriod } },
            create: { salesmanId: r.salesmanId, fromPeriod, target: r.defaultTarget },
            update: { target: r.defaultTarget },
          });
        }
      }
      if (r.target === null) await tx.salesTarget.deleteMany({ where: { salesmanId: r.salesmanId, period } });
      else if (r.target !== undefined)
        await tx.salesTarget.upsert({
          where: { salesmanId_period: { salesmanId: r.salesmanId, period } },
          create: { salesmanId: r.salesmanId, period, target: r.target },
          update: { target: r.target },
        });
    }
    await audit(tx, req.user, 'UPDATE', 'SalesTarget', period, { rows });
  });
  res.json({ ok: true, saved: rows.length });
}));

// ------------------------------------------------------------------ slabs
const slabs = Router();

slabs.get('/', can(M, 'view'), ah(async (_req, res) => {
  res.json({ rows: await loadSlabs() });
}));

const slabsBody = z.object({
  rows: z
    .array(z.object({ fromPct: z.coerce.number().min(0).max(10000), ratePct: z.coerce.number().min(0).max(100) }))
    .max(50),
});

/** Replaces the whole slab table. */
slabs.put('/', can(M, 'edit'), ah(async (req, res) => {
  const { rows } = parse(slabsBody, req.body);
  const sorted = rows.map((r) => ({ fromPct: Math.round(r.fromPct * 100) / 100, ratePct: Math.round(r.ratePct * 100) / 100 })).sort((a, b) => a.fromPct - b.fromPct);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].fromPct === sorted[i - 1].fromPct) throw badRequest(`Two slabs start at ${sorted[i].fromPct}%`);
  await prisma.$transaction(async (tx) => {
    await tx.incentiveSlab.deleteMany({});
    if (sorted.length) await tx.incentiveSlab.createMany({ data: sorted });
    await audit(tx, req.user, 'UPDATE', 'IncentiveSlab', undefined, { rows: sorted });
  });
  res.json({ rows: sorted });
}));

export default [
  { path: '/sales-targets', router: targets },
  { path: '/incentive-slabs', router: slabs },
] satisfies ModuleDef[];
