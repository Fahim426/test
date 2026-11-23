import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma, Tx } from '../lib/prisma';
import { ah, intParam, listQuery, parse, paged } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { num, r2 } from '../lib/calc';
import { postJournal, reverseJournal, accountIdByKey, JournalLineInput } from '../services/accounting';
import { nextNumber } from '../services/numbering';
import { audit } from '../services/audit';
import { assertCan, hasCan, partyNames, qDate, qInt, SALES_OPEN } from '../services/finance-common';
import type { ModuleDef } from '../app';

type VType = 'RECEIPT' | 'PAYMENT';
const permFor = (t: string) => (t === 'RECEIPT' ? 'receipts' : 'payments');
const EPS = 0.005;

const allocSchema = z.object({
  docType: z.enum(['SALES_INVOICE', 'PURCHASE_INVOICE', 'PURCHASE_ORDER']),
  docId: z.number().int(),
  amount: z.number().positive(),
});
const voucherSchema = z.object({
  voucherType: z.enum(['RECEIPT', 'PAYMENT']).optional(),
  mode: z.enum(['CASH', 'BANK']).default('BANK'),
  voucherDate: z.coerce.date(),
  partyType: z.enum(['CUSTOMER', 'SUPPLIER', 'OTHER']),
  partyId: z.number().int().optional().nullable(),
  accountId: z.number().int().optional().nullable(), // cash / bank account
  counterAccountId: z.number().int().optional().nullable(), // OTHER party
  amount: z.number().positive(),
  bankCharges: z.number().min(0).optional(),
  reference: z.string().optional().nullable(),
  narration: z.string().optional().nullable(),
  allocations: z.array(allocSchema).optional(),
});

async function resolveCashAccount(tx: Tx, mode: 'CASH' | 'BANK', accountId?: number | null) {
  if (!accountId) {
    const key = mode === 'CASH' ? 'CASH' : 'BANK';
    return accountIdByKey(tx, key);
  }
  const a = await tx.account.findUnique({ where: { id: accountId } });
  if (!a) throw badRequest('Cash/bank account not found');
  if (a.isGroup) throw badRequest('Cash/bank account cannot be a group');
  if (!a.isBank && a.systemKey !== 'CASH') throw badRequest('Account must be a bank account or the cash account');
  if (!a.isActive) throw badRequest('Account is inactive');
  if (mode === 'CASH' && a.isBank) throw badRequest('Mode CASH requires the cash account; use mode BANK for bank accounts');
  return a.id;
}

function invoiceStatus(received: number, total: number, current: string) {
  if (['DRAFT', 'CANCELLED'].includes(current)) return current;
  if (received <= EPS) return 'POSTED';
  return received >= total - EPS ? 'PAID' : 'PARTIALLY_PAID';
}

/** outstanding sales invoices for a customer (base currency) */
async function openSalesInvoices(customerId?: number, tx: Tx | typeof prisma = prisma) {
  const list = await tx.salesInvoice.findMany({ where: { ...(customerId ? { customerId } : {}), status: { in: SALES_OPEN } }, orderBy: { docDate: 'asc' } });
  return list
    .map((i) => ({
      docType: 'SALES_INVOICE',
      id: i.id,
      docNo: i.docNo,
      docDate: i.docDate,
      dueDate: i.dueDate,
      partyId: i.customerId,
      currencyCode: i.currencyCode,
      total: num(i.total),
      baseTotal: num(i.baseTotal),
      settled: num(i.receivedAmount),
      outstanding: r2(num(i.baseTotal) - num(i.receivedAmount)),
      status: i.status,
    }))
    .filter((i) => i.outstanding > EPS);
}
async function openPurchaseInvoices(supplierId?: number, tx: Tx | typeof prisma = prisma) {
  const list = await tx.purchaseInvoice.findMany({ where: { ...(supplierId ? { supplierId } : {}), status: { in: SALES_OPEN } }, orderBy: { docDate: 'asc' } });
  return list
    .map((i) => ({
      docType: 'PURCHASE_INVOICE',
      id: i.id,
      docNo: i.docNo,
      supplierInvoiceNo: i.supplierInvoiceNo,
      docDate: i.docDate,
      dueDate: i.dueDate,
      partyId: i.supplierId,
      currencyCode: i.currencyCode,
      total: num(i.total),
      baseTotal: num(i.baseTotal),
      settled: num(i.paidAmount),
      outstanding: r2(num(i.baseTotal) - num(i.paidAmount)),
      status: i.status,
    }))
    .filter((i) => i.outstanding > EPS);
}

