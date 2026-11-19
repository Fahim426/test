import { prisma, Tx } from '../lib/prisma';

// Default prefixes per docType; fully editable from Admin > Document Numbering.
export const DOC_DEFAULTS: Record<string, string> = {
  MATERIAL_REQUEST: 'MR',
  PURCHASE_REQUISITION: 'PR',
  PURCHASE_ENQUIRY: 'RFQ',
  SUPPLIER_QUOTATION: 'SQN',
  PURCHASE_ORDER: 'PO',
  IMPORT_PURCHASE_ORDER: 'IPO',
  IMPORT_REQUEST: 'IR',
  SUPPLIER_PROFORMA: 'SPF',
  IMPORT_SHIPMENT: 'SHP',
  GOODS_RECEIPT: 'GRN',
  LANDED_COST: 'LC',
  PURCHASE_INVOICE: 'PI',
  PURCHASE_RETURN: 'PRN',
  SALES_ENQUIRY: 'SE',
  SALES_QUOTATION: 'SQ',
  PROFORMA_INVOICE: 'PF',
  SALES_ORDER: 'SO',
  PICKING_LIST: 'PK',
  PACKING_LIST: 'PL',
  DELIVERY_NOTE: 'DN',
  SALES_INVOICE: 'SI',
  SALES_RETURN: 'SR',
  STOCK_TRANSFER: 'TRF',
  STOCK_ADJUSTMENT: 'ADJ',
  RECEIPT_VOUCHER: 'RV',
  PAYMENT_VOUCHER: 'PV',
  JOURNAL: 'JV',
  CREDIT_NOTE: 'CN',
  DEBIT_NOTE: 'DBN',
  AMC_CONTRACT: 'AMC',
  EMPLOYEE: 'EMP',
  PAYROLL: 'PAY',
};

/** Next document number, generated inside the caller's transaction. Honors prefix/year/branch/padding/reset rules. */
export async function nextNumber(tx: Tx | typeof prisma, docType: string, opts: { date?: Date; branchCode?: string } = {}) {
  const date = opts.date ?? new Date();
  // A no-op update takes the row lock until the caller's transaction commits, serializing concurrent numbering.
  await tx.documentNumbering.updateMany({ where: { docType }, data: { currentSeq: { increment: 0 } } });
  let cfg = await tx.documentNumbering.findUnique({ where: { docType } });
  if (!cfg) {
    cfg = await tx.documentNumbering.create({
      data: { docType, prefix: DOC_DEFAULTS[docType] ?? docType.slice(0, 3) },
    });
  }
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const periodKey = cfg.resetRule === 'YEARLY' ? year : cfg.resetRule === 'MONTHLY' ? `${year}${month}` : 'ALL';
  const seq = cfg.periodKey === periodKey ? cfg.currentSeq + 1 : 1;
  await tx.documentNumbering.update({ where: { docType }, data: { currentSeq: seq, periodKey } });
  const parts = [cfg.prefix];
  if (cfg.includeBranch && opts.branchCode) parts.push(opts.branchCode);
  if (cfg.includeYear) parts.push(year);
  parts.push(String(seq).padStart(cfg.padding, '0'));
  return parts.join(cfg.separator);
}
