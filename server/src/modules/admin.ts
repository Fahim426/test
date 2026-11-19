import { NextFunction, Request, Response, Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma, Prisma } from '../lib/prisma';
import { env } from '../lib/env';
import { ah, intParam, listQuery, paged, parse } from '../lib/http';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { ACTIONS, PERMISSION_MODULES } from '../lib/permissions';
import { audit } from '../services/audit';
import { DOC_DEFAULTS } from '../services/numbering';
import { actOnApproval } from '../services/approval';
import { DOC_BY_TYPE } from '../services/admin-docs';
import { parseCsv, sendTable, toCsv } from '../services/admin-io';
import { ENTITIES, EXPORT_COLUMNS, Entity, SAMPLE_ROW, exportRows, runImport } from '../services/admin-import';
import { num } from '../lib/calc';
import type { ModuleDef } from '../app';

const opt = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v === '' ? null : v));

const adminOnly = (req: Request, _res: Response, next: NextFunction) => (req.user?.role === 'Admin' ? next() : next(forbidden('Administrator access required')));
const dateRange = (from?: unknown, to?: unknown) => {
  const r: { gte?: Date; lte?: Date } = {};
  if (from) {
    const d = new Date(String(from));
    if (!isNaN(+d)) r.gte = d;
  }
  if (to) {
    const d = new Date(String(to));
    if (!isNaN(+d)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) d.setUTCHours(23, 59, 59, 999);
      r.lte = d;
    }
  }
  return r.gte || r.lte ? r : undefined;
};

// =====================================================================
// USERS
// =====================================================================
const users = Router();
const userSelect = { id: true, username: true, email: true, fullName: true, roleId: true, branchId: true, isActive: true, lastLoginAt: true, createdAt: true, updatedAt: true, role: { select: { id: true, name: true } } } as const;
const passwordRule = z.string().min(6, 'Password must be at least 6 characters').max(100);
const userCreate = z.object({
  username: z.string().trim().min(3).max(50).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, . _ - only'),
  email: z.string().trim().email().nullish().or(z.literal('').transform(() => null)),
  fullName: z.string().trim().min(1).max(200),
  password: passwordRule,
  roleId: z.coerce.number().int().positive(),
  branchId: z.coerce.number().int().positive().nullish(),
  isActive: z.boolean().optional(),
});
const userUpdate = userCreate.omit({ password: true }).partial().extend({ password: passwordRule.optional() });

async function revokeTokens(userId: number) {
  await prisma.refreshToken.updateMany({ where: { userId }, data: { revoked: true } });
}

users.get(
  '/',
  can('users', 'view'),
  ah(async (req, res) => {
    const q = listQuery(req);
    const where: Prisma.UserWhereInput = {};
    if (q.search) where.OR = [{ username: { contains: q.search } }, { fullName: { contains: q.search } }, { email: { contains: q.search } }];
    if (req.query.roleId) where.roleId = Number(req.query.roleId);
    if (req.query.isActive !== undefined && req.query.isActive !== '') where.isActive = req.query.isActive === 'true';
    const sort = ['id', 'username', 'fullName', 'lastLoginAt', 'createdAt'].includes(q.sort ?? '') ? q.sort! : 'username';
    const [rows, total] = await Promise.all([
      prisma.user.findMany({ where, select: userSelect, orderBy: { [sort]: q.sort ? q.dir : 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.user.count({ where }),
    ]);
    res.json(paged(rows, total, q));
  }),
);
users.get(
  '/:id',
  can('users', 'view'),
  ah(async (req, res) => {
    const u = await prisma.user.findUnique({ where: { id: intParam(req) }, select: userSelect });
    if (!u) throw notFound('User not found');
    res.json(u);
  }),
);
users.post(
  '/',
  can('users', 'create'),
  ah(async (req, res) => {
    const { password, ...d } = parse(userCreate, req.body);
    if (!(await prisma.role.findUnique({ where: { id: d.roleId } }))) throw badRequest('Role not found');
    if (await prisma.user.findUnique({ where: { username: d.username } })) throw conflict('Username already exists');
    const u = await prisma.user.create({ data: { ...d, passwordHash: await bcrypt.hash(password, 10) }, select: userSelect });
    await audit(prisma, req.user, 'CREATE', 'User', u.id, { ...d });
    res.status(201).json(u);
  }),
);
users.put(
  '/:id',
  can('users', 'edit'),
  ah(async (req, res) => {
    const id = intParam(req);
    const { password, ...d } = parse(userUpdate, req.body);
    if (d.roleId && !(await prisma.role.findUnique({ where: { id: d.roleId } }))) throw badRequest('Role not found');
    if (id === req.user!.id && d.isActive === false) throw badRequest('You cannot deactivate your own account');
    if (d.username) {
      const dup = await prisma.user.findUnique({ where: { username: d.username } });
      if (dup && dup.id !== id) throw conflict('Username already exists');
    }
    const data: Prisma.UserUncheckedUpdateInput = { ...d };
    if (password) data.passwordHash = await bcrypt.hash(password, 10);
    const u = await prisma.user.update({ where: { id }, data, select: userSelect });
    if (password || d.isActive === false) await revokeTokens(id);
    await audit(prisma, req.user, 'UPDATE', 'User', id, { ...d, passwordChanged: !!password });
    res.json(u);
  }),
);
users.post(
  '/:id/reset-password',
  can('users', 'edit'),
  ah(async (req, res) => {
    const id = intParam(req);
    const body = parse(z.object({ password: passwordRule.optional() }), req.body ?? {});
    const temp = body.password ?? crypto.randomBytes(6).toString('base64url');
    if (!(await prisma.user.findUnique({ where: { id } }))) throw notFound('User not found');
    await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(temp, 10) } });
    await revokeTokens(id);
    await audit(prisma, req.user, 'RESET_PASSWORD', 'User', id);
    res.json({ ok: true, ...(body.password ? {} : { temporaryPassword: temp }) });
  }),
);
for (const [seg, active] of [['activate', true], ['deactivate', false]] as const)
  users.post(
    `/:id/${seg}`,
    can('users', 'edit'),
    ah(async (req, res) => {
      const id = intParam(req);
      if (!active && id === req.user!.id) throw badRequest('You cannot deactivate your own account');
      const u = await prisma.user.update({ where: { id }, data: { isActive: active }, select: userSelect });
      if (!active) await revokeTokens(id);
      await audit(prisma, req.user, active ? 'ACTIVATE' : 'DEACTIVATE', 'User', id);
      res.json(u);
    }),
  );
