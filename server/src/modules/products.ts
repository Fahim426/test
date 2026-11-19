import { revisionSnapshot, auditRevision } from '../services/revisions-history';
import { Router } from 'express';
import { z } from 'zod';
import { prisma, Prisma } from '../lib/prisma';
import { ah, intParam, listQuery, paged, parse } from '../lib/http';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import { badRequest, notFound } from '../lib/errors';
import { nextCode } from '../services/admin-master';
import { productHistory, productStock } from '../services/admin-history';
import { num, r3 } from '../lib/calc';
import type { ModuleDef } from '../app';

const PERM = 'products';
const opt = z
  .string()
  .trim()
  .max(5000)
  .nullish()
  .transform((v) => (v === '' ? null : v));
const optId = z.coerce.number().int().positive().nullish();
const money = z.coerce.number().min(0);

const partNumberSchema = z.object({
  number: z.string().trim().min(1).max(100),
  kind: z.enum(['OEM', 'ALTERNATE']).default('ALTERNATE'),
});
const vehicleSchema = z.object({
  make: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
  variant: opt,
  yearFrom: z.coerce.number().int().min(1900).max(2100).nullish(),
  yearTo: z.coerce.number().int().min(1900).max(2100).nullish(),
  engine: opt,
  fuel: opt,
  transmission: opt,
});

export const productSchema = z.object({
  code: z.string().trim().max(60).optional(),
  name: z.string().trim().min(1).max(250),
  arabicName: opt,
  description: opt,
  oemNumber: opt,
  barcode: opt,
  brandId: optId,
  categoryId: optId,
  subCategoryId: optId,
  productGroupId: optId,
  productTypeId: optId,
  vehicleMake: opt,
  vehicleModel: opt,
  vehicleVariant: opt,
  yearInfo: opt,
  engine: opt,
  fuelType: opt,
  purchaseUnit: z.string().trim().min(1).max(20).optional(),
  salesUnit: z.string().trim().min(1).max(20).optional(),
  costPrice: money.optional(),
  averageCost: money.optional(),
  lastPurchasePrice: money.optional(),
  retailPrice: money.optional(),
  wholesalePrice: money.optional(),
  minStock: money.optional(),
  maxStock: money.optional(),
  reorderLevel: money.optional(),
  weight: money.optional(),
  length: money.optional(),
  width: money.optional(),
  height: money.optional(),
  countryOfOrigin: opt,
  warranty: opt,
  vatRate: z.coerce.number().min(0).max(100).optional(),
  primarySupplierId: optId,
  defaultWarehouseId: optId,
  rack: opt,
  shelf: opt,
  bin: opt,
  isActive: z.boolean().optional(),
  partNumbers: z.array(partNumberSchema).max(200).optional(),
  vehicles: z.array(vehicleSchema).max(500).optional(),
});

function cleanPartNumbers(pn: { number: string; kind?: string }[] | undefined, oem: string | null | undefined) {
  const seen = new Set<string>();
  const out: { number: string; kind: string }[] = [];
  const add = (number: string, kind: string) => {
    const key = number.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ number, kind });
  };
  if (oem) add(oem, 'OEM');
  for (const p of pn ?? []) add(p.number, p.kind ?? 'ALTERNATE');
  return out;
}

const include = {
  brand: { select: { id: true, code: true, name: true } },
  category: { select: { id: true, code: true, name: true } },
};

async function stockTotals(ids: number[]) {
  const m = new Map<number, { onHand: number; reserved: number }>();
  if (!ids.length) return m;
  const agg = await prisma.stockBalance.groupBy({ by: ['productId'], where: { productId: { in: ids } }, _sum: { onHand: true, reserved: true } });
  for (const a of agg) m.set(a.productId, { onHand: num(a._sum.onHand), reserved: num(a._sum.reserved) });
  return m;
}

