import { prisma } from '../lib/prisma';
import { num, r2 } from '../lib/calc';
import { badRequest } from '../lib/errors';
import {
  ReportDef, ReportParams, Row, col, P, dateRange, iso, loadLookups, Lookups, productFilterIds, warehouseFilterIds,
  Col, pct,
} from './report-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

interface Bal {
  productId: number;
  warehouseId: number;
  onHand: number;
  reserved: number;
  avgCost: number;
  value: number;
}

async function loadBalances(p: ReportParams, pids: number[] | null): Promise<Bal[]> {
  const where: Any = {};
  const wh = await warehouseFilterIds(p);
  if (wh) where.warehouseId = { in: wh };
  if (pids) where.productId = { in: pids };
  const rows = await prisma.stockBalance.findMany({ where });
  return rows.map((b) => ({
    productId: b.productId,
    warehouseId: b.warehouseId,
    onHand: num(b.onHand),
    reserved: num(b.reserved),
    avgCost: num(b.avgCost),
    value: num(b.onHand) * num(b.avgCost),
  }));
}

interface PAgg {
  onHand: number;
  reserved: number;
  value: number;
}
function byProduct(bals: Bal[]): Map<number, PAgg> {
  const m = new Map<number, PAgg>();
  for (const b of bals) {
    const g = m.get(b.productId) ?? { onHand: 0, reserved: 0, value: 0 };
    g.onHand += b.onHand;
    g.reserved += b.reserved;
    g.value += b.value;
    m.set(b.productId, g);
  }
  return m;
}

const threshold = (pi: { reorderLevel: number; minStock: number }) => (pi.reorderLevel > 0 ? pi.reorderLevel : pi.minStock);

async function lookups(p: ReportParams, productIds: number[]): Promise<Lookups> {
  return loadLookups({ productIds });
}

// ---------------- Stock summary ----------------
const stockSummary: ReportDef = {
  key: 'stock-summary',
  title: 'Stock Summary',
  group: 'Inventory',
  description: 'On-hand, reserved and available quantity with value per product.',
  params: [P.warehouse, P.branch, P.product, P.brand, P.category, P.includeZero],
  columns: [
    col('code', 'Code'),
    col('product', 'Product'),
    col('oem', 'OEM No'),
    col('brand', 'Brand'),
    col('category', 'Category'),
    col('onHand', 'On Hand', 'qty', true),
    col('reserved', 'Reserved', 'qty', true),
    col('available', 'Available', 'qty', true),
    col('avgCost', 'Avg Cost', 'money'),
    col('value', 'Stock Value', 'money', true),
    col('level', 'Level'),
  ],
  async run(p) {
    const pids = await productFilterIds(p);
    const bals = await loadBalances(p, pids);
    const agg = byProduct(bals);
    const L = await loadLookups({ allProducts: true });
    const rows: Row[] = [];
    const ids = p.includeZero ? [...L.products.keys()].filter((id) => !pids || pids.includes(id)) : [...agg.keys()];
    for (const id of ids) {
      const pi = L.products.get(id);
      if (!pi) continue;
      const a = agg.get(id) ?? { onHand: 0, reserved: 0, value: 0 };
      if (!p.includeZero && Math.abs(a.onHand) < 0.0005 && Math.abs(a.reserved) < 0.0005) continue;
      const th = threshold(pi);
      rows.push({
        code: pi.code,
        product: pi.name,
        oem: pi.oemNumber ?? '',
        brand: pi.brandId ? L.brands.get(pi.brandId) ?? '' : '',
        category: pi.categoryId ? L.categories.get(pi.categoryId) ?? '' : '',
        onHand: a.onHand,
        reserved: a.reserved,
        available: a.onHand - a.reserved,
        avgCost: a.onHand ? a.value / a.onHand : pi.averageCost,
        value: a.value,
        level: a.onHand <= 0 ? 'OUT' : th > 0 && a.onHand <= th ? 'LOW' : 'OK',
      });
    }
    rows.sort((a, b) => String(a.code).localeCompare(String(b.code)));
    return { rows };
  },
};