users.delete(
  '/:id',
  can('users', 'delete'),
  ah(async (req, res) => {
    const id = intParam(req);
    if (id === req.user!.id) throw badRequest('You cannot delete your own account');
    const u = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!u) throw notFound('User not found');
    if (u.role.name === 'Admin' && (await prisma.user.count({ where: { role: { name: 'Admin' }, isActive: true } })) <= 1) throw badRequest('Cannot delete the last active administrator');
    await prisma.user.delete({ where: { id } });
    await audit(prisma, req.user, 'DELETE', 'User', id, { username: u.username });
    res.json({ ok: true });
  }),
);

// =====================================================================
// ROLES & PERMISSIONS
// =====================================================================
const roles = Router();
const roleSchema = z.object({ name: z.string().trim().min(2).max(60), description: opt });

roles.get(
  '/',
  can('roles', 'view'),
  ah(async (_req, res) => {
    const rows = await prisma.role.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { users: true, permissions: true } } } });
    res.json({ rows: rows.map((r) => ({ id: r.id, name: r.name, description: r.description, isSystem: r.isSystem, userCount: r._count.users, permissionCount: r._count.permissions })), total: rows.length });
  }),
);
roles.get(
  '/:id',
  can('roles', 'view'),
  ah(async (req, res) => {
    const r = await prisma.role.findUnique({ where: { id: intParam(req) }, include: { _count: { select: { users: true } } } });
    if (!r) throw notFound('Role not found');
    res.json(r);
  }),
);
roles.post(
  '/',
  can('roles', 'create'),
  ah(async (req, res) => {
    const d = parse(roleSchema, req.body);
    if (await prisma.role.findUnique({ where: { name: d.name } })) throw conflict('Role name already exists');
    const r = await prisma.role.create({ data: d });
    await audit(prisma, req.user, 'CREATE', 'Role', r.id, d);
    res.status(201).json(r);
  }),
);
roles.put(
  '/:id',
  can('roles', 'edit'),
  ah(async (req, res) => {
    const id = intParam(req);
    const d = parse(roleSchema.partial(), req.body);
    const cur = await prisma.role.findUnique({ where: { id } });
    if (!cur) throw notFound('Role not found');
    if (cur.isSystem && d.name && d.name !== cur.name) throw badRequest('System roles cannot be renamed');
    if (d.name && d.name !== cur.name && (await prisma.role.findUnique({ where: { name: d.name } }))) throw conflict('Role name already exists');
    const r = await prisma.role.update({ where: { id }, data: d });
    await audit(prisma, req.user, 'UPDATE', 'Role', id, d);
    res.json(r);
  }),
);
roles.delete(
  '/:id',
  can('roles', 'delete'),
  ah(async (req, res) => {
    const id = intParam(req);
    const cur = await prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!cur) throw notFound('Role not found');
    if (cur.isSystem) throw badRequest('System roles cannot be deleted');
    if (cur._count.users) throw badRequest(`Role is assigned to ${cur._count.users} user(s)`);
    await prisma.role.delete({ where: { id } });
    await audit(prisma, req.user, 'DELETE', 'Role', id, { name: cur.name });
    res.json({ ok: true });
  }),
);
roles.get(
  '/:id/permissions',
  can('roles', 'view'),
  ah(async (req, res) => {
    const id = intParam(req);
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) throw notFound('Role not found');
    const rows = await prisma.rolePermission.findMany({ where: { roleId: id } });
    const by = new Map<string, string[]>();
    for (const r of rows) by.set(r.module, [...(by.get(r.module) ?? []), r.action]);
    res.json({
      roleId: id,
      roleName: role.name,
      matrix: PERMISSION_MODULES.map((m) => ({ module: m, actions: ACTIONS.filter((a) => by.get(m)?.includes(a)) })),
      permissions: rows.map((r) => `${r.module}:${r.action}`),
    });
  }),
);
const permsBody = z.object({
  permissions: z.union([
    z.array(z.string().regex(/^[a-z_]+:[a-z]+$/)),
    z.array(z.object({ module: z.string(), actions: z.array(z.string()) })),
  ]),
});
roles.put(
  '/:id/permissions',
  can('roles', 'edit'),
  ah(async (req, res) => {
    const id = intParam(req);
    if (!(await prisma.role.findUnique({ where: { id } }))) throw notFound('Role not found');
    const { permissions } = parse(permsBody, req.body);
    const set = new Set<string>();
    for (const p of permissions) {
      if (typeof p === 'string') set.add(p);
      else for (const a of p.actions) set.add(`${p.module}:${a}`);
    }
    const bad = [...set].filter((p) => {
      const [m, a] = p.split(':');
      return !(PERMISSION_MODULES as readonly string[]).includes(m) || !(ACTIONS as readonly string[]).includes(a);
    });
    if (bad.length) throw badRequest('Unknown permissions', bad);
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (set.size) await tx.rolePermission.createMany({ data: [...set].map((p) => ({ roleId: id, module: p.split(':')[0], action: p.split(':')[1] })) });
      await audit(tx, req.user, 'UPDATE_PERMISSIONS', 'Role', id, { count: set.size });
    });
    res.json({ ok: true, count: set.size });
  }),
);

