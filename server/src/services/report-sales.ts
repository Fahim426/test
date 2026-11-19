import { prisma } from '../lib/prisma';
import { num, r2 } from '../lib/calc';
import {
  ReportDef, ReportParams, Row, col, P, dateRange, iso, VALID_SALES, loadLookups, Lookups, productFilterIds, warehouseFilterIds,
  pName, pCode, brandName, catName, sumCols, roundRows, pct, periodKey, Col,
} from './report-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function invoiceWhere(p: ReportParams, statuses: string[] | null, pids: number[] | null): Promise<Any> {
  const w: Any = {};
  if (statuses) w.status = { in: statuses };
  if (p.status) w.status = p.status;
  const dr = dateRange(p);
  if (dr) w.docDate = dr;
  if (p.customerId) w.customerId = p.customerId;
  if (p.salesmanId) w.salesmanId = p.salesmanId;
  const wh = await warehouseFilterIds(p);
  if (wh) {
    const so = await prisma.salesOrder.findMany({ where: { warehouseId: { in: wh } }, select: { id: true } });
    w.salesOrderId = { in: so.map((s) => s.id) };
  }
  if (pids) w.items = { some: { productId: { in: pids } } };
  return w;
}

interface SLine {
  inv: Any;
  it: Any;
  net: number; // base currency, excl VAT
  vat: number;
  cost: number;
}

async function loadSales(p: ReportParams, statuses: string[] | null = VALID_SALES) {
  const pids = await productFilterIds(p);
  const invs: Any[] = await prisma.salesInvoice.findMany({
    where: await invoiceWhere(p, statuses, pids),
    include: { items: true },
    orderBy: [{ docDate: 'asc' }, { id: 'asc' }],
  });
  const L = await loadLookups({
    productIds: invs.flatMap((i) => i.items.map((x: Any) => x.productId)),
    customerIds: invs.map((i) => i.customerId),
  });
  const lines: SLine[] = [];
  for (const inv of invs) {
    const rate = num(inv.exchangeRate) || 1;
    for (const it of inv.items) {
      if (pids && !pids.includes(it.productId)) continue;
      lines.push({
        inv,
        it,
        net: (num(it.amount) - num(it.vatAmount)) * rate,
        vat: num(it.vatAmount) * rate,
        cost: num(it.qty) * num(it.unitCost),
      });
    }
  }
  return { invs, lines, L, pids };
}

const cust = (L: Lookups, id: number) => L.customers.get(id)?.name ?? `#${id}`;
const sman = (L: Lookups, id: number | null) => (id ? L.salesmen.get(id)?.name ?? '' : '');

/** Generic roll-up of rows by a key function; sums all `sum` columns. */
function rollup(rows: Row[], cols: Col[], keyOf: (r: Row) => string, label: (k: string, sample: Row) => Row): Row[] {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const k = keyOf(r);
    let g = m.get(k);
    if (!g) {
      g = label(k, r);
      m.set(k, g);
    }
    for (const c of cols) if (c.sum) g[c.key] = num(g[c.key]) + num(r[c.key]);
    g.count = num(g.count) + 1;
  }
  return [...m.values()];
}

// ---------------- Sales register / invoice register ----------------
const regCols = (): Col[] => [
  col('docDate', 'Date', 'date'),
  col('docNo', 'Invoice No'),
  col('customer', 'Customer'),
  col('salesman', 'Salesman'),
  col('subtotal', 'Subtotal', 'money', true),
  col('discount', 'Discount', 'money', true),
  col('vatAmount', 'VAT', 'money', true),
  col('total', 'Total (AED)', 'money', true),
  col('received', 'Received', 'money', true),
  col('balance', 'Balance', 'money', true),
  col('status', 'Status'),
];