// ---------------- Warehouse stock ----------------
const warehouseStock: ReportDef = {
  key: 'warehouse-stock',
  title: 'Warehouse Stock',
  group: 'Inventory',
  description: 'Stock per warehouse and product.',
  params: [P.warehouse, P.branch, P.product, P.brand, P.category, P.includeZero],
  columns: [
    col('warehouse', 'Warehouse'),
    col('code', 'Code'),
    col('product', 'Product'),
    col('brand', 'Brand'),
    col('onHand', 'On Hand', 'qty', true),
    col('reserved', 'Reserved', 'qty', true),
    col('available', 'Available', 'qty', true),
    col('avgCost', 'Avg Cost', 'money'),
    col('value', 'Value', 'money', true),
  ],
  async run(p) {
    const pids = await productFilterIds(p);
    const bals = (await loadBalances(p, pids)).filter((b) => p.includeZero || Math.abs(b.onHand) > 0.0005 || Math.abs(b.reserved) > 0.0005);
    const L = await lookups(p, bals.map((b) => b.productId));
    const rows = bals.map((b): Row => ({
      warehouse: L.warehouses.get(b.warehouseId)?.name ?? `#${b.warehouseId}`,
      code: L.products.get(b.productId)?.code ?? '',
      product: L.products.get(b.productId)?.name ?? '',
      brand: L.brands.get(L.products.get(b.productId)?.brandId ?? -1) ?? '',
      onHand: b.onHand,
      reserved: b.reserved,
      available: b.onHand - b.reserved,
      avgCost: b.avgCost,
      value: b.value,
    }));
    rows.sort((a, b) => String(a.warehouse).localeCompare(String(b.warehouse)) || String(a.code).localeCompare(String(b.code)));
    return { rows };
  },
};

// ---------------- Stock valuation ----------------
const stockValuation: ReportDef = {
  key: 'stock-valuation',
  title: 'Stock Valuation',
  group: 'Inventory',
  description: 'Inventory value at weighted-average cost, by product, brand, category or warehouse.',
  params: [P.warehouse, P.branch, P.product, P.brand, P.category, P.groupBy(['product', 'brand', 'category', 'warehouse'], 'product')],
  columns: [col('code', 'Code'), col('product', 'Product'), col('brand', 'Brand'), col('onHand', 'On Hand', 'qty', true), col('avgCost', 'Avg Cost', 'money'), col('value', 'Value', 'money', true), col('share', '% of Total', 'percent')],
  async run(p) {
    const pids = await productFilterIds(p);
    const bals = (await loadBalances(p, pids)).filter((b) => Math.abs(b.onHand) > 0.0005);
    const L = await lookups(p, bals.map((b) => b.productId));
    const gb = p.groupBy || 'product';
    let rows: Row[];
    let columns: Col[] | undefined;
    if (gb === 'product') {
      const agg = byProduct(bals);
      rows = [...agg.entries()].map(([id, a]) => ({ code: L.products.get(id)?.code ?? '', product: L.products.get(id)?.name ?? '', brand: L.brands.get(L.products.get(id)?.brandId ?? -1) ?? '', onHand: a.onHand, avgCost: a.onHand ? a.value / a.onHand : 0, value: a.value }));
    } else {
      const m = new Map<string, Row>();
      for (const b of bals) {
        const pi = L.products.get(b.productId);
        const k = gb === 'brand' ? L.brands.get(pi?.brandId ?? -1) ?? '(no brand)' : gb === 'category' ? L.categories.get(pi?.categoryId ?? -1) ?? '(no category)' : L.warehouses.get(b.warehouseId)?.name ?? `#${b.warehouseId}`;
        const g = m.get(k) ?? { group: k, products: new Set<number>() as unknown as number, onHand: 0, value: 0 };
        (g.products as unknown as Set<number>).add(b.productId);
        g.onHand = num(g.onHand) + b.onHand;
        g.value = num(g.value) + b.value;
        m.set(k, g);
      }
      rows = [...m.values()].map((g) => ({ group: g.group, products: (g.products as unknown as Set<number>).size, onHand: g.onHand, avgCost: num(g.onHand) ? num(g.value) / num(g.onHand) : 0, value: g.value }));
      columns = [col('group', gb[0].toUpperCase() + gb.slice(1)), col('products', 'Products', 'number', true), col('onHand', 'On Hand', 'qty', true), col('avgCost', 'Avg Cost', 'money'), col('value', 'Value', 'money', true), col('share', '% of Total', 'percent')];
    }
    const tot = rows.reduce((a, r) => a + num(r.value), 0);
    rows.forEach((r) => (r.share = pct(num(r.value), tot)));
    rows.sort((a, b) => num(b.value) - num(a.value));
    return { rows, columns };
  },
};

