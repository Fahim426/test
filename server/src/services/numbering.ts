import { prisma, Tx } from '../lib/prisma';
import { buCode, writeBu } from '../lib/bu';

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

/** setting numbering.perBu ('true' = a separate series per Business Unit) */
async function perBuNumbering(tx: Tx | typeof prisma): Promise<boolean> {
  const r = await tx.systemSetting.findUnique({ where: { key: 'numbering.perBu' } });
  return ['true', '1', 'yes', 'on'].includes((r?.value ?? '').toLowerCase());
}

/** Next document number, generated inside the caller's transaction. Honors prefix/year/branch/padding/reset rules. */
export async function nextNumber(tx: Tx | typeof prisma, baseType: string, opts: { date?: Date; branchCode?: string; buId?: number | null } = {}) {
  const date = opts.date ?? new Date();
  // Business Units: with setting numbering.perBu = true every BU has its own counter (row DOCTYPE@BU) and its code in the
  // number, e.g. INV-TZ-2026-00001; the format (prefix, year, padding, reset) is taken from the document type's row.
  let buTag: string | null = null;
  if (await perBuNumbering(tx)) buTag = await buCode(opts.buId ?? writeBu());
  const docType = buTag ? `${baseType}@${buTag}` : baseType;
  // A no-op update takes the row lock until the caller's transaction commits, serializing concurrent numbering.
  await tx.documentNumbering.updateMany({ where: { docType }, data: { currentSeq: { increment: 0 } } });
  let cfg = await tx.documentNumbering.findUnique({ where: { docType } });
  if (!cfg) {
    const tpl = buTag ? await tx.documentNumbering.findUnique({ where: { docType: baseType } }) : null;
    cfg = await tx.documentNumbering.create({
      data: tpl
        ? { docType, prefix: tpl.prefix, includeYear: tpl.includeYear, includeBranch: tpl.includeBranch, padding: tpl.padding, separator: tpl.separator, resetRule: tpl.resetRule }
        : { docType, prefix: DOC_DEFAULTS[baseType] ?? baseType.slice(0, 3) },
    });
  }
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const periodKey = cfg.resetRule === 'YEARLY' ? year : cfg.resetRule === 'MONTHLY' ? `${year}${month}` : 'ALL';
  const seq = cfg.periodKey === periodKey ? cfg.currentSeq + 1 : 1;
  await tx.documentNumbering.update({ where: { docType }, data: { currentSeq: seq, periodKey } });
  const parts = [cfg.prefix];
  if (buTag) parts.push(buTag);
  if (cfg.includeBranch && opts.branchCode) parts.push(opts.branchCode);
  if (cfg.includeYear) parts.push(year);
  parts.push(String(seq).padStart(cfg.padding, '0'));
  return parts.join(cfg.separator);
}
