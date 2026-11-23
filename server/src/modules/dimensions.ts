import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { crudRouter } from '../lib/crud';
import { ah, intParam, listQuery, paged, parse } from '../lib/http';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import { badRequest, notFound } from '../lib/errors';
import type { ModuleDef } from '../app';

const PERM = 'dimensions';
const code = z.string().trim().min(1).max(40);
const name = z.string().trim().min(1).max(200);
const opt = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v === '' ? null : v));
const optId = z.coerce.number().int().positive().nullish();

const simple = z.object({ code, name, isActive: z.boolean().optional() });

/** Wrap a crudRouter with extra routes mounted first (they take precedence over the generic ones). */
function withExtras(mount: (r: Router) => void, crud: Router) {
  const r = Router();
  mount(r);
  r.use(crud);
  return r;
}

function simpleCrud(model: string, schema: z.ZodTypeAny, searchFields = ['code', 'name'], filters = ['isActive'], defaultSort = 'code') {
  return crudRouter({ model, permission: PERM, searchFields, schema, filters, defaultSort });
}

// ---------- warehouses ----------
const warehouseSchema = z.object({
  code,
  name,
  branchId: optId,
  address: opt,
  isActive: z.boolean().optional(),
});
const locationSchema = z.object({
  zone: opt,
  rack: opt,
  shelf: opt,
  bin: opt,
  code: z.string().trim().min(1).max(60).optional(),
  isActive: z.boolean().optional(),
});
const locCode = (d: { zone?: string | null; rack?: string | null; shelf?: string | null; bin?: string | null }) =>
  [d.zone, d.rack, d.shelf, d.bin].filter(Boolean).join('-');

const warehouseRouter = withExtras(
  (r) => {
    r.get(
      '/',
      can(PERM, 'view'),
      ah(async (req, res) => {
        const q = listQuery(req);
        const where: Record<string, unknown> = {};
        if (q.search) where.OR = [{ code: { contains: q.search } }, { name: { contains: q.search } }];
        if (req.query.isActive !== undefined && req.query.isActive !== '') where.isActive = req.query.isActive === 'true';
        if (req.query.branchId) where.branchId = Number(req.query.branchId);
        const sortField = ['code', 'name', 'id'].includes(q.sort ?? '') ? q.sort! : 'code';
        const [rows, total] = await Promise.all([
          prisma.warehouse.findMany({
            where,
            include: { branch: { select: { id: true, code: true, name: true } }, _count: { select: { locations: true } } },
            orderBy: { [sortField]: q.sort && q.dir === 'desc' ? 'desc' : 'asc' },
            skip: (q.page - 1) * q.pageSize,
            take: q.pageSize,
          }),
          prisma.warehouse.count({ where }),
        ]);
        const summ = await prisma.$queryRaw<{ warehouseId: number; qty: unknown; reserved: unknown; value: unknown; items: unknown }[]>`
          SELECT warehouseId, SUM(onHand) AS qty, SUM(reserved) AS reserved, SUM(onHand * avgCost) AS value, SUM(CASE WHEN onHand <> 0 THEN 1 ELSE 0 END) AS items
          FROM StockBalance GROUP BY warehouseId`;
        const m = new Map(summ.map((s) => [Number(s.warehouseId), s]));
        const out = rows.map((w) => {
          const s = m.get(w.id);
          return {
            ...w,
            locationCount: w._count.locations,
            stockQty: Number(s?.qty ?? 0),
            reservedQty: Number(s?.reserved ?? 0),
            stockValue: Math.round(Number(s?.value ?? 0) * 100) / 100,
            itemCount: Number(s?.items ?? 0),
          };
        });
        res.json(paged(out, total, q));
      }),
    );
    r.get(
      '/:id/locations',
      can(PERM, 'view'),
      ah(async (req, res) => {
        const warehouseId = intParam(req);
        res.json(await prisma.warehouseLocation.findMany({ where: { warehouseId }, orderBy: { code: 'asc' } }));
      }),
    );
    r.post(
      '/:id/locations',
      can(PERM, 'create'),
      ah(async (req, res) => {
        const warehouseId = intParam(req);
        if (!(await prisma.warehouse.findUnique({ where: { id: warehouseId } }))) throw notFound('Warehouse not found');
        const d = parse(locationSchema, req.body);
        const c = d.code || locCode(d);
        if (!c) throw badRequest('Provide a code or at least one of zone/rack/shelf/bin');
        const row = await prisma.warehouseLocation.create({ data: { ...d, code: c, warehouseId } });
        await audit(prisma, req.user, 'CREATE', 'WarehouseLocation', row.id, row);
        res.status(201).json(row);
      }),
    );
  },
  crudRouter({
    model: 'warehouse',
    permission: PERM,
    searchFields: ['code', 'name'],
    schema: warehouseSchema,
    filters: ['isActive', 'branchId'],
    defaultSort: 'code',
    include: { branch: true, locations: true },
  }),
);