// ---------------- Low stock ----------------
const lowStock: ReportDef = {
  key: 'low-stock',
  title: 'Low Stock',
  group: 'Inventory',
  description: 'Active products at or below reorder level (or minimum stock).',
  params: [P.warehouse, P.branch, P.brand, P.category, P.supplier],
  columns: [
    col('code', 'Code'),
    col('product', 'Product'),
    col('brand', 'Brand'),
    col('onHand', 'On Hand', 'qty', true),
    col('reserved', 'Reserved', 'qty', true),
    col('reorderLevel', 'Reorder Level', 'qty'),
    col('minStock', 'Min Stock', 'qty'),
    col('maxStock', 'Max Stock', 'qty'),
    col('shortage', 'Shortage', 'qty', true),
    col('suggested', 'Suggested Order', 'qty', true),
    col('lastCost', 'Last Cost', 'money'),
  ],
  async run(p) {
    const pids = await productFilterIds(p);
    const bals = byProduct(await loadBalances(p, null));
    const L = await loadLookups({ allProducts: true });
    const primary = p.supplierId ? await prisma.product.findMany({ where: { primarySupplierId: p.supplierId }, select: { id: true } }) : null;
    const prim = primary ? new Set(primary.map((x) => x.id)) : null;
    const rows: Row[] = [];
    for (const pi of L.products.values()) {
      if (!pi.isActive) continue;
      if (pids && !pids.includes(pi.id)) continue;
      if (prim && !prim.has(pi.id)) continue;
      const th = threshold(pi);
      if (th <= 0) continue;
      const a = bals.get(pi.id) ?? { onHand: 0, reserved: 0, value: 0 };
      if (a.onHand > th) continue;
      rows.push({
        code: pi.code,
        product: pi.name,
        brand: pi.brandId ? L.brands.get(pi.brandId) ?? '' : '',
        onHand: a.onHand,
        reserved: a.reserved,
        reorderLevel: pi.reorderLevel,
        minStock: pi.minStock,
        maxStock: pi.maxStock,
        shortage: Math.max(0, th - a.onHand),
        suggested: Math.max(pi.maxStock > 0 ? pi.maxStock - a.onHand : 0, th - a.onHand),
        lastCost: pi.averageCost,
      });
    }
    rows.sort((a, b) => num(b.shortage) - num(a.shortage));
    return { rows };
  },
};