/** settled part of an advance voucher = net credit on ADVANCE_TO_SUPPLIERS from ADVANCE_SETTLEMENT journals */
async function advanceSettled(voucherId: number, tx: Tx | typeof prisma = prisma) {
  const adv = await tx.account.findFirst({ where: { systemKey: 'ADVANCE_TO_SUPPLIERS' } });
  if (!adv) return 0;
  const agg = await tx.journalLine.aggregate({ where: { accountId: adv.id, journal: { sourceType: 'ADVANCE_SETTLEMENT', sourceId: voucherId } }, _sum: { debit: true, credit: true } });
  return r2(num(agg._sum.credit) - num(agg._sum.debit));
}

async function presentVoucher(id: number) {
  const v = await prisma.voucher.findUnique({ where: { id }, include: { allocations: { orderBy: { id: 'asc' } } } });
  if (!v) throw notFound('Voucher not found');
  const [acc, counter, journal] = await Promise.all([
    prisma.account.findUnique({ where: { id: v.accountId }, select: { id: true, code: true, name: true, isBank: true } }),
    v.counterAccountId ? prisma.account.findUnique({ where: { id: v.counterAccountId }, select: { id: true, code: true, name: true } }) : null,
    v.journalId ? prisma.journalEntry.findUnique({ where: { id: v.journalId }, include: { lines: true } }) : null,
  ]);
  const pn = await partyNames([{ partyType: v.partyType, partyId: v.partyId }]);
  const bc = await prisma.account.findFirst({ where: { systemKey: 'BANK_CHARGES' } });
  const bankCharges = journal && bc ? r2(journal.lines.filter((l) => l.accountId === bc.id).reduce((s, l) => s + num(l.debit) - num(l.credit), 0)) : 0;
  const advanceAmount = r2(v.allocations.filter((a) => a.docType === 'PURCHASE_ORDER').reduce((s, a) => s + num(a.amount), 0));
  const settled = advanceAmount ? await advanceSettled(v.id) : 0;
  const allocated = r2(v.allocations.reduce((s, a) => s + num(a.amount), 0));
  const settlements = advanceAmount
    ? await prisma.journalEntry.findMany({ where: { sourceType: 'ADVANCE_SETTLEMENT', sourceId: v.id }, select: { id: true, entryNo: true, entryDate: true, sourceNo: true, status: true, totalDebit: true } })
    : [];
  return {
    ...v,
    amount: num(v.amount),
    allocations: v.allocations.map((a) => ({ ...a, amount: num(a.amount) })),
    party: pn(v.partyType, v.partyId),
    account: acc,
    counterAccount: counter,
    journal: journal ? { id: journal.id, entryNo: journal.entryNo, status: journal.status } : null,
    bankCharges,
    allocatedAmount: allocated,
    unallocatedAmount: r2(num(v.amount) - allocated),
    isAdvance: advanceAmount > 0,
    advanceAmount,
    advanceSettled: settled,
    advanceRemaining: advanceAmount ? r2(advanceAmount - settled) : 0,
    settlements: settlements.map((s) => ({ ...s, totalDebit: num(s.totalDebit) })),
  };
}

