import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ah, intParam } from '../lib/http';
import { notFound } from '../lib/errors';
import { DOC_BY_TYPE, DocSummary, normalizeType, summarize } from '../services/admin-docs';
import type { ModuleDef } from '../app';

interface Node {
  type: string;
  id: number;
}
const key = (n: Node) => `${n.type}:${n.id}`;

/** child.fk -> parent  (flow direction: parent -> child) */
const FK_EDGES: { child: string; fk: string; parent: string }[] = [
  { child: 'SALES_QUOTATION', fk: 'enquiryId', parent: 'SALES_ENQUIRY' },
  { child: 'PROFORMA_INVOICE', fk: 'quotationId', parent: 'SALES_QUOTATION' },
  { child: 'PROFORMA_INVOICE', fk: 'salesOrderId', parent: 'SALES_ORDER' },
  { child: 'SALES_ORDER', fk: 'quotationId', parent: 'SALES_QUOTATION' },
  { child: 'SALES_ORDER', fk: 'proformaId', parent: 'PROFORMA_INVOICE' },
  { child: 'PICKING_LIST', fk: 'salesOrderId', parent: 'SALES_ORDER' },
  { child: 'PACKING_LIST', fk: 'salesOrderId', parent: 'SALES_ORDER' },
  { child: 'PACKING_LIST', fk: 'pickingId', parent: 'PICKING_LIST' },
  { child: 'DELIVERY_NOTE', fk: 'salesOrderId', parent: 'SALES_ORDER' },
  { child: 'DELIVERY_NOTE', fk: 'pickingId', parent: 'PICKING_LIST' },
  { child: 'DELIVERY_NOTE', fk: 'packingId', parent: 'PACKING_LIST' },
  { child: 'SALES_INVOICE', fk: 'salesOrderId', parent: 'SALES_ORDER' },
  { child: 'SALES_INVOICE', fk: 'deliveryId', parent: 'DELIVERY_NOTE' },
  { child: 'SALES_INVOICE', fk: 'proformaId', parent: 'PROFORMA_INVOICE' },
  { child: 'SALES_RETURN', fk: 'invoiceId', parent: 'SALES_INVOICE' },
  { child: 'PURCHASE_REQUISITION', fk: 'materialRequestId', parent: 'MATERIAL_REQUEST' },
  { child: 'PURCHASE_ENQUIRY', fk: 'requisitionId', parent: 'PURCHASE_REQUISITION' },
  { child: 'SUPPLIER_QUOTATION', fk: 'enquiryId', parent: 'PURCHASE_ENQUIRY' },
  { child: 'PURCHASE_ORDER', fk: 'quotationId', parent: 'SUPPLIER_QUOTATION' },
  { child: 'PURCHASE_ORDER', fk: 'importRequestId', parent: 'IMPORT_REQUEST' },
  { child: 'SUPPLIER_PROFORMA', fk: 'importRequestId', parent: 'IMPORT_REQUEST' },
  { child: 'IMPORT_SHIPMENT', fk: 'orderId', parent: 'PURCHASE_ORDER' },
  { child: 'GOODS_RECEIPT', fk: 'orderId', parent: 'PURCHASE_ORDER' },
  { child: 'GOODS_RECEIPT', fk: 'shipmentId', parent: 'IMPORT_SHIPMENT' },
  { child: 'PURCHASE_INVOICE', fk: 'orderId', parent: 'PURCHASE_ORDER' },
  { child: 'PURCHASE_INVOICE', fk: 'receiptId', parent: 'GOODS_RECEIPT' },
  { child: 'LANDED_COST', fk: 'receiptId', parent: 'GOODS_RECEIPT' },
  { child: 'PURCHASE_RETURN', fk: 'invoiceId', parent: 'PURCHASE_INVOICE' },
  { child: 'PURCHASE_RETURN', fk: 'receiptId', parent: 'GOODS_RECEIPT' },
];

