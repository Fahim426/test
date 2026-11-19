import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { num, r2, r3 } from '../lib/calc';
import { badRequest } from '../lib/errors';
import { Col, ColType, col, iso, loadLookups, ReportParams, productFilterIds, warehouseFilterIds, Row, VALID_SALES, VALID_PURCHASE } from './report-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

interface FieldDef {
  key: string;
  label: string;
  type: ColType;
}
interface Ctx {
  from?: Date;
  to?: Date;
  warehouseId?: number;
  branchId?: number;
  customerId?: number;
  supplierId?: number;
  productId?: number;
  brandId?: number;
  categoryId?: number;
  hasStatusFilter: boolean;
  cap: number;
}
interface EntityDef {
  key: string;
  label: string;
  description: string;
  dateField?: string;
  supports: string[]; // top-level params honoured
  fields: FieldDef[];
  fetch(c: Ctx): Promise<Row[]>;
}

const f = (key: string, label: string, type: ColType = 'text'): FieldDef => ({ key, label, type });
const dr = (c: Ctx) => (c.from || c.to ? { ...(c.from ? { gte: c.from } : {}), ...(c.to ? { lte: c.to } : {}) } : undefined);
const asParams = (c: Ctx): ReportParams => ({ ...c, days: 180, top: 20, includeZero: false });
const month = (d: Date | null | undefined) => (iso(d) ?? '').slice(0, 7);

// ---------- entity field sets ----------
const salesHeaderFields = [
  f('docDate', 'Date', 'date'), f('month', 'Month'), f('docNo', 'Invoice No'), f('customerCode', 'Customer Code'), f('customer', 'Customer'), f('salesman', 'Salesman'),
  f('status', 'Status'), f('currency', 'Currency'), f('paymentTerms', 'Payment Terms'), f('dueDate', 'Due Date', 'date'),
];
const productFields = [f('productCode', 'Product Code'), f('product', 'Product'), f('oemNumber', 'OEM No'), f('brand', 'Brand'), f('category', 'Category')];

async function salesInvoices(c: Ctx, lines: boolean): Promise<Row[]> {
  const where: Any = {};
  if (!c.hasStatusFilter) where.status = { in: VALID_SALES };
  const d = dr(c);
  if (d) where.docDate = d;
  if (c.customerId) where.customerId = c.customerId;
  const wh = await warehouseFilterIds(asParams(c));
  if (wh) where.salesOrderId = { in: (await prisma.salesOrder.findMany({ where: { warehouseId: { in: wh } }, select: { id: true } })).map((s) => s.id) };
  const pids = await productFilterIds(asParams(c));
  if (pids) where.items = { some: { productId: { in: pids } } };
  const invs: Any[] = await prisma.salesInvoice.findMany({ where, include: lines ? { items: true } : undefined, orderBy: { docDate: 'desc' }, take: c.cap });
  const L = await loadLookups({ productIds: lines ? invs.flatMap((i) => i.items.map((x: Any) => x.productId)) : [], customerIds: invs.map((i) => i.customerId) });
  const out: Row[] = [];
  for (const i of invs) {
    const rate = num(i.exchangeRate) || 1;
    const head = {
      docDate: iso(i.docDate), month: month(i.docDate), docNo: i.docNo, customerCode: L.customers.get(i.customerId)?.code ?? '', customer: L.customers.get(i.customerId)?.name ?? '',
      salesman: i.salesmanId ? L.salesmen.get(i.salesmanId)?.name ?? '' : '', status: i.status, currency: i.currencyCode, paymentTerms: i.paymentTerms ?? '', dueDate: iso(i.dueDate),
    };
    if (!lines) {
      const total = num(i.baseTotal) || num(i.total) * rate;
      const net = (num(i.subtotal) - num(i.discount)) * rate;
      out.push({ ...head, subtotal: num(i.subtotal), discount: num(i.discount), vatAmount: num(i.vatAmount), total: num(i.total), baseTotal: total, cogs: num(i.cogs), profit: net - num(i.cogs), received: num(i.receivedAmount), balance: total - num(i.receivedAmount) });
    } else {
      for (const it of i.items) {
        if (pids && !pids.includes(it.productId)) continue;
        const p = L.products.get(it.productId);
        const net = (num(it.amount) - num(it.vatAmount)) * rate;
        const cost = num(it.qty) * num(it.unitCost);
        out.push({
          ...head, productCode: p?.code ?? '', product: p?.name ?? '', oemNumber: p?.oemNumber ?? '', brand: L.brands.get(p?.brandId ?? -1) ?? '', category: L.categories.get(p?.categoryId ?? -1) ?? '',
          qty: num(it.qty), unit: it.unit ?? '', rate: num(it.rate), discount: num(it.discount), vatRate: num(it.vatRate), vatAmount: num(it.vatAmount) * rate, net, amount: num(it.amount) * rate, unitCost: num(it.unitCost), cost, profit: net - cost,
        });
      }
    }
  }
  return out;
}

