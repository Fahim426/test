import { revisionSnapshot, auditRevision } from '../services/revisions-history';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, intParam, listQuery, paged, parse } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import { nextNumber } from '../services/numbering';
import type { ModuleDef } from '../app';

const router = Router();

const num = (v: unknown) => Number(v ?? 0);

const visitSchema = z.object({
  visitNo: z.coerce.number().int().min(1),
  scheduledDate: z.string(),
  completedDate: z.string().nullish(),
  visitType: z.enum(['PREVENTIVE', 'CORRECTIVE', 'EMERGENCY']).default('PREVENTIVE'),
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('SCHEDULED'),
  technicianName: z.string().trim().max(200).nullish(),
  findings: z.string().trim().max(2000).nullish(),
  partsUsed: z.string().trim().max(2000).nullish(),
});

const contractSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  productId: z.coerce.number().int().positive().nullish(),
  equipmentDesc: z.string().trim().max(500).nullish(),
  serialNo: z.string().trim().max(200).nullish(),
  contractType: z.enum(['COMPREHENSIVE', 'LABOUR_ONLY', 'PARTS_ONLY']).default('COMPREHENSIVE'),
  startDate: z.string(),
  endDate: z.string(),
  amount: z.coerce.number().min(0).default(0),
  vatRate: z.coerce.number().min(0).max(100).default(5),
  visitCount: z.coerce.number().int().min(0).default(4),
  status: z.enum(['DRAFT', 'ACTIVE', 'EXPIRED', 'RENEWED', 'CANCELLED']).default('DRAFT'),
  salesmanId: z.coerce.number().int().positive().nullish(),
  notes: z.string().trim().max(2000).nullish(),
  visits: z.array(visitSchema).optional(),
});

const include = {
  customer: { select: { id: true, code: true, name: true, phone: true, email: true } },
  product: { select: { id: true, code: true, name: true } },
  visits: { orderBy: { visitNo: 'asc' as const } },
};

