import type { NextFunction, Request, Response } from 'express';
import { prisma, Prisma, Tx } from '../lib/prisma';
import { num, r3 } from '../lib/calc';
import { DOC_BY_TYPE } from './admin-docs';
import { badRequest, notFound } from '../lib/errors';

/**
 * Pending items: quantities of a source document that were not carried into the next document of its chain.
 *
 *   pending(item) = source qty - qty on live (non-cancelled, drafts included) target docs - qty closed by a user
 *
 * Items are matched by product (lines without a product by description). A stage only reports pending once it has
 * started, i.e. at least one live target document (or a closure) exists; an untouched document is simply "not converted".
 * Documents dated before the `pending.cutoffDate` setting are ignored.
 */

type Db = Tx | typeof prisma;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface Stage {
  key: string;
  source: string;
  target: string;
  /** field on the target document pointing at the source */
  fk: string;
  /** what pending means on the source, e.g. "Not ordered" */
  label: string;
  /** 'max': several targets each cover the same items (RFQ -> one quotation per supplier) */
  agg?: 'sum' | 'max';
  /** extra filter on source docs */
  sourceWhere?: Record<string, unknown>;
  /** target statuses that do not count */
  deadTarget?: string[];
}

export const STAGES: Stage[] = [
  { key: 'SE_SQ', source: 'SALES_ENQUIRY', target: 'SALES_QUOTATION', fk: 'enquiryId', label: 'Not quoted' },
  { key: 'SQ_SO', source: 'SALES_QUOTATION', target: 'SALES_ORDER', fk: 'quotationId', label: 'Not ordered' },
  { key: 'PF_SO', source: 'PROFORMA_INVOICE', target: 'SALES_ORDER', fk: 'proformaId', label: 'Not ordered' },
  { key: 'SO_DN', source: 'SALES_ORDER', target: 'DELIVERY_NOTE', fk: 'salesOrderId', label: 'Not delivered' },
  { key: 'SO_SI', source: 'SALES_ORDER', target: 'SALES_INVOICE', fk: 'salesOrderId', label: 'Not invoiced' },
  { key: 'DN_SI', source: 'DELIVERY_NOTE', target: 'SALES_INVOICE', fk: 'deliveryId', label: 'Not invoiced' },
  { key: 'MR_PR', source: 'MATERIAL_REQUEST', target: 'PURCHASE_REQUISITION', fk: 'materialRequestId', label: 'Not requisitioned' },
  { key: 'PR_RFQ', source: 'PURCHASE_REQUISITION', target: 'PURCHASE_ENQUIRY', fk: 'requisitionId', label: 'Not sent for quotation' },
  { key: 'RFQ_SQ', source: 'PURCHASE_ENQUIRY', target: 'SUPPLIER_QUOTATION', fk: 'enquiryId', label: 'Not quoted by any supplier', agg: 'max', deadTarget: ['CANCELLED'] },
  { key: 'SQ_PO', source: 'SUPPLIER_QUOTATION', target: 'PURCHASE_ORDER', fk: 'quotationId', label: 'Not ordered' },
  { key: 'IR_SP', source: 'IMPORT_REQUEST', target: 'SUPPLIER_PROFORMA', fk: 'importRequestId', label: 'Not on a proforma' },
  { key: 'SP_PO', source: 'SUPPLIER_PROFORMA', target: 'PURCHASE_ORDER', fk: 'supplierProformaId', label: 'Not ordered' },
  { key: 'PO_SH', source: 'PURCHASE_ORDER', target: 'IMPORT_SHIPMENT', fk: 'orderId', label: 'Not shipped', sourceWhere: { orderType: 'IMPORT' } },
  { key: 'SH_GRN', source: 'IMPORT_SHIPMENT', target: 'GOODS_RECEIPT', fk: 'shipmentId', label: 'Not received' },
  { key: 'PO_GRN', source: 'PURCHASE_ORDER', target: 'GOODS_RECEIPT', fk: 'orderId', label: 'Not received' },
  { key: 'GRN_PI', source: 'GOODS_RECEIPT', target: 'PURCHASE_INVOICE', fk: 'receiptId', label: 'Not invoiced' },
  { key: 'PO_PI', source: 'PURCHASE_ORDER', target: 'PURCHASE_INVOICE', fk: 'orderId', label: 'Not invoiced' },
];
export const STAGE_BY_KEY = new Map(STAGES.map((s) => [s.key, s]));