// ---------------- Dead stock ----------------
const deadStock: ReportDef = {
  key: 'dead-stock',
  title: 'Dead Stock',
  group: 'Inventory',
  description: 'Products with stock on hand and no stock movement in the last N days (param days, default 180).',
  params: [P.days, P.warehouse, P.branch, P.brand, P.category],
  columns: [
    col('code', 'Code'),
    col('product', 'Product'),
    col('brand', 'Brand'),
    col('onHand', 'On Hand', 'qty', true),
    col('value', 'Stock Value', 'money', true),
    col('lastMovement', 'Last Movement', 'date'),
    col('lastIssue', 'Last Issue', 'date'),
    col('daysIdle', 'Days Idle', 'number'),
  ],
  async run(p) {
    const pids = await productFilterIds(p);
    const bals = await loadBalances(p, pids);
    const agg = byProduct(bals);
    const ids = [...agg.entries()].filter(([, a]) => a.onHand > 0.0005).map(([id]) => id);
    const L = await lookups(p, ids);
    const wh = await warehouseFilterIds(p);
    const txWhere: Any = { productId: { in: ids } };
    if (wh) txWhere.warehouseId = { in: wh };
    const [last, lastOut] = ids.length
      ? await Promise.all([
          prisma.stockTransaction.groupBy({ by: ['productId'], where: txWhere, _max: { txDate: true } }),
          prisma.stockTransaction.groupBy({ by: ['productId'], where: { ...txWhere, qty: { lt: 0 } }, _max: { txDate: true } }),
        ])
      : [[], []];
    const lm = new Map(last.map((x) => [x.productId, x._max.txDate]));
    const lo = new Map(lastOut.map((x) => [x.productId, x._max.txDate]));
    const now = Date.now();
    const cutoff = now - p.days * 86400000;
    const rows: Row[] = [];
    for (const id of ids) {
      const lastMove = lm.get(id) ?? null;
      if (lastMove && lastMove.getTime() >= cutoff) continue;
      const a = agg.get(id)!;
      rows.push({
        code: L.products.get(id)?.code ?? '',
        product: L.products.get(id)?.name ?? '',
        brand: L.brands.get(L.products.get(id)?.brandId ?? -1) ?? '',
        onHand: a.onHand,
        value: a.value,
        lastMovement: iso(lastMove),
        lastIssue: iso(lo.get(id)),
        daysIdle: lastMove ? Math.floor((now - lastMove.getTime()) / 86400000) : null,
      });
    }
    rows.sort((a, b) => num(b.value) - num(a.value));
    return { rows };
  },
};

// ---------------- Fast / slow moving ----------------
async function soldQty(p: ReportParams, pids: number[] | null) {
  const where: Any = { txType: 'SALES_DELIVERY' };
  const from = p.from ?? new Date(Date.now() - 90 * 86400000);
  where.txDate = { gte: from, ...(p.to ? { lte: p.to } : {}) };
  const wh = await warehouseFilterIds(p);
  if (wh) where.warehouseId = { in: wh };
  if (pids) where.productId = { in: pids };
  const g = await prisma.stockTransaction.groupBy({ by: ['productId'], where, _sum: { qty: true, value: true } });
  const days = Math.max(1, Math.ceil(((p.to ?? new Date()).getTime() - from.getTime()) / 86400000));
  return { sold: new Map(g.map((x) => [x.productId, { qty: -num(x._sum.qty), cost: -num(x._sum.value) }])), days };
}
const movingCols = (): Col[] => [
  col('rank', '#', 'number'),
  col('code', 'Code'),
  col('product', 'Product'),
  col('brand', 'Brand'),
  col('soldQty', 'Qty Sold', 'qty', true),
  col('costValue', 'Cost Value Sold', 'money', true),
  col('avgPerDay', 'Avg / Day', 'qty'),
  col('onHand', 'On Hand', 'qty', true),
  col('daysCover', 'Days Cover', 'number'),
];
const fastMoving: ReportDef = {
  key: 'fast-moving',
  title: 'Fast Moving Items',
  group: 'Inventory',
  description: 'Top N products by quantity delivered to customers in the period (default last 90 days).',
  params: [P.from, P.to, P.top, P.warehouse, P.branch, P.brand, P.category],
  columns: movingCols(),
  async run(p) {
    const pids = await productFilterIds(p);
    const { sold, days } = await soldQty(p, pids);
    const bals = byProduct(await loadBalances(p, pids));
    const top = [...sold.entries()].filter(([, s]) => s.qty > 0).sort((a, b) => b[1].qty - a[1].qty).slice(0, p.top);
    const L = await lookups(p, top.map(([id]) => id));
    const rows = top.map(([id, s], i): Row => {
      const oh = bals.get(id)?.onHand ?? 0;
      const perDay = s.qty / days;
      return { rank: i + 1, code: L.products.get(id)?.code ?? '', product: L.products.get(id)?.name ?? '', brand: L.brands.get(L.products.get(id)?.brandId ?? -1) ?? '', soldQty: s.qty, costValue: s.cost, avgPerDay: perDay, onHand: oh, daysCover: perDay > 0 ? Math.round(oh / perDay) : null };
    });
    return { rows };
  },
};
const slowMoving: ReportDef = {
  key: 'slow-moving',
  title: 'Slow Moving Items',
  group: 'Inventory',
  description: 'Bottom N stocked products by quantity delivered in the period (default last 90 days).',
  params: [P.from, P.to, P.top, P.warehouse, P.branch, P.brand, P.category],
  columns: movingCols(),
  async run(p) {
    const pids = await productFilterIds(p);
    const { sold, days } = await soldQty(p, pids);
    const bals = byProduct(await loadBalances(p, pids));
    const cand = [...bals.entries()].filter(([, a]) => a.onHand > 0.0005).map(([id, a]) => ({ id, a, s: sold.get(id) ?? { qty: 0, cost: 0 } }));
    cand.sort((x, y) => x.s.qty - y.s.qty || y.a.value - x.a.value);
    const top = cand.slice(0, p.top);
    const L = await lookups(p, top.map((t) => t.id));
    const rows = top.map(({ id, a, s }, i): Row => {
      const perDay = s.qty / days;
      return { rank: i + 1, code: L.products.get(id)?.code ?? '', product: L.products.get(id)?.name ?? '', brand: L.brands.get(L.products.get(id)?.brandId ?? -1) ?? '', soldQty: s.qty, costValue: s.cost, avgPerDay: perDay, onHand: a.onHand, daysCover: perDay > 0 ? Math.round(a.onHand / perDay) : null };
    });
    return { rows };
  },
};