const catalog = Router();
catalog.get('/catalog', can('roles', 'view'), (_req, res) => res.json({ modules: PERMISSION_MODULES, actions: ACTIONS }));

// =====================================================================
// DOCUMENT NUMBERING
// =====================================================================
type NumCfg = { docType: string; prefix: string; includeYear: boolean; includeBranch: boolean; padding: number; separator: string; resetRule: string; currentSeq: number; periodKey: string };
function previewNumber(cfg: NumCfg, date = new Date(), branchCode?: string) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const periodKey = cfg.resetRule === 'YEARLY' ? year : cfg.resetRule === 'MONTHLY' ? `${year}${month}` : 'ALL';
  const seq = cfg.periodKey === periodKey ? cfg.currentSeq + 1 : 1;
  const parts = [cfg.prefix];
  if (cfg.includeBranch) parts.push(branchCode || 'BR');
  if (cfg.includeYear) parts.push(year);
  parts.push(String(seq).padStart(cfg.padding, '0'));
  return { preview: parts.join(cfg.separator), nextSeq: seq };
}
const defaultCfg = (docType: string): NumCfg => ({ docType, prefix: DOC_DEFAULTS[docType] ?? docType.slice(0, 3), includeYear: true, includeBranch: false, padding: 5, separator: '-', resetRule: 'YEARLY', currentSeq: 0, periodKey: '' });
const numberingSchema = z.object({
  prefix: z.string().trim().min(1).max(10),
  includeYear: z.boolean(),
  includeBranch: z.boolean(),
  padding: z.coerce.number().int().min(1).max(10),
  separator: z.string().max(3),
  resetRule: z.enum(['YEARLY', 'MONTHLY', 'NEVER']),
  currentSeq: z.coerce.number().int().min(0),
  force: z.boolean().optional(),
});

const numbering = Router();
numbering.get(
  '/',
  can('numbering', 'view'),
  ah(async (_req, res) => {
    const rows = await prisma.documentNumbering.findMany();
    const m = new Map(rows.map((r) => [r.docType, r]));
    const types = [...new Set([...Object.keys(DOC_DEFAULTS), ...rows.map((r) => r.docType)])].sort();
    res.json({
      rows: types.map((t) => {
        const cfg = m.get(t) ?? defaultCfg(t);
        return { ...cfg, id: m.get(t)?.id ?? null, configured: m.has(t), label: DOC_BY_TYPE.get(t)?.label ?? t, example: previewNumber(cfg).preview };
      }),
      total: types.length,
    });
  }),
);
numbering.get(
  '/preview/:docType',
  can('numbering', 'view'),
  ah(async (req, res) => {
    const docType = String(req.params.docType).toUpperCase();
    const row = await prisma.documentNumbering.findUnique({ where: { docType } });
    if (!row && !DOC_DEFAULTS[docType]) throw notFound('Unknown document type');
    const base: NumCfg = row ?? defaultCfg(docType);
    // allow previewing unsaved settings via query string
    const o = req.query;
    const cfg: NumCfg = {
      ...base,
      prefix: o.prefix ? String(o.prefix) : base.prefix,
      includeYear: o.includeYear !== undefined ? o.includeYear === 'true' : base.includeYear,
      includeBranch: o.includeBranch !== undefined ? o.includeBranch === 'true' : base.includeBranch,
      padding: o.padding ? Math.min(10, Math.max(1, Number(o.padding))) : base.padding,
      separator: o.separator !== undefined ? String(o.separator).slice(0, 3) : base.separator,
      resetRule: o.resetRule ? String(o.resetRule) : base.resetRule,
    };
    res.json({ docType, ...previewNumber(cfg, new Date(), o.branch ? String(o.branch) : undefined) });
  }),
);
numbering.put(
  '/:docType',
  can('numbering', 'edit'),
  ah(async (req, res) => {
    const docType = String(req.params.docType).toUpperCase();
    if (!/^[A-Z_]{2,40}$/.test(docType)) throw badRequest('Invalid document type');
    const cur = await prisma.documentNumbering.findUnique({ where: { docType } });
    if (!cur && !DOC_DEFAULTS[docType]) throw notFound('Unknown document type');
    const { force, ...d } = parse(numberingSchema.partial(), req.body);
    if (d.currentSeq !== undefined && cur && d.currentSeq < cur.currentSeq && !force)
      throw badRequest('Lowering the current sequence may create duplicate document numbers; pass force=true to confirm');
    const row = await prisma.documentNumbering.upsert({ where: { docType }, update: d, create: { ...defaultCfg(docType), ...d, periodKey: '' } });
    await audit(prisma, req.user, 'UPDATE', 'DocumentNumbering', row.id, { docType, ...d });
    res.json({ ...row, example: previewNumber(row).preview });
  }),
);

