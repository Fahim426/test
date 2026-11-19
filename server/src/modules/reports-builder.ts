import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { ah } from '../lib/http';
import { can } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { ModuleDef } from '../app';
import { describeEntities, runBuilder, builderSchema } from '../services/report-builder';
import { render } from '../services/report-export';
import { sendFile } from './reports-run';

const router = Router();
const PREFIX = 'savedreport.';

router.get('/entities', can('report_builder', 'view'), (_req, res) => res.json(describeEntities()));

router.post(
  '/run',
  can('report_builder', 'view'),
  ah(async (req, res) => {
    const fmt = z.enum(['pdf', 'xlsx', 'csv']).optional().parse(req.query.format ?? req.body?.format);
    const body = builderSchema.parse({ ...req.body, format: undefined });
    const result = await runBuilder(body);
    if (fmt) {
      await new Promise<void>((ok, bad) => can('report_builder', 'export')(req, res, (e?: unknown) => (e ? bad(e) : ok())));
      return sendFile(res, await render({ title: result.title, columns: result.columns, rows: result.rows, totals: result.totals, params: result.params }, fmt), result.title);
    }
    res.json(result);
  }),
);

// ---------- saved reports (SystemSetting: savedreport.<id>) ----------
const savedSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  shared: z.boolean().default(false),
  definition: builderSchema,
});
interface Saved {
  id: string;
  name: string;
  description?: string;
  shared: boolean;
  definition: unknown;
  createdBy: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}
const load = async (id: string): Promise<Saved> => {
  const s = await prisma.systemSetting.findUnique({ where: { key: PREFIX + id } });
  if (!s) throw notFound('Saved report not found');
  return JSON.parse(s.value) as Saved;
};
const canSee = (s: Saved, uid: number, admin: boolean) => admin || s.shared || s.createdBy === uid;

router.get(
  '/saved',
  can('report_builder', 'view'),
  ah(async (req, res) => {
    const rows = await prisma.systemSetting.findMany({ where: { key: { startsWith: PREFIX } } });
    const admin = req.user!.role === 'Admin';
    const list = rows.map((r) => JSON.parse(r.value) as Saved).filter((s) => canSee(s, req.user!.id, admin)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json({ rows: list, total: list.length });
  }),
);
router.get(
  '/saved/:id',
  can('report_builder', 'view'),
  ah(async (req, res) => {
    const s = await load(req.params.id);
    if (!canSee(s, req.user!.id, req.user!.role === 'Admin')) throw forbidden();
    res.json(s);
  }),
);
router.post(
  '/saved',
  can('report_builder', 'create'),
  ah(async (req, res) => {
    const b = savedSchema.parse(req.body);
    const now = new Date().toISOString();
    const s: Saved = { id: crypto.randomBytes(6).toString('hex'), name: b.name, description: b.description, shared: b.shared, definition: b.definition, createdBy: req.user!.id, createdByName: req.user!.username, createdAt: now, updatedAt: now };
    await prisma.systemSetting.create({ data: { key: PREFIX + s.id, value: JSON.stringify(s) } });
    res.status(201).json(s);
  }),
);
router.put(
  '/saved/:id',
  can('report_builder', 'create'),
  ah(async (req, res) => {
    const old = await load(req.params.id);
    if (old.createdBy !== req.user!.id && req.user!.role !== 'Admin') throw forbidden('Only the owner can modify this report');
    const b = savedSchema.partial().parse(req.body);
    if (b.name === '') throw badRequest('name required');
    const s: Saved = { ...old, ...b, definition: b.definition ?? old.definition, updatedAt: new Date().toISOString() } as Saved;
    await prisma.systemSetting.update({ where: { key: PREFIX + old.id }, data: { value: JSON.stringify(s) } });
    res.json(s);
  }),
);
router.delete(
  '/saved/:id',
  can('report_builder', 'create'),
  ah(async (req, res) => {
    const old = await load(req.params.id);
    if (old.createdBy !== req.user!.id && req.user!.role !== 'Admin') throw forbidden('Only the owner can delete this report');
    await prisma.systemSetting.delete({ where: { key: PREFIX + old.id } });
    res.json({ ok: true });
  }),
);

export default [{ path: '/report-builder', router }] as ModuleDef[];
