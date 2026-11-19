import { prisma } from '../lib/prisma';
import { num, r2 } from '../lib/calc';
import { ReportDef, ReportParams, Row, col, P, dateRange, VALID_SALES, VALID_PURCHASE } from './report-types';

interface BranchRow {
  branchId: number | null;
  branchCode: string;
  branchName: string;
  salesInvoices: number;
  salesRevenue: number;
  cogs: number;
  purchaseInvoices: number;
  purchaseValue: number;
  deliveries: number;
  stockValue: number;
  customers: Set<number>;
}

async function runBranchPerformance(p: ReportParams): Promise<{ rows: Row[] }> {
  const dr = dateRange(p);

  // All branches + warehouse->branch map
  const branches = await prisma.branch.findMany({ orderBy: { code: 'asc' } });
  const warehouses = await prisma.warehouse.findMany({ select: { id: true, branchId: true } });
  const whToBranch = new Map<number, number | null>();
  for (const w of warehouses) whToBranch.set(w.id, w.branchId);

  // ── SalesInvoice: aggregate via salesOrderId -> SalesOrder.warehouseId
  const salesInvs = await prisma.salesInvoice.findMany({
    where: {
      status: { in: VALID_SALES },
      ...(dr ? { docDate: dr } : {}),
    },
    select: {
      salesOrderId: true,
      customerId: true,
      subtotal: true,
      discount: true,
      vatAmount: true,
      cogs: true,
      exchangeRate: true,
    },
  });

  // Fetch warehouseId for each salesOrderId that appears
  const soIds = [...new Set(salesInvs.map((i) => i.salesOrderId).filter((id): id is number => id != null))];
  const soMap = new Map<number, number | null>();
  if (soIds.length) {
    const sos = await prisma.salesOrder.findMany({ where: { id: { in: soIds } }, select: { id: true, warehouseId: true } });
    for (const so of sos) soMap.set(so.id, so.warehouseId);
  }

  // ── PurchaseInvoice: aggregate via orderId -> PurchaseOrder.warehouseId
  const purchaseInvs = await prisma.purchaseInvoice.findMany({
    where: {
      status: { in: VALID_PURCHASE },
      ...(dr ? { docDate: dr } : {}),
    },
    select: { orderId: true, subtotal: true, discount: true, vatAmount: true, exchangeRate: true },
  });

  const poIds = [...new Set(purchaseInvs.map((i) => i.orderId).filter((id): id is number => id != null))];
  const poMap = new Map<number, number | null>();
  if (poIds.length) {
    const pos = await prisma.purchaseOrder.findMany({ where: { id: { in: poIds } }, select: { id: true, warehouseId: true } });
    for (const po of pos) poMap.set(po.id, po.warehouseId ?? null);
  }

  // ── Deliveries (count per branch)
  const deliveries = await prisma.deliveryNote.findMany({
    where: { status: 'POSTED', ...(dr ? { docDate: dr } : {}) },
    select: { warehouseId: true },
  });

  // ── Stock value (current snapshot)
  const stockBalances = await prisma.stockBalance.findMany({
    select: { warehouseId: true, onHand: true, avgCost: true },
  });

  // ── Build branch buckets
  const branchMap = new Map<number | null, BranchRow>();
  const mk = (id: number | null, code: string, name: string): BranchRow => ({
    branchId: id, branchCode: code, branchName: name,
    salesInvoices: 0, salesRevenue: 0, cogs: 0,
    purchaseInvoices: 0, purchaseValue: 0,
    deliveries: 0, stockValue: 0, customers: new Set(),
  });
  for (const b of branches) branchMap.set(b.id, mk(b.id, b.code, b.name));
  branchMap.set(null, mk(null, '—', '(No Branch)'));

  const getRow = (warehouseId: number | null | undefined) => {
    const whId = warehouseId ?? null;
    const bid = whId !== null ? (whToBranch.get(whId) ?? null) : null;
    return branchMap.get(bid) ?? branchMap.get(null)!;
  };

  // Accumulate sales
  for (const inv of salesInvs) {
    const whId = inv.salesOrderId ? (soMap.get(inv.salesOrderId) ?? null) : null;
    const row = getRow(whId);
    const rate = num(inv.exchangeRate) || 1;
    const net = (num(inv.subtotal) - num(inv.discount)) * rate;
    row.salesRevenue += net;
    row.cogs += num(inv.cogs);
    row.salesInvoices += 1;
    row.customers.add(inv.customerId);
  }

  // Accumulate purchases
  for (const inv of purchaseInvs) {
    const whId = inv.orderId ? (poMap.get(inv.orderId) ?? null) : null;
    const row = getRow(whId);
    const rate = num(inv.exchangeRate) || 1;
    row.purchaseValue += (num(inv.subtotal) - num(inv.discount)) * rate;
    row.purchaseInvoices += 1;
  }

  // Deliveries
  for (const dn of deliveries) {
    getRow(dn.warehouseId).deliveries += 1;
  }

  // Stock values
  for (const sb of stockBalances) {
    getRow(sb.warehouseId).stockValue += num(sb.onHand) * num(sb.avgCost);
  }

  // ── Build output rows
  const rows: Row[] = [];
  for (const r of branchMap.values()) {
    if (p.branchId && r.branchId !== p.branchId) continue;
    if (r.branchId === null && r.salesInvoices === 0 && r.purchaseInvoices === 0 && r.stockValue === 0) continue;
    const grossProfit = r.salesRevenue - r.cogs;
    const gpPct = r.salesRevenue > 0 ? r2((grossProfit / r.salesRevenue) * 100) : 0;
    rows.push({
      branch: `${r.branchCode} - ${r.branchName}`,
      salesInvoices: r.salesInvoices,
      salesRevenue: r2(r.salesRevenue),
      cogs: r2(r.cogs),
      grossProfit: r2(grossProfit),
      gpPct,
      purchaseInvoices: r.purchaseInvoices,
      purchaseValue: r2(r.purchaseValue),
      deliveries: r.deliveries,
      stockValue: r2(r.stockValue),
      customers: r.customers.size,
    });
  }

  rows.sort((a, b) => num(b.salesRevenue) - num(a.salesRevenue));
  return { rows };
}

export const branchReport: ReportDef = {
  key: 'branch-performance',
  title: 'Branch Performance Summary',
  group: 'Sales',
  description: 'Sales revenue, COGS, gross profit, purchases, deliveries, stock value and active customers — broken down by branch for the selected period.',
  params: [P.from, P.to, P.branch],
  columns: [
    col('branch', 'Branch'),
    col('salesInvoices', 'Sales Invoices', 'number', true),
    col('salesRevenue', 'Sales Revenue', 'money', true),
    col('cogs', 'COGS', 'money', true),
    col('grossProfit', 'Gross Profit', 'money', true),
    col('gpPct', 'GP %', 'percent'),
    col('purchaseInvoices', 'Purchase Invoices', 'number', true),
    col('purchaseValue', 'Purchase Value', 'money', true),
    col('deliveries', 'Deliveries', 'number', true),
    col('stockValue', 'Stock Value', 'money', true),
    col('customers', 'Active Customers', 'number', true),
  ],
  run: runBranchPerformance,
};