/** Source statuses that never show pending (the document itself is finished / dead). */
const DEAD_SOURCE = ['CANCELLED', 'REJECTED', 'EXPIRED', 'CLOSED'];
const DEAD_TARGET = ['CANCELLED', 'REJECTED'];

/** Permission module of each document type (view = see pending, edit = close pending). */
export const DOC_PERM: Record<string, string> = {
  SALES_ENQUIRY: 'sales_enquiry', SALES_QUOTATION: 'sales_quotation', PROFORMA_INVOICE: 'proforma_invoice', SALES_ORDER: 'sales_order',
  DELIVERY_NOTE: 'delivery_note', SALES_INVOICE: 'sales_invoice', MATERIAL_REQUEST: 'material_request', PURCHASE_REQUISITION: 'purchase_requisition',
  PURCHASE_ENQUIRY: 'purchase_enquiry', SUPPLIER_QUOTATION: 'supplier_quotation', PURCHASE_ORDER: 'purchase_order', IMPORT_REQUEST: 'import_purchase',
  SUPPLIER_PROFORMA: 'import_purchase', IMPORT_SHIPMENT: 'import_purchase', GOODS_RECEIPT: 'goods_receipt', PURCHASE_INVOICE: 'purchase_invoice',
};

/**
 * Conversion-type sources get a PARTIALLY_* status while something is pending.
 * Synced only when the doc is currently in `full` or `partial`; with no live target left it goes back to `revert`.
 */
const STATUS_SYNC: Record<string, { stage: string; full: string; partial: string; revert: string }> = {
  SALES_ENQUIRY: { stage: 'SE_SQ', full: 'QUOTED', partial: 'PARTIALLY_QUOTED', revert: 'OPEN' },
  SALES_QUOTATION: { stage: 'SQ_SO', full: 'CONVERTED', partial: 'PARTIALLY_CONVERTED', revert: 'ACCEPTED' },
  PROFORMA_INVOICE: { stage: 'PF_SO', full: 'CONVERTED', partial: 'PARTIALLY_CONVERTED', revert: 'ISSUED' },
  PURCHASE_REQUISITION: { stage: 'PR_RFQ', full: 'CONVERTED', partial: 'PARTIALLY_CONVERTED', revert: 'APPROVED' },
  PURCHASE_ENQUIRY: { stage: 'RFQ_SQ', full: 'QUOTED', partial: 'PARTIALLY_QUOTED', revert: 'SENT' },
  SUPPLIER_QUOTATION: { stage: 'SQ_PO', full: 'CONVERTED', partial: 'PARTIALLY_CONVERTED', revert: 'SELECTED' },
  SUPPLIER_PROFORMA: { stage: 'SP_PO', full: 'CONVERTED', partial: 'PARTIALLY_CONVERTED', revert: 'RECEIVED' },
};

// ------------------------------------------------------------------ helpers
const def = (type: string) => {
  const d = DOC_BY_TYPE.get(type);
  if (!d) throw new Error(`Unknown document type ${type}`);
  return d;
};
const dlg = (db: Db, type: string): Any => (db as Any)[def(type).model];

/** Does the item model of `type` have a description column? (decided from the Prisma schema) */
const itemHasDesc = (() => {
  const cache = new Map<string, boolean>();
  return (type: string) => {
    if (!cache.has(type)) {
      const modelName = def(type).model.replace(/^./, (c) => c.toUpperCase());
      const m = Prisma.dmmf.datamodel.models.find((x) => x.name === modelName);
      const itemsField = m?.fields.find((f) => f.name === 'items');
      const im = Prisma.dmmf.datamodel.models.find((x) => x.name === itemsField?.type);
      cache.set(type, !!im?.fields.some((f) => f.name === 'description'));
    }
    return cache.get(type)!;
  };
})();
const itemSelect = (type: string) => ({ productId: true, qty: true, ...(itemHasDesc(type) ? { description: true } : {}) });

export const itemKey = (i: { productId?: number | null; description?: string | null }) =>
  i.productId ? `p${i.productId}` : `d${(i.description ?? '').trim().toLowerCase()}`;