/* ── LIST ── */
router.get('/', can('amc', 'view'), ah(async (req, res) => {
  const q = listQuery(req);
  const where: Record<string, unknown> = {};
  if (q.search) {
    where.OR = [
      { contractNo: { contains: q.search } },
      { customer: { name: { contains: q.search } } },
      { equipmentDesc: { contains: q.search } },
      { serialNo: { contains: q.search } },
    ];
  }
  if (req.query.status) where.status = req.query.status;
  if (req.query.customerId) where.customerId = Number(req.query.customerId);
  if (req.query.expiring === 'true') {
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    where.endDate = { lte: soon };
    where.status = 'ACTIVE';
  }
  const sort = q.sort ?? 'id';
  const [rows, total] = await Promise.all([
    prisma.amcContract.findMany({
      where,
      include: { customer: { select: { id: true, code: true, name: true } }, product: { select: { id: true, code: true, name: true } }, visits: { select: { id: true, status: true } } },
      orderBy: { [sort]: q.dir },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.amcContract.count({ where }),
  ]);
  const enriched = rows.map((r) => ({
    ...r,
    visitsDone: r.visits.filter((v) => v.status === 'COMPLETED').length,
    visitsTotal: r.visits.length,
  }));
  res.json(paged(enriched, total, q));
}));

/* ── GET ── */
router.get('/:id', can('amc', 'view'), ah(async (req, res) => {
  const row = await prisma.amcContract.findUnique({ where: { id: intParam(req) }, include });
  if (!row) throw notFound();
  res.json(row);
}));

/* ── CREATE ── */
router.post('/', can('amc', 'create'), ah(async (req, res) => {
  const data = parse(contractSchema, req.body);
  const { visits, amount, vatRate, ...rest } = data;
  const vatAmount = Math.round(num(amount) * num(vatRate)) / 100;
  const total = num(amount) + vatAmount;
  const row = await prisma.$transaction(async (tx) => {
    const contractNo = await nextNumber(tx, 'AMC_CONTRACT', { date: new Date(rest.startDate) });
    const contract = await tx.amcContract.create({
      data: { ...rest, contractNo, amount, vatRate, vatAmount, total, createdBy: req.user?.id },
    });
    if (visits?.length) {
      await tx.amcVisit.createMany({
        data: visits.map((v) => ({ ...v, contractId: contract.id, scheduledDate: new Date(v.scheduledDate), completedDate: v.completedDate ? new Date(v.completedDate) : null })),
      });
    }
    return tx.amcContract.findUniqueOrThrow({ where: { id: contract.id }, include });
  });
  await audit(prisma, req.user, 'CREATE', 'amcContract', row.id, { contractNo: row.contractNo });
  res.status(201).json(row);
}));

/* ── UPDATE ── */
router.put('/:id', can('amc', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const existing = await prisma.amcContract.findUnique({ where: { id } });
  if (!existing) throw notFound();
  const data = parse(contractSchema, req.body);
  const { visits, amount, vatRate, ...rest } = data;
  const vatAmount = Math.round(num(amount) * num(vatRate)) / 100;
  const total = num(amount) + vatAmount;
  const row = await prisma.$transaction(async (tx) => {
    const revisionBefore = await revisionSnapshot(tx, 'AmcContract', id);
    const contract = await tx.amcContract.update({
      where: { id },
      data: { ...rest, amount, vatRate, vatAmount, total },
    });
    if (visits !== undefined) {
      await tx.amcVisit.deleteMany({ where: { contractId: id } });
      if (visits.length) {
        await tx.amcVisit.createMany({
          data: visits.map((v) => ({ ...v, contractId: contract.id, scheduledDate: new Date(v.scheduledDate), completedDate: v.completedDate ? new Date(v.completedDate) : null })),
        });
      }
    }
    await auditRevision(tx, req.user, 'AmcContract', id, revisionBefore, req.body?.changeReason);
    return tx.amcContract.findUniqueOrThrow({ where: { id }, include });
  });
  await audit(prisma, req.user, 'UPDATE', 'amcContract', id, { contractNo: row.contractNo });
  res.json(row);
}));

/* ── DELETE ── */
router.delete('/:id', can('amc', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  const existing = await prisma.amcContract.findUnique({ where: { id } });
  if (!existing) throw notFound();
  if (existing.status === 'ACTIVE') throw badRequest('Cannot delete an ACTIVE contract. Cancel it first.');
  await prisma.amcContract.delete({ where: { id } });
  await audit(prisma, req.user, 'DELETE', 'amcContract', id, { contractNo: existing.contractNo });
  res.json({ ok: true });
}));

/* ── REPORT: expiring contracts ── */
router.get('/reports/expiring', can('amc', 'view'), ah(async (req, res) => {
  const days = Number(req.query.days) || 30;
  const soon = new Date();
  soon.setDate(soon.getDate() + days);
  const rows = await prisma.amcContract.findMany({
    where: { status: 'ACTIVE', endDate: { lte: soon } },
    include: { customer: { select: { id: true, code: true, name: true, phone: true, email: true } } },
    orderBy: { endDate: 'asc' },
  });
  res.json(rows);
}));

/* ── REPORT: summary stats ── */
router.get('/reports/summary', can('amc', 'view'), ah(async (req, res) => {
  const [total, active, expiring, expired] = await Promise.all([
    prisma.amcContract.count(),
    prisma.amcContract.count({ where: { status: 'ACTIVE' } }),
    (() => {
      const soon = new Date(); soon.setDate(soon.getDate() + 30);
      return prisma.amcContract.count({ where: { status: 'ACTIVE', endDate: { lte: soon } } });
    })(),
    prisma.amcContract.count({ where: { status: 'EXPIRED' } }),
  ]);
  const revenue = await prisma.amcContract.aggregate({ _sum: { total: true }, where: { status: { in: ['ACTIVE', 'RENEWED'] } } });
  res.json({ total, active, expiring, expired, activeRevenue: Number(revenue._sum.total ?? 0) });
}));

export default [{ path: '/amc', router }] satisfies ModuleDef[];
