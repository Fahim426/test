import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';
import { env } from '../lib/env';
import { prisma } from '../lib/prisma';
import { HttpError, forbidden, unauthorized } from '../lib/errors';

export interface AuthUser {
  id: number;
  username: string;
  role: string;
  roleId: number;
  branchId?: number | null;
  /** Business Unit of a non-admin user (lib/bu.ts) */
  businessUnitId?: number | null;
  permissions: Set<string>; // "module:action"
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function signAccess(u: { id: number; username: string }) {
  return jwt.sign({ sub: u.id, username: u.username }, env.jwtSecret, { expiresIn: '30m' });
}
export function signRefresh(u: { id: number }, jti: string) {
  return jwt.sign({ sub: u.id, jti }, env.jwtRefreshSecret, { expiresIn: '7d' });
}

export async function loadPermissions(roleId: number): Promise<Set<string>> {
  const rows = await prisma.rolePermission.findMany({ where: { roleId } });
  return new Set(rows.map((r) => `${r.module}:${r.action}`));
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const h = req.headers.authorization;
    const token = h?.startsWith('Bearer ') ? h.slice(7) : (req.query.token as string | undefined);
    if (!token) throw unauthorized('Missing token');
    let payload: { sub: number };
    try {
      payload = jwt.verify(token, env.jwtSecret) as unknown as { sub: number };
    } catch {
      throw unauthorized('Invalid or expired token');
    }
    const user = await prisma.user.findUnique({ where: { id: Number(payload.sub) }, include: { role: true } });
    if (!user || !user.isActive) throw unauthorized('User inactive');
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role.name,
      roleId: user.roleId,
      branchId: user.branchId,
      businessUnitId: user.businessUnitId,
      permissions: await loadPermissions(user.roleId),
    };
    next();
  } catch (e) {
    next(e);
  }
}

/** RBAC: module-specific permission. Role "Admin" bypasses. */
export const can =
  (module: string, action: string) => (req: Request, _res: Response, next: NextFunction) => {
    const u = req.user;
    if (!u) return next(unauthorized());
    if (u.role === 'Admin' || u.permissions.has(`${module}:${action}`)) return next();
    next(forbidden(`Missing permission ${module}:${action}`));
  };

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.flatten() });
  }
  const code = (err as { code?: string }).code;
  if (code === 'P2002') return res.status(409).json({ error: 'Duplicate value violates a unique constraint', details: (err as { meta?: unknown }).meta });
  if (code === 'P2025') return res.status(404).json({ error: 'Record not found' });
  if (code === 'P2003') return res.status(409).json({ error: 'Record is referenced by other data' });
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
};
