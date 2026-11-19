import { Router } from 'express';
import { ah } from '../lib/http';
import { prisma } from '../lib/prisma';
import type { ModuleDef } from '../app';
const router = Router();
// Authenticated users need to know when figures are fictional, regardless of their module permissions.
router.get('/', ah(async (_req, res) => {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'demo.fortune7.activity.v1' } });
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ active: !!setting, label: 'DEMO DATA', description: 'Fictional costs, stock, customers and transactions for presentation.' });
}));
export default [{ path: '/demo-status', router }] satisfies ModuleDef[];
