import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodType, ZodTypeDef } from 'zod';
import { badRequest } from './errors';

export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest('Validation failed', r.error.flatten());
  return r.data;
}

export const intParam = (req: Request, name = 'id'): number => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n)) throw badRequest(`Invalid ${name}`);
  return n;
};

export interface ListQuery {
  page: number;
  pageSize: number;
  search: string;
  sort?: string;
  dir: 'asc' | 'desc';
}
export function listQuery(req: Request): ListQuery {
  const q = req.query;
  return {
    page: Math.max(1, Number(q.page) || 1),
    pageSize: Math.min(500, Math.max(1, Number(q.pageSize) || 25)),
    search: String(q.search || '').trim(),
    sort: q.sort ? String(q.sort) : undefined,
    dir: q.dir === 'asc' ? 'asc' : 'desc',
  };
}
export const paged = <T>(rows: T[], total: number, q: ListQuery) => ({
  rows,
  total,
  page: q.page,
  pageSize: q.pageSize,
});