async function createVoucher(req: Request, forced?: VType) {
  const b = parse(voucherSchema, req.body);
  const type = (forced ?? b.voucherType) as VType | undefined;
  if (!type) throw badRequest('voucherType (RECEIPT | PAYMENT) is required');
  if (b.voucherType && forced && b.voucherType !== forced) throw badRequest(`This endpoint only accepts ${forced} vouchers`);
  assertCan(req, permFor(type), 'create');

  // party / type compatibility
  if (b.partyType !== 'OTHER' && !b.partyId) throw badRequest('partyId is required for customer/supplier vouchers');
  const allocs = b.allocations ?? [];
  if (b.partyType === 'OTHER') {
    if (!b.counterAccountId) throw badRequest('counterAccountId is required when party is OTHER');
    if (allocs.length) throw badRequest('Allocations are not allowed for OTHER vouchers');
  }
  if (type === 'RECEIPT' && b.partyType === 'SUPPLIER' && allocs.length) throw badRequest('Supplier refund receipts cannot be allocated');
  if (type === 'PAYMENT' && b.partyType === 'CUSTOMER' && allocs.length) throw badRequest('Customer refund payments cannot be allocated');
  const charges = r2(b.bankCharges ?? 0);
  if (type === 'RECEIPT' && charges > b.amount) throw badRequest('Bank charges exceed the receipt amount');
  const allocTotal = r2(allocs.reduce((s, a) => s + a.amount, 0));
  if (allocTotal > b.amount + EPS) throw badRequest(`Allocations (${allocTotal}) exceed the voucher amount (${b.amount})`);

  const created = await prisma.$transaction(
    async (tx) => {
      const cashAccId = await resolveCashAccount(tx, b.mode ?? "BANK", b.accountId);
      if (b.partyType === 'CUSTOMER' && !(await tx.customer.findUnique({ where: { id: b.partyId! } }))) throw badRequest('Customer not found');
      if (b.partyType === 'SUPPLIER' && !(await tx.supplier.findUnique({ where: { id: b.partyId! } }))) throw badRequest('Supplier not found');
      if (b.counterAccountId) {
        const ca = await tx.account.findUnique({ where: { id: b.counterAccountId } });
        if (!ca || ca.isGroup) throw badRequest('Invalid counter account');
        if (ca.id === cashAccId) throw badRequest('Counter account must differ from the cash/bank account');
      }

      // validate allocations & collect document updates
      const allocRows: Array<{ docType: string; docId: number; docNo: string; amount: number }> = [];
      const invoiceUpdates: Array<() => Promise<unknown>> = [];
      let advanceAlloc = 0;
      const seen = new Set<string>();
      for (const a of allocs) {
        const key = `${a.docType}:${a.docId}`;
        if (seen.has(key)) throw badRequest(`Duplicate allocation for ${key}`);
        seen.add(key);
        if (a.docType === 'SALES_INVOICE') {
          if (!(type === 'RECEIPT' && b.partyType === 'CUSTOMER')) throw badRequest('SALES_INVOICE allocations are only valid for customer receipts');
          const inv = await tx.salesInvoice.findUnique({ where: { id: a.docId } });
          if (!inv) throw badRequest(`Sales invoice ${a.docId} not found`);
          if (inv.customerId !== b.partyId) throw badRequest(`Invoice ${inv.docNo} belongs to a different customer`);
          if (!SALES_OPEN.includes(inv.status)) throw badRequest(`Invoice ${inv.docNo} is ${inv.status} and cannot receive payments`);
          const out = r2(num(inv.baseTotal) - num(inv.receivedAmount));
          if (a.amount > out + EPS) throw badRequest(`Allocation ${a.amount} exceeds outstanding ${out} of ${inv.docNo}`);
          allocRows.push({ docType: a.docType, docId: inv.id, docNo: inv.docNo, amount: a.amount });
          const received = r2(num(inv.receivedAmount) + a.amount);
          invoiceUpdates.push(() => tx.salesInvoice.update({ where: { id: inv.id }, data: { receivedAmount: received, status: invoiceStatus(received, num(inv.baseTotal), inv.status) } }));
        } else if (a.docType === 'PURCHASE_INVOICE') {
          if (!(type === 'PAYMENT' && b.partyType === 'SUPPLIER')) throw badRequest('PURCHASE_INVOICE allocations are only valid for supplier payments');
          const inv = await tx.purchaseInvoice.findUnique({ where: { id: a.docId } });
          if (!inv) throw badRequest(`Purchase invoice ${a.docId} not found`);
          if (inv.supplierId !== b.partyId) throw badRequest(`Invoice ${inv.docNo} belongs to a different supplier`);
          if (!SALES_OPEN.includes(inv.status)) throw badRequest(`Invoice ${inv.docNo} is ${inv.status} and cannot be paid`);
          const out = r2(num(inv.baseTotal) - num(inv.paidAmount));
          if (a.amount > out + EPS) throw badRequest(`Allocation ${a.amount} exceeds outstanding ${out} of ${inv.docNo}`);
          allocRows.push({ docType: a.docType, docId: inv.id, docNo: inv.docNo, amount: a.amount });
          const paid = r2(num(inv.paidAmount) + a.amount);
          invoiceUpdates.push(() => tx.purchaseInvoice.update({ where: { id: inv.id }, data: { paidAmount: paid, status: invoiceStatus(paid, num(inv.baseTotal), inv.status) } }));
        } else {
          if (!(type === 'PAYMENT' && b.partyType === 'SUPPLIER')) throw badRequest('PURCHASE_ORDER (advance) allocations are only valid for supplier payments');
          const po = await tx.purchaseOrder.findUnique({ where: { id: a.docId } });
          if (!po) throw badRequest(`Purchase order ${a.docId} not found`);
          if (po.supplierId !== b.partyId) throw badRequest(`PO ${po.docNo} belongs to a different supplier`);
          if (['CANCELLED', 'CLOSED'].includes(po.status)) throw badRequest(`PO ${po.docNo} is ${po.status}`);
          allocRows.push({ docType: a.docType, docId: po.id, docNo: po.docNo, amount: a.amount });
          advanceAlloc += a.amount;
        }
      }

      const voucherNo = await nextNumber(tx, type === 'RECEIPT' ? 'RECEIPT_VOUCHER' : 'PAYMENT_VOUCHER', { date: b.voucherDate });
      const v = await tx.voucher.create({
        data: {
          voucherNo,
          voucherType: type,
          mode: b.mode ?? "BANK",
          voucherDate: b.voucherDate,
          partyType: b.partyType,
          partyId: b.partyType === 'OTHER' ? null : b.partyId,
          accountId: cashAccId,
          counterAccountId: b.counterAccountId ?? null,
          amount: b.amount,
          reference: b.reference,
          narration: b.narration,
          status: 'POSTED',
          createdBy: req.user?.id,
          allocations: { create: allocRows },
        },
      });

      const party = b.partyType === 'OTHER' ? {} : { partyType: b.partyType as 'CUSTOMER' | 'SUPPLIER', partyId: b.partyId! };
      const lines: JournalLineInput[] = [];
      const desc = `${voucherNo}${b.reference ? ' / ' + b.reference : ''}`;
      if (type === 'RECEIPT') {
        lines.push({ accountId: cashAccId, debit: r2(b.amount - charges), description: desc });
        if (charges) lines.push({ accountKey: 'BANK_CHARGES', debit: charges, description: `Bank charges ${voucherNo}` });
        if (b.partyType === 'CUSTOMER') lines.push({ accountKey: 'AR', credit: b.amount, ...party, description: desc });
        else if (b.partyType === 'SUPPLIER') lines.push({ accountKey: 'AP', credit: b.amount, ...party, description: `Refund ${desc}` });
        else lines.push({ accountId: b.counterAccountId!, credit: b.amount, description: desc });
      } else {
        lines.push({ accountId: cashAccId, credit: r2(b.amount + charges), description: desc });
        if (charges) lines.push({ accountKey: 'BANK_CHARGES', debit: charges, description: `Bank charges ${voucherNo}` });
        if (b.partyType === 'SUPPLIER') {
          lines.push({ accountKey: 'AP', debit: r2(b.amount - advanceAlloc), ...party, description: desc });
          if (advanceAlloc) lines.push({ accountKey: 'ADVANCE_TO_SUPPLIERS', debit: advanceAlloc, ...party, description: `Advance ${desc}` });
        } else if (b.partyType === 'CUSTOMER') lines.push({ accountKey: 'AR', debit: b.amount, ...party, description: `Refund ${desc}` });
        else lines.push({ accountId: b.counterAccountId!, debit: b.amount, description: desc });
      }
      const j = await postJournal(tx, {
        date: b.voucherDate,
        entryType: type,
        sourceType: type === 'RECEIPT' ? 'RECEIPT_VOUCHER' : 'PAYMENT_VOUCHER',
        sourceId: v.id,
        sourceNo: voucherNo,
        narration: b.narration ?? `${type === 'RECEIPT' ? 'Receipt' : 'Payment'} ${voucherNo}`,
        userId: req.user?.id,
        lines,
      });
      for (const u of invoiceUpdates) await u();
      await tx.voucher.update({ where: { id: v.id }, data: { journalId: j.id } });
      await audit(tx, req.user, 'POST', 'Voucher', v.id, { voucherNo, type, amount: b.amount, partyType: b.partyType, partyId: b.partyId, allocations: allocRows });
      return v;
    },
    { timeout: 30000 },
  );
  return presentVoucher(created.id);
}

