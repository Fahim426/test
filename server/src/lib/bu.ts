/**
 * Business Units (TZ / CARSN): one company, stock shared, every transaction and journal line tagged with a BU.
 *
 *  - A non-admin user works in exactly one BU (User.businessUnitId): everything they create is stamped with it and
 *    they only ever read / change records of that BU (other BUs' documents are simply "not found").
 *  - Admin sees all BUs. The top-bar selector sends `X-BU: <id>` to narrow every list / report to one BU; without it
 *    the admin sees everything (consolidated). New documents need a BU: the selected one, or the BU of the source
 *    document when converting (quotation -> proforma -> delivery -> invoice keep their BU).
 *  - Journals, stock movements and approval requests take the BU of their source document.
 *
 * All of it is applied in one place, a Prisma query extension (see prisma.ts), driven by the request context below.
 * Raw SQL ($queryRaw) is not covered: use scopeSql() for queries on BU tables.
 */
import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { badRequest, forbidden } from './errors';

export interface BuContext {
  userId?: number;
  isAdmin: boolean;
  /** the user's own BU (non-admin: the only one) */
  userBu: number | null;
  /** admin: BU picked in the top bar (X-BU), null = all */
  selectedBu: number | null;
  /** admin write request without a selection: BU of the first BU document read (the source / the document acted on) */
  lockedBu?: number | null;
  write: boolean;
}
const store = new AsyncLocalStorage<BuContext>();
export const buContext = () => store.getStore();
/** run code with a specific BU context (tests, scripts) */
export const runWithBu = <T>(ctx: BuContext, fn: () => T) => store.run(ctx, fn);

/** BU used to filter reads: non-admin = own BU (-1 = none when no BU assigned), admin = selection or null (all). */
export function viewBu(c = buContext()): number | null {
  if (!c) return null;
  if (!c.isAdmin) return c.userBu ?? -1;
  return c.selectedBu;
}
/** BU new records get from the context (null = must come from a source document). */
export function writeBu(c = buContext()): number | null {
  if (!c) return null;
  if (!c.isAdmin) return c.userBu;
  return c.selectedBu ?? c.lockedBu ?? null;
}

/** Express middleware (after authenticate): sets up the BU context for the rest of the request. */
export function buMiddleware(req: Request, _res: Response, next: NextFunction) {
  const u = req.user;
  if (!u) return next();
  const isAdmin = u.role === 'Admin';
  const h = String(req.headers['x-bu'] ?? '').trim();
  const selected = isAdmin && /^\d+$/.test(h) ? Number(h) : null;
  store.run({ userId: u.id, isAdmin, userBu: u.businessUnitId ?? null, selectedBu: selected, write: req.method !== 'GET' }, () => next());
}

// ------------------------------------------------------------------ model maps
/** documents (and journal lines) that carry buId; reads are filtered, creates stamped */
export const BU_DOCS = new Set([
  'SalesEnquiry', 'SalesQuotation', 'ProformaInvoice', 'SalesOrder', 'PickingList', 'PackingList', 'DeliveryNote', 'SalesInvoice', 'SalesReturn',
  'MaterialRequest', 'PurchaseRequisition', 'PurchaseEnquiry', 'SupplierQuotation', 'PurchaseOrder', 'ImportRequest', 'SupplierProforma', 'ImportShipment',
  'GoodsReceipt', 'LandedCost', 'PurchaseInvoice', 'PurchaseReturn', 'StockTransfer', 'StockAdjustment', 'Voucher', 'Note', 'AmcContract',
  'JournalEntry', 'JournalLine', 'ApprovalRequest',
]);
/** stamped (for BU-wise reporting) but never filtered: stock is shared by all BUs */
const BU_STAMP_ONLY = new Set(['StockTransaction']);

/** line tables: reads filtered through their parent document */
const ITEM_PARENT: Record<string, string> = {
  SalesEnquiryItem: 'enquiry', SalesQuotationItem: 'quotation', ProformaInvoiceItem: 'proforma', SalesOrderItem: 'order', DeliveryNoteItem: 'delivery',
  SalesInvoiceItem: 'invoice', SalesReturnItem: 'return', PurchaseOrderItem: 'order', GoodsReceiptItem: 'receipt', PurchaseInvoiceItem: 'invoice',
  PurchaseReturnItem: 'return', SupplierQuotationItem: 'quotation', PurchaseRequisitionItem: 'requisition', MaterialRequestItem: 'request',
};

