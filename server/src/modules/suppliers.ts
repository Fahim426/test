import { revisionSnapshot, auditRevision } from '../services/revisions-history';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, intParam, listQuery, paged, parse } from '../lib/http';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import { notFound } from '../lib/errors';
import { supplierBalance } from '../services/accounting';
import { nextCode, dimensionMaps } from '../services/admin-master';
import { num, r2 } from '../lib/calc';
import type { ModuleDef } from '../app';

const PERM = 'suppliers';
const opt = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => (v === '' ? null : v));
const optId = z.coerce.number().int().positive().nullish();

export const supplierSchema = z.object({
  code: z.string().trim().max(40).optional(),
  name: z.string().trim().min(1).max(200),
  country: opt,
  contactPerson: opt,
  phone: opt,
  email: z
    .string()
    .trim()
    .email()
    .nullish()
    .or(z.literal('').transform(() => null)),
  address: opt,
  currencyCode: z.string().trim().min(2).max(10).optional(),
  paymentTermId: optId,
  vatCategory: z.enum(['TAXABLE', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE']).optional(),
  trn: opt,
  creditLimit: z.coerce.number().min(0).optional(),
  openingBalance: z.coerce.number().optional(),
  bankDetails: opt,
  isActive: z.boolean().optional(),
});

async function decorate<T extends { id: number; paymentTermId: number | null; creditLimit: unknown }>(rows: T[]) {
  const m = await dimensionMaps();
  const balances = new Map<number, number>();
  if (rows.length) {
    const ap = await prisma.account.findUnique({ where: { systemKey: 'AP' } });
    if (ap) {
      const agg = await prisma.journalLine.groupBy({
        by: ['partyId'],
        where: { accountId: ap.id, partyType: 'SUPPLIER', partyId: { in: rows.map((r) => r.id) } },
        _sum: { debit: true, credit: true },
      });
      for (const a of agg) balances.set(a.partyId!, num(a._sum.credit) - num(a._sum.debit));
    }
  }
  return rows.map((r) => {
    const balance = r2(num((r as unknown as { openingBalance: unknown }).openingBalance) + (balances.get(r.id) ?? 0));
    return {
      ...r,
      paymentTerm: r.paymentTermId ? m.term.get(r.paymentTermId) ?? null : null,
      paymentTermName: r.paymentTermId ? m.term.get(r.paymentTermId)?.name ?? null : null,
      balance,
      availableCredit: r2(num(r.creditLimit) - balance),
    };
  });
}

const r = Router();

r.get(
  '/',
  can(PERM, 'view'),
  ah(async (req, res) => {
    const q = listQuery(req);
    const where: Record<string, unknown> = {};
    if (q.search) where.OR = ['code', 'name', 'country', 'trn', 'phone', 'email', 'contactPerson'].map((f) => ({ [f]: { contains: q.search } }));
    if (req.query.isActive !== undefined && req.query.isActive !== '') where.isActive = req.query.isActive === 'true';
    if (req.query.paymentTermId) where.paymentTermId = Number(req.query.paymentTermId);
    if (req.query.country) where.country = String(req.query.country);
    const sortable = ['id', 'code', 'name', 'country', 'creditLimit', 'createdAt'];
    const sort = sortable.includes(q.sort ?? '') ? q.sort! : 'code';
    const [rows, total] = await Promise.all([
      prisma.supplier.findMany({ where, orderBy: { [sort]: q.sort ? q.dir : 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.supplier.count({ where }),
    ]);
    res.json(paged(await decorate(rows), total, q));
  }),
);

r.get(
  '/:id',
  can(PERM, 'view'),
  ah(async (req, res) => {
    const row = await prisma.supplier.findUnique({ where: { id: intParam(req) } });
    if (!row) throw notFound('Supplier not found');
    res.json((await decorate([row]))[0]);
  }),
);

r.get(
  '/:id/summary',
  can(PERM, 'view'),
  ah(async (req, res) => {
    const id = intParam(req);
    const s = await prisma.supplier.findUnique({ where: { id } });
    if (!s) throw notFound('Supplier not found');
    const balance = await supplierBalance(id);
    const now = new Date();
    const openInvWhere = { supplierId: id, status: { in: ['POSTED', 'PARTIALLY_PAID'] } };
    const [openInvoices, overdue, openOrders, grnsNotInvoiced, invAgg, lastPo] = await Promise.all([
      prisma.purchaseInvoice.findMany({ where: openInvWhere, select: { baseTotal: true, paidAmount: true } }),
      prisma.purchaseInvoice.count({ where: { ...openInvWhere, dueDate: { lt: now } } }),
      prisma.purchaseOrder.count({ where: { supplierId: id, status: { in: ['SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'CONFIRMED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS'] } } }),
      prisma.goodsReceipt.count({ where: { supplierId: id, status: 'POSTED', invoiced: false } }),
      prisma.purchaseInvoice.aggregate({ where: { supplierId: id, status: { not: 'CANCELLED' } }, _sum: { baseTotal: true }, _count: { _all: true } }),
      prisma.purchaseOrder.findFirst({ where: { supplierId: id }, orderBy: { docDate: 'desc' }, select: { id: true, docNo: true, docDate: true, total: true, status: true } }),
    ]);
    const outstanding = r2(openInvoices.reduce((a, i) => a + num(i.baseTotal) - num(i.paidAmount), 0));
    const creditLimit = num(s.creditLimit);
    res.json({
      supplierId: id,
      code: s.code,
      name: s.name,
      balance,
      creditLimit,
      availableCredit: r2(creditLimit - balance),
      openInvoices: openInvoices.length,
      openInvoicesAmount: outstanding,
      overdueInvoices: overdue,
      openOrders,
      goodsReceiptsNotInvoiced: grnsNotInvoiced,
      totalInvoices: invAgg._count._all,
      totalPurchases: r2(num(invAgg._sum.baseTotal)),
      lastOrder: lastPo,
    });
  }),
);

r.post(
  '/',
  can(PERM, 'create'),
  ah(async (req, res) => {
    const d = parse(supplierSchema, req.body);
    const row = await prisma.$transaction(
      async (tx) => {
        const code = d.code || (await nextCode(tx, 'supplier', 'V', 4));
        return tx.supplier.create({ data: { ...d, code } });
      },
      { timeout: 30000 },
    );
    await audit(prisma, req.user, 'CREATE', 'Supplier', row.id, d);
    res.status(201).json((await decorate([row]))[0]);
  }),
);

r.put(
  '/:id',
  can(PERM, 'edit'),
  ah(async (req, res) => {
    const id = intParam(req);
    const d = parse(supplierSchema.partial(), req.body);
    if (d.code === '') delete d.code;
    const row = await prisma.$transaction(async tx => {
      const before = await revisionSnapshot(tx, 'Supplier', id);
      const row = await tx.supplier.update({ where: { id }, data: d });
      await auditRevision(tx, req.user, 'Supplier', id, before, req.body?.changeReason);
      await audit(tx, req.user, 'UPDATE', 'Supplier', id, d);
      return row;
    });
    res.json((await decorate([row]))[0]);
  }),
);

r.delete(
  '/:id',
  can(PERM, 'delete'),
  ah(async (req, res) => {
    const id = intParam(req);
    const s = await prisma.supplier.findUnique({ where: { id } });
    if (!s) throw notFound('Supplier not found');
    const used =
      (await prisma.purchaseOrder.count({ where: { supplierId: id } })) +
      (await prisma.purchaseInvoice.count({ where: { supplierId: id } })) +
      (await prisma.goodsReceipt.count({ where: { supplierId: id } })) +
      (await prisma.supplierQuotation.count({ where: { supplierId: id } })) +
      (await prisma.journalLine.count({ where: { partyType: 'SUPPLIER', partyId: id } })) +
      (await prisma.voucher.count({ where: { partyType: 'SUPPLIER', partyId: id } }));
    if (used > 0) {
      await prisma.supplier.update({ where: { id }, data: { isActive: false } });
      await audit(prisma, req.user, 'DEACTIVATE', 'Supplier', id, { reason: 'has transactions' });
      return res.json({ ok: true, deactivated: true, message: 'Supplier has transactions and was deactivated instead of deleted' });
    }
    await prisma.supplier.delete({ where: { id } });
    await audit(prisma, req.user, 'DELETE', 'Supplier', id);
    res.json({ ok: true, deleted: true });
  }),
);

export default [{ path: '/suppliers', router: r }] satisfies ModuleDef[];
