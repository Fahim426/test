/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * End-to-end smoke test for the purchase backend.  Run:  BASE=http://localhost:4012 npx tsx scripts/smoke-purchase.ts
 * (start the server first: PORT=4012 npx tsx src/index.ts).  Creates clearly named TEST documents.
 */
import { prisma } from '../src/lib/prisma';

const BASE = process.env.BASE || 'http://localhost:4012';
let token = '';
let failures = 0;
const log = (...a: any[]) => console.log(...a);
function check(cond: any, msg: string, extra?: any) {
  if (cond) log('  ok   ', msg);
  else { failures++; log('  FAIL ', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}
async function api(method: string, path: string, body?: any, expect = 200): Promise<any> {
  const res = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const txt = await res.text();
  let data: any;
  try { data = JSON.parse(txt); } catch { data = txt; }
  if (expect === 0) return { status: res.status, data };
  if (res.status !== expect && !(expect === 200 && res.status === 201)) throw new Error(`${method} ${path} -> ${res.status} ${txt.slice(0, 500)}`);
  return data;
}
const fail = async (method: string, path: string, body: any, label: string, status = 400) => {
  const r = await api(method, path, body, 0);
  check(r.status === status, `${label} (-> ${r.status}: ${String(r.data?.error ?? '').slice(0, 90)})`);
  return r.data;
};
const N = (v: any) => Number(v);
const RUN = Date.now().toString(36);
const r2 = (n: number) => Math.round(n * 100) / 100;

async function ledgerSnapshot() {
  const inv = await prisma.account.findUnique({ where: { systemKey: 'INVENTORY' } });
  const grni = await prisma.account.findUnique({ where: { systemKey: 'GRNI' } });
  const sum = async (accountId: number) => {
    const a = await prisma.journalLine.aggregate({ where: { accountId }, _sum: { debit: true, credit: true } });
    return N(a._sum.debit ?? 0) - N(a._sum.credit ?? 0);
  };
  const stockVal = await prisma.stockTransaction.aggregate({ _sum: { value: true } });
  return { inventoryGL: await sum(inv!.id), grniGL: await sum(grni!.id), stockValue: N(stockVal._sum.value ?? 0) };
}
async function drift() {
  const bals = await prisma.stockBalance.findMany();
  const sums = await prisma.stockTransaction.groupBy({ by: ['productId', 'warehouseId'], _sum: { qty: true } });
  const out: Record<string, number> = {};
  for (const b of bals) out[`${b.productId}/${b.warehouseId}`] = Math.round((N(b.onHand) - N(sums.find((x) => x.productId === b.productId && x.warehouseId === b.warehouseId)?._sum.qty ?? 0)) * 1000) / 1000;
  return out;
}
async function onHand(productId: number, warehouseId: number) {
  const b = await prisma.stockBalance.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
  return N(b?.onHand ?? 0);
}

async function main() {
  const login = await api('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  token = login.accessToken || login.token;
  check(!!token, 'login');

  const wh = (await prisma.warehouse.findFirst({ where: { code: 'WH-DXB-MAIN' } })) ?? (await prisma.warehouse.findFirstOrThrow());
  const products = await prisma.product.findMany({ where: { isActive: true }, orderBy: { id: 'asc' }, take: 4 });
  const [pA, pB, pC] = products;
  const sup1 = await prisma.supplier.findFirstOrThrow({ where: { code: 'V0002' } });
  const sup2 = await prisma.supplier.findFirstOrThrow({ where: { code: 'V0003' } });
  const supImp = await prisma.supplier.findFirstOrThrow({ where: { code: 'V0001' } });
  const before = await ledgerSnapshot();
  const drift0 = await drift();
  const a0 = await onHand(pA.id, wh.id);
  const b0 = await onHand(pB.id, wh.id);

  // ------------------------------------------------------------------ LOCAL FLOW
  log('\n== MR -> PR -> RFQ');
  const mr = await api('POST', '/material-requests', { requestedBy: 'TEST user', department: 'TEST Workshop', warehouseId: wh.id, priority: 'HIGH', remarks: 'TEST smoke', items: [{ productId: pA.id, qty: 100 }, { productId: pB.id, qty: 50 }] });
  check(mr.status === 'DRAFT' && mr.docNo, `MR created ${mr.docNo}`);
  await fail('POST', `/material-requests/${mr.id}/create-requisition`, {}, 'MR not approved cannot create requisition');
  await api('POST', `/material-requests/${mr.id}/submit`);
  await api('POST', `/material-requests/${mr.id}/approve`);
  const pr = await api('POST', `/material-requests/${mr.id}/create-requisition`);
  check(pr.items.length === 2 && pr.docNo, `PR ${pr.docNo} prefilled from MR`);
  await fail('POST', `/material-requests/${mr.id}/create-requisition`, {}, 'duplicate requisition blocked');
  await api('POST', `/purchase-requisitions/${pr.id}/submit`);
  await api('POST', `/purchase-requisitions/${pr.id}/approve`);
  const rfq = await api('POST', `/purchase-requisitions/${pr.id}/create-enquiry`, { supplierIds: [sup1.id, sup2.id] });
  check(rfq.docNo, `RFQ ${rfq.docNo} created from PR`);
  await api('POST', `/purchase-enquiries/${rfq.id}/send`);
  await api('POST', `/purchase-enquiries/${rfq.id}/suppliers/${sup1.id}/response`, { responseStatus: 'RESPONDED', responseNotes: 'TEST quote coming' });

  log('\n== Supplier quotations + comparative statement');
  const mkQ = (supplierId: number, rA: number, rB: number, days: number, disc = 0) =>
    api('POST', `/purchase-enquiries/${rfq.id}/create-quotation`, { supplierId, paymentTerms: 'Net 30', deliveryDays: days, supplierRef: `TEST-QT-${supplierId}`, items: [{ productId: pA.id, qty: 100, rate: rA, discount: disc }, { productId: pB.id, qty: 50, rate: rB }] });
  const q1 = await mkQ(sup1.id, 10, 20, 7);
  const q2 = await mkQ(sup2.id, 9.5, 21, 3, 10);
  check(q1.total > 0 && q2.total > 0, `quotations ${q1.docNo} total ${q1.total}, ${q2.docNo} total ${q2.total}`);
  const cmp = await api('GET', `/comparative-statements/${rfq.id}`);
  check(cmp.items.length === 2 && cmp.quotations.length === 2, 'comparative matrix 2x2');
  check(cmp.items[0].cells.filter((c: any) => c.cheapest).length === 1, 'cheapest flag per line');
  const cheapestQ = cmp.quotations.find((q: any) => q.cheapestTotal);
  check(!!cheapestQ, `cheapest supplier total flagged: ${cheapestQ?.docNo}`);
  await api('POST', `/comparative-statements/${rfq.id}/select`, { quotationId: cheapestQ.quotationId });
  const cmp2 = await api('GET', `/comparative-statements/${rfq.id}`);
  check(cmp2.quotations.filter((q: any) => q.status === 'SELECTED').length === 1 && cmp2.quotations.filter((q: any) => q.status === 'REJECTED').length === 1, 'selected one, other REJECTED (history kept)');
  const other = cmp2.quotations.find((q: any) => q.status === 'REJECTED');
  await fail('POST', `/supplier-quotations/${other.quotationId}/create-order`, {}, 'rejected quotation cannot become PO');

  log('\n== Purchase order');
  const po = await api('POST', `/supplier-quotations/${cheapestQ.quotationId}/create-order`, { warehouseId: wh.id });
  check(po.status === 'DRAFT' && po.items.length === 2 && po.quotationId === cheapestQ.quotationId, `PO ${po.docNo} prefilled from quotation, total ${po.total}`);
  check(po.links.createdFrom.length >= 1, 'doc link quotation -> PO');
  await api('PUT', `/purchase-orders/${po.id}`, { supplierId: po.supplierId, warehouseId: wh.id, roundOff: -0.13, items: po.items.map((i: any) => ({ productId: i.productId, qty: N(i.qty), rate: N(i.rate), discount: N(i.discount), vatRate: N(i.vatRate) })) });
  const po1 = await api('GET', `/purchase-orders/${po.id}`);
  check(N(po1.roundOff) === -0.13 && r2(N(po1.subtotal) - N(po1.discount) + N(po1.vatAmount) - 0.13) === N(po1.total), `PO totals recomputed with roundOff (total ${po1.total})`);
  await fail('POST', `/purchase-orders/${po.id}/create-receipt`, {}, 'cannot receive DRAFT PO');
  const sub = await api('POST', `/purchase-orders/${po.id}/submit`);
  check(sub.status === 'PENDING_APPROVAL' && sub.approval?.status === 'PENDING', `configured approval rule -> PENDING_APPROVAL (${sub.status})`);
  const apd = await api('POST', `/purchase-orders/${po.id}/approve`, { comment: 'TEST approve' });
  check(apd.status === 'APPROVED' && apd.approval?.status === 'APPROVED', `approved through engine handler (${apd.status})`);
  const list = await api('GET', `/purchase-orders?search=${po.docNo}`);
  check(list.rows[0]?.orderedQty === 150 && list.rows[0]?.receivedQty === 0 && list.rows[0]?.pendingQty === 150, 'list has ordered/received/pending');
  const open = await api('GET', `/purchase-orders/open?supplierId=${po.supplierId}`);
  check(open.rows.some((r: any) => r.id === po.id), 'PO appears in open picker');

  log('\n== GRN 60 / 40 (partial receipts)');
  const itemA = po1.items.find((i: any) => i.productId === pA.id);
  const itemB = po1.items.find((i: any) => i.productId === pB.id);
  const pre = await api('GET', `/goods-receipts/prefill/${po.id}`);
  check(pre.items.length === 2 && pre.items[0].orderedQty === 100 && pre.items[0].previouslyReceived === 0 && pre.items[0].pendingQty === 0 && pre.items[0].qty === 100, 'prefill ordered/previous/current/pending');
  await fail('POST', '/goods-receipts', { orderId: po.id, items: [{ orderItemId: itemA.id, qty: 101 }] }, 'over-receipt blocked (tolerance 0)');
  const g1 = await api('POST', `/purchase-orders/${po.id}/create-receipt`, { supplierDeliveryNo: 'TEST-DN-1', items: [{ orderItemId: itemA.id, qty: 60 }, { orderItemId: itemB.id, qty: 50 }] });
  check(g1.status === 'DRAFT' && g1.items.length === 2, `GRN ${g1.docNo} draft`);
  await fail('POST', `/purchase-orders/${po.id}/create-receipt`, {}, 'second draft GRN for same PO blocked');
  await api('POST', `/goods-receipts/${g1.id}/post`);
  const afterG1 = await api('GET', `/purchase-orders/${po.id}`);
  check(afterG1.status === 'PARTIALLY_RECEIVED', `PO PARTIALLY_RECEIVED after GRN1 (${afterG1.status})`);
  check((await onHand(pA.id, wh.id)) - a0 === 60 && (await onHand(pB.id, wh.id)) - b0 === 50, 'stock increased by 60 / 50');
  const pre2 = await api('GET', `/goods-receipts/prefill/${po.id}`);
  check(pre2.items[0].previouslyReceived === 60 && pre2.items[0].qty === 40 && pre2.items[1].qty === 0, 'prefill GRN2 shows previously received 60, current 40');
  const g2 = await api('POST', `/purchase-orders/${po.id}/create-receipt`, {});
  check(g2.items.length === 1 && N(g2.items[0].qty) === 40, `GRN2 ${g2.docNo} prefilled 40`);
  await api('POST', `/goods-receipts/${g2.id}/post`);
  const afterG2 = await api('GET', `/purchase-orders/${po.id}`);
  check(afterG2.status === 'FULLY_RECEIVED', `PO FULLY_RECEIVED after GRN2 (${afterG2.status})`);
  check((await onHand(pA.id, wh.id)) - a0 === 100, 'stock increased by 100 total');
  const led = await prisma.stockTransaction.findMany({ where: { refType: 'GOODS_RECEIPT', refId: { in: [g1.id, g2.id] } } });
  check(led.length === 3 && led.every((t) => t.txType === 'PURCHASE_RECEIPT' && N(t.qty) > 0), 'stock ledger has 3 PURCHASE_RECEIPT rows');
  const pend = await api('GET', `/goods-receipts/pending-invoice?supplierId=${po.supplierId}`);
  check(pend.rows.some((r: any) => r.id === g1.id) && pend.rows.some((r: any) => r.id === g2.id), 'GRNs show in pending-invoice');

  log('\n== Purchase invoice');
  const inv1 = await api('POST', `/goods-receipts/${g1.id}/create-invoice`, { supplierInvoiceNo: `TEST-SINV-${RUN}-1`, roundOff: 0 });
  check(inv1.status === 'DRAFT' && inv1.items.length === 2, `invoice ${inv1.docNo} from GRN1 total ${inv1.total}`);
  await fail('POST', `/goods-receipts/${g1.id}/create-invoice`, {}, 'GRN1 cannot be invoiced twice');
  const gr1 = await api('GET', `/goods-receipts/${g1.id}`);
  check(gr1.invoiced === true, 'GRN1 flagged invoiced');
  await api('POST', `/purchase-invoices/${inv1.id}/post`);
  const inv2 = await api('POST', `/purchase-orders/${po.id}/create-invoice`, { supplierInvoiceNo: `TEST-SINV-${RUN}-2` });
  check(inv2.items.length === 1 && N(inv2.items[0].qty) === 40, `invoice ${inv2.docNo} from PO for remaining received 40`);
  await fail('POST', `/purchase-orders/${po.id}/create-invoice`, {}, 'PO has nothing left to invoice');
  await fail('POST', '/purchase-invoices', { supplierId: po.supplierId, supplierInvoiceNo: 'X', items: [{ orderItemId: itemA.id, qty: 1 }] }, 'cannot invoice more than received-not-invoiced');
  await api('POST', `/purchase-invoices/${inv2.id}/post`);
  const pi1 = await api('GET', `/purchase-invoices/${inv1.id}`);
  check(pi1.status === 'POSTED' && pi1.outstanding === pi1.baseTotal && pi1.dueDate, `invoice posted, outstanding ${pi1.outstanding}, due ${pi1.dueDate}`);
  const j1 = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: 'PURCHASE_INVOICE', sourceId: inv1.id }, include: { lines: { include: { account: true } } } });
  const ap = j1.lines.find((l) => l.account.systemKey === 'AP');
  check(ap && N(ap.credit) === N(pi1.baseTotal) && ap.partyType === 'SUPPLIER' && ap.partyId === po.supplierId, 'AP credit with supplier party = base total');
  check(j1.lines.some((l) => l.account.systemKey === 'GRNI' && N(l.debit) > 0) && j1.lines.some((l) => l.account.systemKey === 'VAT_INPUT' && N(l.debit) > 0), 'Dr GRNI + Dr VAT_INPUT');
  const out = await api('GET', `/purchase-invoices/outstanding?supplierId=${po.supplierId}`);
  check(out.rows.some((r: any) => r.id === inv1.id) && out.rows.some((r: any) => r.id === inv2.id), 'outstanding list has both');
  await fail('POST', `/goods-receipts/${g1.id}/cancel`, {}, 'invoiced GRN cannot be cancelled');

  log('\n== Purchase return (partial, from invoice)');
  const ret = await api('POST', `/purchase-invoices/${inv1.id}/create-return`, { reason: 'DAMAGED', items: [{ invoiceItemId: pi1.items.find((i: any) => i.productId === pA.id).id, qty: 5 }] });
  check(ret.status === 'DRAFT' && N(ret.total) > 0, `return ${ret.docNo} total ${ret.total}`);
  await fail('POST', '/purchase-returns', { invoiceId: inv1.id, reason: 'OTHER', items: [{ invoiceItemId: pi1.items.find((i: any) => i.productId === pA.id).id, qty: 56 }] }, 'cannot return more than invoiced minus returned');
  const aBefore = await onHand(pA.id, wh.id);
  await api('POST', `/purchase-returns/${ret.id}/post`);
  check((await onHand(pA.id, wh.id)) === aBefore - 5, 'stock reduced by return qty');
  const rd = await api('GET', `/purchase-returns/${ret.id}`);
  check(rd.status === 'POSTED' && rd.creditNote?.noteType === 'CREDIT' && rd.creditNote?.journalId, `credit note ${rd.creditNote?.noteNo} with journal`);
  const pi1b = await api('GET', `/purchase-invoices/${inv1.id}`);
  check(N(pi1b.paidAmount) === N(rd.total) && pi1b.status === 'PARTIALLY_PAID', 'credit applied to invoice');
  await fail('POST', `/purchase-invoices/${inv1.id}/cancel`, {}, 'invoice with return/credit cannot be cancelled');

  log('\n== Approval engine on PO');
  const po3 = await api('POST', '/purchase-orders', { supplierId: sup1.id, warehouseId: wh.id, remarks: 'TEST approval', items: [{ productId: pC.id, qty: 2, rate: 5 }] });
  const s3 = await api('POST', `/purchase-orders/${po3.id}/submit`);
  check(s3.status === 'PENDING_APPROVAL', 'PO pending approval');
  const rj = await api('POST', `/purchase-orders/${po3.id}/reject`, { comment: 'TEST' });
  check(rj.status === 'DRAFT', 'rejection returns PO to DRAFT');
  const active = await prisma.approvalRule.findMany({ where: { docType: 'PURCHASE_ORDER', isActive: true }, select: { id: true } });
  await prisma.approvalRule.updateMany({ where: { id: { in: active.map((r) => r.id) } }, data: { isActive: false } });
  try {
    const s3b = await api('POST', `/purchase-orders/${po3.id}/submit`);
    check(s3b.status === 'APPROVED', `no matching rule -> auto APPROVED (${s3b.status})`);
  } finally {
    await prisma.approvalRule.updateMany({ where: { id: { in: active.map((r) => r.id) } }, data: { isActive: true } });
  }
  await api('POST', `/purchase-orders/${po3.id}/cancel`, { reason: 'TEST cleanup' });

  // ------------------------------------------------------------------ IMPORT FLOW
  log('\n== Import flow');
  const ir = await api('POST', '/import-requests', { supplierId: supImp.id, warehouseId: wh.id, remarks: 'TEST import', items: [{ productId: pA.id, qty: 40 }, { productId: pC.id, qty: 20 }] });
  await api('POST', `/import-requests/${ir.id}/submit`);
  await api('POST', `/import-requests/${ir.id}/approve`);
  const spf = await api('POST', `/import-requests/${ir.id}/create-proforma`, { supplierId: supImp.id, currencyCode: 'USD', exchangeRate: 3.6725, incoterms: 'CIF', supplierRef: 'TEST-PF-1', items: [{ productId: pA.id, qty: 40, rate: 4 }, { productId: pC.id, qty: 20, rate: 10 }] });
  check(spf.total === 360 && spf.baseTotal === r2(360 * 3.6725), `proforma ${spf.docNo} USD ${spf.total} (base ${spf.baseTotal})`);
  const ipo = await api('POST', `/supplier-proformas/${spf.id}/create-order`, { warehouseId: wh.id, incoterms: 'CIF', portOfLoading: 'Yokohama', portOfDestination: 'Jebel Ali', shippingMethod: 'SEA', shippingAgent: 'TEST Shipping', clearingAgent: 'TEST Clearing' });
  check(ipo.orderType === 'IMPORT' && ipo.currencyCode === 'USD' && ipo.supplierCountry, `import PO ${ipo.docNo} (${ipo.supplierCountry})`);
  await fail('POST', `/import-orders/${ipo.id}/status`, { status: 'ARRIVED' }, 'invalid import status transition blocked');
  const c1 = await api('POST', `/import-orders/${ipo.id}/status`, { status: 'CONFIRMED' });
  check(c1.status === 'PENDING_APPROVAL', 'import PO goes through approval engine');
  const c2 = await api('POST', `/import-orders/${ipo.id}/approve`, {});
  check(c2.status === 'CONFIRMED', 'import PO CONFIRMED after approval');
  await api('POST', `/import-orders/${ipo.id}/status`, { status: 'PAYMENT_PENDING' });
  const det = await api('GET', `/import-orders/${ipo.id}`);
  check(det.advancePaid === 0, 'advancePaid exposed');
  await fail('POST', '/goods-receipts', { orderId: ipo.id }, 'import GRN needs shipment');
  const ship = await api('POST', '/import-shipments', { orderId: ipo.id, containerNo: 'TEST-CONT-001', billOfLading: 'TEST-BL-1', etd: '2026-09-01', eta: '2026-10-01' });
  check(ship.items.length === 2, `shipment ${ship.shipmentNo} created with ${ship.items.length} items`);
  await fail('POST', `/import-shipments/${ship.id}/create-receipt`, {}, 'cannot receive before arrival');
  await api('POST', `/import-shipments/${ship.id}/status`, { status: 'IN_TRANSIT' });
  check((await api('GET', `/import-orders/${ipo.id}`)).status === 'IN_TRANSIT', 'PO moved to IN_TRANSIT by shipment');
  const git = await api('GET', '/goods-in-transit');
  const gitRow = git.rows.find((r: any) => r.shipmentId === ship.id);
  check(gitRow && gitRow.quantity === 60 && gitRow.pendingQty === 60 && gitRow.containerNo === 'TEST-CONT-001', 'goods-in-transit row');
  await api('POST', `/import-shipments/${ship.id}/status`, { status: 'ARRIVED' });
  await api('POST', `/import-shipments/${ship.id}/status`, { status: 'CUSTOMS' });
  await api('POST', `/import-shipments/${ship.id}/status`, { status: 'CLEARED' });
  const ig = await api('POST', `/import-shipments/${ship.id}/create-receipt`, {});
  check(ig.grnType === 'IMPORT' && ig.items.length === 2, `import GRN ${ig.docNo}`);
  const a1 = await onHand(pA.id, wh.id);
  await api('POST', `/goods-receipts/${ig.id}/post`);
  check((await onHand(pA.id, wh.id)) === a1 + 40, 'import stock increased by 40');
  const ipoAfter = await api('GET', `/import-orders/${ipo.id}`);
  check(ipoAfter.status === 'RECEIVED', `import PO RECEIVED (${ipoAfter.status})`);
  const shipAfter = await api('GET', `/import-shipments/${ship.id}`);
  check(shipAfter.status === 'RECEIVED' && shipAfter.items.every((i: any) => i.pendingQty === 0), 'shipment RECEIVED, items received');
  const igd = await api('GET', `/goods-receipts/${ig.id}`);
  const unitA = N(igd.items.find((i: any) => i.productId === pA.id).unitCost);
  check(r2(unitA) === r2(4 * 3.6725), `import unit cost in base = rate * FX (${unitA})`);

  log('\n== Landed cost');
  const prev = await api('POST', '/landed-costs/preview', { receiptId: ig.id, allocationMethod: 'VALUE', charges: [{ chargeType: 'FREIGHT', amount: 300 }, { chargeType: 'CUSTOMS_DUTY', amount: 100 }] });
  check(prev.totalAdditional === 400 && r2(prev.lines.reduce((s: number, l: any) => s + l.allocated, 0)) === 400, `preview allocates 400 (actual landed ${prev.actualLandedCost})`);
  const prevQ = await api('POST', '/landed-costs/preview', { receiptId: ig.id, allocationMethod: 'QUANTITY', charges: [{ chargeType: 'FREIGHT', amount: 300 }] });
  check(prevQ.lines.find((l: any) => l.productId === pA.id).allocated === 200, 'quantity method splits 300 by 40/20 => 200');
  const lc = await api('POST', '/landed-costs', { receiptId: ig.id, allocationMethod: 'VALUE', remarks: 'TEST landed', charges: [{ chargeType: 'FREIGHT', amount: 300, supplierId: sup2.id, description: 'TEST freight forwarder' }, { chargeType: 'CUSTOMS_DUTY', amount: 100 }] });
  check(lc.status === 'DRAFT' && lc.allocations.length === 2, `landed cost ${lc.docNo} draft`);
  const preLC = await ledgerSnapshot();
  const avgBefore = N((await prisma.stockBalance.findUnique({ where: { productId_warehouseId: { productId: pA.id, warehouseId: wh.id } } }))!.avgCost);
  await api('POST', `/landed-costs/${lc.id}/post`);
  const postLC = await ledgerSnapshot();
  check(r2(postLC.inventoryGL - preLC.inventoryGL) === 400 && r2(postLC.stockValue - preLC.stockValue) === 400, 'landed cost: inventory GL and stock ledger value both +400');
  const avgAfter = N((await prisma.stockBalance.findUnique({ where: { productId_warehouseId: { productId: pA.id, warehouseId: wh.id } } }))!.avgCost);
  check(avgAfter > avgBefore, `average cost increased ${avgBefore} -> ${avgAfter}`);
  const lcd = await api('GET', `/landed-costs/${lc.id}`);
  check(lcd.status === 'POSTED' && lcd.allocations.every((a: any) => a.newUnitCost > a.oldUnitCost), 'allocations keep old/new unit cost');
  const igd2 = await api('GET', `/goods-receipts/${ig.id}`);
  check(igd2.items.every((i: any) => i.landedUnitCost > i.unitCost), 'GRN landedUnitCost updated');
  const apSup2 = await prisma.journalLine.findFirst({ where: { journal: { sourceType: 'LANDED_COST', sourceId: lc.id }, partyType: 'SUPPLIER', partyId: sup2.id } });
  check(apSup2 && N(apSup2.credit) === 300, 'freight credited to supplier AP, duty to GRNI');

  log('\n== Import invoice');
  const iinv = await api('POST', `/goods-receipts/${ig.id}/create-invoice`, { supplierInvoiceNo: `TEST-IMPINV-${RUN}` });
  check(iinv.invoiceType === 'IMPORT' && iinv.currencyCode === 'USD' && N(iinv.exchangeRate) === 3.6725, `import invoice ${iinv.docNo} USD ${iinv.total}`);
  await api('POST', `/purchase-invoices/${iinv.id}/post`);
  const iinvD = await api('GET', `/purchase-invoices/${iinv.id}`);
  check(N(iinvD.baseTotal) === r2(N(iinvD.total) * 3.6725), `base total ${iinvD.baseTotal}`);

  // ------------------------------------------------------------------ CANCEL checks on a fresh GRN
  log('\n== GRN cancel reverses stock');
  const po4 = await api('POST', '/purchase-orders', { supplierId: sup1.id, warehouseId: wh.id, remarks: 'TEST cancel flow', items: [{ productId: pB.id, qty: 10, rate: 3 }] });
  await api('POST', `/purchase-orders/${po4.id}/submit`);
  await api('POST', `/purchase-orders/${po4.id}/approve`, {});
  const g4 = await api('POST', `/purchase-orders/${po4.id}/create-receipt`, {});
  const bB = await onHand(pB.id, wh.id);
  await api('POST', `/goods-receipts/${g4.id}/post`);
  await api('POST', `/goods-receipts/${g4.id}/cancel`);
  check((await onHand(pB.id, wh.id)) === bB, 'cancel returns stock to previous level');
  check((await api('GET', `/purchase-orders/${po4.id}`)).status === 'APPROVED', 'PO back to APPROVED');
  await api('POST', `/purchase-orders/${po4.id}/cancel`, {});

  // ------------------------------------------------------------------ RECONCILIATION
  log('\n== Reconciliation');
  const lines = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } });
  check(r2(N(lines._sum.debit)) === r2(N(lines._sum.credit)), `trial balance: debits ${lines._sum.debit} = credits ${lines._sum.credit}`);
  const unbalanced = await prisma.$queryRaw<any[]>`SELECT journalId FROM JournalLine GROUP BY journalId HAVING ROUND(SUM(debit),2) <> ROUND(SUM(credit),2)`;
  check(unbalanced.length === 0, 'every journal entry balanced', unbalanced);
  const drift1 = await drift();
  const changed = Object.keys(drift1).filter((k) => drift1[k] !== (drift0[k] ?? 0));
  check(changed.length === 0, `StockBalance.onHand vs stock-ledger drift unchanged by this run (pre-existing: ${JSON.stringify(Object.fromEntries(Object.entries(drift0).filter(([, v]) => v !== 0)))})`, changed.map((k) => [k, drift0[k], drift1[k]]));
  const after = await ledgerSnapshot();
  check(r2(after.inventoryGL - before.inventoryGL) === r2(after.stockValue - before.stockValue), `delta INVENTORY GL (${r2(after.inventoryGL - before.inventoryGL)}) == delta stock ledger value (${r2(after.stockValue - before.stockValue)})`);
  log(`\nDone. ${failures ? failures + ' FAILURE(S)' : 'ALL CHECKS PASSED'}`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}
main().catch(async (e) => { console.error('\nFATAL', e.message); await prisma.$disconnect(); process.exit(2); });