// ---------------- Stock movement ----------------
const MOVE_BUCKETS: Record<string, string> = {
  OPENING: 'receipts',
  PURCHASE_RECEIPT: 'receipts',
  WAREHOUSE_RECEIPT: 'receipts',
  SALES_DELIVERY: 'sales',
  SALES_RETURN: 'salesReturn',
  PURCHASE_RETURN: 'purchaseReturn',
  TRANSFER_IN: 'transferIn',
  TRANSFER_OUT: 'transferOut',
};
const stockMovement: ReportDef = {
  key: 'stock-movement',
  title: 'Stock Movement',
  group: 'Inventory',
  description: 'Opening, movement by transaction type and closing quantity per product.',
  params: [P.from, P.to, P.warehouse, P.branch, P.product, P.brand, P.category],
  columns: [
    col('code', 'Code'),
    col('product', 'Product'),
    col('opening', 'Opening', 'qty', true),
    col('receipts', 'Receipts', 'qty', true),
    col('purchaseReturn', 'Purch. Return', 'qty', true),
    col('sales', 'Sales Delivery', 'qty', true),
    col('salesReturn', 'Sales Return', 'qty', true),
    col('transferIn', 'Transfer In', 'qty', true),
    col('transferOut', 'Transfer Out', 'qty', true),
    col('adjustments', 'Adjustments', 'qty', true),
    col('closing', 'Closing', 'qty', true),
  ],
  async run(p) {
    const pids = await productFilterIds(p);
    const base: Any = {};
    const wh = await warehouseFilterIds(p);
    if (wh) base.warehouseId = { in: wh };
    if (pids) base.productId = { in: pids };
    const dr = dateRange(p);
    const [inPeriod, before] = await Promise.all([
      prisma.stockTransaction.groupBy({ by: ['productId', 'txType'], where: { ...base, ...(dr ? { txDate: dr } : {}) }, _sum: { qty: true } }),
      p.from ? prisma.stockTransaction.groupBy({ by: ['productId'], where: { ...base, txDate: { lt: p.from } }, _sum: { qty: true } }) : Promise.resolve([]),
    ]);
    const m = new Map<number, Row>();
    const get = (id: number) => {
      let r = m.get(id);
      if (!r) m.set(id, (r = { opening: 0, receipts: 0, purchaseReturn: 0, sales: 0, salesReturn: 0, transferIn: 0, transferOut: 0, adjustments: 0, closing: 0 }));
      return r;
    };
    for (const b of before) get(b.productId).opening = num(b._sum.qty);
    for (const x of inPeriod) {
      const r = get(x.productId);
      const bucket = MOVE_BUCKETS[x.txType] ?? 'adjustments';
      r[bucket] = num(r[bucket]) + num(x._sum.qty);
    }
    const L = await lookups(p, [...m.keys()]);
    const rows: Row[] = [];
    for (const [id, r] of m) {
      r.closing = ['opening', 'receipts', 'purchaseReturn', 'sales', 'salesReturn', 'transferIn', 'transferOut', 'adjustments'].reduce((a, k) => a + num(r[k]), 0);
      if (['opening', 'receipts', 'purchaseReturn', 'sales', 'salesReturn', 'transferIn', 'transferOut', 'adjustments', 'closing'].every((k) => Math.abs(num(r[k])) < 0.0005)) continue;
      rows.push({ code: L.products.get(id)?.code ?? '', product: L.products.get(id)?.name ?? '', ...r });
    }
    rows.sort((a, b) => String(a.code).localeCompare(String(b.code)));
    return { rows };
  },
};

