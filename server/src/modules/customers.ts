import { revisionSnapshot, auditRevision } from '../services/revisions-history';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, intParam, listQuery, paged, parse } from '../lib/http';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import { badRequest, notFound } from '../lib/errors';
import { customerBalance } from '../services/accounting';
import { nextCode, dimensionMaps } from '../services/admin-master';
import { num, r2 } from '../lib/calc';
import type { ModuleDef } from '../app';

const PERM = 'customers';
const opt = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v === '' ? null : v));
const optId = z.coerce.number().int().positive().nullish();

export const customerSchema = z.object({
  code: z.string().trim().max(40).optional(),
  name: z.string().trim().min(1).max(200),
  arabicName: opt,
  trn: opt,
  contactPerson: opt,
  phone: opt,
  mobile: opt,
  email: z
    .string()
    .trim()
    .email()
    .nullish()
    .or(z.literal('').transform(() => null)),
  address: opt,
  city: opt,
  country: opt,
  paymentTermId: optId,
  creditLimit: z.coerce.number().min(0).optional(),
  currencyCode: z.string().trim().min(2).max(10).optional(),
  salesmanId: optId,
  territoryId: optId,
  areaId: optId,
  vatCategory: z.enum(['TAXABLE', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE']).optional(),
  openingBalance: z.coerce.number().optional(),
  isActive: z.boolean().optional(),
});

async function decorate<T extends { id: number; paymentTermId: number | null; salesmanId: number | null; territoryId: number | null; areaId: number | null; creditLimit: unknown }>(rows: T[], withBalance = true) {
  const m = await dimensionMaps();
  const balances = new Map<number, number>();
  if (withBalance && rows.length) {
    const ar = await prisma.account.findUnique({ where: { systemKey: 'AR' } });
    if (ar) {
      const agg = await prisma.journalLine.groupBy({
        by: ['partyId'],
        where: { accountId: ar.id, partyType: 'CUSTOMER', partyId: { in: rows.map((r) => r.id) } },
        _sum: { debit: true, credit: true },
      });
      for (const a of agg) balances.set(a.partyId!, num(a._sum.debit) - num(a._sum.credit));
    }
  }
  return rows.map((r) => {
    const opening = num((r as unknown as { openingBalance: unknown }).openingBalance);
    const balance = withBalance ? r2(opening + (balances.get(r.id) ?? 0)) : undefined;
    return {
      ...r,
      paymentTerm: r.paymentTermId ? m.term.get(r.paymentTermId) ?? null : null,
      salesman: r.salesmanId ? { id: r.salesmanId, name: m.salesman.get(r.salesmanId) ?? null } : null,
      territory: r.territoryId ? { id: r.territoryId, name: m.territory.get(r.territoryId) ?? null } : null,
      area: r.areaId ? { id: r.areaId, name: m.area.get(r.areaId) ?? null } : null,
      paymentTermName: r.paymentTermId ? m.term.get(r.paymentTermId)?.name ?? null : null,
      salesmanName: r.salesmanId ? m.salesman.get(r.salesmanId) ?? null : null,
      territoryName: r.territoryId ? m.territory.get(r.territoryId) ?? null : null,
      areaName: r.areaId ? m.area.get(r.areaId) ?? null : null,
      ...(withBalance ? { balance, availableCredit: r2(num(r.creditLimit) - (balance ?? 0)) } : {}),
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
    if (q.search)
      where.OR = ['code', 'name', 'arabicName', 'trn', 'phone', 'mobile', 'email', 'contactPerson'].map((f) => ({ [f]: { contains: q.search } }));
    if (req.query.isActive !== undefined && req.query.isActive !== '') where.isActive = req.query.isActive === 'true';
    for (const f of ['salesmanId', 'territoryId', 'areaId', 'paymentTermId']) if (req.query[f]) where[f] = Number(req.query[f]);
    if (req.query.country) where.country = String(req.query.country);
    const sortable = ['id', 'code', 'name', 'city', 'country', 'creditLimit', 'createdAt'];
    const sort = sortable.includes(q.sort ?? '') ? q.sort! : 'code';
    const [rows, total] = await Promise.all([
      prisma.customer.findMany({ where, orderBy: { [sort]: q.sort ? q.dir : 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.customer.count({ where }),
    ]);
    res.json(paged(await decorate(rows), total, q));
  }),
);

r.get(
  '/:id',
  can(PERM, 'view'),
  ah(async (req, res) => {
    const row = await prisma.customer.findUnique({ where: { id: intParam(req) } });
    if (!row) throw notFound('Customer not found');
    res.json((await decorate([row]))[0]);
  }),
);

r.get(
  '/:id/summary',
  can(PERM, 'view'),
  ah(async (req, res) => {
    const id = intParam(req);
    const c = await prisma.customer.findUnique({ where: { id } });
    if (!c) throw notFound('Customer not found');
    const balance = await customerBalance(id);
    const now = new Date();
    const openInvWhere = { customerId: id, status: { in: ['POSTED', 'PARTIALLY_PAID'] } };
    const [openInvoices, overdue, openOrders, openQuotes, deliveriesToInvoice, invAgg, lastInvoice] = await Promise.all([
      prisma.salesInvoice.findMany({ where: openInvWhere, select: { baseTotal: true, receivedAmount: true } }),
      prisma.salesInvoice.count({ where: { ...openInvWhere, dueDate: { lt: now } } }),
      prisma.salesOrder.count({ where: { customerId: id, status: { in: ['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_DELIVERED'] } } }),
      prisma.salesQuotation.count({ where: { customerId: id, status: { in: ['DRAFT', 'SENT', 'ACCEPTED'] } } }),
      prisma.deliveryNote.count({ where: { customerId: id, status: 'POSTED', invoiced: false } }),
      prisma.salesInvoice.aggregate({ where: { customerId: id, status: { not: 'CANCELLED' } }, _sum: { baseTotal: true }, _count: { _all: true } }),
      prisma.salesInvoice.findFirst({ where: { customerId: id, status: { not: 'DRAFT' } }, orderBy: { docDate: 'desc' }, select: { id: true, docNo: true, docDate: true, total: true } }),
    ]);
    const outstanding = r2(openInvoices.reduce((s, i) => s + num(i.baseTotal) - num(i.receivedAmount), 0));
    const creditLimit = num(c.creditLimit);
    res.json({
      customerId: id,
      code: c.code,
      name: c.name,
      balance,
      creditLimit,
      availableCredit: r2(creditLimit - balance),
      creditExceeded: creditLimit > 0 && balance > creditLimit,
      openInvoices: openInvoices.length,
      openInvoicesAmount: outstanding,
      overdueInvoices: overdue,
      openOrders,
      openQuotations: openQuotes,
      deliveriesAwaitingInvoice: deliveriesToInvoice,
      totalInvoices: invAgg._count._all,
      totalSales: r2(num(invAgg._sum.baseTotal)),
      lastInvoice,
    });
  }),
);

r.post(
  '/',
  can(PERM, 'create'),
  ah(async (req, res) => {
    const d = parse(customerSchema, req.body);
    const row = await prisma.$transaction(
      async (tx) => {
        const code = d.code || (await nextCode(tx, 'customer', 'C', 4));
        return tx.customer.create({ data: { ...d, code } });
      },
      { timeout: 30000 },
    );
    await audit(prisma, req.user, 'CREATE', 'Customer', row.id, d);
    res.status(201).json((await decorate([row]))[0]);
  }),
);

r.put(
  '/:id',
  can(PERM, 'edit'),
  ah(async (req, res) => {
    const id = intParam(req);
    const d = parse(customerSchema.partial(), req.body);
    if (d.code === '') delete d.code;
    const row = await prisma.$transaction(async tx => {
      const before = await revisionSnapshot(tx, 'Customer', id);
      const row = await tx.customer.update({ where: { id }, data: d });
      await auditRevision(tx, req.user, 'Customer', id, before, req.body?.changeReason);
      await audit(tx, req.user, 'UPDATE', 'Customer', id, d);
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
    const c = await prisma.customer.findUnique({ where: { id } });
    if (!c) throw notFound('Customer not found');
    const used =
      (await prisma.salesInvoice.count({ where: { customerId: id } })) +
      (await prisma.salesOrder.count({ where: { customerId: id } })) +
      (await prisma.salesQuotation.count({ where: { customerId: id } })) +
      (await prisma.deliveryNote.count({ where: { customerId: id } })) +
      (await prisma.journalLine.count({ where: { partyType: 'CUSTOMER', partyId: id } })) +
      (await prisma.voucher.count({ where: { partyType: 'CUSTOMER', partyId: id } }));
    if (used > 0) {
      await prisma.customer.update({ where: { id }, data: { isActive: false } });
      await audit(prisma, req.user, 'DEACTIVATE', 'Customer', id, { reason: 'has transactions' });
      return res.json({ ok: true, deactivated: true, message: 'Customer has transactions and was deactivated instead of deleted' });
    }
    await prisma.customer.delete({ where: { id } });
    await audit(prisma, req.user, 'DELETE', 'Customer', id);
    res.json({ ok: true, deleted: true });
  }),
);

void badRequest;
export default [{ path: '/customers', router: r }] satisfies ModuleDef[];