async function purchaseInvoices(c: Ctx, lines: boolean): Promise<Row[]> {
  const where: Any = {};
  if (!c.hasStatusFilter) where.status = { in: VALID_PURCHASE };
  const d = dr(c);
  if (d) where.docDate = d;
  if (c.supplierId) where.supplierId = c.supplierId;
  const pids = await productFilterIds(asParams(c));
  if (pids) where.items = { some: { productId: { in: pids } } };
  const invs: Any[] = await prisma.purchaseInvoice.findMany({ where, include: lines ? { items: true } : undefined, orderBy: { docDate: 'desc' }, take: c.cap });
  const L = await loadLookups({ productIds: lines ? invs.flatMap((i) => i.items.map((x: Any) => x.productId)) : [], supplierIds: invs.map((i) => i.supplierId) });
  const out: Row[] = [];
  for (const i of invs) {
    const rate = num(i.exchangeRate) || 1;
    const head = { docDate: iso(i.docDate), month: month(i.docDate), docNo: i.docNo, supplierInvoiceNo: i.supplierInvoiceNo ?? '', supplierCode: L.suppliers.get(i.supplierId)?.code ?? '', supplier: L.suppliers.get(i.supplierId)?.name ?? '', status: i.status, invoiceType: i.invoiceType, currency: i.currencyCode, dueDate: iso(i.dueDate) };
    if (!lines) {
      const total = num(i.baseTotal) || num(i.total) * rate;
      out.push({ ...head, subtotal: num(i.subtotal), discount: num(i.discount), vatAmount: num(i.vatAmount), total: num(i.total), baseTotal: total, paid: num(i.paidAmount), balance: total - num(i.paidAmount) });
    } else {
      for (const it of i.items) {
        if (pids && !(it.productId && pids.includes(it.productId))) continue;
        const p = it.productId ? L.products.get(it.productId) : null;
        out.push({
          ...head, productCode: p?.code ?? '', product: p?.name ?? it.description ?? '', oemNumber: p?.oemNumber ?? '', brand: L.brands.get(p?.brandId ?? -1) ?? '', category: L.categories.get(p?.categoryId ?? -1) ?? '',
          qty: num(it.qty), unit: it.unit ?? '', rate: num(it.rate), discount: num(it.discount), vatRate: num(it.vatRate), vatAmount: num(it.vatAmount) * rate, net: (num(it.amount) - num(it.vatAmount)) * rate, amount: num(it.amount) * rate,
        });
      }
    }
  }
  return out;
}

