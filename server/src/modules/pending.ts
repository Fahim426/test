import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, intParam, parse } from '../lib/http';
import { badRequest, forbidden } from '../lib/errors';
import { audit } from '../services/audit';
import { normalizeType } from '../services/admin-docs';
import {
  CUTOFF_KEY, DOC_PERM, OPEN_STAGES, STAGES, STAGE_BY_KEY, closePending, cutoffYmd, openForNext, pendingFlags, pendingForDoc, pendingReport, reopenClosure,
} from '../services/pending';
import type { ModuleDef } from '../app';

const r = Router();

const allowed = (req: Request, type: string, action: string) => {
  const u = req.user;
  if (!u) return false;
  if (u.role === 'Admin') return true;
  const m = DOC_PERM[type];
  return !!m && u.permissions.has(`${m}:${action}`);
};
const must = (req: Request, type: string, action: string) => {
  if (!allowed(req, type, action)) throw forbidden(`Missing permission ${DOC_PERM[type] ?? type}:${action}`);
};

/** Stage catalogue + cutoff (for the report filters). */
r.get('/stages', ah(async (_req, res) => {
  res.json({ cutoffDate: await cutoffYmd(), stages: STAGES.map((s) => ({ key: s.key, source: s.source, target: s.target, label: s.label })) });
}));

/** Pending note for one document (both directions). */
r.get('/doc/:type/:id', ah(async (req, res) => {
  const type = normalizeType(req.params.type);
  must(req, type, 'view');
  const out = await pendingForDoc(type, intParam(req));
  res.json({
    asSource: out.asSource.map((x) => ({ ...x, canClose: allowed(req, x.sourceType, 'edit') })),
    asTarget: out.asTarget.filter((x) => allowed(req, x.sourceType, 'view')),
  });
}));

/** List badges: ?type=SALES_QUOTATION&ids=1,2,3 -> { "1": 2 } (pending line count). */
r.get('/flags', ah(async (req, res) => {
  const type = normalizeType(String(req.query.type ?? ''));
  if (!DOC_PERM[type] || !allowed(req, type, 'view')) return res.json({});
  const ids = String(req.query.ids ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  res.json(ids.length ? await pendingFlags(type, ids) : {});
}));

/**
 * Documents ready for the next step of a stage, with what is still pending (the "New ..." pickers).
 * GET /pending/open/MR_PR -> [{ id, docNo, docDate, status, started, targets, pendingLines, pendingQty, party?, ... }]
 */
r.get('/open/:stage', ah(async (req, res) => {
  const st = STAGE_BY_KEY.get(req.params.stage);
  if (!st || !OPEN_STAGES.includes(st.key)) throw badRequest(`Unknown stage ${req.params.stage}`);
  must(req, st.source, 'view');
  const rows = await openForNext(st.key);
  const sup = [...new Set(rows.map((x) => x.supplierId).filter(Boolean))] as number[];
  if (sup.length) {
    const sm = new Map((await prisma.supplier.findMany({ where: { id: { in: sup } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    for (const x of rows) if (x.supplierId) x.supplier = { id: x.supplierId, name: sm.get(x.supplierId) ?? '' };
  }
  res.json(rows);
}));

/** Pending items report (flat lines). ?stages=SQ_SO,SO_DN&partyId=&q= */
r.get('/report', ah(async (req, res) => {
  const stages = String(req.query.stages ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const visible = STAGES.filter((s) => (!stages.length || stages.includes(s.key)) && allowed(req, s.source, 'view')).map((s) => s.key);
  const results = visible.length ? await pendingReport(visible) : [];
  // party names
  const cust = [...new Set(results.filter((x) => x.partyType === 'customer' && x.partyId).map((x) => x.partyId!))];
  const supp = [...new Set(results.filter((x) => x.partyType === 'supplier' && x.partyId).map((x) => x.partyId!))];
  const [cs, ss] = await Promise.all([
    cust.length ? prisma.customer.findMany({ where: { id: { in: cust } }, select: { id: true, name: true } }) : [],
    supp.length ? prisma.supplier.findMany({ where: { id: { in: supp } }, select: { id: true, name: true } }) : [],
  ]);
  const cm = new Map(cs.map((c) => [c.id, c.name]));
  const sm = new Map(ss.map((s) => [s.id, s.name]));
  const partyId = req.query.partyId ? Number(req.query.partyId) : undefined;
  const partyType = req.query.partyType ? String(req.query.partyType) : undefined;
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const rows = results
    .filter((x) => (!partyId || x.partyId === partyId) && (!partyType || x.partyType === partyType))
    .flatMap((x) =>
      x.lines.map((l) => ({
        stage: x.stage,
        stageLabel: x.label,
        sourceType: x.sourceType,
        sourceLabel: x.sourceLabel,
        sourceId: x.sourceId,
        sourceNo: x.sourceNo,
        sourceDate: x.sourceDate,
        sourceStatus: x.sourceStatus,
        partyType: x.partyType,
        partyId: x.partyId,
        party: x.partyType === 'customer' ? cm.get(x.partyId!) ?? null : x.partyType === 'supplier' ? sm.get(x.partyId!) ?? null : null,
        targetLabel: x.targetLabel,
        targets: x.targets.map((t) => t.no).join(', '),
        itemKey: l.key,
        productId: l.productId,
        code: l.code ?? null,
        name: l.name ?? l.description ?? null,
        sourceQty: l.sourceQty,
        processedQty: l.processedQty,
        closedQty: l.closedQty,
        pendingQty: l.pendingQty,
      })),
    )
    .filter((row) => !q || [row.sourceNo, row.code, row.name, row.party, row.targets].some((v) => v && String(v).toLowerCase().includes(q)))
    .sort((a, b) => +new Date(b.sourceDate ?? 0) - +new Date(a.sourceDate ?? 0) || a.sourceNo.localeCompare(b.sourceNo));
  res.json({ cutoffDate: await cutoffYmd(), rows });
}));

/** Close pending without processing: one item (key) or everything on the stage. */
r.post('/close', ah(async (req, res) => {
  const b = parse(z.object({ stage: z.string(), sourceId: z.coerce.number().int().positive(), key: z.string().optional(), reason: z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(500) }), req.body);
  const st = STAGE_BY_KEY.get(b.stage);
  if (!st) throw badRequest(`Unknown stage ${b.stage}`);
  must(req, st.source, 'edit');
  const out = await prisma.$transaction(async (tx) => {
    const x = await closePending(tx, req.user, b.stage, b.sourceId, b.reason, b.key);
    await audit(tx, req.user, 'CLOSE_PENDING', st.source, b.sourceId, { stage: st.key, reason: b.reason, items: x.closed });
    return x.closed;
  }, { timeout: 30000 });
  res.json({ ok: true, closed: out });
}));

/** Undo a closure (the qty becomes pending again). */
r.delete('/closures/:id', ah(async (req, res) => {
  const id = intParam(req);
  const c = await prisma.pendingClosure.findUnique({ where: { id } });
  if (!c) throw badRequest('Closure not found');
  must(req, c.sourceType, 'edit');
  await prisma.$transaction(async (tx) => {
    await reopenClosure(tx, id);
    await audit(tx, req.user, 'REOPEN_PENDING', c.sourceType, c.sourceId, { stage: c.stage, itemKey: c.itemKey, qty: Number(c.qty) });
  });
  res.json({ ok: true });
}));

export { CUTOFF_KEY };
export default { path: '/pending', router: r } satisfies ModuleDef;
