import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/http';
import { DOC_BY_TYPE, findDocs, hasView, permOf } from '../services/admin-docs';
import type { ModuleDef } from '../app';

const RECENT_TYPES = ['PURCHASE_ORDER', 'GOODS_RECEIPT', 'SALES_ORDER', 'SALES_INVOICE', 'PURCHASE_INVOICE', 'DELIVERY_NOTE', 'SALES_QUOTATION', 'RECEIPT_VOUCHER', 'PAYMENT_VOUCHER'];

const recent = Router();
recent.get(
  '/',
  ah(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));
    const defs = RECENT_TYPES.filter((t) => hasView(req.user, permOf(t))).map((t) => DOC_BY_TYPE.get(t)!);
    const lists = await Promise.all(defs.map((d) => findDocs(d, { take: limit, orderBy: 'createdAt' })));
    const all = lists.flat();
    all.sort((a, b) => +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0) || b.id - a.id);
    res.json(all.slice(0, limit));
  }),
);

const pending = Router();
pending.get(
  '/',
  ah(async (req, res) => {
    const u = req.user!;
    const rows = await prisma.approvalRequest.findMany({ where: { status: 'PENDING' }, select: { steps: true, currentStep: true } });
    const total = rows.length;
    const mine = rows.filter((r) => {
      try {
        const steps: string[] = JSON.parse(r.steps);
        return u.role === 'Admin' || steps[r.currentStep] === u.role;
      } catch {
        return false;
      }
    }).length;
    res.json({ count: mine, mine, total });
  }),
);

export default [
  { path: '/recent-documents', router: recent },
  { path: '/pending-approvals-count', router: pending },
] satisfies ModuleDef[];
