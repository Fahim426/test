import type { DrillMap } from './ResultGrid';

/** Ribbon / screen id -> catalog report key (only where they differ). */
export const SCREEN_TO_KEY: Record<string, string> = {
  'sales-return-report': 'sales-return',
  'purchase-return-report': 'purchase-return',
  'import-purchase-report': 'import-purchase',
  'stock-balances': 'stock-summary',
};
/** Catalog report key -> ribbon / screen id. */
export const KEY_TO_SCREEN: Record<string, string> = Object.fromEntries(Object.entries(SCREEN_TO_KEY).map(([s, k]) => [k, s]));

export const screenOfKey = (key: string) => KEY_TO_SCREEN[key] ?? key;
export const keyOfScreen = (screenId: string) => SCREEN_TO_KEY[screenId] ?? screenId;

const SI = { type: 'SALES_INVOICE' };
const PI = { type: 'PURCHASE_INVOICE' };
const CUST = { type: 'CUSTOMER' };
const SUP = { type: 'SUPPLIER' };
const PROD = { type: 'PRODUCT' };

/** Drill-down per report: column key -> document / master to open. Rows without ids are resolved through /search. */
export const DRILL: Record<string, DrillMap> = {
  'sales-register': { docNo: SI, customer: { type: 'CUSTOMER', idKey: 'customerId' } },
  'invoice-register': { docNo: SI, customer: CUST },
  'gross-profit': { docNo: SI, customer: CUST, product: PROD, code: PROD },
  'sales-return': { docNo: { type: 'SALES_RETURN' }, invoiceNo: SI, customer: CUST },
  'sales-by-customer': { code: CUST, customer: CUST },
  'sales-by-product': { code: PROD, product: PROD },
  'purchase-register': { docNo: PI, supplier: SUP },
  'supplier-purchase': { code: SUP, supplier: SUP },
  'product-purchase': { code: PROD, product: PROD },
  'purchase-return': { docNo: { type: 'PURCHASE_RETURN' }, supplier: SUP },
  'import-purchase': { docNo: { type: 'IMPORT_PURCHASE_ORDER' }, supplier: SUP },
  'fast-moving': { code: PROD, product: PROD },
  'slow-moving': { code: PROD, product: PROD },
};