async function registerRows(p: ReportParams, statuses: string[] | null) {
  const { invs, L } = await loadSales(p, statuses);
  return invs.map((i): Row => {
    const rate = num(i.exchangeRate) || 1;
    const total = num(i.baseTotal) || num(i.total) * rate;
    return {
      docDate: iso(i.docDate),
      docNo: i.docNo,
      customer: cust(L, i.customerId),
      salesman: sman(L, i.salesmanId),
      subtotal: num(i.subtotal) * rate,
      discount: num(i.discount) * rate,
      vatAmount: num(i.vatAmount) * rate,
      total,
      received: num(i.receivedAmount),
      balance: ['DRAFT', 'CANCELLED'].includes(i.status) ? 0 : total - num(i.receivedAmount),
      status: i.status,
      customerId: i.customerId,
      salesmanId: i.salesmanId,
    };
  });
}

function groupedRegister(rows: Row[], cols: Col[], groupBy: string | undefined, keyLabel: string): { rows: Row[]; columns: Col[] } | null {
  if (!groupBy || groupBy === 'none') return null;
  const sumCols_ = cols.filter((c) => c.sum);
  let keyOf: (r: Row) => string;
  let lbl: string;
  if (groupBy === 'day') (keyOf = (r) => String(r.docDate)), (lbl = 'Date');
  else if (groupBy === 'month') (keyOf = (r) => String(r.docDate).slice(0, 7)), (lbl = 'Month');
  else if (groupBy === 'customer') (keyOf = (r) => String(r.customer ?? r.supplier)), (lbl = keyLabel);
  else if (groupBy === 'supplier') (keyOf = (r) => String(r.supplier)), (lbl = 'Supplier');
  else if (groupBy === 'salesman') (keyOf = (r) => String(r.salesman || '(none)')), (lbl = 'Salesman');
  else if (groupBy === 'status') (keyOf = (r) => String(r.status)), (lbl = 'Status');
  else return null;
  const out = rollup(rows, cols, keyOf, (k) => ({ group: k }));
  out.forEach((r) => ((r.invoices = r.count), delete r.count));
  const columns = [col('group', lbl), col('invoices', 'Documents', 'number', true), ...sumCols_];
  return { rows: out, columns };
}

const groupOpts = ['none', 'day', 'month', 'customer', 'salesman', 'status'];

const salesRegister: ReportDef = {
  key: 'sales-register',
  title: 'Sales Register',
  group: 'Sales',
  description: 'Posted sales invoices with totals, VAT and balances. Group by day, month, customer or salesman.',
  params: [P.from, P.to, P.warehouse, P.branch, P.customer, P.salesman, P.product, P.brand, P.category, P.groupBy(groupOpts, 'none')],
  columns: regCols(),
  async run(p) {
    const rows = await registerRows(p, VALID_SALES);
    const g = groupedRegister(rows, regCols(), p.groupBy, 'Customer');
    if (g) return g;
    return { rows };
  },
};

const invoiceRegister: ReportDef = {
  key: 'invoice-register',
  title: 'Invoice Register',
  group: 'Sales',
  description: 'All sales invoices including draft and cancelled (filter by status), with due dates and settlement.',
  params: [P.from, P.to, P.customer, P.salesman, { key: 'status', label: 'Status', type: 'select', options: ['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'].map((s) => ({ value: s, label: s })) }],
  columns: [
    col('docDate', 'Date', 'date'),
    col('docNo', 'Invoice No'),
    col('customer', 'Customer'),
    col('dueDate', 'Due Date', 'date'),
    col('daysOverdue', 'Days Overdue', 'number'),
    col('total', 'Total (AED)', 'money', true),
    col('received', 'Received', 'money', true),
    col('balance', 'Balance', 'money', true),
    col('status', 'Status'),
  ],
  async run(p) {
    const { invs, L } = await loadSales(p, null);
    const now = Date.now();
    const rows = invs.map((i): Row => {
      const rate = num(i.exchangeRate) || 1;
      const total = num(i.baseTotal) || num(i.total) * rate;
      const open = ['POSTED', 'PARTIALLY_PAID'].includes(i.status);
      const bal = open ? total - num(i.receivedAmount) : 0;
      return {
        docDate: iso(i.docDate),
        docNo: i.docNo,
        customer: cust(L, i.customerId),
        dueDate: iso(i.dueDate),
        daysOverdue: open && i.dueDate && bal > 0.005 && new Date(i.dueDate).getTime() < now ? Math.floor((now - new Date(i.dueDate).getTime()) / 86400000) : 0,
        total,
        received: num(i.receivedAmount),
        balance: bal,
        status: i.status,
      };
    });
    return { rows };
  },
};