/** source-document links: a converted document keeps the BU of the document it was created from */
const PARENTS: Record<string, [string, string][]> = {
  SalesQuotation: [['enquiryId', 'salesEnquiry']],
  ProformaInvoice: [['quotationId', 'salesQuotation']],
  SalesOrder: [['proformaId', 'proformaInvoice'], ['quotationId', 'salesQuotation']],
  PickingList: [['salesOrderId', 'salesOrder']],
  PackingList: [['salesOrderId', 'salesOrder'], ['pickingId', 'pickingList']],
  DeliveryNote: [['salesOrderId', 'salesOrder']],
  SalesInvoice: [['salesOrderId', 'salesOrder'], ['deliveryId', 'deliveryNote'], ['proformaId', 'proformaInvoice']],
  SalesReturn: [['invoiceId', 'salesInvoice']],
  PurchaseRequisition: [['materialRequestId', 'materialRequest']],
  PurchaseEnquiry: [['requisitionId', 'purchaseRequisition']],
  SupplierQuotation: [['enquiryId', 'purchaseEnquiry']],
  PurchaseOrder: [['quotationId', 'supplierQuotation'], ['importRequestId', 'importRequest']],
  SupplierProforma: [['importRequestId', 'importRequest']],
  ImportShipment: [['orderId', 'purchaseOrder']],
  GoodsReceipt: [['orderId', 'purchaseOrder'], ['shipmentId', 'importShipment']],
  LandedCost: [['receiptId', 'goodsReceipt']],
  PurchaseInvoice: [['orderId', 'purchaseOrder'], ['receiptId', 'goodsReceipt']],
  PurchaseReturn: [['invoiceId', 'purchaseInvoice'], ['receiptId', 'goodsReceipt']],
};

/** document type (journal sourceType / stock refType / approval docType) -> prisma delegate */
export const TYPE_MODEL: Record<string, string> = {
  SALES_ENQUIRY: 'salesEnquiry', SALES_QUOTATION: 'salesQuotation', PROFORMA_INVOICE: 'proformaInvoice', SALES_ORDER: 'salesOrder', PICKING_LIST: 'pickingList',
  PACKING_LIST: 'packingList', DELIVERY_NOTE: 'deliveryNote', SALES_INVOICE: 'salesInvoice', SALES_RETURN: 'salesReturn', MATERIAL_REQUEST: 'materialRequest',
  PURCHASE_REQUISITION: 'purchaseRequisition', PURCHASE_ENQUIRY: 'purchaseEnquiry', SUPPLIER_QUOTATION: 'supplierQuotation', PURCHASE_ORDER: 'purchaseOrder',
  IMPORT_PURCHASE_ORDER: 'purchaseOrder', IMPORT_REQUEST: 'importRequest', SUPPLIER_PROFORMA: 'supplierProforma', IMPORT_SHIPMENT: 'importShipment',
  GOODS_RECEIPT: 'goodsReceipt', LANDED_COST: 'landedCost', PURCHASE_INVOICE: 'purchaseInvoice', PURCHASE_RETURN: 'purchaseReturn',
  STOCK_TRANSFER: 'stockTransfer', STOCK_ADJUSTMENT: 'stockAdjustment', RECEIPT_VOUCHER: 'voucher', PAYMENT_VOUCHER: 'voucher', ADVANCE_SETTLEMENT: 'voucher',
  RECEIPT: 'voucher', PAYMENT: 'voucher', NOTE: 'note', NOTE_APPLIED: 'note', CREDIT_NOTE: 'note', DEBIT_NOTE: 'note', AMC_CONTRACT: 'amcContract',
};
/** model -> [type field, id field] whose source document gives the BU */
const DERIVED: Record<string, [string, string]> = {
  JournalEntry: ['sourceType', 'sourceId'],
  StockTransaction: ['refType', 'refId'],
  ApprovalRequest: ['docType', 'docId'],
};

// ------------------------------------------------------------------ helpers (unscoped client)
let raw: PrismaClient | null = null;
export const setRawClient = (c: PrismaClient) => {
  raw = c;
};
const cap = (d: string) => d.charAt(0).toUpperCase() + d.slice(1);
/**
 * BU of one committed document row, using a non-locking MySQL read. New documents in the current
 * transaction use the request context until their source rows are committed.
 */