const CHAINS = [
  { key: 'SALES', label: 'Sales', types: ['SALES_QUOTATION', 'SALES_ORDER', 'PICKING_LIST', 'DELIVERY_NOTE', 'SALES_INVOICE', 'RECEIPT_VOUCHER'] },
  { key: 'PURCHASE_LOCAL', label: 'Purchase (Local)', types: ['PURCHASE_REQUISITION', 'PURCHASE_ENQUIRY', 'SUPPLIER_QUOTATION', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'PURCHASE_INVOICE', 'PAYMENT_VOUCHER'] },
  { key: 'PURCHASE_IMPORT', label: 'Purchase (Import)', types: ['IMPORT_REQUEST', 'SUPPLIER_PROFORMA', 'PURCHASE_ORDER', 'IMPORT_SHIPMENT', 'GOODS_RECEIPT', 'LANDED_COST', 'PURCHASE_INVOICE', 'PAYMENT_VOUCHER'] },
];
const IMPORT_ONLY = new Set(['IMPORT_REQUEST', 'SUPPLIER_PROFORMA', 'IMPORT_SHIPMENT', 'LANDED_COST']);
const LOCAL_ONLY = new Set(['PURCHASE_REQUISITION', 'PURCHASE_ENQUIRY', 'SUPPLIER_QUOTATION']);
const ALLOC_TYPES = new Set(['SALES_INVOICE', 'PURCHASE_INVOICE', 'PURCHASE_ORDER']);
const MAX_NODES = 250;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dlg = (type: string): any => {
  const def = DOC_BY_TYPE.get(type);
  return def ? (prisma as unknown as Record<string, unknown>)[def.model] : undefined;
};

const voucherType = (v: string) => (v === 'RECEIPT' ? 'RECEIPT_VOUCHER' : 'PAYMENT_VOUCHER');

async function neighbors(n: Node): Promise<{ from: Node; to: Node; no?: Record<string, string> }[]> {
  const out: { from: Node; to: Node; no?: Record<string, string> }[] = [];
  const add = (from: Node, to: Node) => out.push({ from, to });
  // DocumentLink rows (both directions)
  const [asFrom, asTo] = await Promise.all([
    prisma.documentLink.findMany({ where: { fromType: { in: aliasesOf(n.type) }, fromId: n.id } }),
    prisma.documentLink.findMany({ where: { toType: { in: aliasesOf(n.type) }, toId: n.id } }),
  ]);
  for (const l of asFrom) out.push({ from: n, to: { type: normalizeType(l.toType), id: l.toId }, no: { [`${normalizeType(l.toType)}:${l.toId}`]: l.toNo } });
  for (const l of asTo) out.push({ from: { type: normalizeType(l.fromType), id: l.fromId }, to: n, no: { [`${normalizeType(l.fromType)}:${l.fromId}`]: l.fromNo } });

  // inferred FK edges
  for (const e of FK_EDGES) {
    if (e.child === n.type) {
      const row = await dlg(n.type)?.findUnique({ where: { id: n.id }, select: { [e.fk]: true } });
      const pid = row?.[e.fk];
      if (typeof pid === 'number') add({ type: e.parent, id: pid }, n);
    }
    if (e.parent === n.type) {
      const rows = await dlg(e.child)?.findMany({ where: { [e.fk]: n.id }, select: { id: true } });
      for (const r of rows ?? []) add(n, { type: e.child, id: r.id });
    }
  }
  // voucher allocations
  if (n.type === 'RECEIPT_VOUCHER' || n.type === 'PAYMENT_VOUCHER') {
    const allocs = await prisma.voucherAllocation.findMany({ where: { voucherId: n.id } });
    for (const a of allocs) add({ type: normalizeType(a.docType), id: a.docId }, n);
  }
  if (ALLOC_TYPES.has(n.type)) {
    const allocs = await prisma.voucherAllocation.findMany({ where: { docType: n.type, docId: n.id }, include: { voucher: { select: { id: true, voucherType: true } } } });
    for (const a of allocs) add(n, { type: voucherType(a.voucher.voucherType), id: a.voucher.id });
  }
  return out;
}

function aliasesOf(type: string): string[] {
  const s = new Set([type]);
  if (type === 'RECEIPT_VOUCHER') s.add('RECEIPT');
  if (type === 'PAYMENT_VOUCHER') s.add('PAYMENT');
  if (type === 'GOODS_RECEIPT') s.add('GRN');
  if (type === 'PURCHASE_ORDER') s.add('IMPORT_PURCHASE_ORDER');
  if (type === 'DELIVERY_NOTE') s.add('DELIVERY');
  if (type === 'PICKING_LIST') s.add('PICKING');
  return [...s];
}

const r = Router();