// =====================================================================
// APPROVAL RULES
// =====================================================================
const approvalRules = Router();
const ruleSchema = z.object({
  docType: z.string().trim().toUpperCase().min(2).max(50),
  name: z.string().trim().min(1).max(200),
  minAmount: z.coerce.number().min(0).default(0),
  maxAmount: z.coerce.number().min(0).nullish(),
  steps: z.array(z.string().trim().min(1)).min(1, 'At least one approval step (role) is required').max(10),
  isActive: z.boolean().optional(),
});
const fmtRule = (r: { steps: string; minAmount: unknown; maxAmount: unknown } & Record<string, unknown>) => {
  let steps: string[] = [];
  try {
    steps = JSON.parse(r.steps);
  } catch {
    /* ignore */
  }
  return { ...r, steps };
};
async function validateRule(raw: z.input<typeof ruleSchema>, selfId?: number) {
  const d = ruleSchema.parse(raw);
  if (!DOC_DEFAULTS[d.docType]) throw badRequest(`Unknown document type "${d.docType}"`, { allowed: Object.keys(DOC_DEFAULTS) });
  if (d.maxAmount != null && d.maxAmount <= d.minAmount) throw badRequest('Maximum amount must be greater than minimum amount');
  const have = new Set((await prisma.role.findMany({ select: { name: true } })).map((r) => r.name));
  const missing = d.steps.filter((s) => !have.has(s));
  if (missing.length) throw badRequest(`Unknown role(s) in steps: ${missing.join(', ')}`);
  if (d.isActive !== false) {
    const others = await prisma.approvalRule.findMany({ where: { docType: d.docType, isActive: true, ...(selfId ? { id: { not: selfId } } : {}) } });
    const hi = d.maxAmount ?? Infinity;
    const clash = others.find((o) => num(o.minAmount) < hi && d.minAmount < (o.maxAmount === null ? Infinity : num(o.maxAmount)));
    if (clash) throw badRequest(`Amount range overlaps with existing rule "${clash.name}"`);
  }
}
approvalRules.get(
  '/meta',
  can('approvals', 'view'),
  ah(async (_req, res) => {
    res.json({ docTypes: Object.keys(DOC_DEFAULTS), roles: (await prisma.role.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })) });
  }),
);
approvalRules.get(
  '/',
  can('approvals', 'view'),
  ah(async (req, res) => {
    const q = listQuery(req);
    const where: Prisma.ApprovalRuleWhereInput = {};
    if (req.query.docType) where.docType = String(req.query.docType).toUpperCase();
    if (req.query.isActive !== undefined && req.query.isActive !== '') where.isActive = req.query.isActive === 'true';
    if (q.search) where.name = { contains: q.search };
    const [rows, total] = await Promise.all([
      prisma.approvalRule.findMany({ where, orderBy: [{ docType: 'asc' }, { minAmount: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.approvalRule.count({ where }),
    ]);
    res.json(paged(rows.map(fmtRule), total, q));
  }),
);
approvalRules.get(
  '/:id',
  can('approvals', 'view'),
  ah(async (req, res) => {
    const r = await prisma.approvalRule.findUnique({ where: { id: intParam(req) } });
    if (!r) throw notFound('Rule not found');
    res.json(fmtRule(r));
  }),
);
approvalRules.post(
  '/',
  can('approvals', 'create'),
  ah(async (req, res) => {
    const d = parse(ruleSchema, req.body);
    await validateRule(d);
    const r = await prisma.approvalRule.create({ data: { ...d, steps: JSON.stringify(d.steps), maxAmount: d.maxAmount ?? null } });
    await audit(prisma, req.user, 'CREATE', 'ApprovalRule', r.id, d);
    res.status(201).json(fmtRule(r));
  }),
);
approvalRules.put(
  '/:id',
  can('approvals', 'edit'),
  ah(async (req, res) => {
    const id = intParam(req);
    const cur = await prisma.approvalRule.findUnique({ where: { id } });
    if (!cur) throw notFound('Rule not found');
    const patch = parse(ruleSchema.partial(), req.body);
    const merged = ruleSchema.parse({
      docType: cur.docType,
      name: cur.name,
      minAmount: num(cur.minAmount),
      maxAmount: cur.maxAmount === null ? null : num(cur.maxAmount),
      steps: JSON.parse(cur.steps),
      isActive: cur.isActive,
      ...patch,
    });
    await validateRule(merged, id);
    const r = await prisma.approvalRule.update({ where: { id }, data: { ...merged, steps: JSON.stringify(merged.steps), maxAmount: merged.maxAmount ?? null } });
    await audit(prisma, req.user, 'UPDATE', 'ApprovalRule', id, patch);
    res.json(fmtRule(r));
  }),
);
approvalRules.delete(
  '/:id',
  can('approvals', 'delete'),
  ah(async (req, res) => {
    const id = intParam(req);
    await prisma.approvalRule.delete({ where: { id } });
    await audit(prisma, req.user, 'DELETE', 'ApprovalRule', id);
    res.json({ ok: true });
  }),
);

// =====================================================================
// APPROVAL INBOX (any authenticated user; filtered by role)
// =====================================================================
const approvals = Router();
const stepsOf = (s: string): string[] => {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
};
async function decorateApprovals<T extends { id: number; steps: string; currentStep: number; status: string; docType: string; docId: number; requestedBy: number | null }>(rows: T[], user: Request['user']) {
  const ids = [...new Set(rows.map((r) => r.requestedBy).filter((x): x is number => !!x))];
  const us = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, fullName: true } }) : [];
  const um = new Map(us.map((u) => [u.id, u]));
  return rows.map((r) => {
    const steps = stepsOf(r.steps);
    const currentRole = r.status === 'PENDING' ? steps[r.currentStep] ?? null : null;
    const def = DOC_BY_TYPE.get(r.docType);
    return {
      ...r,
      steps,
      currentRole,
      canAct: r.status === 'PENDING' && !!user && (user.role === 'Admin' || user.role === currentRole),
      requester: r.requestedBy ? um.get(r.requestedBy) ?? null : null,
      docLabel: def?.label ?? r.docType,
      route: def ? `${def.route}/${r.docId}` : null,
    };
  });
}
approvals.get(
  '/',
  ah(async (req, res) => {
    const q = listQuery(req);
    const where: Prisma.ApprovalRequestWhereInput = {};
    if (req.query.status) where.status = String(req.query.status).toUpperCase();
    if (req.query.docType) where.docType = String(req.query.docType).toUpperCase();
    if (q.search) where.docNo = { contains: q.search };
    const mine = req.query.mine === '1' || req.query.mine === 'true';
    const u = req.user!;
    let rows = await prisma.approvalRequest.findMany({ where, orderBy: { createdAt: 'desc' }, include: { actions: { orderBy: { id: 'asc' } } } });
    if (mine) rows = rows.filter((r) => r.status === 'PENDING' && (u.role === 'Admin' || stepsOf(r.steps)[r.currentStep] === u.role));
    else if (u.role !== 'Admin' && !u.permissions.has('approvals:view')) {
      // non-privileged users only see requests relevant to their role or raised by them
      rows = rows.filter((r) => r.requestedBy === u.id || stepsOf(r.steps).includes(u.role));
    }
    const total = rows.length;
    const page = rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    res.json(paged(await decorateApprovals(page, u), total, q));
  }),
);
approvals.get(
  '/:id',
  ah(async (req, res) => {
    const r = await prisma.approvalRequest.findUnique({ where: { id: intParam(req) }, include: { actions: { orderBy: { id: 'asc' } } } });
    if (!r) throw notFound('Approval request not found');
    res.json((await decorateApprovals([r], req.user))[0]);
  }),
);
const actBody = z.object({ comment: z.string().trim().max(1000).optional() });
for (const [seg, outcome] of [['approve', 'APPROVED'], ['reject', 'REJECTED']] as const)
  approvals.post(
    `/:id/${seg}`,
    ah(async (req, res) => {
      const id = intParam(req);
      const { comment } = parse(actBody, req.body ?? {});
      if (outcome === 'REJECTED' && !comment) throw badRequest('A comment is required when rejecting');
      const u = req.user!;
      const updated = await prisma.$transaction(async (tx) => {
        const r = await actOnApproval(tx, id, { id: u.id, username: u.username, role: u.role }, outcome, comment);
        await audit(tx, u, outcome === 'APPROVED' ? 'APPROVE' : 'REJECT', 'ApprovalRequest', id, { docType: r.docType, docNo: r.docNo, comment, status: r.status });
        return r;
      }, { timeout: 30000 });
      const full = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: updated.id }, include: { actions: { orderBy: { id: 'asc' } } } });
      res.json((await decorateApprovals([full], u))[0]);
    }),
  );

