/* End-to-end smoke test for the SALES backend.
 *   cd server && PORT=4013 npx tsx src/index.ts            (separate terminal)
 *   BASE=http://localhost:4013/api npx tsx scripts/smoke-sales.ts
 * Data is tagged TEST-SALES (customer PO / remarks). Opening stock is posted through the stock engine with a
 * matching Dr Inventory / Cr Opening Equity journal so ledgers stay consistent.
 */
import { prisma } from '../src/lib/prisma';
import { postStock } from '../src/services/stock';
import { postJournal, customerBalance } from '../src/services/accounting';

const BASE = process.env.BASE || 'http://localhost:4013/api';
let token = '';
let failures = 0;
const TAG = 'TEST-SALES-' + String(Date.now()).slice(-6);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: J }> {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: J;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
async function ok(method: string, path: string, body?: unknown): Promise<J> {
  const r = await call(method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
}
async function fail(method: string, path: string, body: unknown, expect = 400): Promise<J> {
  const r = await call(method, path, body);
  check(`${method} ${path} rejected (${expect})`, r.status === expect, r);
  return r.data;
}
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
}
const near = (a: number, b: number, t = 0.006) => Math.abs(a - b) < t;

async function bal(productId: number, warehouseId = 1) {
  const b = await prisma.stockBalance.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
  return { onHand: Number(b?.onHand ?? 0), reserved: Number(b?.reserved ?? 0), avg: Number(b?.avgCost ?? 0) };
}
async function journalsBalanced(sourceType: string, sourceId: number) {
  const js = await prisma.journalEntry.findMany({ where: { sourceType, sourceId }, include: { lines: true } });
  let ok2 = js.length > 0;
  for (const j of js) {
    const d = j.lines.reduce((s, l) => s + Number(l.debit), 0);
    const c = j.lines.reduce((s, l) => s + Number(l.credit), 0);
    if (!near(d, c)) ok2 = false;
  }
  return { balanced: ok2, journals: js };
}
const sumAcc = async (key: string) => {
  const a = await prisma.account.findUniqueOrThrow({ where: { systemKey: key } });
  const g = await prisma.journalLine.aggregate({ where: { accountId: a.id }, _sum: { debit: true, credit: true } });
  return Number(g._sum.debit ?? 0) - Number(g._sum.credit ?? 0);
};

async function main() {
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  token = login.data.accessToken || login.data.token;
  check('login', !!token);

  const CUST = 1, P1 = 1, P2 = 2, WH = 1;
  const savedSettings = await prisma.systemSetting.findMany({ where: { key: { startsWith: 'sales.' } } });
  await prisma.systemSetting.deleteMany({ where: { key: { startsWith: 'sales.' } } });

  console.log('\n== 0. opening stock via stock engine');
  await prisma.$transaction(async (tx) => {
    for (const [pid, qty, cost] of [[P1, 100, 200], [P2, 50, 10]] as const) {
      await postStock(tx, { txType: 'OPENING', productId: pid, warehouseId: WH, qty, unitCost: cost, refType: 'TEST', refNo: TAG, remarks: TAG });
    }
    await postJournal(tx, { date: new Date(), sourceType: 'TEST', sourceNo: TAG, narration: `${TAG} opening stock`, lines: [{ accountKey: 'INVENTORY', debit: 100 * 200 + 50 * 10 }, { accountKey: 'OPENING_EQUITY', credit: 100 * 200 + 50 * 10 }] });
  });
  const b1 = await bal(P1), b2 = await bal(P2);
  console.log('  baseline P1', b1, 'P2', b2);
  const arBefore = await customerBalance(CUST);
  const cogsBefore = await sumAcc('COGS');
  const invBefore = await sumAcc('INVENTORY');
  const unitCost1 = b1.avg; // average cost used on delivery

  console.log('\n== 1. enquiry -> quotation');
  const enq = await ok('POST', '/sales-enquiries', { customerId: CUST, salesmanId: 1, remarks: TAG, items: [{ productId: P1, qty: 10 }, { productId: P2, qty: 5 }] });
  check('enquiry OPEN', enq.status === 'OPEN' && /^SE-/.test(enq.docNo), enq.docNo);
  const quo = await ok('POST', `/sales-enquiries/${enq.id}/create-quotation`, { warehouseId: WH });
  check('quotation DRAFT prefilled with 2 items', quo.status === 'DRAFT' && quo.items.length === 2 && quo.enquiryId === enq.id, quo.status);
  check('rate defaulted from retailPrice + vat 5', quo.items[0].rate === 420 && quo.items[0].vatRate === 5, quo.items[0]);
  check('quotation item shows availability', quo.items[0].availability && quo.items[0].availability.availableToSell >= 0 && quo.items[0].product.oemNumber !== undefined, quo.items[0].availability);
  check('quotation totals', near(quo.subtotal, 10 * 420 + 5 * 35) && near(quo.vatAmount, (10 * 420 + 5 * 35) * 0.05), quo);
  check('enquiry QUOTED', (await ok('GET', `/sales-enquiries/${enq.id}`)).status === 'QUOTED');
  const av = await ok('GET', `/sales/availability?productId=${P1}&warehouseId=${WH}`);
  check('availability helper', av.onHand === b1.onHand && av.availableToSell === b1.onHand - b1.reserved, av);
  await ok('POST', `/sales-quotations/${quo.id}/send`);
  await ok('POST', `/sales-quotations/${quo.id}/accept`);

  console.log('\n== 2. quotation -> proforma (+ order)');
  const pf = await ok('POST', `/sales-quotations/${quo.id}/create-proforma`, {});
  check('proforma created from quotation', pf.status === 'DRAFT' && pf.quotationId === quo.id);
  await fail('POST', `/sales-quotations/${quo.id}/create-proforma`, {}, 409);
  await ok('POST', `/proforma-invoices/${pf.id}/issue`);
  await fail('POST', `/proforma-invoices/${pf.id}/create-invoice`, {}); // before delivery disabled by default
  const so = await ok('POST', `/proforma-invoices/${pf.id}/create-order`, { warehouseId: WH, customerPoNo: TAG });
  check('SO from proforma DRAFT', so.status === 'DRAFT' && so.proformaId === pf.id && so.quotationId === quo.id, so.status);
  check('quotation CONVERTED', (await ok('GET', `/sales-quotations/${quo.id}`)).status === 'CONVERTED');
  await fail('POST', `/sales-quotations/${quo.id}/create-order`, {}, 400);

  console.log('\n== 3. submit / approve => reservation (physical stock unchanged)');
  const sub = await ok('POST', `/sales-orders/${so.id}/submit`);
  check('submitted (approval rule matched => PENDING_APPROVAL)', sub.status === 'PENDING_APPROVAL' && sub.autoApproved === false, sub.status);
  let x = await bal(P1);
  check('no reservation before approval', x.reserved === b1.reserved && x.onHand === b1.onHand, x);
  const apr = await ok('POST', `/sales-orders/${so.id}/approve`, { comment: TAG });
  check('order APPROVED', apr.status === 'APPROVED', apr.status);
  x = await bal(P1);
  check('P1 onHand unchanged, reserved +10', x.onHand === b1.onHand && x.reserved === b1.reserved + 10, x);
  const x2 = await bal(P2);
  check('P2 reserved +5', x2.onHand === b2.onHand && x2.reserved === b2.reserved + 5, x2);
  check('detail has reservations + line states', apr.reservations.length === 2 && apr.items[0].reserved === 10 && apr.items[0].pending === 10 && apr.items[0].delivered === 0, apr.items[0]);
  check('proforma converted', (await ok('GET', `/proforma-invoices/${pf.id}`)).status === 'CONVERTED');

  console.log('\n== 4. picking (partial) -> packing -> delivery 1');
  const pk = await ok('POST', `/sales-orders/${so.id}/create-picking`, {});
  check('picking OPEN with locations', pk.status === 'OPEN' && pk.items.length === 2 && 'rack' in pk.items[0], pk.items[0]);
  check('picking shows Ordered/Reserved/Picked/Pending', pk.items[0].ordered === 10 && pk.items[0].reserved === 10 && pk.items[0].picked === 0 && pk.items[0].pending === 10, pk.items[0]);
  await fail('POST', `/sales-orders/${so.id}/create-picking`, {}); // nothing left to pick
  const i1 = pk.items.find((i: J) => i.productId === P1), i2 = pk.items.find((i: J) => i.productId === P2);
  await fail('PUT', `/picking-lists/${pk.id}/pick`, { items: [{ id: i1.id, pickedQty: 11 }] });
  const pk2 = await ok('PUT', `/picking-lists/${pk.id}/pick`, { pickedBy: 'TEST picker', items: [{ id: i1.id, pickedQty: 6 }, { id: i2.id, pickedQty: 5 }] });
  check('picking PARTIALLY_PICKED', pk2.status === 'PARTIALLY_PICKED', pk2.status);
  const so1 = await ok('GET', `/sales-orders/${so.id}`);
  check('SO item pickedQty updated', so1.items.find((i: J) => i.productId === P1).picked === 6);
  const pl = await ok('POST', `/picking-lists/${pk.id}/create-packing`, { boxes: 2, dimensions: '40x30x20', remarks: TAG, items: [{ productId: P1, boxNo: 1, qty: 3 }, { productId: P1, boxNo: 2, qty: 3 }, { productId: P2, boxNo: 2, qty: 5 }] });
  check('packing DRAFT with weights/boxes', pl.status === 'DRAFT' && pl.boxes === 2 && pl.items.length === 3, pl);
  await fail('POST', `/picking-lists/${pk.id}/create-packing`, { items: [{ productId: P1, boxNo: 1, qty: 1 }, { productId: P2, boxNo: 1, qty: 1 }] }); // all picked is packed already
  await ok('POST', `/packing-lists/${pl.id}/pack`);
  const dn1 = await ok('POST', `/picking-lists/${pk.id}/create-delivery`, { driver: 'TEST driver', vehicleNo: 'DXB-1' });
  check('DN1 prefilled from picking (6 + 5)', dn1.status === 'DRAFT' && dn1.packingId === pl.id && dn1.items.find((i: J) => i.productId === P1).qty === 6, dn1.items);
  await fail('POST', `/sales-orders/${so.id}/create-delivery`, { items: [{ orderItemId: i1.orderItemId, qty: 5 }] }); // 6 draft + 5 > 10
  await ok('POST', `/delivery-notes/${dn1.id}/post`);
  x = await bal(P1);
  check('DN1 posted: P1 onHand -6, reserved -6', x.onHand === b1.onHand - 6 && x.reserved === b1.reserved + 4, x);
  const dnPosted = await ok('GET', `/delivery-notes/${dn1.id}`);
  check('DN item unitCost stored (avg cost)', near(dnPosted.items.find((i: J) => i.productId === P1).unitCost, unitCost1, 0.0001), dnPosted.items);
  const so2 = await ok('GET', `/sales-orders/${so.id}`);
  check('SO PARTIALLY_DELIVERED, delivered 6', so2.status === 'PARTIALLY_DELIVERED' && so2.items.find((i: J) => i.productId === P1).delivered === 6, so2.status);
  check('packing DELIVERED', (await ok('GET', `/packing-lists/${pl.id}`)).status === 'DELIVERED');
  await fail('POST', `/delivery-notes/${dn1.id}/post`, {}); // already posted
  const list = await ok('GET', `/sales-orders?search=${TAG}`);
  const row = list.rows.find((r: J) => r.id === so.id);
  check('SO list has progress %', row && row.deliveredPct > 0 && row.deliveredPct < 100 && row.invoicedPct === 0, row);

  console.log('\n== 5. complete picking -> delivery 2');
  await fail('POST', `/sales-orders/${so.id}/create-picking`, {}); // remaining 4 already planned on the open picking list
  const pk3 = await ok('PUT', `/picking-lists/${pk.id}/pick`, { items: [{ id: i1.id, pickedQty: 10 }] });
  check('picking PICKED after completing the list', pk3.status === 'PICKED', pk3.status);
  const dn2 = await ok('POST', `/picking-lists/${pk.id}/create-delivery`, {});
  check('DN2 has only the 4 remaining picked units', dn2.items.length === 1 && dn2.items[0].qty === 4, dn2.items);
  await ok('POST', `/delivery-notes/${dn2.id}/post`);
  x = await bal(P1);
  check('after DN2: P1 onHand -10, reserved back to baseline', x.onHand === b1.onHand - 10 && x.reserved === b1.reserved, x);
  const so3 = await ok('GET', `/sales-orders/${so.id}`);
  check('SO DELIVERED', so3.status === 'DELIVERED', so3.status);
  await fail('POST', `/sales-orders/${so.id}/create-delivery`, {}); // nothing left

  console.log('\n== 6. invoicing (no double billing) + COGS');
  const si1 = await ok('POST', `/delivery-notes/${dn1.id}/create-invoice`, { remarks: TAG });
  check('invoice DRAFT from DN1', si1.status === 'DRAFT' && si1.trn !== undefined && si1.dueDate && si1.items.length === 2, si1);
  await fail('POST', `/delivery-notes/${dn1.id}/create-invoice`, {}); // already invoiced
  const dnAfter = await ok('GET', `/delivery-notes/${dn1.id}`);
  check('DN1 flagged invoiced', dnAfter.invoiced === true);
  const si2 = await ok('POST', `/sales-orders/${so.id}/create-invoice`, {});
  check('SO invoice picks only delivered-not-invoiced (DN2: 4 x P1)', si2.items.length === 1 && si2.items[0].qty === 4 && si2.items[0].deliveryItemId, si2.items);
  await fail('POST', `/sales-orders/${so.id}/create-invoice`, {});
  await fail('POST', `/delivery-notes/${dn2.id}/create-invoice`, {});
  await ok('POST', `/sales-invoices/${si1.id}/post`);
  await ok('POST', `/sales-invoices/${si2.id}/post`);
  const p1 = await ok('GET', `/sales-invoices/${si1.id}`);
  const p2 = await ok('GET', `/sales-invoices/${si2.id}`);
  check('invoices POSTED', p1.status === 'POSTED' && p2.status === 'POSTED');
  const exp1 = 6 * 420 + 5 * 35, exp2 = 4 * 420;
  check('invoice 1 total', near(p1.total, (exp1) * 1.05) && near(p1.baseTotal, exp1 * 1.05), p1.total);
  check('invoice 2 total', near(p2.total, exp2 * 1.05), p2.total);
  const cogsExpected = 10 * unitCost1 + 5 * b2.avg;
  check('COGS stored on invoices', near(p1.cogs + p2.cogs, cogsExpected, 0.02), { got: p1.cogs + p2.cogs, cogsExpected });
  for (const inv of [p1, p2]) {
    const jb = await journalsBalanced('SALES_INVOICE', inv.id);
    check(`${inv.docNo} journals balanced (AR/Sales/VAT + COGS)`, jb.balanced && jb.journals.length === 2, jb.journals.length);
  }
  const arAfter = await customerBalance(CUST);
  check('customer AR increased by invoices', near(arAfter - arBefore, (exp1 + exp2) * 1.05), { arBefore, arAfter });
  check('COGS account moved by cogs', near((await sumAcc('COGS')) - cogsBefore, cogsExpected, 0.02));
  check('INVENTORY account credited by cogs (+opening)', near((await sumAcc('INVENTORY')) - invBefore, -cogsExpected, 0.02));
  const soEnd = await ok('GET', `/sales-orders/${so.id}`);
  check('SO INVOICED and all lines invoiced', soEnd.status === 'INVOICED' && soEnd.items.every((i: J) => i.invoiced === i.ordered), soEnd.status);
  const out = await ok('GET', `/sales-invoices/outstanding?customerId=${CUST}`);
  check('outstanding endpoint lists invoices', out.some((r: J) => r.id === si1.id && near(r.outstanding, p1.baseTotal)) && out.some((r: J) => r.id === si2.id));
  const pr = await ok('GET', `/sales-invoices/${si1.id}/print`);
  check('print payload has company', pr.invoice.docNo === si1.docNo && 'company' in pr && 'bank' in pr);
  await fail('POST', `/sales-invoices/${si1.id}/post`, {});

  console.log('\n== 7. sales return: receive -> inspect -> post (credit note)');
  const itemP1 = p1.items.find((i: J) => i.productId === P1);
  await fail('POST', '/sales-returns', { invoiceId: si1.id, items: [{ invoiceItemId: itemP1.id, qty: 7 }] }); // > invoiced 6
  const sr = await ok('POST', '/sales-returns', { invoiceId: si1.id, reason: TAG, items: [{ invoiceItemId: itemP1.id, qty: 3 }] });
  check('return DRAFT', sr.status === 'DRAFT' && near(sr.total, 3 * 420 * 1.05), sr);
  await fail('POST', `/sales-returns/${sr.id}/inspect`, { items: [{ id: sr.items[0].id, resalableQty: 2, damagedQty: 1 }] }); // not received yet
  await ok('POST', `/sales-returns/${sr.id}/receive`, { items: [{ id: sr.items[0].id, receivedQty: 3 }] });
  await fail('POST', `/sales-returns/${sr.id}/inspect`, { items: [{ id: sr.items[0].id, resalableQty: 1, damagedQty: 1 }] }); // != received
  await ok('POST', `/sales-returns/${sr.id}/inspect`, { items: [{ id: sr.items[0].id, resalableQty: 2, damagedQty: 1 }] });
  const stBefore = await bal(P1);
  const arPre = await customerBalance(CUST);
  const srp = await ok('POST', `/sales-returns/${sr.id}/post`);
  check('return POSTED with credit note', srp.status === 'POSTED' && srp.creditNote && srp.creditNote.journalId && /^CN-/.test(srp.creditNote.noteNo), srp.creditNote);
  const stAfter = await bal(P1);
  check('stock: +3 return then -1 damage = +2 net', stAfter.onHand === stBefore.onHand + 2, { stBefore, stAfter });
  const ledger = await prisma.stockTransaction.findMany({ where: { refType: 'SALES_RETURN', refId: sr.id } });
  check('ledger shows SALES_RETURN +2,+1 and DAMAGE -1', ledger.length === 3 && ledger.filter((l) => l.txType === 'DAMAGE').length === 1, ledger.map((l) => `${l.txType}:${l.qty}`));
  const cnj = await prisma.journalEntry.findUnique({ where: { id: srp.creditNote.journalId }, include: { lines: true } });
  const dr = cnj!.lines.reduce((s, l) => s + Number(l.debit), 0), cr = cnj!.lines.reduce((s, l) => s + Number(l.credit), 0);
  check('credit-note journal balanced = 1260 + VAT', near(dr, cr) && near(cr, 3 * 420 * 1.05), { dr, cr });
  const jr = await journalsBalanced('SALES_RETURN', sr.id);
  check('inventory/COGS journal balanced', jr.balanced, jr.journals.length);
  check('AR reduced by credit note', near(arPre - (await customerBalance(CUST)), 3 * 420 * 1.05));
  const p1b = await ok('GET', `/sales-invoices/${si1.id}`);
  check('invoice receivedAmount += credit, PARTIALLY_PAID', near(p1b.receivedAmount, 3 * 420 * 1.05) && p1b.status === 'PARTIALLY_PAID' && near(p1b.outstanding, p1b.baseTotal - 3 * 420 * 1.05), p1b);
  await fail('POST', `/sales-invoices/${si1.id}/cancel`, {}); // has credit
  await fail('POST', '/sales-returns', { invoiceId: si1.id, items: [{ invoiceItemId: itemP1.id, qty: 4 }] }); // 3 already returned, only 3 returnable

  console.log('\n== 8. shortage blocks approval; allowBackorder flags lines; cancel releases');
  const big = await ok('POST', '/sales-orders', { customerId: CUST, warehouseId: WH, customerPoNo: TAG, remarks: TAG, items: [{ productId: P2, qty: 9999, rate: 1 }] });
  await ok('POST', `/sales-orders/${big.id}/submit`); // approval rule (amount < 25000) => pending
  const failApr = await fail('POST', `/sales-orders/${big.id}/approve`, {});
  check('approval error lists short item', /insufficient available stock/i.test(failApr?.error || '') && /OF-00231/.test(failApr?.error || ''), failApr);
  check('order still PENDING_APPROVAL after failed approve', (await ok('GET', `/sales-orders/${big.id}`)).status === 'PENDING_APPROVAL');
  const bo = await ok('POST', `/sales-orders/${big.id}/approve?allowBackorder=true`, {});
  const boLine = bo.items[0];
  check('backorder approve reserves available part & flags line', bo.status === 'APPROVED' && boLine.backorder === true && boLine.reserved > 0 && boLine.reserved < 9999, boLine);
  const cnl = await ok('POST', `/sales-orders/${big.id}/cancel`, {});
  check('cancel releases reservation', cnl.status === 'CANCELLED' && (await bal(P2)).reserved === b2.reserved, await bal(P2));

  console.log('\n== 9. delivery cancel reverses stock; reject returns to DRAFT');
  const s3 = await ok('POST', '/sales-orders', { customerId: CUST, warehouseId: WH, customerPoNo: TAG, remarks: TAG, items: [{ productId: P2, qty: 2 }] });
  await ok('POST', `/sales-orders/${s3.id}/submit`);
  const rej = await ok('POST', `/sales-orders/${s3.id}/reject`, { comment: TAG });
  check('reject => DRAFT', rej.status === 'DRAFT', rej.status);
  await ok('POST', `/sales-orders/${s3.id}/submit`);
  await ok('POST', `/sales-orders/${s3.id}/approve`, {});
  const d3 = await ok('POST', `/sales-orders/${s3.id}/create-delivery`, {});
  const base2 = await bal(P2);
  await ok('POST', `/delivery-notes/${d3.id}/post`);
  check('delivered -2', (await bal(P2)).onHand === base2.onHand - 2);
  await ok('POST', `/delivery-notes/${d3.id}/cancel`, {});
  const re = await bal(P2);
  check('cancel DN: stock back, reservation re-created', re.onHand === base2.onHand && re.reserved === base2.reserved, re);
  const s3b = await ok('GET', `/sales-orders/${s3.id}`);
  check('SO back to APPROVED with nothing delivered', s3b.status === 'APPROVED' && s3b.items[0].delivered === 0);
  await ok('POST', `/sales-orders/${s3.id}/cancel`, {});
  check('order cancel releases', (await bal(P2)).reserved === b2.reserved);

  console.log('\n== 10. invoice before delivery (setting) must not double-bill on delivery');
  await prisma.systemSetting.create({ data: { key: 'sales.invoiceBeforeDelivery', value: 'true' } });
  const s4 = await ok('POST', '/sales-orders', { customerId: CUST, warehouseId: WH, customerPoNo: TAG, remarks: TAG, items: [{ productId: P2, qty: 3 }] });
  await ok('POST', `/sales-orders/${s4.id}/submit`);
  await ok('POST', `/sales-orders/${s4.id}/approve`, {});
  const pre = await ok('POST', `/sales-orders/${s4.id}/create-invoice`, {});
  check('pre-delivery invoice allowed (no delivery link)', pre.items.length === 1 && !pre.items[0].deliveryItemId, pre.items);
  await ok('POST', `/sales-invoices/${pre.id}/post`);
  const preP = await ok('GET', `/sales-invoices/${pre.id}`);
  check('pre-bill COGS at avg cost', near(preP.cogs, 3 * b2.avg, 0.02), preP.cogs);
  await fail('POST', `/sales-orders/${s4.id}/create-invoice`, {}); // nothing more to bill
  const d4 = await ok('POST', `/sales-orders/${s4.id}/create-delivery`, {});
  await ok('POST', `/delivery-notes/${d4.id}/post`);
  const d4p = await ok('GET', `/delivery-notes/${d4.id}`);
  check('delivery of pre-billed qty marked invoiced', d4p.invoiced === true && d4p.items[0].invoicedQty === 3, d4p.items);
  await fail('POST', `/delivery-notes/${d4.id}/create-invoice`, {});
  check('order INVOICED', (await ok('GET', `/sales-orders/${s4.id}`)).status === 'INVOICED');
  await fail('POST', `/delivery-notes/${d4.id}/cancel`, {}); // billed
  await prisma.systemSetting.deleteMany({ where: { key: 'sales.invoiceBeforeDelivery' } });

  console.log('\n== 11. invoice cancel (unpaid) reverses journals + billing');
  const s5 = await ok('POST', '/sales-orders', { customerId: CUST, warehouseId: WH, customerPoNo: TAG, remarks: TAG, items: [{ productId: P2, qty: 1 }] });
  await ok('POST', `/sales-orders/${s5.id}/submit`);
  await ok('POST', `/sales-orders/${s5.id}/approve`, {});
  const d5 = await ok('POST', `/sales-orders/${s5.id}/create-delivery`, {});
  await ok('POST', `/delivery-notes/${d5.id}/post`);
  const i5 = await ok('POST', `/delivery-notes/${d5.id}/create-invoice`, {});
  await ok('POST', `/sales-invoices/${i5.id}/post`);
  const arMid = await customerBalance(CUST);
  const c5 = await ok('POST', `/sales-invoices/${i5.id}/cancel`, {});
  check('invoice CANCELLED, AR reversed', c5.status === 'CANCELLED' && near(arMid - (await customerBalance(CUST)), 36.75), { arMid });
  const i5b = await ok('POST', `/delivery-notes/${d5.id}/create-invoice`, {});
  check('billing released: DN can be invoiced again', i5b.status === 'DRAFT');
  await ok('DELETE', `/sales-invoices/${i5b.id}`);

  console.log('\n== 12. dashboards');
  const ps = await ok('GET', '/sales/pipeline-summary');
  check('pipeline summary keys', ['pendingQuotations', 'pendingSalesOrders', 'pendingDeliveries', 'pendingInvoices'].every((k) => typeof ps[k] === 'number'), ps);
  const open = await ok('GET', `/sales-orders/open?customerId=${CUST}`);
  check('open orders helper', Array.isArray(open));
  const links = await ok('GET', `/sales-orders/${so.id}`);
  check('document links recorded', links.links.createdFrom.length >= 1 && links.links.convertedTo.length >= 3, links.links);

  // restore settings
  await prisma.systemSetting.deleteMany({ where: { key: { startsWith: 'sales.' } } });
  for (const s of savedSettings) await prisma.systemSetting.create({ data: s });

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
}

main()
  .catch((e) => { failures++; console.error('\nFATAL', e.message || e); })
  .finally(async () => { await prisma.$disconnect(); process.exit(failures ? 1 : 0); });
