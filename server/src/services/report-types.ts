import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { num, r2, r3 } from '../lib/calc';

export type ColType = 'text' | 'number' | 'money' | 'qty' | 'percent' | 'date';
export interface Col {
  key: string;
  label: string;
  type: ColType;
  align: 'left' | 'right' | 'center';
  sum?: boolean; // included in auto totals
}
export const col = (key: string, label: string, type: ColType = 'text', sum = false): Col => ({
  key,
  label,
  type,
  align: type === 'text' ? 'left' : type === 'date' ? 'center' : 'right',
  sum,
});

export type Row = Record<string, unknown>;

export interface ReportParamDef {
  key: string;
  label: string;
  type: 'date' | 'number' | 'select' | 'text';
  entity?: string; // lookup entity for select (warehouse, customer, supplier, product, brand, category, salesman, branch)
  options?: { value: string; label: string }[];
  required?: boolean;
  default?: string | number;
}

export interface ReportParams {
  from?: Date;
  to?: Date;
  warehouseId?: number;
  customerId?: number;
  supplierId?: number;
  productId?: number;
  brandId?: number;
  categoryId?: number;
  salesmanId?: number;
  branchId?: number;
  groupBy?: string;
  status?: string;
  days: number;
  top: number;
  includeZero: boolean;
  page?: number;
  pageSize?: number;
}

export interface RunOutput {
  rows: Row[];
  totals?: Row;
  columns?: Col[]; // override (e.g. groupBy variants)
  title?: string;
}

export interface ReportDef {
  key: string;
  title: string;
  group: 'Sales' | 'Purchase' | 'Inventory' | 'Finance';
  description: string;
  params: ReportParamDef[];
  columns: Col[];
  run?: (p: ReportParams) => Promise<RunOutput>;
  source?: 'finance';
  endpoint?: string; // finance reports: API endpoint
  route?: string; // finance reports: UI route
}

export interface ReportResult {
  key: string;
  title: string;
  columns: Col[];
  rows: Row[];
  totals: Row;
  params: Record<string, unknown>;
  total: number;
  page?: number;
  pageSize?: number;
  generatedAt: string;
}

// ---------- param descriptors ----------
export const P = {
  from: { key: 'from', label: 'From date', type: 'date' } as ReportParamDef,
  to: { key: 'to', label: 'To date', type: 'date' } as ReportParamDef,
  warehouse: { key: 'warehouseId', label: 'Warehouse', type: 'select', entity: 'warehouse' } as ReportParamDef,
  branch: { key: 'branchId', label: 'Branch', type: 'select', entity: 'branch' } as ReportParamDef,
  customer: { key: 'customerId', label: 'Customer', type: 'select', entity: 'customer' } as ReportParamDef,
  supplier: { key: 'supplierId', label: 'Supplier', type: 'select', entity: 'supplier' } as ReportParamDef,
  product: { key: 'productId', label: 'Product', type: 'select', entity: 'product' } as ReportParamDef,
  brand: { key: 'brandId', label: 'Brand', type: 'select', entity: 'brand' } as ReportParamDef,
  category: { key: 'categoryId', label: 'Category', type: 'select', entity: 'category' } as ReportParamDef,
  salesman: { key: 'salesmanId', label: 'Salesman', type: 'select', entity: 'salesman' } as ReportParamDef,
  groupBy: (options: string[], def?: string): ReportParamDef => ({
    key: 'groupBy',
    label: 'Group by',
    type: 'select',
    options: options.map((o) => ({ value: o, label: o })),
    default: def,
  }),
  days: { key: 'days', label: 'Days without movement', type: 'number', default: 180 } as ReportParamDef,
  top: { key: 'top', label: 'Top N', type: 'number', default: 20 } as ReportParamDef,
  includeZero: { key: 'includeZero', label: 'Include zero stock', type: 'select', options: [{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes' }], default: 'false' } as ReportParamDef,
};

// ---------- query param parsing ----------
const emptyToUndef = (v: unknown) => (v === '' || v === null || v === undefined || v === 'undefined' || v === 'null' ? undefined : v);
const optInt = z.preprocess(emptyToUndef, z.coerce.number().int().positive().optional());
const optDate = z.preprocess(
  emptyToUndef,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}([T ].*)?$/, 'Expected YYYY-MM-DD')
    .optional(),
);

export const paramsSchema = z.object({
  from: optDate,
  to: optDate,
  warehouseId: optInt,
  customerId: optInt,
  supplierId: optInt,
  productId: optInt,
  brandId: optInt,
  categoryId: optInt,
  salesmanId: optInt,
  branchId: optInt,
  groupBy: z.preprocess(emptyToUndef, z.string().max(40).optional()),
  status: z.preprocess(emptyToUndef, z.string().max(40).optional()),
  days: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(3650).default(180)),
  top: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(1000).default(20)),
  includeZero: z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()),
  page: optInt,
  pageSize: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(5000).optional()),
});

