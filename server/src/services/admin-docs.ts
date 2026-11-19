import { prisma } from '../lib/prisma';
import { num } from '../lib/calc';

/**
 * Registry of document types for cross-module features (global search, recent documents, document flow).
 * `route` is a client route hint: `${route}/${id}`.
 */
export interface DocDef {
  type: string;
  label: string;
  model: string; // prisma delegate
  noField: string;
  dateField: string;
  amountField?: string;
  customerField?: string;
  supplierField?: string;
  route: string;
  where?: Record<string, unknown>; // restricts a shared table (vouchers)
}

export const DOCS: DocDef[] = [
  { type: 'SALES_ENQUIRY', label: 'Sales Enquiry', model: 'salesEnquiry', noField: 'docNo', dateField: 'docDate', customerField: 'customerId', route: '/sales/enquiries' },
  { type: 'SALES_QUOTATION', label: 'Sales Quotation', model: 'salesQuotation', noField: 'docNo', dateField: 'docDate', amountField: 'total', customerField: 'customerId', route: '/sales/quotations' },
  { type: 'PROFORMA_INVOICE', label: 'Proforma Invoice', model: 'proformaInvoice', noField: 'docNo', dateField: 'docDate', amountField: 'total', customerField: 'customerId', route: '/sales/proforma' },
  { type: 'SALES_ORDER', label: 'Sales Order', model: 'salesOrder', noField: 'docNo', dateField: 'docDate', amountField: 'total', customerField: 'customerId', route: '/sales/orders' },
  { type: 'PICKING_LIST', label: 'Picking List', model: 'pickingList', noField: 'docNo', dateField: 'docDate', route: '/sales/picking' },
  { type: 'PACKING_LIST', label: 'Packing List', model: 'packingList', noField: 'docNo', dateField: 'docDate', customerField: 'customerId', route: '/sales/packing' },
  { type: 'DELIVERY_NOTE', label: 'Delivery Note', model: 'deliveryNote', noField: 'docNo', dateField: 'docDate', customerField: 'customerId', route: '/sales/delivery-notes' },
  { type: 'SALES_INVOICE', label: 'Sales Invoice', model: 'salesInvoice', noField: 'docNo', dateField: 'docDate', amountField: 'total', customerField: 'customerId', route: '/sales/invoices' },
  { type: 'SALES_RETURN', label: 'Sales Return', model: 'salesReturn', noField: 'docNo', dateField: 'docDate', amountField: 'total', customerField: 'customerId', route: '/sales/returns' },
  { type: 'MATERIAL_REQUEST', label: 'Material Request', model: 'materialRequest', noField: 'docNo', dateField: 'docDate', route: '/purchase/material-requests' },
  { type: 'PURCHASE_REQUISITION', label: 'Purchase Requisition', model: 'purchaseRequisition', noField: 'docNo', dateField: 'docDate', route: '/purchase/requisitions' },
  { type: 'PURCHASE_ENQUIRY', label: 'Purchase Enquiry', model: 'purchaseEnquiry', noField: 'docNo', dateField: 'docDate', route: '/purchase/enquiries' },
  { type: 'SUPPLIER_QUOTATION', label: 'Supplier Quotation', model: 'supplierQuotation', noField: 'docNo', dateField: 'docDate', amountField: 'total', supplierField: 'supplierId', route: '/purchase/quotations' },
  { type: 'PURCHASE_ORDER', label: 'Purchase Order', model: 'purchaseOrder', noField: 'docNo', dateField: 'docDate', amountField: 'total', supplierField: 'supplierId', route: '/purchase/orders' },
  { type: 'IMPORT_REQUEST', label: 'Import Request', model: 'importRequest', noField: 'docNo', dateField: 'docDate', supplierField: 'supplierId', route: '/import/requests' },
  { type: 'SUPPLIER_PROFORMA', label: 'Supplier Proforma', model: 'supplierProforma', noField: 'docNo', dateField: 'docDate', amountField: 'total', supplierField: 'supplierId', route: '/import/proformas' },
  { type: 'IMPORT_SHIPMENT', label: 'Import Shipment', model: 'importShipment', noField: 'shipmentNo', dateField: 'createdAt', route: '/import/shipments' },
  { type: 'GOODS_RECEIPT', label: 'Goods Receipt', model: 'goodsReceipt', noField: 'docNo', dateField: 'docDate', supplierField: 'supplierId', route: '/purchase/receipts' },
  { type: 'LANDED_COST', label: 'Landed Cost', model: 'landedCost', noField: 'docNo', dateField: 'docDate', amountField: 'totalAdditional', route: '/purchase/landed-costs' },
  { type: 'PURCHASE_INVOICE', label: 'Purchase Invoice', model: 'purchaseInvoice', noField: 'docNo', dateField: 'docDate', amountField: 'total', supplierField: 'supplierId', route: '/purchase/invoices' },
  { type: 'PURCHASE_RETURN', label: 'Purchase Return', model: 'purchaseReturn', noField: 'docNo', dateField: 'docDate', amountField: 'total', supplierField: 'supplierId', route: '/purchase/returns' },
  { type: 'STOCK_TRANSFER', label: 'Stock Transfer', model: 'stockTransfer', noField: 'transferNo', dateField: 'txDate', route: '/inventory/transfers' },
  { type: 'STOCK_ADJUSTMENT', label: 'Stock Adjustment', model: 'stockAdjustment', noField: 'adjNo', dateField: 'txDate', route: '/inventory/adjustments' },
  { type: 'RECEIPT_VOUCHER', label: 'Receipt Voucher', model: 'voucher', noField: 'voucherNo', dateField: 'voucherDate', amountField: 'amount', route: '/finance/receipts', where: { voucherType: 'RECEIPT' } },
  { type: 'PAYMENT_VOUCHER', label: 'Payment Voucher', model: 'voucher', noField: 'voucherNo', dateField: 'voucherDate', amountField: 'amount', route: '/finance/payments', where: { voucherType: 'PAYMENT' } },
];

