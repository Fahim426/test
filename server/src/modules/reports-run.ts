import { Router, Response } from 'express';
import { ah } from '../lib/http';
import { can } from '../middleware/auth';
import { ModuleDef } from '../app';
import { catalog, runReport, getReport } from '../services/report-registry';
import { toParams } from '../services/report-types';
import { render, toHtml, safeFilename, ExportInput } from '../services/report-export';

const router = Router();

router.get('/catalog', can('reports', 'view'), (_req, res) => res.json(catalog()));

function inputFrom(r: Awaited<ReturnType<typeof runReport>>): ExportInput {
  return { title: r.title, columns: r.columns, rows: r.rows, totals: r.totals, params: r.params };
}
export function sendFile(res: Response, f: { buffer: Buffer; mime: string; ext: string }, name: string) {
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(name)}.${f.ext}"`);
  res.setHeader('Content-Length', String(f.buffer.length));
  res.end(f.buffer);
}

router.get(
  '/run/:key',
  can('reports', 'view'),
  ah(async (req, res) => {
    const def = getReport(req.params.key);
    const fmt = String(req.query.format || '').toLowerCase();
    const p = toParams(req.query);
    if (fmt === 'pdf' || fmt === 'xlsx' || fmt === 'csv') {
      await new Promise<void>((ok, bad) => can('reports', 'export')(req, res, (e?: unknown) => (e ? bad(e) : ok())));
      const result = await runReport(def.key, p, false);
      return sendFile(res, await render(inputFrom(result), fmt), `${def.key}_${new Date().toISOString().slice(0, 10)}`);
    }
    res.json(await runReport(def.key, p));
  }),
);

router.get(
  '/print/:key',
  can('reports', 'view'),
  ah(async (req, res) => {
    const result = await runReport(req.params.key, toParams(req.query), false);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(await toHtml(inputFrom(result)));
  }),
);

export default [{ path: '/reports', router }] as ModuleDef[];