export function startOfDay(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return new Date(s);
}
export function endOfDay(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  const d = new Date(s);
  return d;
}

export function toParams(q: Record<string, unknown>): ReportParams {
  const r = paramsSchema.parse(q);
  return {
    ...r,
    from: r.from ? startOfDay(r.from) : undefined,
    to: r.to ? endOfDay(r.to) : undefined,
  } as ReportParams;
}

export const dateRange = (p: { from?: Date; to?: Date }) =>
  p.from || p.to ? { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } : undefined;

export const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  if (isNaN(x.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

export const VALID_SALES = ['POSTED', 'PARTIALLY_PAID', 'PAID'];
export const VALID_PURCHASE = ['POSTED', 'PARTIALLY_PAID', 'PAID'];

// ---------- shared lookups ----------
export interface ProductInfo {
  id: number;
  code: string;
  name: string;
  oemNumber: string | null;
  brandId: number | null;
  categoryId: number | null;
  averageCost: number;
  reorderLevel: number;
  minStock: number;
  maxStock: number;
  isActive: boolean;
}
export interface Lookups {
  products: Map<number, ProductInfo>;
  brands: Map<number, string>;
  categories: Map<number, string>;
  customers: Map<number, { code: string; name: string }>;
  suppliers: Map<number, { code: string; name: string }>;
  salesmen: Map<number, { code: string; name: string; commissionPct: number }>;
  warehouses: Map<number, { code: string; name: string }>;
}

const chunk = <T>(a: T[], n = 1000): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};
const uniq = (a: (number | null | undefined)[]) => [...new Set(a.filter((x): x is number => typeof x === 'number'))];

export async function loadLookups(ids: {
  productIds?: (number | null | undefined)[];
  customerIds?: (number | null | undefined)[];
  supplierIds?: (number | null | undefined)[];
  salesmanIds?: (number | null | undefined)[];
  warehouseIds?: (number | null | undefined)[];
  allProducts?: boolean;
}): Promise<Lookups> {
  const L: Lookups = {
    products: new Map(),
    brands: new Map(),
    categories: new Map(),
    customers: new Map(),
    suppliers: new Map(),
    salesmen: new Map(),
    warehouses: new Map(),
  };
  const pids = uniq(ids.productIds || []);
  const prodSel = { id: true, code: true, name: true, oemNumber: true, brandId: true, categoryId: true, averageCost: true, reorderLevel: true, minStock: true, maxStock: true, isActive: true } as const;
  const prodRows = ids.allProducts
    ? await prisma.product.findMany({ select: prodSel })
    : (await Promise.all(chunk(pids).map((c) => prisma.product.findMany({ where: { id: { in: c } }, select: prodSel })))).flat();
  for (const p of prodRows)
    L.products.set(p.id, { ...p, averageCost: num(p.averageCost), reorderLevel: num(p.reorderLevel), minStock: num(p.minStock), maxStock: num(p.maxStock) });
  const [brands, cats, custs, supps, sms, whs] = await Promise.all([
    prisma.brand.findMany({ select: { id: true, name: true } }),
    prisma.category.findMany({ select: { id: true, name: true } }),
    ids.customerIds ? Promise.all(chunk(uniq(ids.customerIds)).map((c) => prisma.customer.findMany({ where: { id: { in: c } }, select: { id: true, code: true, name: true } }))).then((x) => x.flat()) : [],
    ids.supplierIds ? Promise.all(chunk(uniq(ids.supplierIds)).map((c) => prisma.supplier.findMany({ where: { id: { in: c } }, select: { id: true, code: true, name: true } }))).then((x) => x.flat()) : [],
    prisma.salesman.findMany({ select: { id: true, code: true, name: true, commissionPct: true } }),
    prisma.warehouse.findMany({ select: { id: true, code: true, name: true } }),
  ]);
  brands.forEach((b) => L.brands.set(b.id, b.name));
  cats.forEach((c) => L.categories.set(c.id, c.name));
  custs.forEach((c) => L.customers.set(c.id, { code: c.code, name: c.name }));
  supps.forEach((c) => L.suppliers.set(c.id, { code: c.code, name: c.name }));
  sms.forEach((s) => L.salesmen.set(s.id, { code: s.code, name: s.name, commissionPct: num(s.commissionPct) }));
  whs.forEach((w) => L.warehouses.set(w.id, { code: w.code, name: w.name }));
  return L;
}

/** Product ids matching brand/category/product filters (null = no product-level filter). */
export async function productFilterIds(p: ReportParams): Promise<number[] | null> {
  if (p.productId && !p.brandId && !p.categoryId) return [p.productId];
  if (!p.brandId && !p.categoryId && !p.productId) return null;
  const rows = await prisma.product.findMany({
    where: { ...(p.brandId ? { brandId: p.brandId } : {}), ...(p.categoryId ? { categoryId: p.categoryId } : {}), ...(p.productId ? { id: p.productId } : {}) },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Warehouse ids implied by warehouseId / branchId (null = no filter). */
export async function warehouseFilterIds(p: ReportParams): Promise<number[] | null> {
  if (p.warehouseId) return [p.warehouseId];
  if (p.branchId) {
    const rows = await prisma.warehouse.findMany({ where: { branchId: p.branchId }, select: { id: true } });
    return rows.map((r) => r.id);
  }
  return null;
}

export const pName = (L: Lookups, id: number | null | undefined) => (id ? L.products.get(id)?.name ?? `#${id}` : '(non-stock)');
export const pCode = (L: Lookups, id: number | null | undefined) => (id ? L.products.get(id)?.code ?? '' : '');
export const brandName = (L: Lookups, pid: number | null | undefined) => {
  const b = pid ? L.products.get(pid)?.brandId : null;
  return b ? L.brands.get(b) ?? '' : '(no brand)';
};
export const catName = (L: Lookups, pid: number | null | undefined) => {
  const c = pid ? L.products.get(pid)?.categoryId : null;
  return c ? L.categories.get(c) ?? '' : '(no category)';
};

// ---------- aggregation helpers ----------
export function sumCols(rows: Row[], cols: Col[]): Row {
  const t: Row = {};
  for (const c of cols) {
    if (!c.sum) continue;
    const s = rows.reduce((a, r) => a + num(r[c.key]), 0);
    t[c.key] = c.type === 'qty' ? r3(s) : r2(s);
  }
  return t;
}

export function addTo(obj: Row, key: string, v: number) {
  obj[key] = num(obj[key]) + v;
}

/** Round all numeric money/qty/percent fields per column spec. */
export function roundRows(rows: Row[], cols: Col[]): Row[] {
  for (const r of rows)
    for (const c of cols) {
      const v = r[c.key];
      if (typeof v === 'number') r[c.key] = c.type === 'qty' ? r3(v) : r2(v);
    }
  return rows;
}

export const pct = (a: number, b: number) => (b ? r2((a / b) * 100) : 0);

export function periodKey(d: Date, by: 'day' | 'month') {
  const s = iso(d) || '';
  return by === 'month' ? s.slice(0, 7) : s;
}
