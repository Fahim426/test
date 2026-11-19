import { prisma, Tx } from '../lib/prisma';
import { badRequest } from '../lib/errors';
import { num, r2 } from '../lib/calc';
import { nextNumber } from './numbering';

/**
 * ACCOUNTING ENGINE — double-entry. Auto-postings reference accounts by systemKey (see seed):
 * CASH, BANK, AR, INVENTORY, AP, VAT_INPUT, VAT_OUTPUT, SALES, SALES_RETURNS, COGS, GRNI(goods received not invoiced),
 * ROUND_OFF, OPENING_EQUITY, FREIGHT, STOCK_ADJUSTMENT, BANK_CHARGES, ADVANCE_TO_SUPPLIERS
 */

export interface JournalLineInput {
  accountKey?: string;
  accountId?: number;
  debit?: number;
  credit?: number;
  partyType?: 'CUSTOMER' | 'SUPPLIER';
  partyId?: number;
  description?: string;
  vatCode?: string;
  vatAmount?: number;
}

export interface JournalInput {
  date: Date;
  entryType?: 'AUTO' | 'JOURNAL' | 'DEBIT_NOTE' | 'CREDIT_NOTE' | 'OPENING' | 'RECEIPT' | 'PAYMENT';
  sourceType?: string;
  sourceId?: number;
  sourceNo?: string;
  narration?: string;
  userId?: number;
  lines: JournalLineInput[];
}

export async function accountIdByKey(tx: Tx | typeof prisma, key: string): Promise<number> {
  const a = await tx.account.findUnique({ where: { systemKey: key } });
  if (!a) throw badRequest(`System account "${key}" is not configured in the Chart of Accounts`);
  return a.id;
}

/** Posts a balanced journal entry. Zero-value lines are dropped. Throws if debits != credits. */
export async function postJournal(tx: Tx, j: JournalInput) {
  const lines: Array<Required<Pick<JournalLineInput, 'debit' | 'credit'>> & JournalLineInput & { accountId: number }> = [];
  for (const l of j.lines) {
    const debit = r2(num(l.debit));
    const credit = r2(num(l.credit));
    if (!debit && !credit) continue;
    const accountId = l.accountId ?? (l.accountKey ? await accountIdByKey(tx, l.accountKey) : 0);
    if (!accountId) throw badRequest('Journal line without account');
    const acc = await tx.account.findUnique({ where: { id: accountId }, select: { isGroup: true, name: true } });
    if (acc?.isGroup) throw badRequest(`Cannot post to group account "${acc.name}"`);
    lines.push({ ...l, accountId, debit, credit });
  }
  const totalDebit = r2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = r2(lines.reduce((s, l) => s + l.credit, 0));
  if (!lines.length) throw badRequest('Journal has no postable lines');
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw badRequest(`Journal not balanced: debit ${totalDebit} vs credit ${totalCredit}`);
  }
  const entryNo = await nextNumber(tx, 'JOURNAL', { date: j.date });
  return tx.journalEntry.create({
    data: {
      entryNo,
      entryDate: j.date,
      entryType: j.entryType ?? 'AUTO',
      sourceType: j.sourceType,
      sourceId: j.sourceId,
      sourceNo: j.sourceNo,
      narration: j.narration,
      totalDebit,
      createdBy: j.userId,
      lines: {
        create: lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          partyType: l.partyType,
          partyId: l.partyId,
          description: l.description,
          vatCode: l.vatCode,
          vatAmount: l.vatAmount ?? 0,
        })),
      },
    },
    include: { lines: true },
  });
}

/** Reverses a journal by posting the mirror entry and flagging the original REVERSED. */
export async function reverseJournal(tx: Tx, journalId: number, userId?: number, date = new Date()) {
  const orig = await tx.journalEntry.findUnique({ where: { id: journalId }, include: { lines: true } });
  if (!orig) throw badRequest('Journal not found');
  if (orig.status === 'REVERSED') throw badRequest('Journal already reversed');
  const rev = await postJournal(tx, {
    date,
    entryType: (orig.entryType as JournalInput['entryType']) ?? 'AUTO',
    sourceType: orig.sourceType ?? undefined,
    sourceId: orig.sourceId ?? undefined,
    sourceNo: orig.sourceNo ?? undefined,
    narration: `Reversal of ${orig.entryNo}`,
    userId,
    lines: orig.lines.map((l) => ({
      accountId: l.accountId,
      debit: num(l.credit),
      credit: num(l.debit),
      partyType: (l.partyType as 'CUSTOMER' | 'SUPPLIER' | null) ?? undefined,
      partyId: l.partyId ?? undefined,
      description: l.description ?? undefined,
      vatCode: l.vatCode ?? undefined,
      vatAmount: -num(l.vatAmount),
    })),
  });
  await tx.journalEntry.update({ where: { id: journalId }, data: { status: 'REVERSED' } });
  return rev;
}

/** Customer balance = opening + Σ(debit - credit) on AR lines for that customer. */
export async function customerBalance(customerId: number, tx: Tx | typeof prisma = prisma) {
  const c = await tx.customer.findUnique({ where: { id: customerId } });
  const ar = await accountIdByKey(tx, 'AR');
  const agg = await tx.journalLine.aggregate({
    where: { accountId: ar, partyType: 'CUSTOMER', partyId: customerId },
    _sum: { debit: true, credit: true },
  });
  return r2(num(c?.openingBalance) + num(agg._sum.debit) - num(agg._sum.credit));
}

/** Supplier balance (amount we owe, positive) = opening + Σ(credit - debit) on AP lines. */
export async function supplierBalance(supplierId: number, tx: Tx | typeof prisma = prisma) {
  const s = await tx.supplier.findUnique({ where: { id: supplierId } });
  const ap = await accountIdByKey(tx, 'AP');
  const agg = await tx.journalLine.aggregate({
    where: { accountId: ap, partyType: 'SUPPLIER', partyId: supplierId },
    _sum: { debit: true, credit: true },
  });
  return r2(num(s?.openingBalance) + num(agg._sum.credit) - num(agg._sum.debit));
}
