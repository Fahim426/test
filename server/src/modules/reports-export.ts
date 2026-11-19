import { Router } from 'express';
import { ah, intParam } from '../lib/http';
import { can } from '../middleware/auth';
import { ModuleDef } from '../app';
import { exportBodySchema, render, safeFilename } from '../services/report-export';
import { renderDocumentPdf, normalizeDocType, DOC_PERMISSION, DOC_TYPES } from '../services/report-docpdf';
import { sendFile } from './reports-run';

const exportRouter = Router();
// Generic export of any tabular payload (report results, list-screen rows). Any authenticated user may export data they already hold.
const handler = ah(async (req, res) => {
  const b = exportBodySchema.parse(req.body);
  const f = await render({ title: b.title, subtitle: b.subtitle, columns: b.columns, rows: b.rows, totals: b.totals, params: b.params }, b.format);
  sendFile(res, f, b.filename || b.title);
});
exportRouter.post('/report', handler);
exportRouter.post('/rows', handler);

const docRouter = Router();
docRouter.get('/types', (_req, res) => res.json({ types: DOC_TYPES }));
docRouter.get(
  '/:type/:id/pdf',
  ah(async (req, res, next) => {
    const type = normalizeDocType(req.params.type);
    await new Promise<void>((ok, bad) => can(DOC_PERMISSION[type], 'view')(req, res, (e?: unknown) => (e ? bad(e) : ok())));
    const id = intParam(req);
    const { buffer, filename } = await renderDocumentPdf(type, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${safeFilename(filename.replace(/\.pdf$/, ''))}.pdf"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
    void next;
  }),
);

export default [
  { path: '/export', router: exportRouter },
  { path: '/documents', router: docRouter },
] as ModuleDef[];