async function buOfRow(delegateName: string, id: number): Promise<number | null> {
  const table = cap(delegateName);
  if (!raw || !BU_DOCS.has(table) || !Number.isInteger(id)) return null;
  const r = await raw.$queryRaw<{ buId: number | null }[]>(Prisma.sql`SELECT buId FROM ${Prisma.raw('`' + table + '`')} WHERE id = ${id} LIMIT 1`);
  return r[0]?.buId ?? null;
}

/** BU of a document by type + id (unscoped), null when unknown. */
export async function buOfDoc(type: string | null | undefined, id: number | null | undefined): Promise<number | null> {
  if (!type || !id) return null;
  const m = TYPE_MODEL[type];
  return m ? buOfRow(m, id).catch(() => null) : null;
}

let defaultBuCache: { id: number | null; at: number } | null = null;
/** the default BU (setting bu.defaultId, else the first BU): used for records created outside a user request */
export async function defaultBu(): Promise<number | null> {
  if (defaultBuCache && Date.now() - defaultBuCache.at < 60_000) return defaultBuCache.id;
  const s = await raw?.systemSetting.findUnique({ where: { key: 'bu.defaultId' } });
  const id = s && /^\d+$/.test(s.value) ? Number(s.value) : (await raw?.businessUnit.findFirst({ orderBy: { id: 'asc' }, select: { id: true } }))?.id ?? null;
  defaultBuCache = { id, at: Date.now() };
  return id;
}

let codeCache: { map: Map<number, string>; at: number } | null = null;
export async function buCode(id: number | null | undefined): Promise<string | null> {
  if (!id) return null;
  if (!codeCache || Date.now() - codeCache.at > 60_000) {
    const rows = (await raw?.businessUnit.findMany({ select: { id: true, code: true } })) ?? [];
    codeCache = { map: new Map(rows.map((r) => [r.id, r.code])), at: Date.now() };
  }
  return codeCache.map.get(id) ?? null;
}

/** BU for a new document: source document's BU, else the context BU. Refuses mixing BUs. */
async function stampDoc(model: string, data: Record<string, unknown>): Promise<number | null> {
  const c = buContext();
  if (!c) return (data.buId as number | undefined) ?? (await defaultBu());
  let parentBu: number | null = null;
  for (const [fk, parent] of PARENTS[model] ?? []) {
    const id = data[fk];
    if (typeof id === 'number') {
      const b = await buOfRow(parent, id).catch(() => null);
      if (b) {
        parentBu = b;
        break;
      }
    }
  }
  const explicit = typeof data.buId === 'number' ? (data.buId as number) : null;
  if (!c.isAdmin) {
    if (!c.userBu) throw forbidden('Your user has no Business Unit. Ask an administrator to assign one.');
    if ((explicit && explicit !== c.userBu) || (parentBu && parentBu !== c.userBu)) throw forbidden('That document belongs to another Business Unit');
    return c.userBu;
  }
  const want = explicit ?? c.selectedBu;
  if (want && parentBu && want !== parentBu) {
    throw badRequest(`The source document belongs to Business Unit ${await buCode(parentBu)}; switch the BU selector to ${await buCode(parentBu)} (or All) to continue`);
  }
  const bu = parentBu ?? want ?? c.lockedBu ?? null;
  if (!bu) throw badRequest('Choose a Business Unit before creating documents (the Business Unit field on the document, or the top bar)');
  return bu;
}

/** BU for a journal entry / stock movement / approval: its source document's, else the context's, else the default. */
async function stampDerived(model: string, data: Record<string, unknown>): Promise<number | null> {
  if (typeof data.buId === 'number') return data.buId;
  const [t, i] = DERIVED[model];
  return (await buOfDoc(data[t] as string, data[i] as number)) ?? writeBu() ?? buContext()?.userBu ?? (await defaultBu());
}

const READS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany']);
const UNIQUE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']);
type Args = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown; create?: Record<string, unknown> };