r.get(
  '/:type/:id',
  ah(async (req, res) => {
    const type = normalizeType(String(req.params.type));
    const id = intParam(req);
    const def = DOC_BY_TYPE.get(type);
    if (!def) throw notFound(`Unknown document type "${req.params.type}"`);
    const self = await dlg(type)?.findUnique({ where: { id } });
    if (!self) throw notFound('Document not found');

    const start: Node = { type, id };
    const nodes = new Map<string, Node>([[key(start), start]]);
    const edges = new Map<string, { from: Node; to: Node }>();
    const noHint = new Map<string, string>();
    const queue: Node[] = [start];
    while (queue.length && nodes.size < MAX_NODES) {
      const cur = queue.shift()!;
      for (const e of await neighbors(cur)) {
        edges.set(`${key(e.from)}>${key(e.to)}`, { from: e.from, to: e.to });
        if (e.no) for (const [k, v] of Object.entries(e.no)) noHint.set(k, v);
        for (const nn of [e.from, e.to]) {
          if (!nodes.has(key(nn))) {
            nodes.set(key(nn), nn);
            queue.push(nn);
          }
        }
      }
    }

    // resolve document summaries per type
    const byType = new Map<string, number[]>();
    for (const n of nodes.values()) byType.set(n.type, [...(byType.get(n.type) ?? []), n.id]);
    const summaries = new Map<string, DocSummary>();
    for (const [t, ids] of byType) {
      const d = DOC_BY_TYPE.get(t);
      if (!d) continue;
      const rows = await dlg(t).findMany({ where: { id: { in: ids }, ...(d.where ?? {}) } });
      for (const s of await summarize(d, rows)) summaries.set(`${t}:${s.id}`, s);
    }
    const docOf = (n: Node) => {
      const s = summaries.get(key(n));
      return s
        ? { type: s.type, typeLabel: s.typeLabel, id: s.id, no: s.no, date: s.date, status: s.status, party: s.party, amount: s.amount, route: s.route }
        : { type: n.type, typeLabel: n.type, id: n.id, no: noHint.get(key(n)) ?? String(n.id), date: null, status: null, party: null, amount: null, route: '' };
    };
    // drop nodes whose rows no longer exist (stale links), keep the viewed doc
    const live = [...nodes.values()].filter((n) => summaries.has(key(n)) || !DOC_BY_TYPE.has(n.type));
    const liveKeys = new Set(live.map(key));

    // chain selection
    const present = new Set(live.map((n) => n.type));
    const poRow = present.has('PURCHASE_ORDER') ? await prisma.purchaseOrder.findFirst({ where: { id: { in: byType.get('PURCHASE_ORDER') ?? [] } }, select: { orderType: true } }) : null;
    const isImport = [...present].some((t) => IMPORT_ONLY.has(t)) || poRow?.orderType === 'IMPORT' || (type === 'PURCHASE_ORDER' && (self as { orderType?: string }).orderType === 'IMPORT');
    const hasLocalOnly = [...present].some((t) => LOCAL_ONLY.has(t));
    const activeStatus = (s?: string | null) => s !== 'CANCELLED' && s !== 'REJECTED';

    const chains = CHAINS.map((c) => {
      const applicable = c.types.includes(type) && (c.key === 'SALES' || (c.key === 'PURCHASE_IMPORT' ? isImport : !isImport || hasLocalOnly));
      const stages = c.types.map((t) => {
        const docs = live.filter((n) => n.type === t).map(docOf).sort((a, b) => a.id - b.id);
        const done = docs.some((d) => activeStatus(d.status));
        const state = t === type ? 'current' : done ? 'done' : 'pending';
        return { type: t, label: DOC_BY_TYPE.get(t)?.label ?? t, state, symbol: state === 'done' ? '✓' : state === 'current' ? '●' : '○', docs };
      });
      const lastDone = stages.reduce((m, s, i) => (s.state !== 'pending' ? i : m), -1);
      return { key: c.key, label: c.label, applicable, nextStage: stages.slice(lastDone + 1).find((s) => s.state === 'pending')?.type ?? null, stages };
    });
    // exactly one primary chain: the best fit for the viewed document
    const primary = chains.find((c) => c.applicable) ?? null;

    const selfKey = key(start);
    const parents = [...edges.values()].filter((e) => key(e.to) === selfKey && liveKeys.has(key(e.from))).map((e) => docOf(e.from));
    const children = [...edges.values()].filter((e) => key(e.from) === selfKey && liveKeys.has(key(e.to))).map((e) => docOf(e.to));
    const directKeys = new Set([selfKey, ...parents.map((p) => `${p.type}:${p.id}`), ...children.map((c) => `${c.type}:${c.id}`)]);
    const related = live.filter((n) => !directKeys.has(key(n))).map(docOf);
    const uniq = <T extends { type: string; id: number }>(a: T[]) => [...new Map(a.map((x) => [`${x.type}:${x.id}`, x])).values()];

    res.json({
      document: docOf(start),
      primaryChain: primary?.key ?? null,
      chains: chains.map((c) => ({ ...c, primary: c.key === primary?.key })),
      createdFrom: uniq(parents),
      convertedTo: uniq(children),
      related,
      truncated: nodes.size >= MAX_NODES,
    });
  }),
);

export default [{ path: '/doc-flow', router: r }] satisfies ModuleDef[];
