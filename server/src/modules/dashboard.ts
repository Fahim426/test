import { Router } from 'express';
import { z } from 'zod';
import { ah, parse } from '../lib/http';
import { can } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { num, r2 } from '../lib/calc';
import { ModuleDef } from '../app';
import { VALID_SALES, VALID_PURCHASE, iso, loadLookups } from '../services/report-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const router = Router();

async function safe<T>(label: string, p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    console.error(`[dashboard] ${label} failed:`, e instanceof Error ? e.message : e);
    return fallback;
  }
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Build ordered buckets for the range. */
function buckets(range: string, now: Date) {
  const out: { key: string; label: string }[] = [];
  let start: Date;
  let by: 'day' | 'month';
  if (range === '30d' || range === '90d') {
    const n = range === '30d' ? 30 : 90;
    by = 'day';
    start = addDays(startOfDay(now), -(n - 1));
    for (let i = 0; i < n; i++) {
      const d = addDays(start, i);
      out.push({ key: iso(d)!, label: `${d.getDate()} ${MONTHS[d.getMonth()]}` });
    }
  } else {
    const n = range === '6m' ? 6 : 12;
    by = 'month';
    start = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
    for (let i = 0; i < n; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      out.push({ key: monthKey(d), label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` });
    }
  }
  return { out, start, by };
}
const bucketOf = (d: Date, by: 'day' | 'month') => (by === 'day' ? iso(d)! : monthKey(d));

const sumRange = async (model: 'salesInvoice' | 'purchaseInvoice', from: Date, to: Date) => {
  const a = await (prisma[model] as Any).aggregate({ where: { status: { in: VALID_SALES }, docDate: { gte: from, lt: to } }, _sum: { baseTotal: true, vatAmount: true }, _count: true });
  return { amount: r2(num(a._sum.baseTotal)), count: a._count as number };
};

const NOT_OPEN_PO = ['DRAFT', 'CANCELLED', 'CLOSED', 'FULLY_RECEIVED', 'RECEIVED', 'COMPLETED'];
const OPEN_PO_PENDING = ['APPROVED', 'PARTIALLY_RECEIVED', 'CONFIRMED', 'PAYMENT_PENDING', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS'];

async function statusCounts(model: string): Promise<Record<string, number>> {
  const g: Any[] = await (prisma as Any)[model].groupBy({ by: ['status'], _count: { _all: true } });
  return Object.fromEntries(g.map((x) => [x.status, x._count._all]));
}
const stage = (name: string, key: string, route: string, c: Record<string, number>, pendingStatuses: string[], extraPending = 0, ignore: string[] = ['CANCELLED']) => ({
  stage: name,
  key,
  route,
  count: Object.entries(c).filter(([s]) => !ignore.includes(s)).reduce((a, [, n]) => a + n, 0),
  pending: pendingStatuses.reduce((a, s) => a + (c[s] ?? 0), 0) + extraPending,
});

// Party balances from the AR / AP control accounts (same basis as customerBalance / supplierBalance)
async function partyBalances(kind: 'CUSTOMER' | 'SUPPLIER') {
  const acc = await prisma.account.findFirst({ where: { systemKey: kind === 'CUSTOMER' ? 'AR' : 'AP' }, select: { id: true } });
  const g = acc ? await prisma.journalLine.groupBy({ by: ['partyId'], where: { accountId: acc.id, partyType: kind }, _sum: { debit: true, credit: true } }) : [];
  const bal = new Map<number, number>();
  for (const x of g) if (x.partyId) bal.set(x.partyId, kind === 'CUSTOMER' ? num(x._sum.debit) - num(x._sum.credit) : num(x._sum.credit) - num(x._sum.debit));
  const openings: { id: number; openingBalance: unknown }[] =
    kind === 'CUSTOMER' ? await prisma.customer.findMany({ where: { openingBalance: { not: 0 } }, select: { id: true, openingBalance: true } }) : await prisma.supplier.findMany({ where: { openingBalance: { not: 0 } }, select: { id: true, openingBalance: true } });
  for (const o of openings) bal.set(o.id, (bal.get(o.id) ?? 0) + num(o.openingBalance));
  return bal;
}

router.get(
  '/',
  can('dashboard', 'view'),
  ah(async (req, res) => {
    const range = z.enum(['6m', '12m', '30d', '90d']).catch('12m').parse(req.query.range);
    const topDays = z.coerce.number().int().min(1).max(730).catch(90).parse(req.query.topDays);
    const now = new Date();
    const today = startOfDay(now);
    const tomorrow = addDays(today, 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const { out: bkts, start: trendStart, by } = buckets(range, now);
    const cfBkts = buckets('12m', now);

    const sumPur = (from: Date, to: Date) =>
      prisma.purchaseInvoice.aggregate({ where: { status: { in: VALID_PURCHASE }, docDate: { gte: from, lt: to } }, _sum: { baseTotal: true }, _count: true }).then((a) => ({ amount: r2(num(a._sum.baseTotal)), count: a._count }));
    const sumSales = (from: Date, to: Date) =>
      prisma.salesInvoice.aggregate({ where: { status: { in: VALID_SALES }, docDate: { gte: from, lt: to } }, _sum: { baseTotal: true }, _count: true }).then((a) => ({ amount: r2(num(a._sum.baseTotal)), count: a._count }));
    void sumRange;

    const [
      todaySales, monthSales, todayPur, monthPur,
      custBal, suppBal,
      stockVal, lowRows,
      pendQuot, pendPO, pendDel, pendPay, unpaidSales,
      salesTrendRows, purTrendRows, vouchers,
      topProducts, outCustInv, recent,
      mrC, prC, rfqC, sqC, poC, grnC, piC, pvC, grnUninv, seC, qC, soC, pkC, dnC, siC, dnUninv,
    ] = await Promise.all([
      safe('todaySales', sumSales(today, tomorrow), { amount: 0, count: 0 }),
      safe('monthSales', sumSales(monthStart, nextMonth), { amount: 0, count: 0 }),
      safe('todayPur', sumPur(today, tomorrow), { amount: 0, count: 0 }),
      safe('monthPur', sumPur(monthStart, nextMonth), { amount: 0, count: 0 }),
      safe('custBal', partyBalances('CUSTOMER'), new Map<number, number>()),
      safe('suppBal', partyBalances('SUPPLIER'), new Map<number, number>()),
      safe('stockVal', prisma.$queryRaw<{ v: unknown; q: unknown }[]>`SELECT COALESCE(SUM(onHand * avgCost),0) AS v, COALESCE(SUM(onHand),0) AS q FROM StockBalance`, [{ v: 0, q: 0 }]),
      safe(
        'lowStock',
        prisma.$queryRaw<{ id: number; code: string; name: string; onHand: unknown; th: unknown; reorderLevel: unknown; minStock: unknown }[]>`
          SELECT p.id, p.code, p.name, COALESCE(b.q,0) AS onHand, IF(p.reorderLevel>0,p.reorderLevel,p.minStock) AS th, p.reorderLevel, p.minStock
          FROM Product p LEFT JOIN (SELECT productId, SUM(onHand) q FROM StockBalance GROUP BY productId) b ON b.productId = p.id
          WHERE p.isActive = 1 AND IF(p.reorderLevel>0,p.reorderLevel,p.minStock) > 0 AND COALESCE(b.q,0) <= IF(p.reorderLevel>0,p.reorderLevel,p.minStock)
          ORDER BY (IF(p.reorderLevel>0,p.reorderLevel,p.minStock) - COALESCE(b.q,0)) DESC`,
        [],
      ),
      safe('pendQuot', prisma.salesQuotation.aggregate({ where: { status: { in: ['SENT', 'ACCEPTED'] } }, _count: true, _sum: { total: true } }), { _count: 0, _sum: { total: 0 } } as Any),
      safe('pendPO', prisma.purchaseOrder.aggregate({ where: { status: { notIn: [...NOT_OPEN_PO, 'SUBMITTED', 'PENDING_APPROVAL'] } }, _count: true, _sum: { total: true } }), { _count: 0, _sum: { total: 0 } } as Any),
      safe('pendDel', prisma.salesOrder.aggregate({ where: { status: { in: ['APPROVED', 'PARTIALLY_DELIVERED'] } }, _count: true, _sum: { total: true } }), { _count: 0, _sum: { total: 0 } } as Any),
      safe('pendPay', prisma.purchaseInvoice.findMany({ where: { status: { in: ['POSTED', 'PARTIALLY_PAID'] } }, select: { baseTotal: true, paidAmount: true, dueDate: true } }), [] as Any[]),
      safe('unpaidSales', prisma.salesInvoice.findMany({ where: { status: { in: ['POSTED', 'PARTIALLY_PAID'] } }, select: { baseTotal: true, receivedAmount: true, dueDate: true, customerId: true } }), [] as Any[]),
      safe('salesTrend', prisma.salesInvoice.findMany({ where: { status: { in: VALID_SALES }, docDate: { gte: trendStart } }, select: { docDate: true, baseTotal: true } }), [] as Any[]),
      safe('purTrend', prisma.purchaseInvoice.findMany({ where: { status: { in: VALID_PURCHASE }, docDate: { gte: trendStart } }, select: { docDate: true, baseTotal: true } }), [] as Any[]),
      safe('vouchers', prisma.voucher.findMany({ where: { status: 'POSTED', voucherDate: { gte: cfBkts.start } }, select: { voucherDate: true, voucherType: true, amount: true } }), [] as Any[]),
      safe(
        'topProducts',
        prisma.salesInvoiceItem.groupBy({ by: ['productId'], where: { invoice: { status: { in: VALID_SALES }, docDate: { gte: addDays(today, -topDays) } } }, _sum: { qty: true, amount: true, vatAmount: true }, orderBy: { _sum: { qty: 'desc' } }, take: 10 }),
        [] as Any[],
      ),
      Promise.resolve(null),
      safe('recent', recentTransactions(), [] as Any[]),
      safe('mr', statusCounts('materialRequest'), {}),
      safe('pr', statusCounts('purchaseRequisition'), {}),
      safe('rfq', statusCounts('purchaseEnquiry'), {}),
      safe('sq', statusCounts('supplierQuotation'), {}),
      safe('po', statusCounts('purchaseOrder'), {}),
      safe('grn', statusCounts('goodsReceipt'), {}),
      safe('pi', statusCounts('purchaseInvoice'), {}),
      safe('pv', prisma.voucher.count({ where: { voucherType: 'PAYMENT', status: { not: 'CANCELLED' } } }), 0),
      safe('grnUninv', prisma.goodsReceipt.count({ where: { status: 'POSTED', invoiced: false } }), 0),
      safe('se', statusCounts('salesEnquiry'), {}),
      safe('q', statusCounts('salesQuotation'), {}),
      safe('so', statusCounts('salesOrder'), {}),
      safe('pk', statusCounts('pickingList'), {}),
      safe('dn', statusCounts('deliveryNote'), {}),
      safe('si', statusCounts('salesInvoice'), {}),
      safe('dnUninv', prisma.deliveryNote.count({ where: { status: 'POSTED', invoiced: false } }), 0),
    ]);
    void outCustInv;

    const receivables = r2([...custBal.values()].reduce((a, b) => a + b, 0));
    const payables = r2([...suppBal.values()].reduce((a, b) => a + b, 0));
    const sv = stockVal[0] ?? { v: 0, q: 0 };
    const nowMs = now.getTime();
    const payDocs = pendPay as Any[];
    const pendingPaymentsAmount = r2(payDocs.reduce((a, d) => a + num(d.baseTotal) - num(d.paidAmount), 0));
    const overduePay = payDocs.filter((d) => d.dueDate && new Date(d.dueDate).getTime() < nowMs && num(d.baseTotal) - num(d.paidAmount) > 0.005);
    const overdueByCust = new Map<number, number>();
    for (const d of unpaidSales as Any[]) {
      const open = num(d.baseTotal) - num(d.receivedAmount);
      if (d.dueDate && new Date(d.dueDate).getTime() < nowMs && open > 0.005) overdueByCust.set(d.customerId, (overdueByCust.get(d.customerId) ?? 0) + open);
    }

    // trends
    const series = (rows: Any[], b: { key: string; label: string }[], byKind: 'day' | 'month') => {
      const m = new Map<string, { total: number; count: number }>(b.map((x) => [x.key, { total: 0, count: 0 }]));
      for (const r of rows) {
        const k = bucketOf(new Date(r.docDate), byKind);
        const g = m.get(k);
        if (g) {
          g.total += num(r.baseTotal);
          g.count += 1;
        }
      }
      return b.map((x) => ({ key: x.key, label: x.label, total: r2(m.get(x.key)!.total), count: m.get(x.key)!.count }));
    };
    const cf = new Map<string, { inflow: number; outflow: number }>(cfBkts.out.map((x) => [x.key, { inflow: 0, outflow: 0 }]));
    for (const v of vouchers as Any[]) {
      const g = cf.get(monthKey(new Date(v.voucherDate)));
      if (!g) continue;
      if (v.voucherType === 'RECEIPT') g.inflow += num(v.amount);
      else if (v.voucherType === 'PAYMENT') g.outflow += num(v.amount);
    }

    // lookups for top products / low stock / outstanding parties
    const lowAll = (lowRows as Any[]).map((r) => ({ productId: Number(r.id), code: r.code, name: r.name, onHand: num(r.onHand), threshold: num(r.th), shortage: r2(num(r.th) - num(r.onHand)) }));
    const topCustBal = [...custBal.entries()].filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topSuppBal = [...suppBal.entries()].filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const L = await loadLookups({ productIds: (topProducts as Any[]).map((t) => t.productId), customerIds: topCustBal.map(([id]) => id), supplierIds: topSuppBal.map(([id]) => id) });

    const wfPurchase = [
      stage('Material Request', 'material_request', '/purchase/material-requests', mrC as Any, ['SUBMITTED', 'APPROVED']),
      stage('Purchase Requisition', 'purchase_requisition', '/purchase/requisitions', prC as Any, ['SUBMITTED', 'APPROVED']),
      stage('RFQ', 'purchase_enquiry', '/purchase/enquiries', rfqC as Any, ['DRAFT', 'SENT']),
      stage('Quotation', 'supplier_quotation', '/purchase/quotations', sqC as Any, ['RECEIVED', 'SELECTED']),
      stage('Purchase Order', 'purchase_order', '/purchase/orders', poC as Any, OPEN_PO_PENDING, 0, ['CANCELLED', 'DRAFT']),
      stage('GRN', 'goods_receipt', '/purchase/receipts', grnC as Any, ['DRAFT'], grnUninv as number),
      stage('Invoice', 'purchase_invoice', '/purchase/invoices', piC as Any, ['DRAFT']),
      { stage: 'Payment', key: 'payments', route: '/finance/payments', count: pvC as number, pending: payDocs.length },
    ];
    const wfSales = [
      stage('Enquiry', 'sales_enquiry', '/sales/enquiries', seC as Any, ['OPEN']),
      stage('Quotation', 'sales_quotation', '/sales/quotations', qC as Any, ['SENT', 'ACCEPTED']),
      stage('Order', 'sales_order', '/sales/orders', soC as Any, ['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_DELIVERED'], 0, ['CANCELLED', 'DRAFT']),
      stage('Picking', 'picking', '/sales/picking', pkC as Any, ['OPEN', 'PARTIALLY_PICKED']),
      stage('Delivery', 'delivery_note', '/sales/deliveries', dnC as Any, ['DRAFT'], dnUninv as number),
      stage('Invoice', 'sales_invoice', '/sales/invoices', siC as Any, ['DRAFT']),
      { stage: 'Receipt', key: 'receipts', route: '/finance/receipts', count: (unpaidSales as Any[]).length ? 0 : 0, pending: (unpaidSales as Any[]).length },
    ];
    // receipt count (separate light query)
    wfSales[wfSales.length - 1].count = await safe('rcCount', prisma.voucher.count({ where: { voucherType: 'RECEIPT', status: { not: 'CANCELLED' } } }), 0);

    res.json({
      generatedAt: now.toISOString(),
      range,
      kpis: {
        todaysSales: { value: todaySales.amount, count: todaySales.count },
        monthlySales: { value: monthSales.amount, count: monthSales.count },
        todaysPurchase: { value: todayPur.amount, count: todayPur.count },
        monthlyPurchase: { value: monthPur.amount, count: monthPur.count },
        receivables: { value: receivables, overdue: r2([...overdueByCust.values()].reduce((a, b) => a + b, 0)), customers: topCustBal.length },
        payables: { value: payables, overdue: r2(overduePay.reduce((a, d) => a + num(d.baseTotal) - num(d.paidAmount), 0)) },
        stockValue: { value: r2(num(sv.v)), qty: num(sv.q) },
        lowStockCount: { value: lowAll.length },
        pendingQuotations: { value: (pendQuot as Any)._count, amount: r2(num((pendQuot as Any)._sum.total)) },
        pendingPurchaseOrders: { value: (pendPO as Any)._count, amount: r2(num((pendPO as Any)._sum.total)) },
        pendingDeliveries: { value: (pendDel as Any)._count, amount: r2(num((pendDel as Any)._sum.total)) },
        pendingPayments: { value: payDocs.length, amount: pendingPaymentsAmount, overdue: overduePay.length },
      },
      // flat KPI shortcuts for simple clients
      todaysSales: todaySales.amount,
      monthlySales: monthSales.amount,
      todaysPurchase: todayPur.amount,
      monthlyPurchase: monthPur.amount,
      receivables,
      payables,
      stockValue: r2(num(sv.v)),
      lowStockCount: lowAll.length,
      pendingQuotations: (pendQuot as Any)._count,
      pendingPurchaseOrders: (pendPO as Any)._count,
      pendingDeliveries: (pendDel as Any)._count,
      pendingPayments: payDocs.length,
      charts: {
        salesTrend: series(salesTrendRows as Any[], bkts, by),
        purchaseTrend: series(purTrendRows as Any[], bkts, by),
        cashFlow: cfBkts.out.map((x) => ({ key: x.key, label: x.label, inflow: r2(cf.get(x.key)!.inflow), outflow: r2(cf.get(x.key)!.outflow), net: r2(cf.get(x.key)!.inflow - cf.get(x.key)!.outflow) })),
      },
      salesTrend: series(salesTrendRows as Any[], bkts, by),
      purchaseTrend: series(purTrendRows as Any[], bkts, by),
      cashFlow: cfBkts.out.map((x) => ({ key: x.key, label: x.label, inflow: r2(cf.get(x.key)!.inflow), outflow: r2(cf.get(x.key)!.outflow), net: r2(cf.get(x.key)!.inflow - cf.get(x.key)!.outflow) })),
      topSellingProducts: (topProducts as Any[]).map((t) => ({
        productId: t.productId,
        code: L.products.get(t.productId)?.code ?? '',
        name: L.products.get(t.productId)?.name ?? `#${t.productId}`,
        qty: num(t._sum.qty),
        value: r2(num(t._sum.amount) - num(t._sum.vatAmount)),
        days: topDays,
      })),
      lowStockProducts: lowAll.slice(0, 10),
      outstandingCustomers: topCustBal.map(([id, bal]) => ({ customerId: id, code: L.customers.get(id)?.code ?? '', name: L.customers.get(id)?.name ?? `#${id}`, balance: r2(bal), overdue: r2(overdueByCust.get(id) ?? 0) })),
      outstandingSuppliers: topSuppBal.map(([id, bal]) => ({ supplierId: id, code: L.suppliers.get(id)?.code ?? '', name: L.suppliers.get(id)?.name ?? `#${id}`, balance: r2(bal) })),
      recentTransactions: recent,
      workflows: { purchase: wfPurchase, sales: wfSales },
    });
  }),
);