/** The Prisma query hook: stamps creates and narrows reads / writes to the visible BU. */
export async function scopeQuery(model: string | undefined, operation: string, args: Args, query: (a: Args) => Promise<unknown>) {
  if (!model) return query(args);
  const isDoc = BU_DOCS.has(model);
  const stampOnly = BU_STAMP_ONLY.has(model);
  const derived = !!DERIVED[model];
  if (isDoc || stampOnly) {
    const stamp = async (d: Record<string, unknown>) => {
      if (d.buId !== undefined && !buContext()) return d;
      const bu = derived ? await stampDerived(model, d) : model === 'JournalLine' ? (d.buId as number | undefined) ?? writeBu() ?? (await defaultBu()) : await stampDoc(model, d);
      return { ...d, buId: bu };
    };
    if (operation === 'create' && args.data) args = { ...args, data: await stamp(args.data as Record<string, unknown>) };
    else if (operation === 'createMany' && args.data) args = { ...args, data: await Promise.all((Array.isArray(args.data) ? args.data : [args.data]).map((d) => stamp(d as Record<string, unknown>))) };
    else if (operation === 'upsert' && args.create) args = { ...args, create: await stamp(args.create) };
  }
  const vb = viewBu();
  if ((model === 'EInvoiceQueue' || model === 'EInvoiceLog') && vb !== null && raw) {
    const table = Prisma.raw(model === 'EInvoiceQueue' ? '`EInvoiceQueue`' : '`EInvoiceLog`');
    const systemLog = model === 'EInvoiceLog' ? Prisma.sql`OR q.invoiceId IS NULL` : Prisma.empty;
    const visible = await raw.$queryRaw<{ id: number }[]>(Prisma.sql`
      SELECT q.id FROM ${table} q LEFT JOIN SalesInvoice i ON i.id = q.invoiceId
      WHERE i.buId = ${vb} ${systemLog}`);
    const permitted = { id: { in: visible.map(row => row.id) } };
    if (READS.has(operation) || UNIQUE_OPS.has(operation)) {
      args = { ...args, where: { ...args.where, AND: [args.where ?? {}, permitted] } };
    }
  }
  if (isDoc && vb !== null) {
    if (READS.has(operation)) args = { ...args, where: args.where ? { AND: [args.where, { buId: vb }] } : { buId: vb } };
    else if (UNIQUE_OPS.has(operation) && args.where) args = { ...args, where: { ...args.where, buId: vb } };
  } else if (ITEM_PARENT[model] && vb !== null && ['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy'].includes(operation)) {
    const rel = { [ITEM_PARENT[model]]: { buId: vb } };
    args = { ...args, where: args.where ? { AND: [args.where, rel] } : rel };
  }
  const result = await query(args);
  // admin acting without a BU selection: the first document read in a write request fixes the BU (source / target doc)
  const c = buContext();
  if (isDoc && c?.isAdmin && c.write && c.selectedBu === null && c.lockedBu === undefined && result && typeof result === 'object' && !Array.isArray(result)) {
    const b = (result as { buId?: unknown }).buId;
    if (typeof b === 'number') c.lockedBu = b;
  }
  return result;
}

/** Raw SQL on BU tables: replaces `FROM|JOIN <Table>` with a BU-filtered derived table for the current viewer. */
export function scopeSql(sql: Prisma.Sql): Prisma.Sql {
  const vb = viewBu();
  if (vb === null) return sql;
  const tables = [...BU_DOCS].filter((m) => m !== 'ApprovalRequest').sort((a, b) => b.length - a.length).join('|');
  const re = new RegExp(`\\b(FROM|JOIN)\\s+(?:\\[?dbo\\]?\\.)?\\[?(${tables})\\]?(?![\\w\\]])(\\s+(?:AS\\s+)?([A-Za-z_]\\w*))?`, 'gi');
  const KEYWORDS = new Set(['WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER', 'ON', 'GROUP', 'ORDER', 'HAVING', 'UNION', 'OPTION', 'WITH']);
  const strings = sql.strings.map((s) =>
    s.replace(re, (_m, kw: string, t: string, aliasPart?: string, alias?: string) => {
      const sub = `${kw} (SELECT * FROM \`${t}\` WHERE buId = ${Number(vb)})`;
      // a derived table needs an alias: keep the query's own, else use the table name
      if (alias && !KEYWORDS.has(alias.toUpperCase())) return `${sub}${aliasPart}`;
      return `${sub} \`${t}\`${aliasPart ?? ''}`;
    }),
  );
  return Prisma.sql(strings, ...sql.values);
}

/** record opening balances (customer / supplier master) belong to the default BU: count them only when it is visible */
export async function recordOpeningVisible(): Promise<boolean> {
  const vb = viewBu();
  return vb === null || vb === (await defaultBu());
}