async function cancelVoucher(req: Request, id: number) {
  const pre = await prisma.voucher.findUnique({ where: { id } });
  if (!pre) throw notFound('Voucher not found');
  assertCan(req, permFor(pre.voucherType), 'cancel');
  await prisma.$transaction(
    async (tx) => {
      const v = await tx.voucher.findUnique({ where: { id }, include: { allocations: true } });
      if (!v) throw notFound('Voucher not found');
      if (v.status !== 'POSTED') throw badRequest(`Voucher is ${v.status}`);
      if (await advanceSettled(v.id, tx)) throw badRequest('This advance has been (partly) settled against purchase invoices and cannot be cancelled');
      if (v.journalId) await reverseJournal(tx, v.journalId, req.user?.id);
      for (const a of v.allocations) {
        if (a.docType === 'SALES_INVOICE') {
          const inv = await tx.salesInvoice.findUnique({ where: { id: a.docId } });
          if (!inv) continue;
          const rec = Math.max(0, r2(num(inv.receivedAmount) - num(a.amount)));
          await tx.salesInvoice.update({ where: { id: inv.id }, data: { receivedAmount: rec, status: invoiceStatus(rec, num(inv.baseTotal), inv.status) } });
        } else if (a.docType === 'PURCHASE_INVOICE') {
          const inv = await tx.purchaseInvoice.findUnique({ where: { id: a.docId } });
          if (!inv) continue;
          const paid = Math.max(0, r2(num(inv.paidAmount) - num(a.amount)));
          await tx.purchaseInvoice.update({ where: { id: inv.id }, data: { paidAmount: paid, status: invoiceStatus(paid, num(inv.baseTotal), inv.status) } });
        }
      }
      await tx.voucher.update({ where: { id }, data: { status: 'CANCELLED' } });
      await audit(tx, req.user, 'CANCEL', 'Voucher', id, { voucherNo: v.voucherNo, reason: req.body?.reason });
    },
    { timeout: 30000 },
  );
  return presentVoucher(id);
}

