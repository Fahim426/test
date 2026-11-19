import { badRequest, notFound } from '../lib/errors';
import { ReportDef, ReportParams, ReportResult, Col, col, P, roundRows, sumCols, Row, iso } from './report-types';
import { salesReports } from './report-sales';
import { purchaseReports } from './report-purchase';
import { inventoryReports } from './report-inventory';
import { branchReport } from './report-branch';

const fin = (key: string, title: string, description: string, endpoint: string, route: string, params = [P.from, P.to]): ReportDef => ({
  key,
  title,
  group: 'Finance',
  description,
  params,
  columns: [],
  source: 'finance',
  endpoint,
  route,
});

const financeReports: ReportDef[] = [
  fin('general-ledger', 'General Ledger', 'Account-wise ledger with running balance.', '/api/ledger/general', '/finance/general-ledger'),
  fin('trial-balance', 'Trial Balance', 'Debit / credit balances of all accounts.', '/api/ledger/trial-balance', '/finance/trial-balance'),
  fin('profit-loss', 'Profit & Loss', 'Income statement for the period.', '/api/ledger/profit-loss', '/finance/profit-loss'),
  fin('balance-sheet', 'Balance Sheet', 'Assets, liabilities and equity at a date.', '/api/ledger/balance-sheet', '/finance/balance-sheet', [P.to]),
  fin('cash-flow', 'Cash Flow', 'Cash and bank movements.', '/api/ledger/cash-flow', '/finance/cash-flow'),
  fin('customer-statement', 'Customer Statement', 'Customer ledger statement.', '/api/receivables/statement', '/finance/customer-statement', [P.customer, P.from, P.to]),
  fin('supplier-statement', 'Supplier Statement', 'Supplier ledger statement.', '/api/payables/statement', '/finance/supplier-statement', [P.supplier, P.from, P.to]),
  fin('ar-aging', 'AR Aging', 'Receivables aged by due date.', '/api/receivables/aging', '/finance/ar-aging', [P.to]),
  fin('ap-aging', 'AP Aging', 'Payables aged by due date.', '/api/payables/aging', '/finance/ap-aging', [P.to]),
  fin('vat-report', 'VAT Report', 'Output / input VAT summary and return.', '/api/vat/summary', '/finance/vat', [P.from, P.to]),
];

export const REPORTS: ReportDef[] = [...salesReports, ...purchaseReports, ...inventoryReports, ...financeReports, branchReport];
const byKey = new Map(REPORTS.map((r) => [r.key, r]));

export function getReport(key: string): ReportDef {
  const r = byKey.get(key);
  if (!r) throw notFound(`Unknown report '${key}'`);
  return r;
}

export function catalog() {
  const groups = ['Sales', 'Purchase', 'Inventory', 'Finance'] as const;
  return {
    groups: groups.map((g) => ({
      group: g,
      reports: REPORTS.filter((r) => r.group === g).map((r) => ({
        key: r.key,
        title: r.title,
        group: r.group,
        description: r.description,
        params: r.params,
        columns: r.columns,
        source: r.source ?? 'reports',
        endpoint: r.source ? r.endpoint : `/api/reports/run/${r.key}`,
        route: r.route,
      })),
    })),
  };
}

export async function runReport(key: string, p: ReportParams, paginate = true): Promise<ReportResult> {
  const def = getReport(key);
  if (def.source === 'finance' || !def.run) throw badRequest(`'${def.title}' is a finance report; use ${def.endpoint}`, { source: 'finance', endpoint: def.endpoint, route: def.route });
  const out = await def.run(p);
  const columns: Col[] = out.columns ?? def.columns;
  const rows: Row[] = roundRows(out.rows, columns);
  const totals = { ...sumCols(rows, columns), ...(out.totals ?? {}) };
  const total = rows.length;
  let page: number | undefined;
  let pageSize: number | undefined;
  let outRows = rows;
  if (paginate && (p.page || p.pageSize)) {
    page = p.page ?? 1;
    pageSize = p.pageSize ?? 100;
    outRows = rows.slice((page - 1) * pageSize, page * pageSize);
  }
  return {
    key,
    title: out.title ?? def.title,
    columns,
    rows: outRows,
    totals,
    params: Object.fromEntries(
      Object.entries({ from: iso(p.from) ?? undefined, to: iso(p.to) ?? undefined, warehouseId: p.warehouseId, customerId: p.customerId, supplierId: p.supplierId, productId: p.productId, brandId: p.brandId, categoryId: p.categoryId, salesmanId: p.salesmanId, branchId: p.branchId, groupBy: p.groupBy, status: p.status, days: key === 'dead-stock' ? p.days : undefined, top: ['fast-moving', 'slow-moving'].includes(key) ? p.top : undefined }).filter(([, v]) => v !== undefined),
    ),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}
void col;