async function recentTransactions() {
  const take = 8;
  const sel = { orderBy: { createdAt: 'desc' as const }, take };
  const [si, pi, grn, dn, so, po, rc, pv] = await Promise.all([
    prisma.salesInvoice.findMany({ ...sel, select: { id: true, docNo: true, docDate: true, createdAt: true, customerId: true, baseTotal: true, status: true } }),
    prisma.purchaseInvoice.findMany({ ...sel, select: { id: true, docNo: true, docDate: true, createdAt: true, supplierId: true, baseTotal: true, status: true } }),
    prisma.goodsReceipt.findMany({ ...sel, select: { id: true, docNo: true, docDate: true, createdAt: true, supplierId: true, status: true } }),
    prisma.deliveryNote.findMany({ ...sel, select: { id: true, docNo: true, docDate: true, createdAt: true, customerId: true, status: true } }),
    prisma.salesOrder.findMany({ ...sel, select: { id: true, docNo: true, docDate: true, createdAt: true, customerId: true, total: true, status: true } }),
    prisma.purchaseOrder.findMany({ ...sel, select: { id: true, docNo: true, docDate: true, createdAt: true, supplierId: true, total: true, status: true } }),
    prisma.voucher.findMany({ ...sel, select: { id: true, voucherNo: true, voucherType: true, voucherDate: true, createdAt: true, partyType: true, partyId: true, amount: true, status: true } }),
    Promise.resolve([] as Any[]),
  ]);
  void pv;
  const L = await loadLookups({
    customerIds: [...si, ...dn, ...so].map((x) => x.customerId),
    supplierIds: [...pi, ...grn, ...po].map((x) => x.supplierId),
  });
  const rows: Any[] = [];
  const cn = (id: number) => L.customers.get(id)?.name ?? '';
  const sn = (id: number) => L.suppliers.get(id)?.name ?? '';
  si.forEach((x) => rows.push({ type: 'SALES_INVOICE', label: 'Sales Invoice', id: x.id, docNo: x.docNo, date: x.docDate, createdAt: x.createdAt, party: cn(x.customerId), amount: num(x.baseTotal), status: x.status, route: `/sales/invoices/${x.id}` }));
  pi.forEach((x) => rows.push({ type: 'PURCHASE_INVOICE', label: 'Purchase Invoice', id: x.id, docNo: x.docNo, date: x.docDate, createdAt: x.createdAt, party: sn(x.supplierId), amount: num(x.baseTotal), status: x.status, route: `/purchase/invoices/${x.id}` }));
  grn.forEach((x) => rows.push({ type: 'GOODS_RECEIPT', label: 'Goods Receipt', id: x.id, docNo: x.docNo, date: x.docDate, createdAt: x.createdAt, party: sn(x.supplierId), amount: null, status: x.status, route: `/purchase/receipts/${x.id}` }));
  dn.forEach((x) => rows.push({ type: 'DELIVERY_NOTE', label: 'Delivery Note', id: x.id, docNo: x.docNo, date: x.docDate, createdAt: x.createdAt, party: cn(x.customerId), amount: null, status: x.status, route: `/sales/deliveries/${x.id}` }));
  so.forEach((x) => rows.push({ type: 'SALES_ORDER', label: 'Sales Order', id: x.id, docNo: x.docNo, date: x.docDate, createdAt: x.createdAt, party: cn(x.customerId), amount: num(x.total), status: x.status, route: `/sales/orders/${x.id}` }));
  po.forEach((x) => rows.push({ type: 'PURCHASE_ORDER', label: 'Purchase Order', id: x.id, docNo: x.docNo, date: x.docDate, createdAt: x.createdAt, party: sn(x.supplierId), amount: num(x.total), status: x.status, route: `/purchase/orders/${x.id}` }));
  const vp = await loadLookups({ customerIds: rc.filter((v) => v.partyType === 'CUSTOMER').map((v) => v.partyId), supplierIds: rc.filter((v) => v.partyType === 'SUPPLIER').map((v) => v.partyId) });
  rc.forEach((x) => rows.push({ type: x.voucherType === 'RECEIPT' ? 'RECEIPT' : 'PAYMENT', label: x.voucherType === 'RECEIPT' ? 'Receipt' : 'Payment', id: x.id, docNo: x.voucherNo, date: x.voucherDate, createdAt: x.createdAt, party: x.partyType === 'CUSTOMER' ? vp.customers.get(x.partyId!)?.name ?? '' : x.partyType === 'SUPPLIER' ? vp.suppliers.get(x.partyId!)?.name ?? '' : '', amount: num(x.amount), status: x.status, route: x.voucherType === 'RECEIPT' ? `/finance/receipts/${x.id}` : `/finance/payments/${x.id}` }));
  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return rows.slice(0, 15);
}

