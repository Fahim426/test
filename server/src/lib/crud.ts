import { Router } from 'express';
import { ZodSchema } from 'zod';
import { prisma } from './prisma';
import { ah, intParam, listQuery, paged, parse } from './http';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import { notFound } from './errors';

/**
 * Generic master-data CRUD router: GET / (paged+search+sort), GET /:id, POST /, PUT /:id, DELETE /:id.
 * `model` is the Prisma delegate name (e.g. "brand"); search runs `contains` over `searchFields`.
 */
export interface CrudOptions {
  model: string;
  permission: string;
  searchFields: string[];
  schema: ZodSchema;
  include?: Record<string, unknown>;
  defaultSort?: string;
  /** extra equality filters taken from query string, e.g. ['isActive','categoryId'] */
  filters?: string[];
  beforeSave?: (data: Record<string, unknown>, isNew: boolean) => Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const delegate = (name: string): any => (prisma as any)[name];

export function crudRouter(o: CrudOptions) {
  const r = Router();
  const d = () => delegate(o.model);

  r.get(
    '/',
    can(o.permission, 'view'),
    ah(async (req, res) => {
      const q = listQuery(req);
      const where: Record<string, unknown> = {};
      if (q.search) where.OR = o.searchFields.map((f) => ({ [f]: { contains: q.search } }));
      for (const f of o.filters ?? []) {
        const v = req.query[f];
        if (v === undefined || v === '') continue;
        where[f] = v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(String(v)) && f.endsWith('Id') ? Number(v) : v;
      }
      const sortField = q.sort ?? o.defaultSort ?? 'id';
      const [rows, total] = await Promise.all([
        d().findMany({
          where,
          include: o.include,
          orderBy: { [sortField]: q.dir },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        d().count({ where }),
      ]);
      res.json(paged(rows, total, q));
    }),
  );

  r.get(
    '/:id',
    can(o.permission, 'view'),
    ah(async (req, res) => {
      const row = await d().findUnique({ where: { id: intParam(req) }, include: o.include });
      if (!row) throw notFound();
      res.json(row);
    }),
  );

  r.post(
    '/',
    can(o.permission, 'create'),
    ah(async (req, res) => {
      let data = parse(o.schema, req.body) as Record<string, unknown>;
      if (o.beforeSave) data = o.beforeSave(data, true);
      const row = await d().create({ data });
      await audit(prisma, req.user, 'CREATE', o.model, row.id, data);
      res.status(201).json(row);
    }),
  );

  r.put(
    '/:id',
    can(o.permission, 'edit'),
    ah(async (req, res) => {
      let data = parse((o.schema as unknown as { partial: () => ZodSchema }).partial(), req.body) as Record<string, unknown>;
      if (o.beforeSave) data = o.beforeSave(data, false);
      const row = await d().update({ where: { id: intParam(req) }, data });
      await audit(prisma, req.user, 'UPDATE', o.model, row.id, data);
      res.json(row);
    }),
  );

  r.delete(
    '/:id',
    can(o.permission, 'delete'),
    ah(async (req, res) => {
      const id = intParam(req);
      await d().delete({ where: { id } });
      await audit(prisma, req.user, 'DELETE', o.model, id);
      res.json({ ok: true });
    }),
  );
  return r;
}