// =====================================================================
// SYSTEM SETTINGS (+ email / sms config)
// =====================================================================
const settings = Router();
const SECRET = /(password|secret|apikey|api_key|token)$/i;
const MASK = '********';
const mask = (k: string, v: string) => (SECRET.test(k) && v ? MASK : v);
const keySchema = z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/, 'Invalid setting key');
const valSchema = z.union([z.string(), z.number(), z.boolean()]);

async function getSettings(prefix?: string) {
  const rows = await prisma.systemSetting.findMany({ where: prefix ? { key: { startsWith: prefix } } : {}, orderBy: { key: 'asc' } });
  return Object.fromEntries(rows.map((r) => [r.key, mask(r.key, r.value)]));
}
async function putSettings(entriesIn: Record<string, string | number | boolean>, user: Request['user'], onlyPrefix?: string) {
  const entries: Record<string, string> = Object.fromEntries(Object.entries(entriesIn).map(([k, v]) => [k, String(v)]));
  const keys = Object.keys(entries);
  for (const k of keys) {
    keySchema.parse(k);
    if (/^(equipment\.|reminders\.|issued\.)/.test(k)) throw badRequest('Use the equipment or reminder screen to edit these records');
    if (onlyPrefix && !k.startsWith(onlyPrefix)) throw badRequest(`Key "${k}" must start with "${onlyPrefix}"`);
  }
  await prisma.$transaction(async (tx) => {
    for (const k of keys) {
      if (SECRET.test(k) && entries[k] === MASK) continue; // unchanged secret
      await tx.systemSetting.upsert({ where: { key: k }, update: { value: entries[k] }, create: { key: k, value: entries[k] } });
    }
    await audit(tx, user, 'UPDATE', 'SystemSetting', undefined, Object.fromEntries(keys.map((k) => [k, SECRET.test(k) ? MASK : entries[k]])));
  });
}
const settingsMap = z.record(keySchema, valSchema);

settings.get('/', can('settings', 'view'), ah(async (req, res) => res.json(await getSettings(req.query.prefix ? String(req.query.prefix) : undefined))));
settings.put(
  '/',
  can('settings', 'edit'),
  ah(async (req, res) => {
    const body = parse(z.object({ settings: settingsMap }).or(settingsMap), req.body);
    const entries = 'settings' in body && typeof body.settings === 'object' && body.settings !== null && !('length' in body.settings) ? (body.settings as Record<string, string | number | boolean>) : (body as Record<string, string | number | boolean>);
    await putSettings(entries, req.user);
    res.json(await getSettings());
  }),
);