// ---------------- Stock ledger ----------------
const stockLedger: ReportDef = {
  key: 'stock-ledger',
  title: 'Stock Ledger',
  group: 'Inventory',
  description: 'Chronological stock transactions for one product with running balance.',
  params: [{ ...P.product, required: true }, P.from, P.to, P.warehouse, P.branch],
  columns: [
    col('date', 'Date', 'date'),
    col('type', 'Type'),
    col('refNo', 'Reference'),
    col('warehouse', 'Warehouse'),
    col('remarks', 'Remarks'),
    col('qtyIn', 'In', 'qty', true),
    col('qtyOut', 'Out', 'qty', true),
    col('balance', 'Balance', 'qty'),
    col('unitCost', 'Unit Cost', 'money'),
    col('value', 'Value', 'money', true),
  ],
  async run(p) {
    if (!p.productId) throw badRequest('productId is required for the stock ledger');
    const base: Any = { productId: p.productId };
    const wh = await warehouseFilterIds(p);
    if (wh) base.warehouseId = { in: wh };
    const txs = await prisma.stockTransaction.findMany({ where: { ...base, ...(dateRange(p) ? { txDate: dateRange(p) } : {}) }, orderBy: [{ txDate: 'asc' }, { id: 'asc' }] });
    let running = 0;
    const rows: Row[] = [];
    if (p.from) {
      const o = await prisma.stockTransaction.aggregate({ where: { ...base, txDate: { lt: p.from } }, _sum: { qty: true, value: true } });
      running = num(o._sum.qty);
      rows.push({ date: iso(p.from), type: 'OPENING BALANCE', refNo: '', warehouse: '', remarks: '', qtyIn: 0, qtyOut: 0, balance: running, unitCost: 0, value: num(o._sum.value) });
    }
    const L = await loadLookups({});
    for (const t of txs) {
      const q = num(t.qty);
      running += q;
      rows.push({
        date: iso(t.txDate),
        type: t.txType,
        refNo: t.refNo ?? '',
        warehouse: L.warehouses.get(t.warehouseId)?.name ?? '',
        remarks: t.remarks ?? '',
        qtyIn: q > 0 ? q : 0,
        qtyOut: q < 0 ? -q : 0,
        balance: running,
        unitCost: num(t.unitCost),
        value: num(t.value),
      });
    }
    const prod = await prisma.product.findUnique({ where: { id: p.productId }, select: { code: true, name: true } });
    return { rows, title: prod ? `Stock Ledger - ${prod.code} ${prod.name}` : undefined, totals: { qtyIn: r2(rows.reduce((a, r) => a + num(r.qtyIn), 0)), qtyOut: r2(rows.reduce((a, r) => a + num(r.qtyOut), 0)), balance: running } };
  },
};