const ENTITIES: EntityDef[] = [
  {
    key: 'sales_invoices', label: 'Sales Invoices', description: 'One row per sales invoice.', dateField: 'docDate',
    supports: ['dateRange', 'customerId', 'warehouseId', 'branchId', 'productId', 'brandId', 'categoryId'],
    fields: [...salesHeaderFields, f('subtotal', 'Subtotal', 'money'), f('discount', 'Discount', 'money'), f('vatAmount', 'VAT', 'money'), f('total', 'Total (doc cur.)', 'money'), f('baseTotal', 'Total (AED)', 'money'), f('cogs', 'COGS', 'money'), f('profit', 'Gross Profit', 'money'), f('received', 'Received', 'money'), f('balance', 'Balance', 'money')],
    fetch: (c) => salesInvoices(c, false),
  },
  {
    key: 'sales_invoice_lines', label: 'Sales Invoice Lines', description: 'One row per sales invoice line with product, cost and profit.', dateField: 'docDate',
    supports: ['dateRange', 'customerId', 'warehouseId', 'branchId', 'productId', 'brandId', 'categoryId'],
    fields: [...salesHeaderFields, ...productFields, f('qty', 'Qty', 'qty'), f('unit', 'Unit'), f('rate', 'Rate', 'money'), f('discount', 'Discount', 'money'), f('vatRate', 'VAT %', 'percent'), f('vatAmount', 'VAT', 'money'), f('net', 'Net Sales (AED)', 'money'), f('amount', 'Amount incl. VAT (AED)', 'money'), f('unitCost', 'Unit Cost', 'money'), f('cost', 'Cost', 'money'), f('profit', 'Gross Profit', 'money')],
    fetch: (c) => salesInvoices(c, true),
  },
  {
    key: 'purchase_invoices', label: 'Purchase Invoices', description: 'One row per purchase invoice.', dateField: 'docDate',
    supports: ['dateRange', 'supplierId', 'productId', 'brandId', 'categoryId'],
    fields: [f('docDate', 'Date', 'date'), f('month', 'Month'), f('docNo', 'Invoice No'), f('supplierInvoiceNo', 'Supplier Inv No'), f('supplierCode', 'Supplier Code'), f('supplier', 'Supplier'), f('status', 'Status'), f('invoiceType', 'Type'), f('currency', 'Currency'), f('dueDate', 'Due Date', 'date'), f('subtotal', 'Subtotal', 'money'), f('discount', 'Discount', 'money'), f('vatAmount', 'VAT', 'money'), f('total', 'Total (doc cur.)', 'money'), f('baseTotal', 'Total (AED)', 'money'), f('paid', 'Paid', 'money'), f('balance', 'Balance', 'money')],
    fetch: (c) => purchaseInvoices(c, false),
  },
  {
    key: 'purchase_invoice_lines', label: 'Purchase Invoice Lines', description: 'One row per purchase invoice line.', dateField: 'docDate',
    supports: ['dateRange', 'supplierId', 'productId', 'brandId', 'categoryId'],
    fields: [f('docDate', 'Date', 'date'), f('month', 'Month'), f('docNo', 'Invoice No'), f('supplierInvoiceNo', 'Supplier Inv No'), f('supplierCode', 'Supplier Code'), f('supplier', 'Supplier'), f('status', 'Status'), f('invoiceType', 'Type'), f('currency', 'Currency'), ...productFields, f('qty', 'Qty', 'qty'), f('unit', 'Unit'), f('rate', 'Rate', 'money'), f('discount', 'Discount', 'money'), f('vatRate', 'VAT %', 'percent'), f('vatAmount', 'VAT', 'money'), f('net', 'Net (AED)', 'money'), f('amount', 'Amount incl. VAT (AED)', 'money')],
    fetch: (c) => purchaseInvoices(c, true),
  },
  {
    key: 'stock_ledger', label: 'Stock Ledger', description: 'Every stock transaction (receipts, deliveries, transfers, adjustments).', dateField: 'date',
    supports: ['dateRange', 'warehouseId', 'branchId', 'productId', 'brandId', 'categoryId'],
    fields: [f('date', 'Date', 'date'), f('month', 'Month'), f('type', 'Type'), f('refType', 'Ref Type'), f('refNo', 'Reference'), ...productFields, f('warehouse', 'Warehouse'), f('qty', 'Qty (signed)', 'qty'), f('qtyIn', 'Qty In', 'qty'), f('qtyOut', 'Qty Out', 'qty'), f('unitCost', 'Unit Cost', 'money'), f('value', 'Value', 'money'), f('remarks', 'Remarks')],
    async fetch(c) {
      const pr = asParams(c);
      const where: Any = {};
      const d = dr(c);
      if (d) where.txDate = d;
      const wh = await warehouseFilterIds(pr);
      if (wh) where.warehouseId = { in: wh };
      const pids = await productFilterIds(pr);
      if (pids) where.productId = { in: pids };
      const txs = await prisma.stockTransaction.findMany({ where, orderBy: [{ txDate: 'desc' }, { id: 'desc' }], take: c.cap });
      const L = await loadLookups({ productIds: txs.map((t) => t.productId) });
      return txs.map((t): Row => {
        const p = L.products.get(t.productId);
        const q = num(t.qty);
        return { date: iso(t.txDate), month: month(t.txDate), type: t.txType, refType: t.refType ?? '', refNo: t.refNo ?? '', productCode: p?.code ?? '', product: p?.name ?? '', oemNumber: p?.oemNumber ?? '', brand: L.brands.get(p?.brandId ?? -1) ?? '', category: L.categories.get(p?.categoryId ?? -1) ?? '', warehouse: L.warehouses.get(t.warehouseId)?.name ?? '', qty: q, qtyIn: q > 0 ? q : 0, qtyOut: q < 0 ? -q : 0, unitCost: num(t.unitCost), value: num(t.value), remarks: t.remarks ?? '' };
      });
    },
  },
  {
    key: 'stock_balances', label: 'Stock Balances', description: 'Current stock per product and warehouse.',
    supports: ['warehouseId', 'branchId', 'productId', 'brandId', 'categoryId'],
    fields: [...productFields, f('warehouse', 'Warehouse'), f('onHand', 'On Hand', 'qty'), f('reserved', 'Reserved', 'qty'), f('available', 'Available', 'qty'), f('avgCost', 'Avg Cost', 'money'), f('value', 'Stock Value', 'money')],
    async fetch(c) {
      const pr = asParams(c);
      const where: Any = {};
      const wh = await warehouseFilterIds(pr);
      if (wh) where.warehouseId = { in: wh };
      const pids = await productFilterIds(pr);
      if (pids) where.productId = { in: pids };
      const bals = await prisma.stockBalance.findMany({ where, take: c.cap });
      const L = await loadLookups({ productIds: bals.map((b) => b.productId) });
      return bals.map((b): Row => {
        const p = L.products.get(b.productId);
        return { productCode: p?.code ?? '', product: p?.name ?? '', oemNumber: p?.oemNumber ?? '', brand: L.brands.get(p?.brandId ?? -1) ?? '', category: L.categories.get(p?.categoryId ?? -1) ?? '', warehouse: L.warehouses.get(b.warehouseId)?.name ?? '', onHand: num(b.onHand), reserved: num(b.reserved), available: num(b.onHand) - num(b.reserved), avgCost: num(b.avgCost), value: num(b.onHand) * num(b.avgCost) };
      });
    },
  },
  {
    key: 'products', label: 'Products', description: 'Product master with total stock and stock value.',
    supports: ['productId', 'brandId', 'categoryId'],
    fields: [f('code', 'Code'), f('name', 'Name'), f('oemNumber', 'OEM No'), f('barcode', 'Barcode'), f('brand', 'Brand'), f('category', 'Category'), f('vehicleMake', 'Vehicle Make'), f('vehicleModel', 'Vehicle Model'), f('countryOfOrigin', 'Origin'), f('purchaseUnit', 'Purchase Unit'), f('salesUnit', 'Sales Unit'), f('costPrice', 'Cost Price', 'money'), f('averageCost', 'Average Cost', 'money'), f('retailPrice', 'Retail Price', 'money'), f('wholesalePrice', 'Wholesale Price', 'money'), f('minStock', 'Min Stock', 'qty'), f('reorderLevel', 'Reorder Level', 'qty'), f('maxStock', 'Max Stock', 'qty'), f('vatRate', 'VAT %', 'percent'), f('isActive', 'Active'), f('onHand', 'On Hand', 'qty'), f('stockValue', 'Stock Value', 'money')],
    async fetch(c) {
      const pids = await productFilterIds(asParams(c));
      const prods = await prisma.product.findMany({ where: pids ? { id: { in: pids } } : undefined, orderBy: { code: 'asc' }, take: c.cap });
      const [bals, L] = await Promise.all([prisma.stockBalance.findMany({ select: { productId: true, onHand: true, avgCost: true } }), loadLookups({})]);
      const agg = new Map<number, { q: number; v: number }>();
      for (const b of bals) {
        const g = agg.get(b.productId) ?? { q: 0, v: 0 };
        g.q += num(b.onHand);
        g.v += num(b.onHand) * num(b.avgCost);
        agg.set(b.productId, g);
      }
      return prods.map((p): Row => ({
        code: p.code, name: p.name, oemNumber: p.oemNumber ?? '', barcode: p.barcode ?? '', brand: L.brands.get(p.brandId ?? -1) ?? '', category: L.categories.get(p.categoryId ?? -1) ?? '', vehicleMake: p.vehicleMake ?? '', vehicleModel: p.vehicleModel ?? '', countryOfOrigin: p.countryOfOrigin ?? '', purchaseUnit: p.purchaseUnit, salesUnit: p.salesUnit,
        costPrice: num(p.costPrice), averageCost: num(p.averageCost), retailPrice: num(p.retailPrice), wholesalePrice: num(p.wholesalePrice), minStock: num(p.minStock), reorderLevel: num(p.reorderLevel), maxStock: num(p.maxStock), vatRate: num(p.vatRate), isActive: p.isActive ? 'Yes' : 'No', onHand: agg.get(p.id)?.q ?? 0, stockValue: agg.get(p.id)?.v ?? 0,
      }));
    },
  },
  {
    key: 'customers', label: 'Customers', description: 'Customer master with ledger balance.',
    supports: ['customerId'],
    fields: [f('code', 'Code'), f('name', 'Name'), f('trn', 'TRN'), f('contactPerson', 'Contact'), f('phone', 'Phone'), f('email', 'Email'), f('city', 'City'), f('country', 'Country'), f('salesman', 'Salesman'), f('currency', 'Currency'), f('creditLimit', 'Credit Limit', 'money'), f('openingBalance', 'Opening Balance', 'money'), f('balance', 'Balance', 'money'), f('isActive', 'Active')],
    async fetch(c) {
      const rows = await prisma.customer.findMany({ where: c.customerId ? { id: c.customerId } : undefined, orderBy: { code: 'asc' }, take: c.cap });
      const ar = await prisma.account.findFirst({ where: { systemKey: 'AR' }, select: { id: true } });
      const g = ar ? await prisma.journalLine.groupBy({ by: ['partyId'], where: { accountId: ar.id, partyType: 'CUSTOMER' }, _sum: { debit: true, credit: true } }) : [];
      const bal = new Map(g.map((x) => [x.partyId, num(x._sum.debit) - num(x._sum.credit)]));
      const L = await loadLookups({});
      return rows.map((r): Row => ({ code: r.code, name: r.name, trn: r.trn ?? '', contactPerson: r.contactPerson ?? '', phone: r.phone ?? r.mobile ?? '', email: r.email ?? '', city: r.city ?? '', country: r.country ?? '', salesman: r.salesmanId ? L.salesmen.get(r.salesmanId)?.name ?? '' : '', currency: r.currencyCode, creditLimit: num(r.creditLimit), openingBalance: num(r.openingBalance), balance: num(r.openingBalance) + (bal.get(r.id) ?? 0), isActive: r.isActive ? 'Yes' : 'No' }));
    },
  },
  {
    key: 'suppliers', label: 'Suppliers', description: 'Supplier master with payable balance.',
    supports: ['supplierId'],
    fields: [f('code', 'Code'), f('name', 'Name'), f('country', 'Country'), f('trn', 'TRN'), f('contactPerson', 'Contact'), f('phone', 'Phone'), f('email', 'Email'), f('currency', 'Currency'), f('creditLimit', 'Credit Limit', 'money'), f('openingBalance', 'Opening Balance', 'money'), f('balance', 'Balance Payable', 'money'), f('isActive', 'Active')],
    async fetch(c) {
      const rows = await prisma.supplier.findMany({ where: c.supplierId ? { id: c.supplierId } : undefined, orderBy: { code: 'asc' }, take: c.cap });
      const ap = await prisma.account.findFirst({ where: { systemKey: 'AP' }, select: { id: true } });
      const g = ap ? await prisma.journalLine.groupBy({ by: ['partyId'], where: { accountId: ap.id, partyType: 'SUPPLIER' }, _sum: { debit: true, credit: true } }) : [];
      const bal = new Map(g.map((x) => [x.partyId, num(x._sum.credit) - num(x._sum.debit)]));
      return rows.map((r): Row => ({ code: r.code, name: r.name, country: r.country ?? '', trn: r.trn ?? '', contactPerson: r.contactPerson ?? '', phone: r.phone ?? '', email: r.email ?? '', currency: r.currencyCode, creditLimit: num(r.creditLimit), openingBalance: num(r.openingBalance), balance: num(r.openingBalance) + (bal.get(r.id) ?? 0), isActive: r.isActive ? 'Yes' : 'No' }));
    },
  },
  {
    key: 'journal_lines', label: 'Journal Lines', description: 'General ledger lines (posted journals).', dateField: 'date',
    supports: ['dateRange', 'customerId', 'supplierId'],
    fields: [f('date', 'Date', 'date'), f('month', 'Month'), f('entryNo', 'Entry No'), f('entryType', 'Entry Type'), f('sourceType', 'Source Type'), f('sourceNo', 'Source No'), f('narration', 'Narration'), f('accountCode', 'Account Code'), f('accountName', 'Account'), f('accountType', 'Account Type'), f('debit', 'Debit', 'money'), f('credit', 'Credit', 'money'), f('net', 'Net (Dr-Cr)', 'money'), f('partyType', 'Party Type'), f('party', 'Party'), f('description', 'Description')],
    async fetch(c) {
      const where: Any = {};
      const d = dr(c);
      if (d) where.journal = { entryDate: d };
      if (c.customerId) Object.assign(where, { partyType: 'CUSTOMER', partyId: c.customerId });
      if (c.supplierId) Object.assign(where, { partyType: 'SUPPLIER', partyId: c.supplierId });
      const lines: Any[] = await prisma.journalLine.findMany({ where, include: { journal: true, account: true }, orderBy: { id: 'desc' }, take: c.cap });
      const L = await loadLookups({ customerIds: lines.filter((l) => l.partyType === 'CUSTOMER').map((l) => l.partyId), supplierIds: lines.filter((l) => l.partyType === 'SUPPLIER').map((l) => l.partyId) });
      return lines.map((l): Row => ({
        date: iso(l.journal.entryDate), month: month(l.journal.entryDate), entryNo: l.journal.entryNo, entryType: l.journal.entryType, sourceType: l.journal.sourceType ?? '', sourceNo: l.journal.sourceNo ?? '', narration: l.journal.narration ?? '', accountCode: l.account.code, accountName: l.account.name, accountType: l.account.type,
        debit: num(l.debit), credit: num(l.credit), net: num(l.debit) - num(l.credit), partyType: l.partyType ?? '', party: l.partyType === 'CUSTOMER' ? L.customers.get(l.partyId)?.name ?? '' : l.partyType === 'SUPPLIER' ? L.suppliers.get(l.partyId)?.name ?? '' : '', description: l.description ?? '',
      }));
    },
  },
];
const byKey = new Map(ENTITIES.map((e) => [e.key, e]));