export const DOC_BY_TYPE = new Map(DOCS.map((d) => [d.type, d]));

const ALIASES: Record<string, string> = {
  RECEIPT: 'RECEIPT_VOUCHER',
  PAYMENT: 'PAYMENT_VOUCHER',
  GRN: 'GOODS_RECEIPT',
  SQ: 'SALES_QUOTATION',
  SO: 'SALES_ORDER',
  PO: 'PURCHASE_ORDER',
  SI: 'SALES_INVOICE',
  PI: 'PURCHASE_INVOICE',
  DN: 'DELIVERY_NOTE',
  PICKING: 'PICKING_LIST',
  PACKING: 'PACKING_LIST',
  DELIVERY: 'DELIVERY_NOTE',
  IMPORT_PURCHASE_ORDER: 'PURCHASE_ORDER',
};
export function normalizeType(t: string): string {
  const u = t.trim().toUpperCase().replace(/[-\s]/g, '_');
  return ALIASES[u] ?? u;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const delegate = (d: DocDef): any => (prisma as any)[d.model];

export interface DocSummary {
  type: string;
  typeLabel: string;
  id: number;
  no: string;
  date: Date | null;
  createdAt: Date | null;
  party: string | null;
  partyId: number | null;
  partyType: 'CUSTOMER' | 'SUPPLIER' | 'OTHER' | null;
  amount: number | null;
  status: string | null;
  route: string;
}

export async function partyNames(customerIds: number[], supplierIds: number[]) {
  const [c, s] = await Promise.all([
    customerIds.length ? prisma.customer.findMany({ where: { id: { in: [...new Set(customerIds)] } }, select: { id: true, name: true } }) : [],
    supplierIds.length ? prisma.supplier.findMany({ where: { id: { in: [...new Set(supplierIds)] } }, select: { id: true, name: true } }) : [],
  ]);
  return { customers: new Map(c.map((x) => [x.id, x.name])), suppliers: new Map(s.map((x) => [x.id, x.name])) };
}

/** Converts raw rows of a doc type to DocSummary (batch resolves party names). */
export async function summarize(def: DocDef, rows: Record<string, unknown>[]): Promise<DocSummary[]> {
  const isVoucher = def.model === 'voucher';
  const cIds: number[] = [];
  const sIds: number[] = [];
  for (const r of rows) {
    if (def.customerField && typeof r[def.customerField] === 'number') cIds.push(r[def.customerField] as number);
    if (def.supplierField && typeof r[def.supplierField] === 'number') sIds.push(r[def.supplierField] as number);
    if (isVoucher && typeof r.partyId === 'number') (r.partyType === 'CUSTOMER' ? cIds : r.partyType === 'SUPPLIER' ? sIds : []).push(r.partyId);
  }
  const names = await partyNames(cIds, sIds);
  return rows.map((r) => {
    let party: string | null = null;
    let partyId: number | null = null;
    let partyType: DocSummary['partyType'] = null;
    if (def.customerField && r[def.customerField]) {
      partyId = r[def.customerField] as number;
      partyType = 'CUSTOMER';
      party = names.customers.get(partyId) ?? null;
    } else if (def.supplierField && r[def.supplierField]) {
      partyId = r[def.supplierField] as number;
      partyType = 'SUPPLIER';
      party = names.suppliers.get(partyId) ?? null;
    } else if (isVoucher && r.partyId) {
      partyId = r.partyId as number;
      partyType = (r.partyType as DocSummary['partyType']) ?? 'OTHER';
      party = partyType === 'CUSTOMER' ? names.customers.get(partyId) ?? null : partyType === 'SUPPLIER' ? names.suppliers.get(partyId) ?? null : null;
    }
    return {
      type: def.type,
      typeLabel: def.label,
      id: r.id as number,
      no: String(r[def.noField]),
      date: (r[def.dateField] as Date) ?? null,
      createdAt: (r.createdAt as Date) ?? null,
      party,
      partyId,
      partyType,
      amount: def.amountField ? num(r[def.amountField]) : null,
      status: (r.status as string) ?? null,
      route: `${def.route}/${r.id}`,
    };
  });
}

export async function findDocs(def: DocDef, opts: { search?: string; take: number; orderBy?: string }) {
  const where: Record<string, unknown> = { ...(def.where ?? {}) };
  if (opts.search) where[def.noField] = { contains: opts.search };
  const rows = await delegate(def).findMany({ where, orderBy: { [opts.orderBy ?? 'id']: 'desc' }, take: opts.take });
  return summarize(def, rows);
}

export async function getDoc(type: string, id: number): Promise<DocSummary | null> {
  const def = DOC_BY_TYPE.get(type);
  if (!def) return null;
  const row = await delegate(def).findUnique({ where: { id } });
  if (!row) return null;
  if (def.where && Object.entries(def.where).some(([k, v]) => row[k] !== v)) return null;
  return (await summarize(def, [row]))[0];
}

const PERM_OVERRIDES: Record<string, string> = {
  RECEIPT_VOUCHER: 'receipts',
  PAYMENT_VOUCHER: 'payments',
  PICKING_LIST: 'picking',
  PACKING_LIST: 'packing',
  IMPORT_REQUEST: 'import_purchase',
  SUPPLIER_PROFORMA: 'import_purchase',
  IMPORT_SHIPMENT: 'import_purchase',
};
/** Permission module that guards viewing a document type. */
export const permOf = (type: string) => PERM_OVERRIDES[type] ?? type.toLowerCase();

export const hasView = (u: { role: string; permissions: Set<string> } | undefined, module: string) =>
  !!u && (u.role === 'Admin' || u.permissions.has(`${module}:view`));