/** Product ids whose total on-hand is at or below the reorder level (reorderLevel, else minStock). */
async function lowStockIds(): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT p.id FROM Product p
    LEFT JOIN (SELECT productId, SUM(onHand) AS oh FROM StockBalance GROUP BY productId) b ON b.productId = p.id
    WHERE p.isActive = 1
      AND (CASE WHEN p.reorderLevel > 0 THEN p.reorderLevel ELSE p.minStock END) > 0
      AND COALESCE(b.oh, 0) <= (CASE WHEN p.reorderLevel > 0 THEN p.reorderLevel ELSE p.minStock END)`;
  return rows.map((r) => Number(r.id));
}

function searchWhere(s: string): Prisma.ProductWhereInput[] {
  return [
    { code: { contains: s } },
    { name: { contains: s } },
    { arabicName: { contains: s } },
    { description: { contains: s } },
    { oemNumber: { contains: s } },
    { barcode: { contains: s } },
    { vehicleMake: { contains: s } },
    { vehicleModel: { contains: s } },
    { brand: { name: { contains: s } } },
    { partNumbers: { some: { number: { contains: s } } } },
    { vehicles: { some: { OR: [{ make: { contains: s } }, { model: { contains: s } }] } } },
  ];
}

const r = Router();

r.get(
  '/',
  can(PERM, 'view'),
  ah(async (req, res) => {
    const q = listQuery(req);
    const and: Prisma.ProductWhereInput[] = [];
    if (q.search) and.push({ OR: searchWhere(q.search) });
    if (req.query.brandId) and.push({ brandId: Number(req.query.brandId) });
    if (req.query.categoryId) and.push({ OR: [{ categoryId: Number(req.query.categoryId) }, { subCategoryId: Number(req.query.categoryId) }] });
    if (req.query.productGroupId) and.push({ productGroupId: Number(req.query.productGroupId) });
    if (req.query.productTypeId) and.push({ productTypeId: Number(req.query.productTypeId) });
    const active = req.query.active ?? req.query.isActive;
    if (active !== undefined && active !== '') and.push({ isActive: active === 'true' || active === '1' });
    if (req.query.lowStock === 'true' || req.query.lowStock === '1') and.push({ id: { in: await lowStockIds() } });
    const where: Prisma.ProductWhereInput = and.length ? { AND: and } : {};
    const sortable = ['id', 'code', 'name', 'oemNumber', 'retailPrice', 'costPrice', 'createdAt', 'updatedAt'];
    const sort = sortable.includes(q.sort ?? '') ? q.sort! : 'code';
    const [rows, total] = await Promise.all([
      prisma.product.findMany({ where, include, orderBy: { [sort]: q.sort ? q.dir : 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.product.count({ where }),
    ]);
    const st = await stockTotals(rows.map((x) => x.id));
    const out = rows.map((p) => {
      const s = st.get(p.id) ?? { onHand: 0, reserved: 0 };
      const level = num(p.reorderLevel) > 0 ? num(p.reorderLevel) : num(p.minStock);
      return { ...p, onHand: s.onHand, reserved: s.reserved, available: r3(s.onHand - s.reserved), lowStock: level > 0 && s.onHand <= level };
    });
    res.json(paged(out, total, q));
  }),
);

// Fast autocomplete for line-item pickers
r.get(
  '/lookup',
  can(PERM, 'view'),
  ah(async (req, res) => {
    const s = String(req.query.q ?? req.query.search ?? '').trim();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : undefined;
    const where: Prisma.ProductWhereInput = { isActive: true };
    if (s)
      where.OR = [
        { code: { contains: s } },
        { oemNumber: { contains: s } },
        { barcode: { contains: s } },
        { name: { contains: s } },
        { arabicName: { contains: s } },
        { partNumbers: { some: { number: { contains: s } } } },
      ];
    const rows = await prisma.product.findMany({
      where,
      include: { partNumbers: { select: { number: true, kind: true } }, brand: { select: { name: true } } },
      take: s ? 100 : limit,
      orderBy: { code: 'asc' },
    });
    const sl = s.toLowerCase();
    const score = (p: (typeof rows)[number]) => {
      const fields = [p.code, p.oemNumber, p.barcode, ...p.partNumbers.map((x) => x.number)].filter(Boolean).map((x) => x!.toLowerCase());
      if (fields.some((f) => f === sl)) return 0;
      if (fields.some((f) => f.startsWith(sl))) return 1;
      if (p.name.toLowerCase().startsWith(sl)) return 2;
      return 3;
    };
    const sorted = s ? rows.sort((a, b) => score(a) - score(b) || a.code.localeCompare(b.code)).slice(0, limit) : rows;
    const bal = await prisma.stockBalance.groupBy({
      by: ['productId'],
      where: { productId: { in: sorted.map((p) => p.id) }, ...(warehouseId ? { warehouseId } : {}) },
      _sum: { onHand: true, reserved: true },
    });
    const bm = new Map(bal.map((b) => [b.productId, b._sum]));
    res.json(
      sorted.map((p) => {
        const b = bm.get(p.id);
        const onHand = num(b?.onHand);
        const reserved = num(b?.reserved);
        const matched = s ? p.partNumbers.find((x) => x.number.toLowerCase().includes(sl)) : undefined;
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          arabicName: p.arabicName,
          oemNumber: p.oemNumber,
          barcode: p.barcode,
          brand: p.brand?.name ?? null,
          unit: p.salesUnit,
          salesUnit: p.salesUnit,
          purchaseUnit: p.purchaseUnit,
          costPrice: num(p.costPrice),
          averageCost: num(p.averageCost),
          lastPurchasePrice: num(p.lastPurchasePrice),
          retailPrice: num(p.retailPrice),
          wholesalePrice: num(p.wholesalePrice),
          vatRate: num(p.vatRate),
          onHand,
          reserved,
          available: r3(onHand - reserved),
          matchedPartNumber: matched?.number ?? null,
          label: `${p.code} | ${p.oemNumber ?? '-'} | ${p.name}`,
        };
      }),
    );
  }),
);

// Vehicle compatibility search
r.get(
  '/by-vehicle',
  can(PERM, 'view'),
  ah(async (req, res) => {
    const q = listQuery(req);
    const make = String(req.query.make ?? '').trim();
    const model = String(req.query.model ?? '').trim();
    const variant = String(req.query.variant ?? '').trim();
    const engine = String(req.query.engine ?? '').trim();
    const fuel = String(req.query.fuel ?? '').trim();
    const year = req.query.year ? Number(req.query.year) : undefined;
    if (!make && !model && !year) throw badRequest('Provide at least make, model or year');
    if (year !== undefined && !Number.isInteger(year)) throw badRequest('Invalid year');
    const veh: Prisma.ProductVehicleWhereInput = {};
    if (make) veh.make = { contains: make };
    if (model) veh.model = { contains: model };
    if (variant) veh.variant = { contains: variant };
    if (engine) veh.engine = { contains: engine };
    if (fuel) veh.fuel = { contains: fuel };
    if (year) veh.AND = [{ OR: [{ yearFrom: null }, { yearFrom: { lte: year } }] }, { OR: [{ yearTo: null }, { yearTo: { gte: year } }] }];
    const and: Prisma.ProductWhereInput[] = [{ vehicles: { some: veh } }, { isActive: true }];
    if (q.search) and.push({ OR: searchWhere(q.search) });
    if (req.query.categoryId) and.push({ categoryId: Number(req.query.categoryId) });
    if (req.query.brandId) and.push({ brandId: Number(req.query.brandId) });
    const where: Prisma.ProductWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { ...include, vehicles: { where: veh } },
        orderBy: { code: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.product.count({ where }),
    ]);
    const st = await stockTotals(rows.map((x) => x.id));
    res.json(
      paged(
        rows.map((p) => {
          const s = st.get(p.id) ?? { onHand: 0, reserved: 0 };
          return { ...p, matchedVehicles: p.vehicles, vehicles: undefined, onHand: s.onHand, reserved: s.reserved, available: r3(s.onHand - s.reserved) };
        }),
        total,
        q,
      ),
    );
  }),
);

r.get(
  '/vehicle-makes',
  can(PERM, 'view'),
  ah(async (_req, res) => {
    const rows = await prisma.productVehicle.findMany({ distinct: ['make'], select: { make: true }, orderBy: { make: 'asc' } });
    res.json(rows.map((x) => x.make));
  }),
);
r.get(
  '/vehicle-models',
  can(PERM, 'view'),
  ah(async (req, res) => {
    const make = String(req.query.make ?? '');
    const rows = await prisma.productVehicle.findMany({ where: make ? { make } : {}, distinct: ['model'], select: { model: true }, orderBy: { model: 'asc' } });
    res.json(rows.map((x) => x.model));
  }),
);

r.get(
  '/:id',
  can(PERM, 'view'),
  ah(async (req, res) => {
    const id = intParam(req);
    const p = await prisma.product.findUnique({
      where: { id },
      include: { brand: true, category: true, productGroup: true, productType: true, partNumbers: { orderBy: [{ kind: 'desc' }, { id: 'asc' }] }, vehicles: { orderBy: [{ make: 'asc' }, { model: 'asc' }] } },
    });
    if (!p) throw notFound('Product not found');
    const [stock, history, sub, supplier, whs] = await Promise.all([
      productStock(id),
      productHistory(id, 5),
      p.subCategoryId ? prisma.category.findUnique({ where: { id: p.subCategoryId }, select: { id: true, code: true, name: true } }) : null,
      p.primarySupplierId ? prisma.supplier.findUnique({ where: { id: p.primarySupplierId }, select: { id: true, code: true, name: true } }) : null,
      p.defaultWarehouseId ? prisma.warehouse.findUnique({ where: { id: p.defaultWarehouseId }, select: { id: true, code: true, name: true } }) : null,
    ]);
    const level = num(p.reorderLevel) > 0 ? num(p.reorderLevel) : num(p.minStock);
    res.json({
      ...p,
      subCategory: sub,
      primarySupplier: supplier,
      defaultWarehouse: whs,
      onHand: stock.total.onHand,
      reserved: stock.total.reserved,
      available: stock.total.available,
      stockValue: stock.total.value,
      lowStock: level > 0 && stock.total.onHand <= level,
      balances: stock.warehouses,
      history,
    });
  }),
);

async function saveRelations(tx: Prisma.TransactionClient, productId: number, d: { partNumbers?: { number: string; kind?: string }[]; vehicles?: z.infer<typeof vehicleSchema>[] }, oem: string | null | undefined, isNew: boolean) {
  if (d.partNumbers !== undefined || (oem !== undefined && !isNew)) {
    let list = d.partNumbers;
    if (list === undefined) {
      // oem changed only: keep alternates, rebuild OEM row
      const existing = await tx.productPartNumber.findMany({ where: { productId, kind: 'ALTERNATE' } });
      list = existing.map((e) => ({ number: e.number, kind: 'ALTERNATE' }));
    }
    const rows = cleanPartNumbers(list, oem === undefined ? (await tx.product.findUnique({ where: { id: productId } }))?.oemNumber : oem);
    await tx.productPartNumber.deleteMany({ where: { productId } });
    if (rows.length) await tx.productPartNumber.createMany({ data: rows.map((x) => ({ ...x, productId })) });
  }
  if (d.vehicles !== undefined) {
    await tx.productVehicle.deleteMany({ where: { productId } });
    if (d.vehicles.length) await tx.productVehicle.createMany({ data: d.vehicles.map((v) => ({ ...v, productId })) });
  }
}

r.post(
  '/',
  can(PERM, 'create'),
  ah(async (req, res) => {
    const d = parse(productSchema, req.body);
    const { partNumbers: _pn, vehicles: _v, ...data } = d;
    void _pn;
    void _v;
    const id = await prisma.$transaction(
      async (tx) => {
        const code = data.code || (await nextCode(tx, 'product', 'BP-', 5));
        const p = await tx.product.create({ data: { ...data, code } });
        await saveRelations(tx, p.id, { ...d, partNumbers: d.partNumbers ?? [] }, data.oemNumber, true);
        await audit(tx, req.user, 'CREATE', 'Product', p.id, { code, name: data.name });
        return p.id;
      },
      { timeout: 30000 },
    );
    res.status(201).json(await prisma.product.findUnique({ where: { id }, include: { ...include, partNumbers: true, vehicles: true } }));
  }),
);

r.put(
  '/:id',
  can(PERM, 'edit'),
  ah(async (req, res) => {
    const id = intParam(req);
    const d = parse(productSchema.partial(), req.body);
    const { partNumbers: _pn, vehicles: _v, ...data } = d;
    void _pn;
    void _v;
    if (data.code === '') delete data.code;
    await prisma.$transaction(
      async (tx) => {
    const revisionBefore = await revisionSnapshot(tx, 'Product', id);
        await tx.product.update({ where: { id }, data });
        await saveRelations(tx, id, d, data.oemNumber, false);
        await auditRevision(tx, req.user, 'Product', id, revisionBefore, req.body?.changeReason);
    await audit(tx, req.user, 'UPDATE', 'Product', id, { ...data, partNumbers: d.partNumbers?.length, vehicles: d.vehicles?.length });
      },
      { timeout: 30000 },
    );
    res.json(await prisma.product.findUnique({ where: { id }, include: { ...include, partNumbers: true, vehicles: true } }));
  }),
);

r.delete(
  '/:id',
  can(PERM, 'delete'),
  ah(async (req, res) => {
    const id = intParam(req);
    const p = await prisma.product.findUnique({ where: { id } });
    if (!p) throw notFound('Product not found');
    const counts = await Promise.all([
      prisma.stockTransaction.count({ where: { productId: id } }),
      prisma.purchaseOrderItem.count({ where: { productId: id } }),
      prisma.goodsReceiptItem.count({ where: { productId: id } }),
      prisma.purchaseInvoiceItem.count({ where: { productId: id } }),
      prisma.salesQuotationItem.count({ where: { productId: id } }),
      prisma.salesOrderItem.count({ where: { productId: id } }),
      prisma.deliveryNoteItem.count({ where: { productId: id } }),
      prisma.salesInvoiceItem.count({ where: { productId: id } }),
      prisma.stockTransferItem.count({ where: { productId: id } }),
      prisma.stockAdjustmentItem.count({ where: { productId: id } }),
      prisma.stockReservation.count({ where: { productId: id } }),
    ]);
    if (counts.some((c) => c > 0)) {
      await prisma.product.update({ where: { id }, data: { isActive: false } });
      await audit(prisma, req.user, 'DEACTIVATE', 'Product', id, { reason: 'has transactions' });
      return res.json({ ok: true, deactivated: true, message: 'Product has transactions and was deactivated instead of deleted' });
    }
    await prisma.$transaction(async (tx) => {
      await tx.stockBalance.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
      await audit(tx, req.user, 'DELETE', 'Product', id, { code: p.code });
    });
    res.json({ ok: true, deleted: true });
  }),
);

export default [{ path: '/products', router: r }] satisfies ModuleDef[];