// ---------------- Sales by customer / product / brand / salesman ----------------
const profitCols = (first: Col[]): Col[] => [
  ...first,
  col('qty', 'Qty', 'qty', true),
  col('net', 'Net Sales', 'money', true),
  col('vat', 'VAT', 'money', true),
  col('total', 'Total', 'money', true),
  col('cost', 'Cost', 'money', true),
  col('profit', 'Gross Profit', 'money', true),
  col('margin', 'GP %', 'percent'),
];

function aggregateLines(lines: SLine[], keyOf: (l: SLine) => string, label: (k: string, l: SLine) => Row): Row[] {
  const m = new Map<string, Row & { _inv: Set<number> }>();
  for (const l of lines) {
    const k = keyOf(l);
    let g = m.get(k);
    if (!g) {
      g = { ...label(k, l), qty: 0, net: 0, vat: 0, total: 0, cost: 0, profit: 0, _inv: new Set<number>() };
      m.set(k, g);
    }
    g.qty = num(g.qty) + num(l.it.qty);
    g.net = num(g.net) + l.net;
    g.vat = num(g.vat) + l.vat;
    g.total = num(g.total) + l.net + l.vat;
    g.cost = num(g.cost) + l.cost;
    g.profit = num(g.profit) + l.net - l.cost;
    g._inv.add(l.inv.id);
  }
  return [...m.values()].map((g) => {
    const { _inv, ...rest } = g;
    return { ...rest, invoices: _inv.size, margin: pct(num(rest.profit), num(rest.net)) } as Row;
  });
}

const salesByCustomer: ReportDef = {
  key: 'sales-by-customer',
  title: 'Sales by Customer',
  group: 'Sales',
  description: 'Net sales, VAT, cost and gross profit per customer.',
  params: [P.from, P.to, P.warehouse, P.branch, P.customer, P.salesman, P.product, P.brand, P.category],
  columns: profitCols([col('code', 'Code'), col('customer', 'Customer'), col('invoices', 'Invoices', 'number', true)]),
  async run(p) {
    const { lines, L } = await loadSales(p);
    const rows = aggregateLines(lines, (l) => String(l.inv.customerId), (k, l) => ({ code: L.customers.get(l.inv.customerId)?.code ?? '', customer: cust(L, l.inv.customerId) }));
    rows.sort((a, b) => num(b.net) - num(a.net));
    return { rows };
  },
};

const salesByProduct: ReportDef = {
  key: 'sales-by-product',
  title: 'Sales by Product',
  group: 'Sales',
  description: 'Quantity sold, average price, net sales and gross profit per product.',
  params: [P.from, P.to, P.warehouse, P.branch, P.customer, P.salesman, P.product, P.brand, P.category],
  columns: [
    col('code', 'Code'),
    col('product', 'Product'),
    col('brand', 'Brand'),
    col('category', 'Category'),
    col('invoices', 'Invoices', 'number', true),
    col('qty', 'Qty', 'qty', true),
    col('avgPrice', 'Avg Price', 'money'),
    col('net', 'Net Sales', 'money', true),
    col('cost', 'Cost', 'money', true),
    col('profit', 'Gross Profit', 'money', true),
    col('margin', 'GP %', 'percent'),
  ],
  async run(p) {
    const { lines, L } = await loadSales(p);
    const rows = aggregateLines(lines, (l) => String(l.it.productId), (k, l) => ({ code: pCode(L, l.it.productId), product: pName(L, l.it.productId), brand: brandName(L, l.it.productId), category: catName(L, l.it.productId) }));
    rows.forEach((r) => (r.avgPrice = num(r.qty) ? num(r.net) / num(r.qty) : 0));
    rows.sort((a, b) => num(b.net) - num(a.net));
    return { rows };
  },
};

