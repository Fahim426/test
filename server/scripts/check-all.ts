/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Read-only health check of the whole API (GET only, plus 2 harmless POST /export calls) and ledger integrity.
 *   cd server && BASE=http://localhost:4000/api npx tsx scripts/check-all.ts [--verbose]
 * Exit code 1 when any problem is found. Prints a grouped list of PROBLEMS and INFO notes.
 */
import { prisma } from '../src/lib/prisma';

const BASE = process.env.BASE || 'http://localhost:4000/api';
const VERBOSE = process.argv.includes('--verbose');
let token = '';
const problems: string[] = [];
const info: string[] = [];
let requests = 0;
const problem = (m: string) => { if (!problems.includes(m)) problems.push(m); };
const note = (m: string) => info.push(m);
const N = (v: any) => Number(v ?? 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const near = (a: number, b: number, t = 0.011) => Math.abs(a - b) <= t;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());
const FROM = iso(new Date(Date.now() - 200 * 86400000));

interface Res { status: number; data: any; ct: string; bytes: number }
async function req(method: string, path: string, body?: unknown): Promise<Res> {
  requests++;
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = r.headers.get('content-type') || '';
  if (/json/.test(ct)) { const t = await r.text(); let d: any; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, ct, bytes: t.length }; }
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, data: buf, ct, bytes: buf.length };
}

/** keys whose value should always be a finite number when present */
const NUMERIC_KEY = /^(qty|quantity|amount|total|subtotal|baseTotal|vatAmount|discount|rate|price|cost|unitCost|avgCost|averageCost|balance|outstanding|debit|credit|onHand|reserved|available|value|stockValue|receivedAmount|paidAmount|retailPrice|wholesalePrice|costPrice|orderedQty|receivedQty|pendingQty|closingBalance|openingBalance|netProfit|revenue|income|expenses|vat|netPayable)$/;
const AMOUNT_NULL_OK = /^\/(doc-flow|dashboard|recent-documents|search)/;
function scan(path: string, data: any, depth = 0, key = '') {
  if (depth > 6 || data === null || data === undefined) return;
  if (typeof data === 'number') { if (!Number.isFinite(data)) problem(`${path}: non-finite number at ${key}`); return; }
  if (typeof data === 'string') { if (/^(NaN|Infinity|-Infinity|undefined|\[object Object\])$/.test(data)) problem(`${path}: suspicious string "${data}" at ${key}`); return; }
  if (Array.isArray(data)) { data.slice(0, 40).forEach((x) => scan(path, x, depth + 1, key)); return; }
  if (typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) {
      if (NUMERIC_KEY.test(k) && !(k === 'amount' && AMOUNT_NULL_OK.test(path)) && (v === null || (typeof v === 'string' && v !== '' && !Number.isFinite(Number(v))))) problem(`${path}: numeric field "${k}" is ${JSON.stringify(v)}`);
      scan(path, v, depth + 1, k);
    }
  }
}
async function get(path: string, opts: { expect?: number; scanIt?: boolean; allow404?: boolean } = {}): Promise<Res> {
  let r: Res;
  try { r = await req('GET', path); } catch (e: any) { problem(`GET ${path}: request failed ${e.message}`); return { status: 0, data: null, ct: '', bytes: 0 }; }
  const exp = opts.expect ?? 200;
  if (r.status !== exp) { if (!(opts.allow404 && r.status === 404)) problem(`GET ${path} -> ${r.status} ${typeof r.data === 'string' ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 200)}`); }
  else if (opts.scanIt !== false && typeof r.data === 'object' && !Buffer.isBuffer(r.data)) scan(path, r.data);
  if (VERBOSE) console.log(`  ${r.status} GET ${path} (${r.bytes}b)`);
  return r;
}
const rowsOf = (d: any): any[] => (Array.isArray(d) ? d : Array.isArray(d?.rows) ? d.rows : Array.isArray(d?.items) ? d.items : []);