// ---------------- widgets ----------------
const WIDGETS = [
  ...['todaysSales', 'monthlySales', 'todaysPurchase', 'monthlyPurchase', 'receivables', 'payables', 'stockValue', 'lowStockCount', 'pendingQuotations', 'pendingPurchaseOrders', 'pendingDeliveries', 'pendingPayments'].map((k) => ({ key: `kpi.${k}`, label: k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), type: 'kpi' })),
  { key: 'salesTrend', label: 'Sales Chart', type: 'chart' },
  { key: 'purchaseTrend', label: 'Purchase Chart', type: 'chart' },
  { key: 'cashFlow', label: 'Cash Flow Chart', type: 'chart' },
  { key: 'topSellingProducts', label: 'Top Selling Products', type: 'table' },
  { key: 'lowStockProducts', label: 'Low Stock Products', type: 'table' },
  { key: 'outstandingCustomers', label: 'Outstanding Customers', type: 'table' },
  { key: 'outstandingSuppliers', label: 'Outstanding Suppliers', type: 'table' },
  { key: 'recentTransactions', label: 'Recent Transactions', type: 'table' },
  { key: 'purchaseWorkflow', label: 'Purchase Workflow', type: 'workflow' },
  { key: 'salesWorkflow', label: 'Sales Workflow', type: 'workflow' },
];
const WKEYS = WIDGETS.map((w) => w.key);