const EMAIL_DEFAULTS: Record<string, string> = { 'email.enabled': 'false', 'email.host': '', 'email.port': '587', 'email.secure': 'false', 'email.username': '', 'email.password': '', 'email.fromName': '', 'email.fromAddress': '' };
const SMS_DEFAULTS: Record<string, string> = { 'sms.enabled': 'false', 'sms.provider': '', 'sms.apiUrl': '', 'sms.apiKey': '', 'sms.senderId': '' };
for (const [name, defaults] of [['email', EMAIL_DEFAULTS], ['sms', SMS_DEFAULTS]] as const) {
  settings.get(
    `/${name}`,
    can('settings', 'view'),
    ah(async (_req, res) => res.json({ ...defaults, ...(await getSettings(`${name}.`)) })),
  );
  settings.put(
    `/${name}`,
    can('settings', 'edit'),
    ah(async (req, res) => {
      const body = parse(settingsMap, req.body);
      const entries: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(body)) entries[k.startsWith(`${name}.`) ? k : `${name}.${k}`] = v;
      const unknown = Object.keys(entries).filter((k) => !(k in defaults));
      if (unknown.length) throw badRequest('Unknown settings', unknown);
      await putSettings(entries, req.user, `${name}.`);
      res.json({ ...defaults, ...(await getSettings(`${name}.`)) });
    }),
  );
}
// config validation only: nothing is actually sent
settings.post(
  '/email/test',
  can('settings', 'edit'),
  ah(async (req, res) => {
    const to = parse(z.object({ to: z.string().trim().email().optional() }), req.body ?? {}).to;
    const c = { ...EMAIL_DEFAULTS, ...Object.fromEntries((await prisma.systemSetting.findMany({ where: { key: { startsWith: 'email.' } } })).map((r) => [r.key, r.value])) };
    const errors: string[] = [];
    if (!c['email.host']) errors.push('SMTP host is required');
    const port = Number(c['email.port']);
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('SMTP port must be 1-65535');
    if (!/^\S+@\S+\.\S+$/.test(c['email.fromAddress'])) errors.push('A valid from address is required');
    if (c['email.username'] && !c['email.password']) errors.push('Password is required when a username is set');
    await audit(prisma, req.user, 'TEST', 'EmailSettings', undefined, { ok: !errors.length, to, errors });
    console.log(`[email.test] validated config (no message sent) to=${to ?? '-'} ok=${!errors.length}`);
    res.json({ ok: !errors.length, sent: false, message: errors.length ? 'Configuration is incomplete' : 'Configuration looks valid (test mode: no email was sent)', errors });
  }),
);
settings.post(
  '/sms/test',
  can('settings', 'edit'),
  ah(async (req, res) => {
    const to = parse(z.object({ to: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, 'Invalid phone number').optional() }), req.body ?? {}).to;
    const c = { ...SMS_DEFAULTS, ...Object.fromEntries((await prisma.systemSetting.findMany({ where: { key: { startsWith: 'sms.' } } })).map((r) => [r.key, r.value])) };
    const errors: string[] = [];
    if (!c['sms.provider']) errors.push('SMS provider is required');
    if (!c['sms.apiKey']) errors.push('API key is required');
    if (!c['sms.senderId']) errors.push('Sender ID is required');
    if (c['sms.apiUrl'] && !/^https?:\/\//.test(c['sms.apiUrl'])) errors.push('API URL must start with http(s)://');
    await audit(prisma, req.user, 'TEST', 'SmsSettings', undefined, { ok: !errors.length, to, errors });
    console.log(`[sms.test] validated config (no message sent) to=${to ?? '-'} ok=${!errors.length}`);
    res.json({ ok: !errors.length, sent: false, message: errors.length ? 'Configuration is incomplete' : 'Configuration looks valid (test mode: no SMS was sent)', errors });
  }),
);
settings.get(
  '/:key',
  can('settings', 'view'),
  ah(async (req, res) => {
    const key = keySchema.parse(req.params.key);
    const r = await prisma.systemSetting.findUnique({ where: { key } });
    if (!r) throw notFound('Setting not found');
    res.json({ key, value: mask(key, r.value) });
  }),
);
settings.put(
  '/:key',
  can('settings', 'edit'),
  ah(async (req, res) => {
    const key = keySchema.parse(req.params.key);
    const { value } = parse(z.object({ value: valSchema }), req.body);
    await putSettings({ [key]: value }, req.user);
    res.json({ key, value: mask(key, String(value)) });
  }),
);
settings.delete(
  '/:key',
  can('settings', 'edit'),
  ah(async (req, res) => {
    const key = keySchema.parse(req.params.key);
    await prisma.systemSetting.deleteMany({ where: { key } });
    await audit(prisma, req.user, 'DELETE', 'SystemSetting', key);
    res.json({ ok: true });
  }),
);

// =====================================================================
// AUDIT LOGS
// =====================================================================
const auditRouter = Router();
function auditWhere(req: Request): Prisma.AuditLogWhereInput {
  const q = req.query;
  const where: Prisma.AuditLogWhereInput = {};
  if (q.entity) where.entity = String(q.entity);
  if (q.entityId) where.entityId = String(q.entityId);
  if (q.userId) where.userId = Number(q.userId);
  if (q.username) where.username = { contains: String(q.username) };
  if (q.action) where.action = String(q.action).toUpperCase();
  const dr = dateRange(q.from, q.to);
  if (dr) where.createdAt = dr;
  const s = String(q.search ?? '').trim();
  if (s) where.OR = [{ entity: { contains: s } }, { entityId: { contains: s } }, { username: { contains: s } }, { action: { contains: s } }, { details: { contains: s } }];
  return where;
}
auditRouter.get(
  '/',
  can('audit', 'view'),
  ah(async (req, res) => {
    const q = listQuery(req);
    const where = auditWhere(req);
    const sort = ['id', 'createdAt', 'username', 'entity', 'action'].includes(q.sort ?? '') ? q.sort! : 'id';
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { [sort]: q.dir }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.auditLog.count({ where }),
    ]);
    res.json(paged(rows, total, q));
  }),
);
auditRouter.get(
  '/entities',
  can('audit', 'view'),
  ah(async (_req, res) => {
    const [e, a] = await Promise.all([
      prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
      prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    ]);
    res.json({ entities: e.map((x) => x.entity), actions: a.map((x) => x.action) });
  }),
);
auditRouter.get(
  '/export',
  can('audit', 'export'),
  ah(async (req, res) => {
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
    const rows = await prisma.auditLog.findMany({ where: auditWhere(req), orderBy: { id: 'desc' }, take: 50000 });
    await sendTable(res, format, 'audit-log', ['id', 'createdAt', 'username', 'action', 'entity', 'entityId', 'details', 'ip'], rows as unknown as Record<string, unknown>[]);
  }),
);
auditRouter.get(
  '/:id',
  can('audit', 'view'),
  ah(async (req, res) => {
    const r = await prisma.auditLog.findUnique({ where: { id: intParam(req) } });
    if (!r) throw notFound();
    res.json(r);
  }),
);