const locationRouter = Router();
locationRouter.get(
  '/:id',
  can(PERM, 'view'),
  ah(async (req, res) => {
    const row = await prisma.warehouseLocation.findUnique({ where: { id: intParam(req) } });
    if (!row) throw notFound();
    res.json(row);
  }),
);
locationRouter.put(
  '/:id',
  can(PERM, 'edit'),
  ah(async (req, res) => {
    const id = intParam(req);
    const d = parse(locationSchema.partial(), req.body);
    const row = await prisma.warehouseLocation.update({ where: { id }, data: d });
    await audit(prisma, req.user, 'UPDATE', 'WarehouseLocation', id, d);
    res.json(row);
  }),
);
locationRouter.delete(
  '/:id',
  can(PERM, 'delete'),
  ah(async (req, res) => {
    const id = intParam(req);
    const used = await prisma.stockTransaction.count({ where: { locationId: id } });
    if (used) throw badRequest('Location has stock transactions; deactivate it instead');
    await prisma.warehouseLocation.delete({ where: { id } });
    await audit(prisma, req.user, 'DELETE', 'WarehouseLocation', id);
    res.json({ ok: true });
  }),
);

// ---------- categories ----------
const categorySchema = z.object({ code, name, parentId: optId, isActive: z.boolean().optional() });
const categoryRouter = withExtras(
  (r) => {
    r.get(
      '/',
      can(PERM, 'view'),
      ah(async (req, res, next) => {
        if (req.query.tree !== '1' && req.query.tree !== 'true') return next();
        const all = await prisma.category.findMany({ orderBy: { name: 'asc' } });
        const counts = await prisma.product.groupBy({ by: ['categoryId'], _count: { _all: true } });
        const cm = new Map(counts.map((c) => [c.categoryId, c._count._all]));
        type Node = (typeof all)[number] & { productCount: number; children: Node[] };
        const nodes = new Map<number, Node>(all.map((c) => [c.id, { ...c, parent: undefined, productCount: cm.get(c.id) ?? 0, children: [] } as unknown as Node]));
        const roots: Node[] = [];
        for (const n of nodes.values()) {
          const p = n.parentId ? nodes.get(n.parentId) : undefined;
          if (p) p.children.push(n);
          else roots.push(n);
        }
        res.json(roots);
      }),
    );
    // prevent cyclic parent
    r.put(
      '/:id',
      can(PERM, 'edit'),
      ah(async (req, _res, next) => {
        const id = intParam(req);
        const pid = req.body?.parentId;
        if (pid) {
          let cur: number | null = Number(pid);
          const seen = new Set<number>();
          while (cur) {
            if (cur === id) throw badRequest('A category cannot be its own ancestor');
            if (seen.has(cur)) break;
            seen.add(cur);
            cur = (await prisma.category.findUnique({ where: { id: cur }, select: { parentId: true } }))?.parentId ?? null;
          }
        }
        next();
      }),
    );
  },
  crudRouter({
    model: 'category',
    permission: PERM,
    searchFields: ['code', 'name'],
    schema: categorySchema,
    filters: ['isActive', 'parentId'],
    defaultSort: 'code',
    include: { parent: { select: { id: true, code: true, name: true } } },
  }),
);