export function describeEntities() {
  return {
    entities: ENTITIES.map((e) => ({
      key: e.key,
      label: e.label,
      description: e.description,
      dateField: e.dateField ?? null,
      supports: e.supports,
      fields: e.fields.map((x) => ({ ...x, filterable: true, groupable: x.type === 'text' || x.type === 'date', aggregatable: ['number', 'money', 'qty', 'percent'].includes(x.type) })),
    })),
    operators: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'between', 'in'],
    aggregates: ['sum', 'count', 'avg', 'min', 'max'],
  };
}

// ---------- request schema ----------
const filterSchema = z.object({ field: z.string().max(80), op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'between', 'in']), value: z.any() });
const optId = z.coerce.number().int().positive().optional().nullable();
export const builderSchema = z.object({
  entity: z.string().max(60),
  columns: z.array(z.string().max(80)).max(60).default([]),
  filters: z.array(filterSchema).max(30).default([]),
  groupBy: z.array(z.string().max(80)).max(5).default([]),
  aggregates: z.array(z.object({ field: z.string().max(80).optional(), fn: z.enum(['sum', 'count', 'avg', 'min', 'max']) })).max(20).default([]),
  sort: z.array(z.object({ field: z.string().max(100), dir: z.enum(['asc', 'desc']).default('asc') })).max(5).default([]),
  dateRange: z.object({ field: z.string().max(80).optional(), from: z.string().optional().nullable(), to: z.string().optional().nullable() }).optional(),
  warehouseId: optId,
  branchId: optId,
  customerId: optId,
  supplierId: optId,
  productId: optId,
  brandId: optId,
  categoryId: optId,
  limit: z.coerce.number().int().min(1).max(20000).default(1000),
  title: z.string().max(200).optional(),
});
export type BuilderReq = z.infer<typeof builderSchema>;