// =====================================================================
// ATTACHMENTS (any authenticated user; scoped by docType/docId)
// =====================================================================
const attachDir = path.resolve(env.uploadDir, 'attachments');
fs.mkdirSync(attachDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, attachDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).slice(0, 10).replace(/[^.\w]/g, '')}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});
const attachments = Router();
attachments.post(
  '/',
  upload.single('file'),
  ah(async (req, res) => {
    const file = req.file;
    try {
      const body = parse(z.object({ docType: z.string().trim().min(1).max(50), docId: z.coerce.number().int().positive() }), req.body);
      if (!file) throw badRequest('file is required (multipart field "file")');
      const row = await prisma.attachment.create({
        data: { docType: body.docType.toUpperCase(), docId: body.docId, fileName: path.basename(Buffer.from(file.originalname, 'latin1').toString('utf8')), filePath: file.filename, mimeType: file.mimetype, size: file.size, uploadedBy: req.user!.id },
      });
      await audit(prisma, req.user, 'UPLOAD', 'Attachment', row.id, { docType: row.docType, docId: row.docId, fileName: row.fileName });
      res.status(201).json(row);
    } catch (e) {
      if (file) fs.promises.unlink(file.path).catch(() => undefined);
      throw e;
    }
  }),
);
attachments.get(
  '/',
  ah(async (req, res) => {
    const docType = String(req.query.docType ?? '').toUpperCase();
    const docId = Number(req.query.docId);
    if (!docType || !Number.isInteger(docId)) throw badRequest('docType and docId are required');
    const rows = await prisma.attachment.findMany({ where: { docType, docId }, orderBy: { id: 'desc' } });
    const ids = [...new Set(rows.map((r) => r.uploadedBy).filter((x): x is number => !!x))];
    const us = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } }) : [];
    const um = new Map(us.map((u) => [u.id, u.username]));
    res.json(rows.map((r) => ({ ...r, filePath: undefined, uploadedByName: r.uploadedBy ? um.get(r.uploadedBy) ?? null : null })));
  }),
);
attachments.get(
  '/:id/download',
  ah(async (req, res) => {
    const a = await prisma.attachment.findUnique({ where: { id: intParam(req) } });
    if (!a) throw notFound('Attachment not found');
    const full = path.resolve(attachDir, path.basename(a.filePath));
    if (!full.startsWith(attachDir) || !fs.existsSync(full)) throw notFound('File is missing on disk');
    res.download(full, a.fileName);
  }),
);
attachments.delete(
  '/:id',
  ah(async (req, res) => {
    const id = intParam(req);
    const a = await prisma.attachment.findUnique({ where: { id } });
    if (!a) throw notFound('Attachment not found');
    const u = req.user!;
    if (u.role !== 'Admin' && a.uploadedBy !== u.id) throw forbidden('Only the uploader or an administrator can delete this attachment');
    await prisma.attachment.delete({ where: { id } });
    fs.promises.unlink(path.resolve(attachDir, path.basename(a.filePath))).catch(() => undefined);
    await audit(prisma, u, 'DELETE', 'Attachment', id, { docType: a.docType, docId: a.docId, fileName: a.fileName });
    res.json({ ok: true });
  }),
);

// =====================================================================
// FAVORITES (per user)
// =====================================================================
const favorites = Router();
favorites.get('/', ah(async (req, res) => res.json(await prisma.favorite.findMany({ where: { userId: req.user!.id }, orderBy: { id: 'asc' } }))));
favorites.post(
  '/',
  ah(async (req, res) => {
    const d = parse(z.object({ label: z.string().trim().min(1).max(200), route: z.string().trim().min(1).max(500) }), req.body);
    const row = await prisma.favorite.upsert({ where: { userId_route: { userId: req.user!.id, route: d.route } }, update: { label: d.label }, create: { ...d, userId: req.user!.id } });
    res.status(201).json(row);
  }),
);
favorites.delete(
  '/:id',
  ah(async (req, res) => {
    const r = await prisma.favorite.deleteMany({ where: { id: intParam(req), userId: req.user!.id } });
    if (!r.count) throw notFound('Favorite not found');
    res.json({ ok: true });
  }),
);