const salesByBrand: ReportDef = {
  key: 'sales-by-brand',
  title: 'Sales by Brand',
  group: 'Sales',
  description: 'Sales performance grouped by product brand.',
  params: [P.from, P.to, P.warehouse, P.branch, P.customer, P.salesman, P.brand, P.category],
  columns: profitCols([col('brand', 'Brand'), col('invoices', 'Invoices', 'number', true)]),
  async run(p) {
    const { lines, L } = await loadSales(p);
    const rows = aggregateLines(lines, (l) => brandName(L, l.it.productId), (k) => ({ brand: k }));
    rows.sort((a, b) => num(b.net) - num(a.net));
    return { rows };
  },
};

const salesmanSales: ReportDef = {
  key: 'salesman-sales',
  title: 'Salesman Sales',
  group: 'Sales',
  description: 'Sales, gross profit and commission per salesman.',
  params: [P.from, P.to, P.salesman, P.customer, P.brand, P.category],
  columns: profitCols([col('salesman', 'Salesman'), col('invoices', 'Invoices', 'number', true), col('customers', 'Customers', 'number')]).concat([col('commissionPct', 'Comm %', 'percent'), col('commission', 'Commission', 'money', true)]),
  async run(p) {
    const { lines, L } = await loadSales(p);
    const custs = new Map<string, Set<number>>();
    const key = (l: SLine) => String(l.inv.salesmanId ?? 0);
    for (const l of lines) {
      const k = key(l);
      if (!custs.has(k)) custs.set(k, new Set());
      custs.get(k)!.add(l.inv.customerId);
    }
    const rows = aggregateLines(lines, key, (k, l) => ({ salesman: l.inv.salesmanId ? L.salesmen.get(l.inv.salesmanId)?.name ?? `#${l.inv.salesmanId}` : '(unassigned)', _sid: l.inv.salesmanId }));
    for (const r of rows) {
      const pctv = r._sid ? L.salesmen.get(r._sid as number)?.commissionPct ?? 0 : 0;
      r.commissionPct = pctv;
      r.commission = (num(r.net) * pctv) / 100;
      r.customers = custs.get(String(r._sid ?? 0))?.size ?? 0;
      delete r._sid;
    }
    rows.sort((a, b) => num(b.net) - num(a.net));
    return { rows };
  },
};