// ---------------- Stock aging ----------------
const AGING_IN_TYPES = ['OPENING', 'PURCHASE_RECEIPT', 'WAREHOUSE_RECEIPT', 'SALES_RETURN', 'ADJUSTMENT', 'COUNT'];
const stockAging: ReportDef = {
  key: 'stock-aging',
  title: 'Stock Aging',
  group: 'Inventory',
  description: 'On-hand quantity aged by days since receipt (FIFO approximation: remaining stock is attributed to the most recent receipts).',
  params: [P.warehouse, P.branch, P.product, P.brand, P.category],
  columns: [
    col('code', 'Code'),
    col('product', 'Product'),
    col('onHand', 'On Hand', 'qty', true),
    col('b0', '0-30 d', 'qty', true),
    col('b1', '31-60 d', 'qty', true),
    col('b2', '61-90 d', 'qty', true),
    col('b3', '91-180 d', 'qty', true),
    col('b4', '180+ d', 'qty', true),
    col('value', 'Stock Value', 'money', true),
    col('value180', 'Value 180+ d', 'money', true),
    col('oldest', 'Oldest Receipt', 'date'),
  ],
  async run(p) {
    const pids = await productFilterIds(p);
    const bals = await loadBalances(p, pids);
    const agg = byProduct(bals);
    const ids = [...agg.entries()].filter(([, a]) => a.onHand > 0.0005).map(([id]) => id);
    const L = await lookups(p, ids);
    const wh = await warehouseFilterIds(p);
    const txs = ids.length
      ? await prisma.stockTransaction.findMany({
          where: { productId: { in: ids }, qty: { gt: 0 }, txType: { in: AGING_IN_TYPES }, ...(wh ? { warehouseId: { in: wh } } : {}) },
          select: { productId: true, txDate: true, qty: true },
          orderBy: { txDate: 'desc' },
        })
      : [];
    const byP = new Map<number, { d: Date; q: number }[]>();
    for (const t of txs) {
      const a = byP.get(t.productId) ?? [];
      a.push({ d: t.txDate, q: num(t.qty) });
      byP.set(t.productId, a);
    }
    const now = Date.now();
    const rows: Row[] = [];
    for (const id of ids) {
      const a = agg.get(id)!;
      let remaining = a.onHand;
      const b = [0, 0, 0, 0, 0];
      let oldest: Date | null = null;
      for (const rc of byP.get(id) ?? []) {
        if (remaining <= 0.0005) break;
        const take = Math.min(remaining, rc.q);
        remaining -= take;
        const age = Math.floor((now - rc.d.getTime()) / 86400000);
        b[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : age <= 180 ? 3 : 4] += take;
        oldest = rc.d;
      }
      if (remaining > 0.0005) b[4] += remaining; // no receipt history for the remainder
      const unit = a.onHand ? a.value / a.onHand : 0;
      rows.push({ code: L.products.get(id)?.code ?? '', product: L.products.get(id)?.name ?? '', onHand: a.onHand, b0: b[0], b1: b[1], b2: b[2], b3: b[3], b4: b[4], value: a.value, value180: b[4] * unit, oldest: iso(oldest) });
    }
    rows.sort((x, y) => num(y.b4) - num(x.b4) || String(x.code).localeCompare(String(y.code)));
    return { rows };
  },
};

export const inventoryReports: ReportDef[] = [stockSummary, stockLedger, stockValuation, warehouseStock, lowStock, deadStock, fastMoving, slowMoving, stockMovement, stockAging];