router.get('/widget-catalog', can('dashboard', 'view'), (_req, res) => res.json({ widgets: WIDGETS }));

router.get(
  '/widgets',
  can('dashboard', 'view'),
  ah(async (req, res) => {
    const s = await prisma.systemSetting.findUnique({ where: { key: `dashboard.widgets.${req.user!.id}` } });
    let enabled: string[] = WKEYS;
    let customized = false;
    if (s) {
      try {
        const parsed = JSON.parse(s.value);
        const list: unknown = Array.isArray(parsed) ? parsed : parsed.enabled;
        if (Array.isArray(list)) {
          enabled = list.filter((k): k is string => typeof k === 'string' && WKEYS.includes(k));
          customized = true;
        }
      } catch {
        /* ignore corrupt value */
      }
    }
    res.json({ enabled, customized, widgets: enabled.map((key, order) => ({ key, order, enabled: true })), available: WIDGETS });
  }),
);

router.put(
  '/widgets',
  can('dashboard', 'view'),
  ah(async (req, res) => {
    const body = parse(z.object({ enabled: z.array(z.string()).max(100) }), Array.isArray(req.body) ? { enabled: req.body } : req.body);
    const enabled = [...new Set(body.enabled.filter((k) => WKEYS.includes(k)))];
    await prisma.systemSetting.upsert({ where: { key: `dashboard.widgets.${req.user!.id}` }, update: { value: JSON.stringify({ enabled }) }, create: { key: `dashboard.widgets.${req.user!.id}`, value: JSON.stringify({ enabled }) } });
    res.json({ enabled, customized: true, widgets: enabled.map((key, order) => ({ key, order, enabled: true })) });
  }),
);

export default [{ path: '/dashboard', router }] as ModuleDef[];