const dateOnly = (s: string, end: boolean) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) throw badRequest(`Invalid date '${s}'`);
  return end ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999) : new Date(+m[1], +m[2] - 1, +m[3]);
};

function cmpVal(a: unknown, t: ColType): string | number {
  if (['number', 'money', 'qty', 'percent'].includes(t)) return Number(a);
  return String(a ?? '').toLowerCase();
}
function matches(row: Row, fd: FieldDef, op: string, value: unknown): boolean {
  const raw = row[fd.key];
  const t = fd.type;
  const v = cmpVal(raw, t);
  const one = (x: unknown) => cmpVal(x, t);
  switch (op) {
    case 'eq': return v === one(value);
    case 'ne': return v !== one(value);
    case 'gt': return v > one(value);
    case 'gte': return v >= one(value);
    case 'lt': return v < one(value);
    case 'lte': return v <= one(value);
    case 'contains': return String(raw ?? '').toLowerCase().includes(String(value ?? '').toLowerCase());
    case 'between': {
      const arr = Array.isArray(value) ? value : [];
      if (arr.length < 2) throw badRequest("'between' needs [from, to]");
      return v >= one(arr[0]) && v <= one(arr[1]);
    }
    case 'in': {
      const arr = Array.isArray(value) ? value : String(value ?? '').split(',');
      return arr.map(one).includes(v);
    }
  }
  return true;
}