const chunk = <T>(a: T[], n = 500) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export const CUTOFF_KEY = 'pending.cutoffDate';
export const DEFAULT_CUTOFF = '1970-01-01';
/** Cached for 30 s: it is read on every pending computation (list badges, detail panels). */
let cutoffCache: { at: number; value: Date } | null = null;
export async function cutoffDate(db: Db = prisma): Promise<Date> {
  if (cutoffCache && Date.now() - cutoffCache.at < 30_000) return cutoffCache.value;
  const r = await db.systemSetting.findUnique({ where: { key: CUTOFF_KEY } });
  let d = new Date(`${(r?.value || DEFAULT_CUTOFF).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) d = new Date(`${DEFAULT_CUTOFF}T00:00:00`);
  cutoffCache = { at: Date.now(), value: d };
  return d;
}

/** Cutoff as YYYY-MM-DD in server local time (toISOString would shift it a day back east of UTC). */
export async function cutoffYmd(): Promise<string> {
  const d = await cutoffDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ core computation
export interface PendingLine {
  key: string;
  productId: number | null;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  sourceQty: number;
  processedQty: number;
  closedQty: number;
  pendingQty: number;
}
export interface StageResult {
  stage: string;
  label: string;
  sourceType: string;
  sourceLabel: string;
  sourceId: number;
  sourceNo: string;
  sourceDate: Date | null;
  sourceStatus: string | null;
  partyId: number | null;
  partyType: 'customer' | 'supplier' | null;
  targetType: string;
  targetLabel: string;
  targets: { id: number; no: string; status: string | null }[];
  lines: PendingLine[];
  closures: { id: number; itemKey: string; productId: number | null; code?: string | null; name?: string | null; description?: string | null; qty: number; reason: string; createdAt: Date }[];
}

interface ComputeOpts {
  /** apply cutoff + dead-source + "started" filters (default true). Off = raw remaining (used by conversions). */
  filter?: boolean;
  /** resolve product code/name (default true) */
  names?: boolean;
}

/** Pending per source document for one stage. Missing ids = nothing to report. */
export async function computeStage(db: Db, stage: Stage, sourceIds: number[], opts: ComputeOpts = {}): Promise<Map<number, StageResult>> {
  const out = new Map<number, StageResult>();
  const ids = [...new Set(sourceIds)].filter((x) => Number.isInteger(x) && x > 0);
  if (!ids.length) return out;
  const filter = opts.filter !== false;
  const sd = def(stage.source);
  const td = def(stage.target);
  const cutoff = filter ? await cutoffDate(db) : null;

  const partyField = sd.customerField ?? sd.supplierField;
  const sources: Any[] = [];
  for (const part of chunk(ids)) {
    sources.push(...(await dlg(db, stage.source).findMany({
      where: { id: { in: part }, ...(sd.where ?? {}), ...(stage.sourceWhere ?? {}) },
      select: { id: true, status: true, [sd.noField]: true, [sd.dateField]: true, ...(partyField ? { [partyField]: true } : {}), items: { select: itemSelect(stage.source) } },
    })));
  }
  const live = sources.filter((s) => !filter || (!DEAD_SOURCE.includes(s.status) && (!cutoff || (s[sd.dateField] && new Date(s[sd.dateField]) >= cutoff))));
  if (!live.length) return out;
  const liveIds = live.map((s) => s.id);

  const parts = chunk(liveIds);
  const [tParts, cParts] = await Promise.all([
    Promise.all(parts.map((part) => dlg(db, stage.target).findMany({
      where: { [stage.fk]: { in: part }, status: { notIn: stage.deadTarget ?? DEAD_TARGET }, ...(td.where ?? {}) },
      select: { id: true, status: true, [td.noField]: true, [stage.fk]: true, items: { select: itemSelect(stage.target) } },
      orderBy: { id: 'asc' },
    }) as Promise<Any[]>)),
    Promise.all(parts.map((part) => db.pendingClosure.findMany({ where: { stage: stage.key, sourceId: { in: part } }, orderBy: { id: 'asc' } }) as Promise<Any[]>)),
  ]);
  const targets: Any[] = tParts.flat();
  const closures: Any[] = cParts.flat();

  const tBy = new Map<number, Any[]>();
  for (const t of targets) tBy.set(t[stage.fk], [...(tBy.get(t[stage.fk]) ?? []), t]);
  const cBy = new Map<number, Any[]>();
  for (const c of closures) cBy.set(c.sourceId, [...(cBy.get(c.sourceId) ?? []), c]);
  for (const s of live) {
    const tg = tBy.get(s.id) ?? [];
    const cl = cBy.get(s.id) ?? [];
    if (filter && !tg.length && !cl.length) continue;
    const lines = new Map<string, PendingLine>();
    for (const i of s.items as Any[]) {
      const k = itemKey(i);
      const l = lines.get(k) ?? { key: k, productId: i.productId ?? null, description: i.description ?? null, sourceQty: 0, processedQty: 0, closedQty: 0, pendingQty: 0 };
      l.sourceQty += num(i.qty);
      lines.set(k, l);
    }
    for (const t of tg) {
      const per = new Map<string, number>();
      for (const i of t.items as Any[]) per.set(itemKey(i), (per.get(itemKey(i)) ?? 0) + num(i.qty));
      for (const [k, q] of per) {
        const l = lines.get(k);
        if (!l) continue; // item added in the target that the source never had
        l.processedQty = stage.agg === 'max' ? Math.max(l.processedQty, q) : l.processedQty + q;
      }
    }
    for (const c of cl) {
      const l = lines.get(c.itemKey);
      if (l) l.closedQty += num(c.qty);
    }
    const arr = [...lines.values()].map((l) => ({ ...l, sourceQty: r3(l.sourceQty), processedQty: r3(l.processedQty), closedQty: r3(l.closedQty), pendingQty: r3(Math.max(0, l.sourceQty - l.processedQty - l.closedQty)) }));
    out.set(s.id, {
      stage: stage.key, label: stage.label, sourceType: stage.source, sourceLabel: sd.label, sourceId: s.id, sourceNo: s[sd.noField], sourceDate: s[sd.dateField] ?? null,
      sourceStatus: s.status ?? null, partyId: partyField ? s[partyField] ?? null : null, partyType: sd.customerField ? 'customer' : sd.supplierField ? 'supplier' : null,
      targetType: stage.target, targetLabel: td.label, targets: tg.map((t) => ({ id: t.id, no: t[td.noField], status: t.status ?? null })),
      lines: arr.filter((l) => l.pendingQty > 0.0005),
      closures: cl.map((c) => ({ id: c.id, itemKey: c.itemKey, productId: c.itemKey.startsWith('p') ? Number(c.itemKey.slice(1)) : null, description: c.itemKey.startsWith('d') ? c.itemKey.slice(1) : null, qty: num(c.qty), reason: c.reason, createdAt: c.createdAt })),
    });
  }
  if (opts.names !== false) await attachNames(db, [...out.values()].flatMap((r) => [...r.lines, ...r.closures]));
  return out;
}

async function attachNames(db: Db, lines: { productId: number | null; code?: string | null; name?: string | null }[]) {
  const pids = [...new Set(lines.map((l) => l.productId).filter((x): x is number => !!x))];
  if (!pids.length) return;
  const map = new Map<number, { code: string; name: string }>();
  for (const part of chunk(pids)) for (const p of await db.product.findMany({ where: { id: { in: part } }, select: { id: true, code: true, name: true } })) map.set(p.id, p);
  for (const l of lines) {
    const p = l.productId ? map.get(l.productId) : undefined;
    if (p) { l.code = p.code; l.name = p.name; }
  }
}

/** Pending for one document: as a source (what it still has to pass on) and as a target (what its sources still have pending). */
export async function pendingForDoc(type: string, id: number) {
  const tStages = STAGES.filter((s) => s.target === type);
  const fks = [...new Set(tStages.map((s) => s.fk))];
  // all stages are independent: run them in parallel
  const [srcRes, doc] = await Promise.all([
    Promise.all(STAGES.filter((s) => s.source === type).map(async (st) => (await computeStage(prisma, st, [id])).get(id))),
    fks.length ? dlg(prisma, type).findUnique({ where: { id }, select: Object.fromEntries(fks.map((f) => [f, true])) }) : null,
  ]);
  const tgtRes = doc
    ? await Promise.all(tStages.filter((st) => doc[st.fk]).map(async (st) => (await computeStage(prisma, st, [doc[st.fk]])).get(doc[st.fk])))
    : [];
  return {
    asSource: srcRes.filter((r): r is StageResult => !!r && (r.lines.length > 0 || r.closures.length > 0)),
    asTarget: tgtRes.filter((r): r is StageResult => !!r && r.lines.length > 0),
  };
}

/** Number of pending lines per document (as source), for list badges. */
export async function pendingFlags(type: string, ids: number[]): Promise<Record<number, number>> {
  const res: Record<number, number> = {};
  const all = await Promise.all(STAGES.filter((s) => s.source === type).map((st) => computeStage(prisma, st, ids, { names: false })));
  for (const m of all) {
    for (const [sid, r] of m) if (r.lines.length) res[sid] = (res[sid] ?? 0) + r.lines.length;
  }
  return res;
}

/** Every source with pending lines for the given stages (report). */
export async function pendingReport(stageKeys?: string[]): Promise<StageResult[]> {
  const cutoff = await cutoffDate();
  // start from source docs dated after the cutoff (the set that can be pending at all), stages in parallel
  const per = await Promise.all(STAGES.filter((s) => !stageKeys?.length || stageKeys.includes(s.key)).map(async (st) => {
    const sd = def(st.source);
    const src: Any[] = await dlg(prisma, st.source).findMany({
      where: { [sd.dateField]: { gte: cutoff }, status: { notIn: DEAD_SOURCE }, ...(sd.where ?? {}), ...(st.sourceWhere ?? {}) },
      select: { id: true },
    });
    const res = await computeStage(prisma, st, src.map((x) => x.id));
    return [...res.values()].filter((r) => r.lines.length);
  }));
  return per.flat();
}

// ------------------------------------------------------------------ "New <target>" pickers
/** Source statuses the conversion endpoint accepts, per stage (what a "New ..." picker may offer). */
const OPEN_FOR_NEXT: Record<string, { statuses: string[]; extra: Record<string, true> }> = {
  MR_PR: { statuses: ['APPROVED'], extra: { requestedBy: true, department: true, priority: true } },
  PR_RFQ: { statuses: ['APPROVED', 'PARTIALLY_CONVERTED', 'CONVERTED'], extra: { requestedBy: true, department: true, priority: true } },
  SQ_PO: { statuses: ['SELECTED', 'PARTIALLY_CONVERTED', 'CONVERTED'], extra: { supplierRef: true, total: true, currencyCode: true } },
};
export const OPEN_STAGES = Object.keys(OPEN_FOR_NEXT);

/**
 * Source documents of a stage that still have something to carry into the next document: untouched ones (everything
 * pending) and partly converted ones. Newest first, at most `limit`. Started documents dated before the cutoff are
 * left out, like everywhere else (their history predates pending tracking).
 */
export async function openForNext(stageKey: string, limit = 300) {
  const st = STAGE_BY_KEY.get(stageKey);
  const cfg = OPEN_FOR_NEXT[stageKey];
  if (!st || !cfg) throw badRequest(`Unknown stage ${stageKey}`);
  const sd = def(st.source);
  const partyField = sd.customerField ?? sd.supplierField;
  const src: Any[] = await dlg(prisma, st.source).findMany({
    where: { status: { in: cfg.statuses }, ...(sd.where ?? {}), ...(st.sourceWhere ?? {}) },
    select: { id: true, ...cfg.extra, ...(partyField ? { [partyField]: true } : {}) },
    orderBy: { id: 'desc' },
    take: limit,
  });
  const [res, cutoff] = await Promise.all([computeStage(prisma, st, src.map((s) => s.id), { filter: false, names: false }), cutoffDate()]);
  const rows: Any[] = [];
  for (const s of src) {
    const r = res.get(s.id);
    if (!r?.lines.length) continue;
    const started = r.targets.length > 0 || r.closures.length > 0;
    if (started && (!r.sourceDate || new Date(r.sourceDate) < cutoff)) continue;
    rows.push({
      ...s, docNo: r.sourceNo, docDate: r.sourceDate, status: r.sourceStatus, partyId: r.partyId,
      started, targets: r.targets.map((t) => t.no).join(', '),
      pendingLines: r.lines.length, pendingQty: r3(r.lines.reduce((a, l) => a + l.pendingQty, 0)),
    });
  }
  return rows;
}

// ------------------------------------------------------------------ conversions
/**
 * Remaining (unfiltered) qty per item key for a stage, used when converting again: only what is still pending is copied.
 */
export async function remainingQty(db: Db, stageKey: string, sourceId: number): Promise<Map<string, number>> {
  const st = STAGE_BY_KEY.get(stageKey)!;
  const r = (await computeStage(db, st, [sourceId], { filter: false, names: false })).get(sourceId);
  return new Map((r?.lines ?? []).map((l) => [l.key, l.pendingQty]));
}

/**
 * Restrict source lines to what is still pending (by item key, consumed in line order). Throws when nothing is left.
 * `mk` builds the new line from the source line and the qty to take.
 */
export async function takePending<I extends { productId?: number | null; description?: string | null; qty: unknown }, O>(
  db: Db, stageKey: string, sourceId: number, items: I[], mk: (i: I, qty: number) => O, docLabel: string,
): Promise<O[]> {
  const rem = await remainingQty(db, stageKey, sourceId);
  const out: O[] = [];
  for (const i of items) {
    const k = itemKey(i);
    const left = rem.get(k) ?? 0;
    const take = r3(Math.min(num(i.qty), left));
    if (take <= 0) continue;
    rem.set(k, r3(left - take));
    out.push(mk(i, take));
  }
  if (!out.length) {
    throw badRequest(`Nothing pending on ${docLabel}: every item has already been converted or closed`);
  }
  return out;
}

// ------------------------------------------------------------------ status sync
/** Set PARTIALLY_* / full / revert status of a conversion-type source from its current pending. */
export async function syncSourceStatus(db: Db, type: string, id: number | null | undefined) {
  if (!id) return;
  const cfg = STATUS_SYNC[type];
  if (!cfg) return;
  const d = dlg(db, type);
  const doc = await d.findUnique({ where: { id }, select: { id: true, status: true, [def(type).dateField]: true } });
  if (!doc || ![cfg.full, cfg.partial].includes(doc.status)) return;
  const st = STAGE_BY_KEY.get(cfg.stage)!;
  const r = (await computeStage(db, st, [id], { filter: false, names: false })).get(id);
  let next: string;
  if (!r || !r.targets.length) next = cfg.revert;
  else if (r.lines.length && (await cutoffDate(db)) <= new Date(doc[def(type).dateField])) next = cfg.partial;
  else next = cfg.full;
  if (next !== doc.status) await d.update({ where: { id }, data: { status: next } });
}

/** Source documents (type + id) that a target document was created from. */
export async function parentsOf(db: Db, targetType: string, targetId: number): Promise<{ type: string; id: number }[]> {
  const stages = STAGES.filter((s) => s.target === targetType && STATUS_SYNC[s.source]);
  if (!stages.length) return [];
  const doc = await dlg(db, targetType).findUnique({ where: { id: targetId }, select: Object.fromEntries([...new Set(stages.map((s) => s.fk))].map((f) => [f, true])) });
  if (!doc) return [];
  return stages.filter((s) => doc[s.fk]).map((s) => ({ type: s.source, id: doc[s.fk] as number }));
}
export async function syncParentsOf(db: Db, targetType: string, targetId: number) {
  for (const p of await parentsOf(db, targetType, targetId)) await syncSourceStatus(db, p.type, p.id);
}

/**
 * Router middleware for target documents: after a successful edit / cancel / delete of `/:id...`, re-sync the
 * status of the documents it was created from (parents are captured before the handler so deletes work too).
 */
export function syncParentsMiddleware(targetType: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET') return next();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return next();
    let parents: { type: string; id: number }[] = [];
    try {
      parents = await parentsOf(prisma, targetType, id);
    } catch {
      /* ignore */
    }
    if (parents.length) {
      res.on('finish', () => {
        if (res.statusCode >= 400) return;
        void (async () => {
          try {
            // the doc may have been re-linked by the handler; include its current parents as well
            const now = await parentsOf(prisma, targetType, id).catch(() => []);
            const all = new Map([...parents, ...now].map((p) => [`${p.type}:${p.id}`, p]));
            for (const p of all.values()) await syncSourceStatus(prisma, p.type, p.id);
          } catch (e) {
            console.error('pending: status sync failed', e);
          }
        })();
      });
    }
    next();
  };
}

// ------------------------------------------------------------------ closures
export async function closePending(db: Db, user: { id: number } | undefined, stageKey: string, sourceId: number, reason: string, key?: string) {
  const st = STAGE_BY_KEY.get(stageKey);
  if (!st) throw badRequest(`Unknown stage ${stageKey}`);
  const r = (await computeStage(db, st, [sourceId], { filter: false, names: false })).get(sourceId);
  const lines = (r?.lines ?? []).filter((l) => !key || l.key === key);
  if (!lines.length) throw badRequest('Nothing pending to close');
  for (const l of lines) {
    await db.pendingClosure.create({ data: { stage: st.key, sourceType: st.source, sourceId, itemKey: l.key, qty: l.pendingQty, reason, createdBy: user?.id ?? null } });
  }
  await syncSourceStatus(db, st.source, sourceId);
  return { stage: st, closed: lines.map((l) => ({ key: l.key, qty: l.pendingQty })) };
}

export async function reopenClosure(db: Db, closureId: number) {
  const c = await db.pendingClosure.findUnique({ where: { id: closureId } });
  if (!c) throw notFound('Closure not found');
  await db.pendingClosure.delete({ where: { id: closureId } });
  await syncSourceStatus(db, c.sourceType, c.sourceId);
  return c;
}

/** Text lines for printing on a target document ("From QT-0040 still pending: ..."). */
export async function pendingPrintNote(type: string, id: number): Promise<string | null> {
  const { asSource, asTarget } = await pendingForDoc(type, id);
  const fmtQ = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, ''));
  const line = (l: PendingLine) => `${l.code ?? l.description ?? l.key}${l.name ? ` ${l.name}` : ''}: ${fmtQ(l.pendingQty)}`;
  const parts: string[] = [];
  for (const r of asTarget) parts.push(`Pending from ${r.sourceLabel} ${r.sourceNo} (not included here): ${r.lines.map(line).join('; ')}`);
  for (const r of asSource) if (r.lines.length) parts.push(`${r.label}: ${r.lines.map(line).join('; ')}`);
  return parts.length ? parts.join('\n') : null;
}

// ------------------------------------------------------------------ list badges
const LIST_TYPES: Record<string, string> = {
  '/sales-enquiries': 'SALES_ENQUIRY', '/sales-quotations': 'SALES_QUOTATION', '/proforma-invoices': 'PROFORMA_INVOICE', '/sales-orders': 'SALES_ORDER',
  '/delivery-notes': 'DELIVERY_NOTE', '/material-requests': 'MATERIAL_REQUEST', '/purchase-requisitions': 'PURCHASE_REQUISITION', '/purchase-enquiries': 'PURCHASE_ENQUIRY',
  '/supplier-quotations': 'SUPPLIER_QUOTATION', '/purchase-orders': 'PURCHASE_ORDER', '/import-orders': 'PURCHASE_ORDER', '/import-requests': 'IMPORT_REQUEST',
  '/supplier-proformas': 'SUPPLIER_PROFORMA', '/import-shipments': 'IMPORT_SHIPMENT', '/goods-receipts': 'GOODS_RECEIPT',
};

/**
 * Adds `pendingCount` (pending line count) to the rows of document list responses (GET /<list>), so every list in
 * both UIs can show a "Pending" badge. One batched computation for the rows of the page only (indexed lookups).
 */
export function pendingListBadges(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'GET') return next();
  const type = LIST_TYPES[req.path.replace(/\/$/, '')];
  if (!type) return next();
  const json = res.json.bind(res);
  res.json = ((body: Any) => {
    const rows: Any[] | undefined = Array.isArray(body?.rows) ? body.rows : Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : undefined;
    if (res.statusCode >= 400 || !rows?.length || rows.length > 500) return json(body);
    pendingFlags(type, rows.map((r) => Number(r.id)).filter(Boolean))
      .then((flags) => {
        for (const r of rows) r.pendingCount = flags[r.id] ?? 0;
      })
      .catch((e) => console.error('pending: list badges failed', e))
      .finally(() => json(body));
    return res;
  }) as Response['json'];
  next();
}
