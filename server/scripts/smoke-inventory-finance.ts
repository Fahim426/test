/* Smoke test for the inventory & finance modules.
 *   cd server && PORT=4014 npx tsx src/index.ts   (separate terminal)
 *   BASE=http://localhost:4014/api npx tsx scripts/smoke-inventory-finance.ts [--keep]
 * Creates TEST- prefixed data and (unless --keep) removes it again at the end.
 */
import { prisma } from '../src/lib/prisma';
import { postStock } from '../src/services/stock';
import { postJournal } from '../src/services/accounting';

const BASE = process.env.BASE || 'http://localhost:4014/api';
const KEEP = process.argv.includes('--keep');
let token = '';
let failures = 0;
const startedAt = new Date();
const tag = String(Date.now()).slice(-7);

async function api(method: string, path: string, body?: unknown, expectStatus?: number) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text; }
  if (expectStatus ? r.status !== expectStatus : !r.ok) {
    throw new Error(`${method} ${path} -> ${r.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  }
  return json;
}
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.006;
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

const created = { journalNos: new Set<string>(), adjIds: [] as number[], trfIds: [] as number[], voucherIds: [] as number[], noteIds: [] as number[], jvIds: [] as number[] };

async function main() {
  const login = await api('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  token = login.accessToken || login.token;
  check('login', !!token);

  const whMain = await prisma.warehouse.findUniqueOrThrow({ where: { code: 'WH-DXB-MAIN' } });
  const whShj = await prisma.warehouse.findUniqueOrThrow({ where: { code: 'WH-SHJ' } });
  const product = await prisma.product.create({ data: { code: `TEST-SMK-${tag}`, name: 'TEST smoke product', costPrice: 10 } });

  // ---------------------------------------------------------------- INVENTORY
  console.log('Inventory');
  const adjOpen = await api('POST', '/stock-adjustments', { adjType: 'OPENING', warehouseId: whMain.id, txDate: iso(daysAgo(60)), items: [{ productId: product.id, qtyChange: 100, unitCost: 10 }] }, 201);
  created.adjIds.push(adjOpen.id);
  check('opening adjustment DRAFT', adjOpen.status === 'DRAFT');
  const posted = await api('POST', `/stock-adjustments/${adjOpen.id}/post`);
  check('opening adjustment POSTED with journal', posted.status === 'POSTED' && !!posted.journal);
  if (posted.journal) created.journalNos.add(posted.journal.entryNo);

  // emulate GRN / delivery / returns via the stock engine
  const d = (n: number) => daysAgo(n);
  await prisma.$transaction(async (tx) => {
    await postStock(tx, { txType: 'PURCHASE_RECEIPT', productId: product.id, warehouseId: whMain.id, qty: 50, unitCost: 12, refType: 'TEST_GRN', refId: 1, refNo: 'TEST-GRN', date: d(50) });
    await postStock(tx, { txType: 'SALES_DELIVERY', productId: product.id, warehouseId: whMain.id, qty: -20, refType: 'TEST_DN', refId: 1, refNo: 'TEST-DN', date: d(45) });
    await postStock(tx, { txType: 'PURCHASE_RETURN', productId: product.id, warehouseId: whMain.id, qty: -5, refType: 'TEST_PRN', refId: 1, refNo: 'TEST-PRN', date: d(40) });
    await postStock(tx, { txType: 'SALES_RETURN', productId: product.id, warehouseId: whMain.id, qty: 2, unitCost: 10, refType: 'TEST_SR', refId: 1, refNo: 'TEST-SR', date: d(35) });
  });

  // transfer through all stages
  const trf = await api('POST', '/stock-transfers', { fromWarehouseId: whMain.id, toWarehouseId: whShj.id, txDate: iso(d(30)), items: [{ productId: product.id, qty: 10 }] }, 201);
  created.trfIds.push(trf.id);
  check('transfer REQUESTED', trf.status === 'REQUESTED');
  await api('POST', `/stock-transfers/${trf.id}/dispatch`, {}, 400); // not approved yet
  check('dispatch before approval rejected', true);
  const appr = await api('POST', `/stock-transfers/${trf.id}/approve`);
  check('transfer APPROVED', appr.status === 'APPROVED');
  const disp = await api('POST', `/stock-transfers/${trf.id}/dispatch`);
  check('transfer IN_TRANSIT', disp.status === 'IN_TRANSIT');
  const it = await api('GET', '/stock-transfers/in-transit');
  check('in-transit list has transfer', it.rows.some((r: any) => r.id === trf.id && near(r.pendingQty, 10)), it);
  const part = await api('POST', `/stock-transfers/${trf.id}/receive`, { items: [{ productId: product.id, receivedQty: 4 }] });
  check('partial receive -> RECEIVING', part.status === 'RECEIVING');
  const fin = await api('POST', `/stock-transfers/${trf.id}/receive`, { items: [{ productId: product.id, receivedQty: 6 }] });
  check('full receive -> COMPLETED', fin.status === 'COMPLETED');
  await api('POST', `/stock-transfers/${trf.id}/receive`, { receiveAll: true }, 400);

  // adjustment -3 (ADJUSTMENT type, loss)
  const adj = await api('POST', '/stock-adjustments', { adjType: 'ADJUSTMENT', warehouseId: whMain.id, txDate: iso(d(20)), reason: 'TEST shrinkage', items: [{ productId: product.id, qtyChange: -3 }] }, 201);
  created.adjIds.push(adj.id);
  const adjP = await api('POST', `/stock-adjustments/${adj.id}/post`);
  check('adjustment posted', adjP.status === 'POSTED');
  if (adjP.journal) created.journalNos.add(adjP.journal.entryNo);
  check('loss journal Dr STOCK_ADJUSTMENT', !!adjP.journal && adjP.journal.lines.length === 2);
  await api('POST', `/stock-adjustments/${adj.id}/cancel`, {}, 400);
  check('cannot cancel posted adjustment', true);

  // count sheet + count
  const sheet = await api('GET', `/stock-adjustments/count-sheet?warehouseId=${whMain.id}&search=TEST-SMK-${tag}`);
  check('count sheet prefilled systemQty', sheet.items.length === 1 && near(sheet.items[0].systemQty, 100 + 50 - 20 - 5 + 2 - 10 - 3), sheet.items);
  const cnt = await api('POST', '/stock-adjustments', { adjType: 'COUNT', warehouseId: whMain.id, items: [{ productId: product.id, countedQty: sheet.items[0].systemQty - 1 }] }, 201);
  created.adjIds.push(cnt.id);
  check('count qtyChange = counted - system', near(cnt.items[0].qtyChange, -1), cnt.items);
  await api('POST', `/stock-adjustments/${cnt.id}/cancel`, {});

  // ledger spec example (all warehouses): +100 +50 -20 -5 +2 -10 +10 -3 = 124
  const led = await api('GET', `/stock/ledger?productId=${product.id}`);
  const seq = led.entries.map((e: any) => e.qty);
  console.log('   ledger qty sequence:', seq.join(' '), '=>', led.closingQty);
  check('ledger closing = 124', near(led.closingQty, 124), led.closingQty);
  check('ledger running balances monotone sum', led.entries.every((e: any, i: number) => near(e.runningQty, seq.slice(0, i + 1).reduce((a: number, b: number) => a + b, 0))));
  const led2 = await api('GET', `/stock/ledger?productId=${product.id}&warehouseId=${whMain.id}&from=${iso(d(36))}`);
  check('ledger opening balance before from', near(led2.openingQty, 100 + 50 - 20 - 5), led2.openingQty);
  check('ledger main warehouse closing = 114 (124 - 10 net transfer in at SHJ)', near(led2.closingQty, 114), led2.closingQty);
  const bal = await api('GET', `/stock/balances?productId=${product.id}`);
  check('balances rows (2 warehouses)', bal.rows.length === 2 && near(bal.rows.reduce((s: number, r: any) => s + r.onHand, 0), 124), bal.rows);
  const sum = await api('GET', `/stock/summary?search=TEST-SMK-${tag}`);
  check('summary total', sum.rows.length === 1 && near(sum.rows[0].onHand, 124));
  const av = await api('GET', `/stock/availability?productId=${product.id}`);
  check('availability', near(av.available, 124));
  const val = await api('GET', `/stock/valuation?productId=${product.id}`);
  check('valuation positive', val.totals.value > 0, val.totals);
  const rec = await api('GET', '/stock/reconcile');
  check('stock reconcile OK for test product', !rec.discrepancies.some((x: any) => x.productId === product.id), rec.discrepancies);
  if (!rec.ok) console.log('   note: reconcile reports discrepancies on other (non-test) products:', rec.discrepancies.length);
  await api('GET', '/stock/reservations');

  // ---------------------------------------------------------------- FINANCE
  console.log('Finance');
  const accs = await api('GET', '/accounts?all=1');
  const accBy = (code: string) => accs.rows.find((a: any) => a.code === code);
  const other = accBy('6900');
  const cashAcc = accBy('1110');
  const tree = await api('GET', '/accounts?tree=1&balances=1');
  check('accounts tree', Array.isArray(tree) && tree.length >= 5);
  const newAcc = await api('POST', '/accounts', { code: `T${tag}`, name: 'TEST account', type: 'EXPENSE', parentId: accBy('6000').id }, 201);
  await api('POST', '/accounts', { code: `T${tag}X`, name: 'bad', type: 'ASSET', parentId: accBy('6000').id }, 400);
  check('parent type consistency enforced', true);
  await api('DELETE', `/accounts/${accBy('1110').id}`, undefined, 400);
  check('system account not deletable', true);

  const jv = await api('POST', '/journals', { date: iso(d(10)), narration: 'TEST manual journal', lines: [{ accountId: newAcc.id, debit: 100 }, { accountId: cashAcc.id, credit: 100 }] }, 201);
  created.jvIds.push(jv.id); created.journalNos.add(jv.entryNo);
  check('manual journal posted', jv.entryType === 'JOURNAL' && near(jv.totalDebit, 100));
  await api('POST', '/journals', { date: iso(d(10)), lines: [{ accountId: newAcc.id, debit: 100 }, { accountId: cashAcc.id, credit: 90 }] }, 400);
  check('unbalanced journal rejected', true);
  const jvr = await api('POST', `/journals/${jv.id}/reverse`, {});
  created.journalNos.add(jvr.reversal.entryNo);
  check('journal reversed', jvr.original.status === 'REVERSED');
  const ob = await api('POST', '/journals/opening-balance', { date: iso(d(70)), lines: [{ accountId: accBy('1600').id, debit: 500 }] }, 201);
  created.jvIds.push(ob.id); created.journalNos.add(ob.entryNo);
  check('opening balance journal balanced vs equity', ob.lines.length === 2 && near(ob.totalDebit, 500));

  // test customer + posted sales invoice with AR journal (inserted directly, TEST-prefixed)
  const cust = await prisma.customer.create({ data: { code: `TEST-C-${tag}`, name: 'TEST Customer', openingBalance: 0 } });
  const inv = await prisma.salesInvoice.create({
    data: { docNo: `TEST-SI-${tag}`, docDate: daysAgo(70), dueDate: daysAgo(40), customerId: cust.id, subtotal: 1000, vatAmount: 50, total: 1050, baseTotal: 1050, status: 'POSTED', items: { create: [{ productId: product.id, qty: 10, rate: 100, vatRate: 5, vatAmount: 50, amount: 1050 }] } },
  });
  const arJ = await prisma.$transaction(async (tx) => {
    const j = await postJournal(tx, { date: daysAgo(70), sourceType: 'SALES_INVOICE', sourceId: inv.id, sourceNo: inv.docNo, narration: 'TEST invoice', lines: [{ accountKey: 'AR', debit: 1050, partyType: 'CUSTOMER', partyId: cust.id }, { accountKey: 'SALES', credit: 1000 }, { accountKey: 'VAT_OUTPUT', credit: 50, vatCode: 'VAT5', vatAmount: 50 }] });
    await tx.salesInvoice.update({ where: { id: inv.id }, data: { journalId: j.id } });
    return j;
  });
  created.journalNos.add(arJ.entryNo);

  const open = await api('GET', `/vouchers/open-invoices?partyType=CUSTOMER&partyId=${cust.id}`);
  check('open invoices lists test invoice', open.rows.length === 1 && near(open.rows[0].outstanding, 1050), open);
  await api('POST', '/receipts', { partyType: 'CUSTOMER', partyId: cust.id, mode: 'BANK', voucherDate: iso(d(5)), amount: 500, allocations: [{ docType: 'SALES_INVOICE', docId: inv.id, amount: 600 }] }, 400);
  check('over-allocation rejected', true);
  const rv = await api('POST', '/receipts', { partyType: 'CUSTOMER', partyId: cust.id, mode: 'BANK', voucherDate: iso(d(5)), amount: 500, bankCharges: 5, reference: 'TEST-CHQ', allocations: [{ docType: 'SALES_INVOICE', docId: inv.id, amount: 500 }] }, 201);
  created.voucherIds.push(rv.id); if (rv.journal) created.journalNos.add(rv.journal.entryNo);
  check('receipt posted, bank charges derived', rv.status === 'POSTED' && near(rv.bankCharges, 5));
  let invNow = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: inv.id } });
  check('invoice PARTIALLY_PAID 500', invNow.status === 'PARTIALLY_PAID' && near(Number(invNow.receivedAmount), 500));
  const rv2 = await api('POST', '/vouchers', { voucherType: 'RECEIPT', partyType: 'CUSTOMER', partyId: cust.id, mode: 'CASH', voucherDate: iso(d(2)), amount: 100 }, 201);
  created.voucherIds.push(rv2.id); if (rv2.journal) created.journalNos.add(rv2.journal.entryNo);
  check('on-account receipt unallocated', near(rv2.unallocatedAmount, 100));

  const aging = await api('GET', `/receivables/aging?partyId=${cust.id}&detail=1`);
  const row = aging.rows.find((r: any) => r.partyId === cust.id);
  check('aging: 550 in 31-60 bucket (due 40 days ago)', row && near(row['31-60'], 550), row);
  check('aging: unapplied receipt 100 shown as credit', row && near(row.unappliedCredit, 100) && near(row.total, 450), row);
  const stmt = await api('GET', `/receivables/statement/${cust.id}`);
  check('statement closing = 1050 - 500 - 100 = 450', near(stmt.closingBalance, 450), stmt);
  check('statement kinds', stmt.summary.INVOICE && stmt.summary.RECEIPT);
  const ov = await api('GET', `/receivables/overdue?partyId=${cust.id}`);
  check('overdue lists invoice', ov.rows.length === 1 && ov.rows[0].daysPastDue >= 40, ov.rows);
  await api('GET', '/receivables/customers'); await api('GET', '/receivables/outstanding'); await api('GET', '/receivables/due-today');

  // credit note (VAT from master) applied to invoice
  const cn = await api('POST', '/notes', { noteType: 'CREDIT', partyType: 'CUSTOMER', partyId: cust.id, noteDate: iso(d(1)), amount: 100, vatCode: 'VAT5', reason: 'TEST credit', refType: 'SALES_INVOICE', refId: inv.id, applyToInvoice: true }, 201);
  created.noteIds.push(cn.id); if (cn.journal) created.journalNos.add(cn.journal.entryNo);
  check('credit note VAT derived from master (5% of 100)', near(cn.vatAmount, 5) && near(cn.total, 105), cn);
  invNow = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: inv.id } });
  check('credit note applied to invoice', near(Number(invNow.receivedAmount), 605));
  const cnC = await api('POST', `/notes/${cn.id}/cancel`, {});
  created.journalNos.add(`REV-${cn.journal?.entryNo}`);
  invNow = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: inv.id } });
  check('note cancel rolls back application', cnC.status === 'CANCELLED' && near(Number(invNow.receivedAmount), 500));

  // supplier advance + settlement
  const sup = await prisma.supplier.create({ data: { code: `TEST-S-${tag}`, name: 'TEST Supplier' } });
  const po = await prisma.purchaseOrder.create({ data: { docNo: `TEST-PO-${tag}`, docDate: daysAgo(30), supplierId: sup.id, status: 'APPROVED', total: 1000 } });
  const adv = await api('POST', '/payments', { partyType: 'SUPPLIER', partyId: sup.id, mode: 'BANK', voucherDate: iso(d(25)), amount: 300, allocations: [{ docType: 'PURCHASE_ORDER', docId: po.id, amount: 300 }] }, 201);
  created.voucherIds.push(adv.id); if (adv.journal) created.journalNos.add(adv.journal.entryNo);
  check('advance payment flagged', adv.isAdvance && near(adv.advanceRemaining, 300));
  const pinv = await prisma.purchaseInvoice.create({ data: { docNo: `TEST-PI-${tag}`, docDate: daysAgo(20), dueDate: daysAgo(5), supplierId: sup.id, subtotal: 500, vatAmount: 25, total: 525, baseTotal: 525, status: 'POSTED', items: { create: [{ productId: product.id, qty: 5, rate: 100, vatRate: 5, vatAmount: 25, amount: 525 }] } } });
  const apJ = await prisma.$transaction(async (tx) => {
    const j = await postJournal(tx, { date: daysAgo(20), sourceType: 'PURCHASE_INVOICE', sourceId: pinv.id, sourceNo: pinv.docNo, narration: 'TEST purchase invoice', lines: [{ accountKey: 'INVENTORY', debit: 500 }, { accountKey: 'VAT_INPUT', debit: 25, vatCode: 'VAT5', vatAmount: 25 }, { accountKey: 'AP', credit: 525, partyType: 'SUPPLIER', partyId: sup.id }] });
    await tx.purchaseInvoice.update({ where: { id: pinv.id }, data: { journalId: j.id } });
    return j;
  });
  created.journalNos.add(apJ.entryNo);
  const set = await api('POST', `/vouchers/${adv.id}/settle-advance`, { purchaseInvoiceId: pinv.id, amount: 200 });
  check('advance settled 200', near(set.advanceSettled, 200) && near(set.advanceRemaining, 100));
  let pNow = await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id: pinv.id } });
  check('purchase invoice PARTIALLY_PAID 200', pNow.status === 'PARTIALLY_PAID' && near(Number(pNow.paidAmount), 200));
  created.journalNos.add('ADVSET');
  const pay = await api('POST', '/payments', { partyType: 'SUPPLIER', partyId: sup.id, mode: 'BANK', voucherDate: iso(d(1)), amount: 325, allocations: [{ docType: 'PURCHASE_INVOICE', docId: pinv.id, amount: 325 }] }, 201);
  created.voucherIds.push(pay.id); if (pay.journal) created.journalNos.add(pay.journal.entryNo);
  pNow = await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id: pinv.id } });
  check('purchase invoice PAID', pNow.status === 'PAID');
  await api('POST', `/vouchers/${adv.id}/cancel`, {}, 400);
  check('settled advance cannot be cancelled', true);
  const apAging = await api('GET', '/payables/aging');
  check('payables aging responds', Array.isArray(apAging.rows));
  const sst = await api('GET', `/payables/statement/${sup.id}`);
  check('supplier statement closing = 525 - 300 advance... (AP: 525 cr, 200 settle dr, 325 pay dr = 0)', near(sst.closingBalance, 0), sst);
  await api('GET', '/payables/suppliers');

  // cancel the first receipt -> rollback allocations
  const rvc = await api('POST', `/receipts/${rv.id}/cancel`, {});
  invNow = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: inv.id } });
  check('receipt cancel rolls back invoice to POSTED', rvc.status === 'CANCELLED' && invNow.status === 'POSTED' && near(Number(invNow.receivedAmount), 0));

  // ---- reports
  const asOf = iso(new Date());
  const tb = await api('GET', `/ledger/trial-balance?asOf=${asOf}`);
  check('trial balance balances', tb.balanced, tb.totals);
  const bs = await api('GET', `/ledger/balance-sheet?asOf=${asOf}`);
  check('balance sheet balances', bs.balanced, { diff: bs.difference });
  const pl = await api('GET', `/ledger/profit-loss?from=${iso(d(100))}&to=${asOf}`);
  check('P&L net = revenue - cogs - expenses', near(pl.netProfit, pl.revenue.total - pl.cogs.total - pl.expenses.total));
  const cf = await api('GET', `/ledger/cash-flow?from=${iso(d(100))}&to=${asOf}`);
  check('cash flow closing consistent', near(cf.closingBalance, cf.openingBalance + cf.netChange));
  const gl = await api('GET', `/ledger/general?accountId=${accBy('1300').id}&partyId=${cust.id}&partyType=CUSTOMER`);
  check('general ledger AR running', near(gl.closingBalance, 1050 - 100), gl.closingBalance);
  for (const k of ['cash-book', 'bank-book', 'sales', 'purchase', 'receipts', 'payments', 'journal']) await api('GET', `/registers/${k}?from=${iso(d(100))}&to=${asOf}`);
  check('registers respond', true);
  const vs = await api('GET', `/vat/summary?from=${iso(d(100))}&to=${asOf}`);
  check('vat summary: output includes test invoice 50', vs.output.sales.vat >= 50 && near(vs.netPayable, vs.outputVat - vs.inputVat), vs.output.sales);
  const vt = await api('GET', `/vat/transactions?type=SALES&from=${iso(d(100))}&to=${asOf}`);
  check('vat transactions has category', vt.rows.some((r: any) => r.docNo === `TEST-SI-${tag}` && r.category === 'TAXABLE'));
  const dash = await api('GET', '/finance/dashboard-metrics');
  check('dashboard metrics', typeof dash.receivables === 'number' && dash.monthly.length === 12);
  const rec2 = await api('GET', '/stock/reconcile');
  check('stock reconcile OK for test product (final)', !rec2.discrepancies.some((x: any) => x.productId === product.id));

  // ---------------------------------------------------------------- cleanup
  if (!KEEP) await cleanup(product.id, cust.id, sup.id, [inv.id], [pinv.id], [po.id]);
  else console.log('--keep: test data left in place');
}

async function cleanup(productId: number, custId: number, supId: number, siIds: number[], piIds: number[], poIds: number[]) {
  console.log('Cleanup of TEST data');
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  // journals created by this run: tracked numbers + their reversals + voucher/note/adjustment/transfer/settlement sourced entries
  const jr = await prisma.journalEntry.findMany({ where: { createdAt: { gte: startedAt }, createdBy: admin.id } });
  const ids = new Set<number>();
  const trackedNos = new Set([...created.journalNos]);
  const srcIds = {
    VOUCHER: created.voucherIds, NOTE: created.noteIds, ADJ: created.adjIds,
  };
  for (const j of jr) {
    if (trackedNos.has(j.entryNo)) ids.add(j.id);
    if (j.sourceType === 'RECEIPT_VOUCHER' || j.sourceType === 'PAYMENT_VOUCHER' || j.sourceType === 'ADVANCE_SETTLEMENT') { if (srcIds.VOUCHER.includes(j.sourceId ?? -1)) ids.add(j.id); }
    if ((j.sourceType === 'NOTE' || j.sourceType === 'NOTE_APPLIED') && srcIds.NOTE.includes(j.sourceId ?? -1)) ids.add(j.id);
    if (j.sourceType === 'STOCK_ADJUSTMENT' && srcIds.ADJ.includes(j.sourceId ?? -1)) ids.add(j.id);
    if (j.narration?.startsWith('Reversal of ') && [...trackedNos].some((n) => j.narration!.endsWith(n))) ids.add(j.id);
  }
  // journals with test sourceNos (inserted by the script, created by system user null => match by sourceNo)
  const byNo = await prisma.journalEntry.findMany({ where: { createdAt: { gte: startedAt }, OR: [{ sourceNo: { startsWith: 'TEST-' } }] } });
  for (const j of byNo) ids.add(j.id);
  await prisma.journalEntry.deleteMany({ where: { id: { in: [...ids] } } });
  await prisma.voucher.deleteMany({ where: { id: { in: created.voucherIds } } });
  await prisma.note.deleteMany({ where: { id: { in: created.noteIds } } });
  await prisma.stockAdjustment.deleteMany({ where: { id: { in: created.adjIds } } });
  await prisma.stockTransfer.deleteMany({ where: { id: { in: created.trfIds } } });
  await prisma.salesInvoice.deleteMany({ where: { id: { in: siIds } } });
  await prisma.purchaseInvoice.deleteMany({ where: { id: { in: piIds } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds } } });
  await prisma.customer.delete({ where: { id: custId } });
  await prisma.supplier.delete({ where: { id: supId } });
  await prisma.stockTransaction.deleteMany({ where: { productId } });
  await prisma.stockBalance.deleteMany({ where: { productId } });
  await prisma.product.delete({ where: { id: productId } });
  await prisma.account.deleteMany({ where: { name: 'TEST account' } });
  console.log(`  removed ${ids.size} journals`);
}

main()
  .catch((e) => { failures++; console.error('FATAL', e); })
  .finally(async () => {
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
    await prisma.$disconnect();
    process.exit(failures ? 1 : 0);
  });