export async function runBuilder(req: BuilderReq) {
  const ent = byKey.get(req.entity);
  if (!ent) throw badRequest(`Unknown entity '${req.entity}'`, { entities: ENTITIES.map((e) => e.key) });
  const fields = new Map(ent.fields.map((x) => [x.key, x]));
  const need = (k: string, what: string): FieldDef => {
    const fd = fields.get(k);
    if (!fd) throw badRequest(`Unknown ${what} field '${k}' for entity ${ent.key}`, { fields: [...fields.keys()] });
    return fd;
  };
  req.columns.forEach((k) => need(k, 'column'));
  req.filters.forEach((x) => need(x.field, 'filter'));
  req.groupBy.forEach((k) => need(k, 'groupBy'));
  const isNum = (fd: FieldDef) => ['number', 'money', 'qty', 'percent'].includes(fd.type);
  const aggs = req.aggregates.map((a) => {
    if (a.fn === 'count' && !a.field) return { fn: 'count' as const, field: null as FieldDef | null, alias: 'count', label: 'Count' };
    if (!a.field) throw badRequest(`Aggregate ${a.fn} needs a field`);
    const fd = need(a.field, 'aggregate');
    if (a.fn !== 'count' && !isNum(fd) && a.fn !== 'min' && a.fn !== 'max') throw badRequest(`Cannot ${a.fn} non-numeric field '${a.field}'`);
    return { fn: a.fn, field: fd, alias: `${a.fn}_${fd.key}`, label: `${a.fn[0].toUpperCase()}${a.fn.slice(1)} of ${fd.label}` };
  });
  if (req.groupBy.length && !aggs.length) aggs.push({ fn: 'count', field: null, alias: 'count', label: 'Count' });

  // date range
  const rangeField = req.dateRange?.field ?? ent.dateField;
  if (req.dateRange?.field) {
    const df = need(req.dateRange.field, 'dateRange');
    if (df.type !== 'date') throw badRequest(`dateRange.field must be a date field`);
  }
  const from = req.dateRange?.from ? dateOnly(req.dateRange.from, false) : undefined;
  const to = req.dateRange?.to ? dateOnly(req.dateRange.to, true) : undefined;
  const pushDown = rangeField === ent.dateField;
  const ctx: Ctx = {
    from: pushDown ? from : undefined,
    to: pushDown ? to : undefined,
    warehouseId: req.warehouseId ?? undefined,
    branchId: req.branchId ?? undefined,
    customerId: req.customerId ?? undefined,
    supplierId: req.supplierId ?? undefined,
    productId: req.productId ?? undefined,
    brandId: req.brandId ?? undefined,
    categoryId: req.categoryId ?? undefined,
    hasStatusFilter: req.filters.some((x) => x.field === 'status'),
    cap: 50000,
  };
  let rows = await ent.fetch(ctx);
  if (!pushDown && rangeField && (from || to)) {
    rows = rows.filter((r) => {
      const v = String(r[rangeField] ?? '').slice(0, 10);
      return (!from || v >= (req.dateRange!.from as string).slice(0, 10)) && (!to || v <= (req.dateRange!.to as string).slice(0, 10));
    });
  }
  for (const flt of req.filters) {
    const fd = fields.get(flt.field)!;
    rows = rows.filter((r) => matches(r, fd, flt.op, flt.value));
  }

  let columns: Col[];
  let out: Row[];
  let totals: Row = {};
  if (req.groupBy.length || aggs.length) {
    const gfs = req.groupBy.map((k) => fields.get(k)!);
    const groups = new Map<string, { key: Row; rows: Row[] }>();
    for (const r of rows) {
      const kv: Row = {};
      gfs.forEach((g) => (kv[g.key] = r[g.key] ?? ''));
      const k = JSON.stringify(gfs.map((g) => kv[g.key]));
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { key: kv, rows: [] }));
      g.rows.push(r);
    }
    out = [...groups.values()].map(({ key, rows: rs }) => {
      const o: Row = { ...key };
      for (const a of aggs) {
        if (a.fn === 'count') o[a.alias] = a.field ? rs.filter((r) => r[a.field!.key] !== '' && r[a.field!.key] != null).length : rs.length;
        else {
          const vals = rs.map((r) => r[a.field!.key]).filter((v) => v !== null && v !== undefined && v !== '');
          if (a.fn === 'sum') o[a.alias] = vals.reduce((s: number, v) => s + num(v), 0);
          else if (a.fn === 'avg') o[a.alias] = vals.length ? vals.reduce((s: number, v) => s + num(v), 0) / vals.length : 0;
          else {
            const nv = vals.map((v) => (isNum(a.field!) ? num(v) : String(v)));
            o[a.alias] = nv.length ? nv.reduce((m, v) => (a.fn === 'min' ? (v < m ? v : m) : v > m ? v : m)) : null;
          }
        }
      }
      return o;
    });
    columns = [...gfs.map((g) => col(g.key, g.label, g.type)), ...aggs.map((a) => col(a.alias, a.label, a.fn === 'count' ? 'number' : a.field!.type === 'percent' ? 'number' : a.field!.type, a.fn === 'sum' || a.fn === 'count'))];
  } else {
    const cols = req.columns.length ? req.columns : ent.fields.map((x) => x.key);
    columns = cols.map((k) => {
      const fd = fields.get(k)!;
      return col(fd.key, fd.label, fd.type, isNum(fd) && fd.type !== 'percent');
    });
    out = rows.map((r) => Object.fromEntries(cols.map((k) => [k, r[k]])));
    // keep sort fields available even if not selected
    out.forEach((o, i) => req.sort.forEach((s) => { if (!(s.field in o) && fields.has(s.field)) Object.defineProperty(o, s.field, { value: rows[i][s.field], enumerable: false }); }));
  }

  // sort
  const sortKeys = req.sort.filter((s) => out.length && (s.field in out[0] || fields.has(s.field)));
  if (sortKeys.length) {
    out.sort((a, b) => {
      for (const s of sortKeys) {
        const x = a[s.field] as Any;
        const y = b[s.field] as Any;
        if (x === y) continue;
        const r = x == null ? -1 : y == null ? 1 : typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
        if (r !== 0) return s.dir === 'desc' ? -r : r;
      }
      return 0;
    });
  }
  const total = out.length;
  out = out.slice(0, req.limit);
  for (const r of out) for (const c of columns) if (typeof r[c.key] === 'number') r[c.key] = c.type === 'qty' ? r3(r[c.key] as number) : r2(r[c.key] as number);
  for (const c of columns) if (c.sum) totals[c.key] = (c.type === 'qty' ? r3 : r2)(out.reduce((a, r) => a + num(r[c.key]), 0));
  return {
    title: req.title || ent.label,
    entity: ent.key,
    columns,
    rows: out,
    totals,
    total,
    truncated: total > out.length,
    params: { entity: ent.key, dateRange: req.dateRange, filters: req.filters.length ? req.filters.length + ' filter(s)' : undefined, groupBy: req.groupBy.length ? req.groupBy.join(', ') : undefined },
    generatedAt: new Date().toISOString(),
  };
}