// =====================================================================
// IMPORT / EXPORT
// =====================================================================
const entityOf = (req: Request): Entity => {
  const e = String(req.params.entity);
  if (!(ENTITIES as readonly string[]).includes(e)) throw badRequest(`Unsupported entity "${e}"`, { allowed: ENTITIES });
  return e as Entity;
};
const importRouter = Router();
importRouter.get(
  '/:entity/template',
  can('import_export', 'view'),
  ah(async (req, res) => {
    const e = entityOf(req);
    await sendTable(res, req.query.format === 'xlsx' ? 'xlsx' : 'csv', `${e}-import-template`, EXPORT_COLUMNS[e], [SAMPLE_ROW[e]]);
  }),
);
importRouter.post(
  '/:entity',
  can('import_export', 'create'),
  ah(async (req, res) => {
    const e = entityOf(req);
    const b = parse(
      z.object({
        rows: z.array(z.record(z.unknown())).optional(),
        csv: z.string().max(20_000_000).optional(),
        dryRun: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
        updateExisting: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
      }),
      req.body,
    );
    const rows = b.rows ?? (b.csv ? parseCsv(b.csv) : undefined);
    if (!rows || !rows.length) throw badRequest('Provide "rows" (JSON array) or "csv" (text with a header row)');
    const dryRun = b.dryRun === true || b.dryRun === 'true' || req.query.dryRun === 'true';
    const updateExisting = b.updateExisting === true || b.updateExisting === 'true' || req.query.updateExisting === 'true';
    res.json(await runImport(e, rows, { dryRun, updateExisting, user: req.user }));
  }),
);
const exportRouter = Router();
exportRouter.get(
  '/:entity',
  can('import_export', 'export'),
  ah(async (req, res) => {
    const e = entityOf(req);
    const rows = await exportRows(e, req.query.search ? String(req.query.search) : undefined, req.query.isActive !== undefined && req.query.isActive !== '' ? req.query.isActive === 'true' : undefined);
    await audit(prisma, req.user, 'EXPORT', e, undefined, { rows: rows.length });
    await sendTable(res, req.query.format === 'xlsx' ? 'xlsx' : 'csv', e, EXPORT_COLUMNS[e], rows);
  }),
);

// =====================================================================
// BACKUP (admin only) — JSON dump of all tables except secrets
// =====================================================================
const backupDir = path.resolve(__dirname, '..', '..', 'backups');
const FILE_RE = /^backup-\d{8}-\d{6}(-[a-z0-9]+)?\.json$/;
const SKIP_MODELS = new Set(['RefreshToken']);
const OMIT_FIELDS: Record<string, string[]> = { User: ['passwordHash'] };
const backup = Router();
backup.use(adminOnly);
backup.post(
  '/',
  can('backup', 'create'),
  ah(async (req, res) => {
    fs.mkdirSync(backupDir, { recursive: true });
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const name = `backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
    const file = path.join(backupDir, name);
    const fd = fs.openSync(file, 'w');
    const w = (s: string) => fs.writeSync(fd, s);
    const counts: Record<string, number> = {};
    try {
      w(`{"meta":${JSON.stringify({ app: 'SmartSpare ERP', createdAt: now.toISOString(), createdBy: req.user!.username, note: 'passwordHash and refresh tokens are excluded' })},"tables":{`);
      let first = true;
      for (const m of Prisma.dmmf.datamodel.models) {
        if (SKIP_MODELS.has(m.name)) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = (prisma as any)[m.name.charAt(0).toLowerCase() + m.name.slice(1)];
        if (!d) continue;
        const hasId = m.fields.some((f) => f.name === 'id');
        const omit = OMIT_FIELDS[m.name] ?? [];
        w(`${first ? '' : ','}${JSON.stringify(m.name)}:[`);
        first = false;
        let n = 0;
        let cursor: number | undefined;
        for (;;) {
          const batch: Record<string, unknown>[] = hasId
            ? await d.findMany({ orderBy: { id: 'asc' }, take: 2000, ...(cursor !== undefined ? { where: { id: { gt: cursor } } } : {}) })
            : await d.findMany();
          for (const row of batch) {
            for (const f of omit) delete row[f];
            w(`${n ? ',' : ''}${JSON.stringify(row)}`);
            n++;
          }
          if (!hasId || batch.length < 2000) break;
          cursor = batch[batch.length - 1].id as number;
        }
        w(']');
        counts[m.name] = n;
      }
      w('}}');
    } finally {
      fs.closeSync(fd);
    }
    const st = fs.statSync(file);
    await audit(prisma, req.user, 'BACKUP', 'System', name, { size: st.size, tables: Object.keys(counts).length });
    res.status(201).json({ file: name, size: st.size, createdAt: now.toISOString(), tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0), counts });
  }),
);
backup.get(
  '/',
  can('backup', 'view'),
  ah(async (_req, res) => {
    if (!fs.existsSync(backupDir)) return res.json([]);
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => FILE_RE.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(backupDir, f));
        return { file: f, size: st.size, createdAt: st.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(files);
  }),
);
backup.get(
  '/:file',
  can('backup', 'view'),
  ah(async (req, res) => {
    const f = String(req.params.file);
    if (!FILE_RE.test(f)) throw badRequest('Invalid backup file name');
    const full = path.join(backupDir, f);
    if (!fs.existsSync(full)) throw notFound('Backup not found');
    res.download(full, f);
  }),
);
backup.delete(
  '/:file',
  can('backup', 'delete'),
  ah(async (req, res) => {
    const f = String(req.params.file);
    if (!FILE_RE.test(f)) throw badRequest('Invalid backup file name');
    const full = path.join(backupDir, f);
    if (!fs.existsSync(full)) throw notFound('Backup not found');
    fs.unlinkSync(full);
    await audit(prisma, req.user, 'DELETE', 'Backup', f);
    res.json({ ok: true });
  }),
);

void toCsv;
export default [
  { path: '/users', router: users },
  { path: '/roles', router: roles },
  { path: '/permissions', router: catalog },
  { path: '/numbering', router: numbering },
  { path: '/approval-rules', router: approvalRules },
  { path: '/approvals', router: approvals },
  { path: '/settings', router: settings },
  { path: '/audit-logs', router: auditRouter },
  { path: '/attachments', router: attachments },
  { path: '/favorites', router: favorites },
  { path: '/import', router: importRouter },
  { path: '/export', router: exportRouter },
  { path: '/backup', router: backup },
] satisfies ModuleDef[];
