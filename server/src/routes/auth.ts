import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env } from '../lib/env';
import { ah, parse } from '../lib/http';
import { unauthorized } from '../lib/errors';
import { authenticate, loadPermissions, signAccess, signRefresh } from '../middleware/auth';
import { audit } from '../services/audit';

const r = Router();
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

async function issueTokens(user: { id: number; username: string }) {
  const jti = crypto.randomUUID();
  const refresh = signRefresh(user, jti);
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: hash(refresh), expiresAt: new Date(Date.now() + 7 * 864e5) },
  });
  return { accessToken: signAccess(user), refreshToken: refresh };
}

async function profile(userId: number) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true } });
  const perms = u.role.name === 'Admin' ? ['*'] : [...(await loadPermissions(u.roleId))];
  const bu = u.businessUnitId ? await prisma.businessUnit.findUnique({ where: { id: u.businessUnitId }, select: { id: true, code: true, name: true } }) : null;
  return { id: u.id, username: u.username, fullName: u.fullName, email: u.email, role: u.role.name, branchId: u.branchId, businessUnitId: u.businessUnitId, businessUnit: bu, permissions: perms };
}

r.post(
  '/login',
  ah(async (req, res) => {
    const { username, password } = parse(z.object({ username: z.string(), password: z.string() }), req.body);
    const u = await prisma.user.findUnique({ where: { username } });
    if (!u || !u.isActive || !(await bcrypt.compare(password, u.passwordHash))) throw unauthorized('Invalid username or password');
    await prisma.user.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } });
    await audit(prisma, { id: u.id, username: u.username }, 'LOGIN', 'User', u.id);
    res.json({ ...(await issueTokens(u)), user: await profile(u.id) });
  }),
);

r.post(
  '/refresh',
  ah(async (req, res) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string() }), req.body);
    let payload: { sub: number };
    try {
      payload = jwt.verify(refreshToken, env.jwtRefreshSecret) as unknown as { sub: number };
    } catch {
      throw unauthorized('Invalid refresh token');
    }
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hash(refreshToken) } });
    if (!row || row.revoked || row.expiresAt < new Date()) throw unauthorized('Refresh token revoked or expired');
    const user = await prisma.user.findUnique({ where: { id: Number(payload.sub) } });
    if (!user || !user.isActive) throw unauthorized('User inactive');
    await prisma.refreshToken.update({ where: { id: row.id }, data: { revoked: true } }); // rotate
    res.json(await issueTokens(user));
  }),
);

r.post(
  '/logout',
  ah(async (req, res) => {
    const t = req.body?.refreshToken as string | undefined;
    if (t) await prisma.refreshToken.updateMany({ where: { tokenHash: hash(t) }, data: { revoked: true } });
    res.json({ ok: true });
  }),
);

r.get(
  '/me',
  authenticate,
  ah(async (req, res) => {
    res.json(await profile(req.user!.id));
  }),
);

r.post(
  '/change-password',
  authenticate,
  ah(async (req, res) => {
    const { oldPassword, newPassword } = parse(z.object({ oldPassword: z.string(), newPassword: z.string().min(6) }), req.body);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await bcrypt.compare(oldPassword, u.passwordHash))) throw unauthorized('Old password incorrect');
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
    res.json({ ok: true });
  }),
);

export default r;