function voucherRouter(forced?: VType) {
  const router = Router();

  router.get(
    '/',
    ah(async (req, res) => {
      const typeQ = forced ?? (req.query.voucherType ? (String(req.query.voucherType).toUpperCase() as VType) : undefined);
      if (typeQ) assertCan(req, permFor(typeQ), 'view');
      else if (!hasCan(req, 'receipts', 'view') && !hasCan(req, 'payments', 'view')) assertCan(req, 'receipts', 'view');
      const q = listQuery(req);
      const where: Record<string, unknown> = {};
      if (typeQ) where.voucherType = typeQ;
      else if (!hasCan(req, 'receipts', 'view')) where.voucherType = 'PAYMENT';
      else if (!hasCan(req, 'payments', 'view')) where.voucherType = 'RECEIPT';
      if (req.query.mode) where.mode = String(req.query.mode);
      if (req.query.status) where.status = String(req.query.status);
      if (req.query.partyType) where.partyType = String(req.query.partyType);
      const pid = qInt(req.query.partyId);
      if (pid) where.partyId = pid;
      const acc = qInt(req.query.accountId);
      if (acc) where.accountId = acc;
      const from = qDate(req.query.from);
      const to = qDate(req.query.to, true);
      if (from || to) where.voucherDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
      if (q.search) where.OR = [{ voucherNo: { contains: q.search } }, { reference: { contains: q.search } }, { narration: { contains: q.search } }];
      const sortable = ['voucherNo', 'voucherDate', 'amount', 'status', 'id'];
      const orderBy = { [q.sort && sortable.includes(q.sort) ? q.sort : 'id']: q.dir };
      const [raw, total, agg] = await Promise.all([
        prisma.voucher.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { allocations: true } }),
        prisma.voucher.count({ where }),
        prisma.voucher.aggregate({ where: { ...where, status: 'POSTED' }, _sum: { amount: true } }),
      ]);
      const pn = await partyNames(raw);
      const accs = await prisma.account.findMany({ where: { id: { in: [...new Set(raw.map((r) => r.accountId))] } }, select: { id: true, code: true, name: true } });
      const am = new Map(accs.map((a) => [a.id, a]));
      const rows = raw.map(({ allocations, ...v }) => ({
        ...v,
        amount: num(v.amount),
        party: pn(v.partyType, v.partyId),
        account: am.get(v.accountId) ?? null,
        allocatedAmount: r2(allocations.reduce((s, a) => s + num(a.amount), 0)),
        allocationCount: allocations.length,
        isAdvance: allocations.some((a) => a.docType === 'PURCHASE_ORDER'),
      }));
      res.json({ ...paged(rows, total, q), totalAmount: r2(num(agg._sum.amount)) });
    }),
  );

  router.get(
    '/open-invoices',
    ah(async (req, res) => {
      const pt = req.query.partyType ? String(req.query.partyType).toUpperCase() : forced === 'PAYMENT' ? 'SUPPLIER' : 'CUSTOMER';
      const partyId = qInt(req.query.partyId);
      if (!partyId) throw badRequest('partyId is required');
      if (pt === 'CUSTOMER') {
        assertCan(req, 'receipts', 'view');
        const rows = await openSalesInvoices(partyId);
        return res.json({ partyType: pt, partyId, rows, totalOutstanding: r2(rows.reduce((s, r) => s + r.outstanding, 0)) });
      }
      if (pt === 'SUPPLIER') {
        assertCan(req, 'payments', 'view');
        const rows = await openPurchaseInvoices(partyId);
        return res.json({ partyType: pt, partyId, rows, totalOutstanding: r2(rows.reduce((s, r) => s + r.outstanding, 0)) });
      }
      throw badRequest('partyType must be CUSTOMER or SUPPLIER');
    }),
  );

  // open purchase orders of a supplier (targets for advance / LC payments)
  router.get(
    '/open-orders',
    ah(async (req, res) => {
      assertCan(req, 'payments', 'view');
      const supplierId = qInt(req.query.supplierId ?? req.query.partyId);
      if (!supplierId) throw badRequest('supplierId is required');
      const pos = await prisma.purchaseOrder.findMany({ where: { supplierId, status: { notIn: ['DRAFT', 'CANCELLED', 'CLOSED'] } }, orderBy: { id: 'desc' } });
      const adv = await prisma.voucherAllocation.groupBy({ by: ['docId'], where: { docType: 'PURCHASE_ORDER', voucher: { status: 'POSTED' } }, _sum: { amount: true } });
      const am = new Map(adv.map((a) => [a.docId, num(a._sum.amount)]));
      res.json({
        rows: pos.map((p) => ({
          docType: 'PURCHASE_ORDER',
          id: p.id,
          docNo: p.docNo,
          docDate: p.docDate,
          orderType: p.orderType,
          currencyCode: p.currencyCode,
          exchangeRate: num(p.exchangeRate),
          total: num(p.total),
          baseTotal: r2(num(p.total) * num(p.exchangeRate)),
          advancePaid: am.get(p.id) ?? 0,
          status: p.status,
        })),
      });
    }),
  );

  // advance payments of a supplier with their unsettled balance
  router.get(
    '/advances',
    ah(async (req, res) => {
      assertCan(req, 'payments', 'view');
      const supplierId = qInt(req.query.supplierId ?? req.query.partyId);
      const vs = await prisma.voucher.findMany({
        where: { voucherType: 'PAYMENT', partyType: 'SUPPLIER', status: 'POSTED', ...(supplierId ? { partyId: supplierId } : {}), allocations: { some: { docType: 'PURCHASE_ORDER' } } },
        include: { allocations: true },
        orderBy: { id: 'desc' },
      });
      const rows = [];
      for (const v of vs) {
        const advanceAmount = r2(v.allocations.filter((a) => a.docType === 'PURCHASE_ORDER').reduce((s, a) => s + num(a.amount), 0));
        const settled = await advanceSettled(v.id);
        if (req.query.includeSettled !== '1' && advanceAmount - settled <= EPS) continue;
        rows.push({ voucherId: v.id, voucherNo: v.voucherNo, voucherDate: v.voucherDate, supplierId: v.partyId, purchaseOrders: v.allocations.filter((a) => a.docType === 'PURCHASE_ORDER').map((a) => ({ docId: a.docId, docNo: a.docNo, amount: num(a.amount) })), advanceAmount, settled, remaining: r2(advanceAmount - settled) });
      }
      res.json({ rows, totalRemaining: r2(rows.reduce((s, r) => s + r.remaining, 0)) });
    }),
  );

  router.get(
    '/:id',
    ah(async (req, res) => {
      const v = await presentVoucher(intParam(req));
      assertCan(req, permFor(v.voucherType), 'view');
      res.json(v);
    }),
  );

  router.post(
    '/',
    ah(async (req, res) => {
      res.status(201).json(await createVoucher(req, forced));
    }),
  );

  router.post(
    '/:id/cancel',
    ah(async (req, res) => {
      res.json(await cancelVoucher(req, intParam(req)));
    }),
  );

  const settleSchema = z.object({ purchaseInvoiceId: z.number().int(), amount: z.number().positive(), date: z.coerce.date().optional() });
  router.post(
    '/:id/settle-advance',
    ah(async (req, res) => {
      const id = intParam(req);
      const b = parse(settleSchema, req.body);
      assertCan(req, 'payments', 'post');
      await prisma.$transaction(
        async (tx) => {
          const v = await tx.voucher.findUnique({ where: { id }, include: { allocations: true } });
          if (!v) throw notFound('Voucher not found');
          if (v.voucherType !== 'PAYMENT' || v.partyType !== 'SUPPLIER' || v.status !== 'POSTED') throw badRequest('Not a posted supplier payment voucher');
          const advanceAmount = r2(v.allocations.filter((a) => a.docType === 'PURCHASE_ORDER').reduce((s, a) => s + num(a.amount), 0));
          if (!advanceAmount) throw badRequest('Voucher is not an advance payment');
          const remaining = r2(advanceAmount - (await advanceSettled(id, tx)));
          if (b.amount > remaining + EPS) throw badRequest(`Amount exceeds the unsettled advance (${remaining})`);
          const inv = await tx.purchaseInvoice.findUnique({ where: { id: b.purchaseInvoiceId } });
          if (!inv) throw badRequest('Purchase invoice not found');
          if (inv.supplierId !== v.partyId) throw badRequest('Invoice belongs to a different supplier');
          if (!SALES_OPEN.includes(inv.status)) throw badRequest(`Invoice ${inv.docNo} is ${inv.status}`);
          const out = r2(num(inv.baseTotal) - num(inv.paidAmount));
          if (b.amount > out + EPS) throw badRequest(`Amount exceeds outstanding ${out} of ${inv.docNo}`);
          const date = b.date ?? new Date();
          const j = await postJournal(tx, {
            date,
            entryType: 'AUTO',
            sourceType: 'ADVANCE_SETTLEMENT',
            sourceId: v.id,
            sourceNo: inv.docNo,
            narration: `Advance ${v.voucherNo} settled against ${inv.docNo}`,
            userId: req.user?.id,
            lines: [
              { accountKey: 'AP', debit: b.amount, partyType: 'SUPPLIER', partyId: v.partyId!, description: `Advance ${v.voucherNo} -> ${inv.docNo}` },
              { accountKey: 'ADVANCE_TO_SUPPLIERS', credit: b.amount, partyType: 'SUPPLIER', partyId: v.partyId!, description: `Advance ${v.voucherNo} -> ${inv.docNo}` },
            ],
          });
          const paid = r2(num(inv.paidAmount) + b.amount);
          await tx.purchaseInvoice.update({ where: { id: inv.id }, data: { paidAmount: paid, status: invoiceStatus(paid, num(inv.baseTotal), inv.status) } });
          await audit(tx, req.user, 'SETTLE_ADVANCE', 'Voucher', id, { voucherNo: v.voucherNo, invoice: inv.docNo, amount: b.amount, journal: j.entryNo });
        },
        { timeout: 30000 },
      );
      res.json(await presentVoucher(id));
    }),
  );
  return router;
}

export default [
  { path: '/vouchers', router: voucherRouter() },
  { path: '/receipts', router: voucherRouter('RECEIPT') },
  { path: '/payments', router: voucherRouter('PAYMENT') },
] satisfies ModuleDef[];