async function main() {
  const login = await req('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  token = login.data?.accessToken || login.data?.token;
  if (!token) { console.log('login failed', login.status); process.exit(2); }
  await get('/auth/me', { allow404: true });

  // ------------------------------------------------------------------------------------- lists + /:id samples
  console.log('== lists and sample records');
  const resources = [
    'products', 'customers', 'suppliers', 'brands', 'categories', 'warehouses', 'units', 'currencies', 'vat-codes', 'payment-terms', 'salesmen', 'territories', 'areas', 'branches', 'business-units', 'product-groups', 'product-types', 'company',
    'material-requests', 'purchase-requisitions', 'purchase-enquiries', 'supplier-quotations', 'purchase-orders', 'goods-receipts', 'purchase-invoices', 'purchase-returns',
    'import-requests', 'supplier-proformas', 'import-orders', 'import-shipments', 'landed-costs',
    'sales-enquiries', 'sales-quotations', 'sales-orders', 'proforma-invoices', 'picking-lists', 'packing-lists', 'delivery-notes', 'sales-invoices', 'sales-returns',
    'stock-adjustments', 'stock-transfers', 'accounts', 'journals', 'vouchers', 'receipts', 'payments', 'notes',
    'users', 'roles', 'approval-rules', 'approvals', 'audit-logs', 'numbering',
  ];
  const sampleIds: Record<string, number[]> = {};
  for (const res of resources) {
    const l = await get(`/${res}?pageSize=100`);
    if (l.status !== 200) continue;
    const rows = rowsOf(l.data);
    if (!rows.length && !['approvals', 'audit-logs', 'landed-costs', 'users', 'roles'].includes(res)) note(`/${res}: list is empty`);
    if (l.data && typeof l.data.total === 'number' && l.data.rows && l.data.total < l.data.rows.length) problem(`/${res}: total ${l.data.total} < rows ${l.data.rows.length}`);
    const ids = rows.map((r) => r.id).filter((x) => typeof x === 'number');
    sampleIds[res] = ids;
    // first, middle and last record of the list
    const picks = [...new Set([ids[0], ids[Math.floor(ids.length / 2)], ids[ids.length - 1]].filter((x) => x !== undefined))];
    for (const id of picks) {
      if (['numbering', 'audit-logs', 'approvals'].includes(res)) continue;
      await get(`/${res}/${id}`, { allow404: res === 'numbering' });
    }
    // page 2 + search + sort do not break
    if (l.data?.total > 100) await get(`/${res}?pageSize=100&page=2`);
    await get(`/${res}?search=zzz-no-match`);
  }
  // list-shape extras
  for (const p of [
    '/purchase-orders/open', '/goods-receipts/pending-invoice', '/purchase-invoices/outstanding', '/goods-in-transit', '/stock-transfers/in-transit', '/sales-orders/open', '/sales-invoices/outstanding', '/sales/pipeline-summary',
    '/vouchers/advances', '/receivables/customers', '/receivables/outstanding', '/receivables/due-today', '/receivables/overdue', '/payables/suppliers', '/payables/outstanding', '/payables/due-today', '/payables/overdue',
    '/products/lookup?q=brake', '/products/vehicle-makes', '/products/vehicle-models?make=Toyota', '/products/by-vehicle?make=Toyota&model=Camry', '/accounts?tree=1&balances=1', '/accounts?all=1',
    '/recent-documents', '/pending-approvals-count', '/report-builder/entities', '/report-builder/saved', '/documents/types', '/permissions/catalog', '/settings', '/favorites',
  ]) await get(p, { allow404: p.startsWith('/payables/due-today') });

  // special /:id forms
  const supp = sampleIds['suppliers']?.[0], cust = sampleIds['customers']?.[0];
  const po = sampleIds['purchase-orders']?.[0];
  if (po) await get(`/goods-receipts/prefill/${po}`, { allow404: true });
  if (sampleIds['sales-invoices']?.[0]) await get(`/sales-invoices/${sampleIds['sales-invoices'][0]}/print`);
  if (sampleIds['purchase-enquiries']?.[0]) await get(`/comparative-statements/${sampleIds['purchase-enquiries'][0]}`, { allow404: true });
  if (cust) await get(`/vouchers/open-invoices?partyType=CUSTOMER&partyId=${cust}`);
  if (supp) await get(`/vouchers/open-invoices?partyType=SUPPLIER&partyId=${supp}`);

  // ------------------------------------------------------------------------------------- dashboard / search / docflow / PDFs
  console.log('== dashboard, search, doc-flow, PDFs');
  await get('/dashboard');
  await get('/dashboard/widgets');
  await get('/dashboard/widget-catalog');
  await get('/finance/dashboard-metrics');
  for (const q of ['brake', 'filter', '04465', 'Toyota', 'C0001', 'SO-2026', 'Futtaim']) await get(`/search?q=${encodeURIComponent(q)}`);
  await get('/search/part?q=04465-33471', { allow404: true }); await get('/search/part/04465-33471', { allow404: true });
  const flowTypes: [string, string][] = [['SALES_ORDER', 'sales-orders'], ['SALES_INVOICE', 'sales-invoices'], ['DELIVERY_NOTE', 'delivery-notes'], ['SALES_QUOTATION', 'sales-quotations'], ['PURCHASE_ORDER', 'purchase-orders'], ['GOODS_RECEIPT', 'goods-receipts'], ['PURCHASE_INVOICE', 'purchase-invoices'], ['IMPORT_SHIPMENT', 'import-shipments'], ['LANDED_COST', 'landed-costs'], ['SUPPLIER_QUOTATION', 'supplier-quotations'], ['PURCHASE_REQUISITION', 'purchase-requisitions'], ['SALES_RETURN', 'sales-returns'], ['PURCHASE_RETURN', 'purchase-returns'], ['PICKING_LIST', 'picking-lists'], ['PACKING_LIST', 'packing-lists'], ['RECEIPT_VOUCHER', 'receipts'], ['PAYMENT_VOUCHER', 'payments']];
  for (const [t, res] of flowTypes) for (const id of (sampleIds[res] ?? []).slice(0, 3)) await get(`/doc-flow/${t}/${id}`);
  const pdfTypes: [string, string][] = [['PURCHASE_ORDER', 'purchase-orders'], ['GOODS_RECEIPT', 'goods-receipts'], ['PURCHASE_INVOICE', 'purchase-invoices'], ['SALES_QUOTATION', 'sales-quotations'], ['SALES_ORDER', 'sales-orders'], ['DELIVERY_NOTE', 'delivery-notes'], ['SALES_INVOICE', 'sales-invoices']];
  for (const [t, res] of pdfTypes) for (const id of (sampleIds[res] ?? []).slice(0, 4)) {
    const r = await get(`/documents/${t}/${id}/pdf`, { scanIt: false });
    if (r.status === 200 && !(Buffer.isBuffer(r.data) && r.data.slice(0, 4).toString() === '%PDF')) problem(`PDF ${t}/${id}: not a PDF (${r.ct})`);
  }

  // ------------------------------------------------------------------------------------- reports
  console.log('== reports catalog');
  const cat = await get('/reports/catalog');
  const reports: any[] = (cat.data?.groups ?? []).flatMap((g: any) => g.reports);
  if (!reports.length) problem('/reports/catalog returned no reports');
  const sampleCust = sampleIds['customers']?.[10] ?? cust, sampleSupp = sampleIds['suppliers']?.[3] ?? supp, sampleProd = sampleIds['products']?.[3];
  for (const rep of reports) {
    const qs = new URLSearchParams();
    for (const p of rep.params ?? []) {
      if (p.key === 'from') qs.set('from', FROM);
      else if (p.key === 'to') qs.set('to', TODAY);
      else if (p.key === 'customerId' && sampleCust) qs.set('customerId', String(sampleCust));
      else if (p.key === 'supplierId' && sampleSupp) qs.set('supplierId', String(sampleSupp));
      else if (p.key === 'productId' && sampleProd && (rep.key.includes('card') || rep.key.includes('ledger'))) qs.set('productId', String(sampleProd));
      else if (p.key === 'groupBy' && p.options?.[0]) qs.set('groupBy', p.options[0].value);
    }
    if (rep.source === 'finance') {
      // finance reports are served by the finance modules; the catalog endpoint must exist
      const ep = String(rep.endpoint).replace(/^\/api/, '');
      let url = ep;
      if (/statement$/.test(ep)) { const id = ep.includes('receivables') ? sampleCust : sampleSupp; url = `${ep}/${id}`; qs.delete('customerId'); qs.delete('supplierId'); }
      if (/\/general/.test(ep)) { const ar = await prisma.account.findUnique({ where: { systemKey: 'CASH' } }); qs.set('accountId', String(ar?.id ?? 1)); }
      await get(`${url}?${qs.toString()}`);
      continue;
    }
    const r = await get(`/reports/run/${rep.key}?${qs.toString()}`);
    if (r.status === 200) {
      if (!Array.isArray(r.data?.rows) || !Array.isArray(r.data?.columns)) problem(`report ${rep.key}: missing rows/columns`);
      else if (!r.data.rows.length) note(`report ${rep.key}: no rows for sample params`);
      for (const [k, v] of Object.entries(r.data?.totals ?? {})) if (typeof v === 'number' && !Number.isFinite(v)) problem(`report ${rep.key}: totals.${k} not finite`);
    }
  }
  for (const k of ['sales-register', 'stock-valuation', 'purchase-register'].filter((k) => reports.some((r) => r.key === k)))
    for (const f of ['csv', 'xlsx', 'pdf']) { const r = await get(`/reports/run/${k}?from=${FROM}&to=${TODAY}&format=${f}`, { scanIt: false }); if (r.status === 200 && r.bytes < 50) problem(`export ${k}.${f} is empty`); }
  if (reports[0]) await get(`/reports/print/${reports.find((r) => r.source !== 'finance')?.key}?from=${FROM}&to=${TODAY}`, { scanIt: false });
  for (const fmt of ['csv', 'xlsx', 'pdf']) {
    const r = await req('POST', '/export/rows', { format: fmt, title: 'check', columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B', type: 'number' }], rows: [{ a: 'x', b: 1.5 }] });
    if (r.status !== 200) problem(`POST /export/rows ${fmt} -> ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  }

  // ------------------------------------------------------------------------------------- finance reports + integrity
  console.log('== finance reports');
  const tb = await get(`/ledger/trial-balance?asOf=${TODAY}`);
  if (tb.data && tb.data.balanced !== true) problem(`trial balance not balanced ${JSON.stringify(tb.data.totals)}`);
  const tb2 = await get(`/ledger/trial-balance?from=${FROM}&to=${TODAY}`);
  if (tb2.data && tb2.data.balanced !== true) problem(`trial balance (period) not balanced ${JSON.stringify(tb2.data.totals)}`);
  const bs = await get(`/ledger/balance-sheet?asOf=${TODAY}`);
  if (bs.data && (bs.data.balanced !== true)) problem(`balance sheet not balancing: difference ${bs.data.difference}`);
  const pl = await get(`/ledger/profit-loss?from=${FROM}&to=${TODAY}`);
  if (pl.data && !near(N(pl.data.netProfit), N(pl.data.revenue?.total) - N(pl.data.cogs?.total) - N(pl.data.expenses?.total))) problem('P&L net != revenue - cogs - expenses');
  const cf = await get(`/ledger/cash-flow?from=${FROM}&to=${TODAY}`);
  if (cf.data && !near(N(cf.data.closingBalance), N(cf.data.openingBalance) + N(cf.data.netChange))) problem('cash flow closing != opening + net change');
  for (const k of ['cash-book', 'bank-book', 'sales', 'purchase', 'receipts', 'payments', 'journal']) await get(`/registers/${k}?from=${FROM}&to=${TODAY}`);
  const vs = await get(`/vat/summary?from=${FROM}&to=${TODAY}`);
  if (vs.data && !near(N(vs.data.netPayable), N(vs.data.outputVat) - N(vs.data.inputVat))) problem('VAT netPayable != output - input');
  await get(`/vat/transactions?type=SALES&from=${FROM}&to=${TODAY}`);
  await get(`/vat/transactions?type=PURCHASE&from=${FROM}&to=${TODAY}`);
  const accs = (await get('/accounts?all=1&pageSize=500')).data?.rows ?? [];
  for (const a of accs.filter((x: any) => !x.isGroup).slice(0, 40)) {
    const g = await get(`/ledger/general?accountId=${a.id}&from=${FROM}&to=${TODAY}`);
    if (g.status === 200 && g.data) {
      const rows = g.data.rows ?? g.data.entries ?? [];
      if (rows.length && !near(N(g.data.closingBalance), rows[rows.length - 1].balance ?? g.data.closingBalance, 0.02)) problem(`general ledger ${a.code}: closing balance != last running balance`);
    }
  }
  await get(`/receivables/aging?asOf=${TODAY}`); await get(`/receivables/aging?detail=1`); await get(`/payables/aging`); await get(`/payables/aging?detail=1`);
  for (const id of (sampleIds['customers'] ?? []).slice(0, 12)) await get(`/receivables/statement/${id}`);
  for (const id of (sampleIds['suppliers'] ?? []).slice(0, 8)) await get(`/payables/statement/${id}`);
  // aging total must equal the AR subledger
  const ag = await get('/receivables/aging');
  const arAgg = await receivableTotals();
  if (ag.data?.totals && typeof ag.data.totals.total === 'number' && !near(ag.data.totals.total, arAgg.partyTotal, 0.05)) problem(`AR aging total ${ag.data.totals.total} != customer sub-ledger AR ${r2(arAgg.partyTotal)}`);
  const apg = await get('/payables/aging');
  const apAgg = await payableTotals();
  if (apg.data?.totals && typeof apg.data.totals.total === 'number' && !near(apg.data.totals.total, apAgg.partyTotal, 0.05)) problem(`AP aging total ${apg.data.totals.total} != supplier sub-ledger AP ${r2(apAgg.partyTotal)}`);

  console.log('== stock endpoints');
  for (const p of ['/stock/balances', '/stock/summary', '/stock/valuation', '/stock/reservations', '/stock/reconcile', '/stock/availability?productId=1', `/stock/ledger?productId=${sampleProd}`, `/stock/ledger?productId=${sampleProd}&warehouseId=1`]) await get(p);
  const rec = await get('/stock/reconcile');
  if (rec.data && rec.data.ok === false) problem(`stock/reconcile discrepancies: ${JSON.stringify(rec.data.discrepancies).slice(0, 400)}`);
  const sheetW = await get('/stock-adjustments/count-sheet?warehouseId=1');
  void sheetW;

  // ------------------------------------------------------------------------------------- database integrity (read-only)
  console.log('== database integrity');
  const unbalanced = await prisma.$queryRaw<any[]>`SELECT journalId, ROUND(SUM(debit),2) d, ROUND(SUM(credit),2) c FROM JournalLine GROUP BY journalId HAVING ROUND(SUM(debit),2) <> ROUND(SUM(credit),2)`;
  if (unbalanced.length) problem(`${unbalanced.length} unbalanced journal(s): ${unbalanced.slice(0, 5).map((u) => `#${u.journalId} dr ${u.d} cr ${u.c}`).join('; ')}`);
  const orphanJournals = await prisma.$queryRaw<any[]>`SELECT j.id FROM JournalEntry j LEFT JOIN JournalLine l ON l.journalId = j.id GROUP BY j.id HAVING COUNT(l.id) = 0`;
  if (orphanJournals.length) problem(`${orphanJournals.length} journal entries with no lines`);
  const tot = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } });
  if (!near(N(tot._sum.debit), N(tot._sum.credit), 0.05)) problem(`global debits ${tot._sum.debit} != credits ${tot._sum.credit}`);

  // stock balance vs stock ledger
  const bals = await prisma.stockBalance.findMany();
  const sums = await prisma.stockTransaction.groupBy({ by: ['productId', 'warehouseId'], _sum: { qty: true } });
  const key = (p: number, w: number) => `${p}/${w}`;
  const sm = new Map(sums.map((s) => [key(s.productId, s.warehouseId), N(s._sum.qty)]));
  const drift: string[] = [];
  for (const b of bals) { const d = N(b.onHand) - (sm.get(key(b.productId, b.warehouseId)) ?? 0); if (Math.abs(d) > 0.0005) drift.push(`${key(b.productId, b.warehouseId)}: ${r2(d)}`); }
  for (const [k, v] of sm) if (!bals.some((b) => key(b.productId, b.warehouseId) === k) && Math.abs(v) > 0.0005) drift.push(`${k}: no balance row, ledger ${v}`);
  if (drift.length) problem(`StockBalance.onHand != stock ledger sum for ${drift.length} product/warehouse: ${drift.slice(0, 6).join(', ')}`);
  const neg = bals.filter((b) => N(b.onHand) < 0 || N(b.reserved) < 0);
  if (neg.length) problem(`negative onHand/reserved: ${neg.slice(0, 5).map((b) => key(b.productId, b.warehouseId)).join(', ')}`);
  const overRes = bals.filter((b) => N(b.reserved) > N(b.onHand) + 0.0005);
  if (overRes.length) note(`${overRes.length} balance rows where reserved > onHand (backorder reservations?)`);
  // reservations vs balance.reserved
  const resvRows = await prisma.stockReservation.findMany({ where: { status: 'ACTIVE' } });
  const resvMap = new Map<string, number>();
  for (const r of resvRows) resvMap.set(key(r.productId, r.warehouseId), (resvMap.get(key(r.productId, r.warehouseId)) ?? 0) + N(r.qty) - N(r.fulfilledQty));
  for (const b of bals) { const act = resvMap.get(key(b.productId, b.warehouseId)) ?? 0; if (!near(N(b.reserved), act, 0.001)) problem(`reserved mismatch ${key(b.productId, b.warehouseId)}: balance ${b.reserved} vs active reservations (qty - fulfilled) ${act}`); }

  // inventory valuation vs INVENTORY GL, per source document type
  const invAcc = await prisma.account.findUnique({ where: { systemKey: 'INVENTORY' } });
  const glLines = await prisma.journalLine.findMany({ where: { accountId: invAcc!.id }, include: { journal: { select: { sourceType: true } } } });
  const glBy: Record<string, number> = {};
  for (const l of glLines) glBy[l.journal.sourceType ?? '?'] = (glBy[l.journal.sourceType ?? '?'] ?? 0) + N(l.debit) - N(l.credit);
  const stBy: Record<string, number> = {};
  for (const t of await prisma.stockTransaction.groupBy({ by: ['refType'], _sum: { value: true } })) stBy[t.refType ?? '?'] = N(t._sum.value);
  for (const k of ['GOODS_RECEIPT', 'LANDED_COST', 'STOCK_ADJUSTMENT', 'PURCHASE_RETURN', 'SALES_RETURN']) if (!near(stBy[k] ?? 0, glBy[k] ?? 0, 1)) problem(`INVENTORY GL vs stock ledger differ for ${k}: GL ${r2(glBy[k] ?? 0)} vs stock ${r2(stBy[k] ?? 0)}`);
  // delivered-but-not-invoiced goods: stock left the warehouse but COGS is journalled at invoice time
  const dnVal = -((stBy['DELIVERY_NOTE'] ?? 0));
  const cogsPosted = -(glBy['SALES_INVOICE'] ?? 0);
  const dnItems: any[] = await (prisma as any).deliveryNoteItem.findMany({ where: { delivery: { status: 'POSTED' } } }).catch(() => []);
  let unbilled = dnItems.reduce((sum, i) => sum + Math.max(0, N(i.qty) - N(i.invoicedQty)) * N(i.unitCost), 0);
  // lines already on a DRAFT invoice are flagged as invoiced but their COGS is only journalled when the invoice is posted
  const draftLines: any[] = await (prisma as any).salesInvoiceItem.findMany({ where: { invoice: { status: 'DRAFT' }, deliveryItemId: { not: null } } }).catch(() => []);
  for (const l of draftLines) { const di = dnItems.find((x) => x.id === l.deliveryItemId); if (di) unbilled += N(l.qty) * N(di.unitCost); }
  if (!near(dnVal - cogsPosted, unbilled, 25)) problem(`delivered stock value ${r2(dnVal)} - invoiced COGS ${r2(cogsPosted)} = ${r2(dnVal - cogsPosted)} but un-invoiced delivery lines are worth ${r2(unbilled)}`);
  note(`goods delivered but not yet invoiced (COGS not yet posted): ${r2(unbilled)}`);
  const trIn = stBy['STOCK_TRANSFER'] ?? 0;
  const glInv = Object.values(glBy).reduce((a, b) => a + b, 0);
  const stockVal = await prisma.stockTransaction.aggregate({ _sum: { value: true } });
  const residual = r2(glInv - N(stockVal._sum.value) - (dnVal - cogsPosted) - -trIn - (glBy['NOTE'] ?? 0));
  if (Math.abs(residual) > 25) problem(`INVENTORY GL vs stock ledger: unexplained difference ${residual} (after un-invoiced deliveries, in-transit transfers, notes)`);
  note(`INVENTORY GL ${r2(glInv)} vs stock ledger value ${r2(N(stockVal._sum.value))}; difference ${r2(glInv - N(stockVal._sum.value))} = un-invoiced deliveries ${r2(dnVal - cogsPosted)} + in-transit transfers ${r2(-trIn)} + notes posted to inventory ${r2(glBy['NOTE'] ?? 0)}`);
  const balVal = bals.reduce((s, b) => s + N(b.onHand) * N(b.avgCost), 0);
  if (!near(balVal, N(stockVal._sum.value), 5)) note(`sum(onHand*avgCost) ${r2(balVal)} vs stock ledger value ${r2(N(stockVal._sum.value))} (rounding of average cost)`);

  // AR / AP control vs sub-ledgers
  const ar = await receivableTotals();
  if (ar.untagged !== 0) problem(`AR control has ${r2(ar.untagged)} on lines without a customer party (should be 0)`);
  note(`AR control ${r2(ar.control)} = customer sub-ledger ${r2(ar.partyTotal)} (+ master opening balances ${r2(ar.openingBalances)} not journalled)`);
  const ap = await payableTotals();
  if (ap.untagged !== 0) problem(`AP control has ${r2(ap.untagged)} on lines without a supplier party (should be 0)`);
  note(`AP control ${r2(ap.control)} = supplier sub-ledger ${r2(ap.partyTotal)} (+ master opening balances ${r2(ap.openingBalances)} not journalled)`);
  // invoice outstanding sums vs sub-ledger
  const si = await prisma.salesInvoice.findMany({ where: { status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } } });
  const siOut = si.reduce((s, i) => s + N(i.baseTotal) - N(i.receivedAmount), 0);
  const noteBal = await prisma.note.findMany({ where: { partyType: 'CUSTOMER', status: { not: 'CANCELLED' } } });
  note(`open sales invoices outstanding ${r2(siOut)}; customer notes ${noteBal.length}; AR GL ${r2(ar.control)}`);
  const piRows = await prisma.purchaseInvoice.findMany({ where: { status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } } });
  for (const i of si) if (N(i.receivedAmount) > N(i.baseTotal) + 0.01) problem(`sales invoice ${i.docNo}: received ${i.receivedAmount} > total ${i.baseTotal}`);
  for (const i of piRows) if (N(i.paidAmount) > N(i.baseTotal) + 0.01) problem(`purchase invoice ${i.docNo}: paid ${i.paidAmount} > total ${i.baseTotal}`);
  for (const i of si) {
    const exp = N(i.receivedAmount) <= 0.005 ? 'POSTED' : N(i.receivedAmount) >= N(i.baseTotal) - 0.005 ? 'PAID' : 'PARTIALLY_PAID';
    if (exp !== i.status) problem(`sales invoice ${i.docNo}: status ${i.status} but received ${i.receivedAmount}/${i.baseTotal} implies ${exp}`);
  }
  for (const i of piRows) {
    const exp = N(i.paidAmount) <= 0.005 ? 'POSTED' : N(i.paidAmount) >= N(i.baseTotal) - 0.005 ? 'PAID' : 'PARTIALLY_PAID';
    if (exp !== i.status) problem(`purchase invoice ${i.docNo}: status ${i.status} but paid ${i.paidAmount}/${i.baseTotal} implies ${exp}`);
  }
  // received amount vs voucher allocations + applied credit notes
  const allocs = await prisma.voucherAllocation.groupBy({ by: ['docType', 'docId'], where: { voucher: { status: 'POSTED' } }, _sum: { amount: true } }).catch(() => [] as any[]);
  for (const a of allocs as any[]) {
    if (a.docType === 'SALES_INVOICE') { const inv = si.find((i) => i.id === a.docId); if (inv && N(inv.receivedAmount) + 0.01 < N(a._sum.amount)) problem(`sales invoice ${inv.docNo}: receivedAmount ${inv.receivedAmount} < allocations ${a._sum.amount}`); }
    if (a.docType === 'PURCHASE_INVOICE') { const inv = piRows.find((i) => i.id === a.docId); if (inv && N(inv.paidAmount) + 0.01 < N(a._sum.amount)) problem(`purchase invoice ${inv.docNo}: paidAmount ${inv.paidAmount} < allocations ${a._sum.amount}`); }
  }
  // document totals recomputed
  for (const m of ['salesInvoice', 'purchaseInvoice', 'salesOrder', 'purchaseOrder'] as const) {
    const docs: any[] = await (prisma as any)[m].findMany({ include: { items: true } });
    for (const d of docs) {
      if (!d.items.length) continue;
      const sub = d.items.reduce((s: number, i: any) => s + N(i.amount) - N(i.vatAmount), 0);
      const vat = d.items.reduce((s: number, i: any) => s + N(i.vatAmount), 0);
      if (!near(N(d.vatAmount), vat, 0.05)) problem(`${m} ${d.docNo}: vatAmount ${d.vatAmount} != sum of lines ${r2(vat)}`);
      if (!near(N(d.total), sub + vat + N(d.roundOff ?? 0), 0.05) && !near(N(d.total), N(d.subtotal) - N(d.discount ?? 0) + N(d.vatAmount) + N(d.roundOff ?? 0), 0.05)) problem(`${m} ${d.docNo}: total ${d.total} inconsistent with lines (sub ${r2(sub)} vat ${r2(vat)})`);
    }
  }
  // posted docs must have journals
  const noJ = await prisma.salesInvoice.count({ where: { status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] }, journalId: null } });
  if (noJ) problem(`${noJ} posted sales invoices without journal`);
  const noJp = await prisma.purchaseInvoice.count({ where: { status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] }, journalId: null } });
  if (noJp) problem(`${noJp} posted purchase invoices without journal`);
  // GRNI should clear: report balance
  const grni = await prisma.account.findUnique({ where: { systemKey: 'GRNI' } });
  if (grni) { const g = await prisma.journalLine.aggregate({ where: { accountId: grni.id }, _sum: { debit: true, credit: true } }); note(`GRNI balance (credit) ${r2(N(g._sum.credit) - N(g._sum.debit))} = goods received not yet invoiced`); }

  console.log(`\n${requests} requests`);
  if (info.length) { console.log('\nINFO'); info.forEach((m) => console.log('  -', m)); }
  if (problems.length) { console.log(`\nPROBLEMS (${problems.length})`); problems.forEach((m) => console.log('  !', m)); }
  else console.log('\nNO PROBLEMS FOUND');
  await prisma.$disconnect();
  process.exit(problems.length ? 1 : 0);
}

async function partyTotals(key: 'AR' | 'AP', partyType: 'CUSTOMER' | 'SUPPLIER') {
  const acc = await prisma.account.findUnique({ where: { systemKey: key } });
  const all = await prisma.journalLine.aggregate({ where: { accountId: acc!.id }, _sum: { debit: true, credit: true } });
  const tagged = await prisma.journalLine.aggregate({ where: { accountId: acc!.id, partyType, partyId: { not: null } }, _sum: { debit: true, credit: true } });
  const sign = key === 'AR' ? 1 : -1;
  const control = sign * (N(all._sum.debit) - N(all._sum.credit));
  const partyTotal = sign * (N(tagged._sum.debit) - N(tagged._sum.credit));
  const openingBalances = N((partyType === 'CUSTOMER' ? await prisma.customer.aggregate({ _sum: { openingBalance: true } }) : await prisma.supplier.aggregate({ _sum: { openingBalance: true } }))._sum.openingBalance);
  return { control, partyTotal, untagged: r2(control - partyTotal), openingBalances };
}
const receivableTotals = () => partyTotals('AR', 'CUSTOMER');
const payableTotals = () => partyTotals('AP', 'SUPPLIER');

main().catch(async (e) => { console.error('FATAL', e); await prisma.$disconnect(); process.exit(2); });