// ---------------- Gross profit ----------------
const grossProfit: ReportDef = {
  key: 'gross-profit',
  title: 'Gross Profit',
  group: 'Sales',
  description: 'Gross profit by invoice (uses invoice COGS) or by product (qty x unit cost).',
  params: [P.from, P.to, P.warehouse, P.branch, P.customer, P.salesman, P.product, P.brand, P.category, P.groupBy(['invoice', 'product'], 'invoice')],
  columns: [
    col('docDate', 'Date', 'date'),
    col('docNo', 'Invoice No'),
    col('customer', 'Customer'),
    col('net', 'Net Sales', 'money', true),
    col('cost', 'Cost of Sales', 'money', true),
    col('profit', 'Gross Profit', 'money', true),
    col('margin', 'GP %', 'percent'),
  ],
  async run(p) {
    const { invs, lines, L } = await loadSales(p);
    if (p.groupBy === 'product') {
      const rows = aggregateLines(lines, (l) => String(l.it.productId), (k, l) => ({ code: pCode(L, l.it.productId), product: pName(L, l.it.productId) }));
      rows.sort((a, b) => num(b.profit) - num(a.profit));
      return {
        rows,
        columns: [col('code', 'Code'), col('product', 'Product'), col('qty', 'Qty', 'qty', true), col('net', 'Net Sales', 'money', true), col('cost', 'Cost of Sales', 'money', true), col('profit', 'Gross Profit', 'money', true), col('margin', 'GP %', 'percent')],
      };
    }
    const byInv = new Map<number, { net: number; costLines: number }>();
    for (const l of lines) {
      const g = byInv.get(l.inv.id) ?? { net: 0, costLines: 0 };
      g.net += l.net;
      g.costLines += l.cost;
      byInv.set(l.inv.id, g);
    }
    const hasFilter = !!(p.productId || p.brandId || p.categoryId);
    const rows = invs.map((i): Row => {
      const g = byInv.get(i.id) ?? { net: 0, costLines: 0 };
      // invoice COGS is authoritative unless the report is filtered at product level
      const cost = hasFilter ? g.costLines : num(i.cogs) || g.costLines;
      const net = hasFilter ? g.net : (num(i.subtotal) - num(i.discount)) * (num(i.exchangeRate) || 1);
      return { docDate: iso(i.docDate), docNo: i.docNo, customer: cust(L, i.customerId), net, cost, profit: net - cost, margin: pct(net - cost, net) };
    });
    return { rows };
  },
};

// ---------------- Sales return ----------------
const salesReturn: ReportDef = {
  key: 'sales-return',
  title: 'Sales Return Report',
  group: 'Sales',
  description: 'Posted customer returns with value and reason.',
  params: [P.from, P.to, P.warehouse, P.customer, P.product, P.brand, P.category],
  columns: [
    col('docDate', 'Date', 'date'),
    col('docNo', 'Return No'),
    col('customer', 'Customer'),
    col('invoiceNo', 'Invoice'),
    col('reason', 'Reason'),
    col('qty', 'Qty', 'qty', true),
    col('subtotal', 'Subtotal', 'money', true),
    col('vatAmount', 'VAT', 'money', true),
    col('total', 'Total', 'money', true),
    col('status', 'Status'),
  ],
  async run(p) {
    const pids = await productFilterIds(p);
    const where: Any = { status: p.status || 'POSTED' };
    const dr = dateRange(p);
    if (dr) where.docDate = dr;
    if (p.customerId) where.customerId = p.customerId;
    const wh = await warehouseFilterIds(p);
    if (wh) where.warehouseId = { in: wh };
    if (pids) where.items = { some: { productId: { in: pids } } };
    const rets: Any[] = await prisma.salesReturn.findMany({ where, include: { items: true }, orderBy: { docDate: 'asc' } });
    const L = await loadLookups({ customerIds: rets.map((r) => r.customerId) });
    const invs = await prisma.salesInvoice.findMany({ where: { id: { in: [...new Set(rets.map((r) => r.invoiceId))] } }, select: { id: true, docNo: true } });
    const invNo = new Map(invs.map((i) => [i.id, i.docNo]));
    const rows = rets.map((r): Row => ({
      docDate: iso(r.docDate),
      docNo: r.docNo,
      customer: cust(L, r.customerId),
      invoiceNo: invNo.get(r.invoiceId) ?? '',
      reason: r.reason ?? '',
      qty: r.items.filter((i: Any) => !pids || pids.includes(i.productId)).reduce((a: number, i: Any) => a + num(i.qty), 0),
      subtotal: num(r.subtotal),
      vatAmount: num(r.vatAmount),
      total: num(r.total),
      status: r.status,
    }));
    return { rows };
  },
};

export const salesReports: ReportDef[] = [salesRegister, salesByCustomer, salesByProduct, salesByBrand, salesmanSales, grossProfit, invoiceRegister, salesReturn];
export { rollup, roundRows, sumCols, periodKey };