// ---------- single-flag tables (VAT default, base currency) ----------
function flagCrud(model: 'vatCode' | 'currency', flag: 'isDefault' | 'isBase', schema: z.ZodObject<z.ZodRawShape>, searchFields: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (): any => (prisma as any)[model];
  const entity = model === 'vatCode' ? 'VatCode' : 'Currency';
  return withExtras(
    (r) => {
      r.post(
        '/',
        can(PERM, 'create'),
        ah(async (req, res) => {
          const data = parse(schema, req.body) as Record<string, unknown>;
          const row = await prisma.$transaction(async (tx) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const t = (tx as any)[model];
            const created = await t.create({ data });
            if (data[flag]) await t.updateMany({ where: { id: { not: created.id } }, data: { [flag]: false } });
            return created;
          });
          await audit(prisma, req.user, 'CREATE', entity, row.id, data);
          res.status(201).json(row);
        }),
      );
      r.put(
        '/:id',
        can(PERM, 'edit'),
        ah(async (req, res) => {
          const id = intParam(req);
          const data = parse(schema.partial(), req.body) as Record<string, unknown>;
          const row = await prisma.$transaction(async (tx) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const t = (tx as any)[model];
            const updated = await t.update({ where: { id }, data });
            if (data[flag] === true) await t.updateMany({ where: { id: { not: id } }, data: { [flag]: false } });
            return updated;
          });
          await audit(prisma, req.user, 'UPDATE', entity, id, data);
          res.json(row);
        }),
      );
      r.delete(
        '/:id',
        can(PERM, 'delete'),
        ah(async (req, res) => {
          const id = intParam(req);
          const row = await d().findUnique({ where: { id } });
          if (!row) throw notFound();
          if (row[flag]) throw badRequest(flag === 'isDefault' ? 'Cannot delete the default VAT code' : 'Cannot delete the base currency');
          await d().delete({ where: { id } });
          await audit(prisma, req.user, 'DELETE', entity, id);
          res.json({ ok: true });
        }),
      );
    },
    crudRouter({ model, permission: PERM, searchFields, schema, filters: ['isActive'], defaultSort: 'code' }),
  );
}

const vatSchema = z.object({
  code,
  name,
  rate: z.coerce.number().min(0).max(100),
  category: z.enum(['TAXABLE', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE']).default('TAXABLE'),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
const currencySchema = z.object({
  code,
  name,
  symbol: opt,
  rate: z.coerce.number().positive(),
  isBase: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const companySchema = z.object({
  code,
  name,
  arabicName: opt,
  trn: opt,
  address: opt,
  phone: opt,
  email: z
    .string()
    .email()
    .nullish()
    .or(z.literal('').transform(() => null)),
  country: opt,
  baseCurrency: z.string().trim().min(2).max(10).optional(),
  tagline: z.string().trim().max(60).nullish().or(z.literal('').transform(() => null)),
  // logo as an image data URL; the client resizes it before upload, so 600 KB is generous
  logo: z
    .string()
    .max(600_000, 'Logo is too large (max ~400 KB)')
    .regex(/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/, 'Logo must be a PNG, JPG, WEBP or SVG image')
    .nullish()
    .or(z.literal('')),
  isActive: z.boolean().optional(),
});

export default [
  { path: '/company', router: crudRouter({ model: 'company', permission: PERM, searchFields: ['code', 'name'], schema: companySchema, filters: ['isActive'] }) },
  // optional legal name / address / TRN print on this BU's documents (else the Company details)
  { path: '/business-units', router: simpleCrud('businessUnit', simple.extend({ legalName: opt, address: opt, trn: opt })) },
  { path: '/branches', router: simpleCrud('branch', simple.extend({ address: opt })) },
  { path: '/warehouses', router: warehouseRouter },
  { path: '/warehouse-locations', router: locationRouter },
  { path: '/categories', router: categoryRouter },
  { path: '/product-groups', router: simpleCrud('productGroup', simple) },
  { path: '/product-types', router: simpleCrud('productType', simple) },
  { path: '/brands', router: simpleCrud('brand', simple.extend({ country: opt }), ['code', 'name', 'country']) },
  { path: '/areas', router: simpleCrud('area', simple) },
  {
    path: '/salesmen',
    router: simpleCrud('salesman', simple.extend({ phone: opt, email: opt, commissionPct: z.coerce.number().min(0).max(100).optional() }), ['code', 'name', 'phone', 'email']),
  },
  { path: '/territories', router: simpleCrud('territory', simple) },
  { path: '/units', router: simpleCrud('unit', simple) },
  { path: '/payment-terms', router: simpleCrud('paymentTerm', simple.extend({ days: z.coerce.number().int().min(0).default(0), basis: z.enum(['INVOICE_DATE', 'NEXT_MONTH']).default('INVOICE_DATE') })) },
  { path: '/currencies', router: flagCrud('currency', 'isBase', currencySchema, ['code', 'name']) },
  { path: '/vat-codes', router: flagCrud('vatCode', 'isDefault', vatSchema, ['code', 'name']) },
] satisfies ModuleDef[];
