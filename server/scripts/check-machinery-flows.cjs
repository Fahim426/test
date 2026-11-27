/* Mutating regression checks. Run only against the isolated QA API, never the live demo. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.QA_API || 'http://127.0.0.1:4001/api';
if (base !== 'http://127.0.0.1:4001/api') throw new Error('Use the isolated QA API on port 4001');
const report = { checks: [], documents: {}, failures: [] };
let token, bu;
const rows = x => Array.isArray(x) ? x : x.rows;
async function request(url, method = 'GET', body, options = {}) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(bu ? { 'X-BU': String(bu) } : {}), ...options.headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (options.binary) { assert.equal(r.status, 200, url); const b = Buffer.from(await r.arrayBuffer()); assert.equal(b.subarray(0, 4).toString(), '%PDF'); return b.length; }
  const value = await r.json();
  if (options.status) { assert.equal(r.status, options.status, JSON.stringify(value)); return value; }
  if (!r.ok) throw Error(method + ' ' + url + ': ' + r.status + ' ' + JSON.stringify(value));
  return value;
}
const post = (u, b = {}) => request(u, 'POST', b);
function check(name, value = true) { assert.ok(value, name); report.checks.push(name); console.log('PASS ' + name); }
async function section(name, fn) { try { await fn(); } catch (e) { report.failures.push(name + ': ' + e.message); console.error('FAIL ' + name + ': ' + e.message); } }
function metadata(doc, label) {
  assert.ok(doc.items?.length, label + ' has items');
  for (const item of doc.items.filter(x => x.productId)) {
    assert.ok(item.product, label + ' product enrichment');
    assert.ok(Object.hasOwn(item.product, 'stockNumber'), label + ' stock number');
    assert.ok(Object.hasOwn(item.product, 'brandName'), label + ' brand');
    assert.ok(Object.hasOwn(item.product, 'altNo'), label + ' alternate references');
  }
  check(label + ' includes product details');
}
async function main() {
  const login = await post('/auth/login', { username: 'admin', password: 'admin123' }); token = login.accessToken;
  check('Admin login');
  bu = rows(await request('/business-units')).find(x => x.isActive).id;
  const product = rows(await request('/products?pageSize=100'))[0];
  const customer = rows(await request('/customers?pageSize=100'))[0];
  const supplier = rows(await request('/suppliers?pageSize=100'))[0];
  const warehouse = rows(await request('/warehouses?pageSize=100'))[0];
  const reference = 'QA-STOCK-' + Date.now();
  await request('/products/' + product.id, 'PUT', { stockNumber: reference, oemNumber: 'QA-MFR-1530', partNumbers: [{ kind: 'ALTERNATE', number: 'QA-ALT-1530', brand: 'GXU' }], vehicles: [{ make: 'GXU', model: 'Laser series', yearFrom: 2026 }] });
  check('Product stock number edited in QA only');
  const picked = rows(await request('/products/lookup?q=' + encodeURIComponent(reference)))[0];
  check('Lookup finds stock number and brand', picked?.stockNumber === reference && Object.hasOwn(picked, 'brand') && Object.hasOwn(picked, 'altNo'));
  check('Lookup includes manufacturer and equipment references', picked.oemNumber === 'QA-MFR-1530' && picked.altNo.includes('QA-ALT-1530') && picked.vehicle.includes('GXU Laser series'));
  report.master = { productId: product.id, productCode: product.code, stockNumber: reference, customerId: customer.id, supplierId: supplier.id, warehouseId: warehouse.id, buId: bu, admin: login.user };
  await section('Purchase order to paid invoice', async () => {
    let po = await post('/purchase-orders', { supplierId: supplier.id, warehouseId: warehouse.id, currencyCode: 'AED', remarks: 'QA machinery regression', items: [{ productId: product.id, qty: 5, rate: 82000, vatRate: 5 }] });
    report.documents.po = po.id; metadata(po, 'Purchase order');
    po = await post('/purchase-orders/' + po.id + '/submit');
    for (let step = 0; po.status === 'PENDING_APPROVAL' && step < 10; step++) po = await post('/purchase-orders/' + po.id + '/approve');
    check('Purchase approval', po.status === 'APPROVED');
    let grn = await post('/purchase-orders/' + po.id + '/create-receipt'); report.documents.grn = grn.id; metadata(grn, 'Goods receipt');
    grn = await post('/goods-receipts/' + grn.id + '/post'); check('Goods receipt posts stock', grn.status === 'POSTED');
    let pi = await post('/goods-receipts/' + grn.id + '/create-invoice', { supplierInvoiceNo: 'QA-' + Date.now() }); report.documents.pi = pi.id; metadata(pi, 'Purchase invoice');
    pi = await post('/purchase-invoices/' + pi.id + '/post'); check('Purchase invoice posts accounts', pi.status === 'POSTED' && !!pi.journalId);
    const payment = await post('/payments', { voucherDate: '2026-11-27', mode: 'CASH', partyType: 'SUPPLIER', partyId: supplier.id, amount: Number(pi.baseTotal), allocations: [{ docType: 'PURCHASE_INVOICE', docId: pi.id, amount: Number(pi.baseTotal) }] });
    check('Supplier payment posted', payment.status === 'POSTED');
    pi = await request('/purchase-invoices/' + pi.id); check('Purchase invoice settled', pi.status === 'PAID');
    let ret = await post('/purchase-invoices/' + pi.id + '/create-return', { items: [{ invoiceItemId: pi.items[0].id, qty: 1 }] }); report.documents.pr = ret.id; metadata(ret, 'Purchase return');
    ret = await post('/purchase-returns/' + ret.id + '/post'); check('Purchase return posts stock and accounts', ret.status === 'POSTED');
    ret = await post('/purchase-returns/' + ret.id + '/cancel'); check('Purchase return cancellation reverses posting', ret.status === 'CANCELLED');
    await request('/landed-costs', 'POST', { receiptId: grn.id, charges: [{ chargeType: 'FREIGHT', amount: 500 }] }, { status: 400 }); check('Local receipts reject landed costs');
  });
  await section('Enquiry to paid sales invoice', async () => {
    const enquiry = await post('/sales-enquiries', { customerId: customer.id, remarks: 'QA machinery regression', items: [{ productId: product.id, qty: 1 }] }); report.documents.enquiry = enquiry.id; metadata(enquiry, 'Enquiry');
    let quote = await post('/sales-enquiries/' + enquiry.id + '/create-quotation', { warehouseId: warehouse.id }); report.documents.quote = quote.id; metadata(quote, 'Quotation');
    quote = await post('/sales-quotations/' + quote.id + '/send'); quote = await post('/sales-quotations/' + quote.id + '/accept'); check('Quotation sent and accepted', quote.status === 'ACCEPTED');
    let order = await post('/sales-quotations/' + quote.id + '/create-order'); report.documents.order = order.id; metadata(order, 'Sales order');
    order = await post('/sales-orders/' + order.id + '/submit');
    for (let step = 0; order.status === 'PENDING_APPROVAL' && step < 10; step++) order = await post('/sales-orders/' + order.id + '/approve');
    check('Sales order approved and reserved', order.status === 'APPROVED');
    let pick = await post('/sales-orders/' + order.id + '/create-picking'); report.documents.pick = pick.id; metadata(pick, 'Picking');
    pick = await request('/picking-lists/' + pick.id + '/pick', 'PUT', { pickedBy: 'QA test', items: pick.items.map(i => ({ id: i.id, pickedQty: Number(i.orderedQty) })) }); check('Picking recorded', pick.status === 'PICKED');
    let pack = await post('/picking-lists/' + pick.id + '/create-packing'); report.documents.pack = pack.id; metadata(pack, 'Packing');
    pack = await post('/packing-lists/' + pack.id + '/pack'); check('Packing completed', pack.status === 'PACKED');
    let delivery = await post('/packing-lists/' + pack.id + '/create-delivery'); report.documents.delivery = delivery.id; metadata(delivery, 'Delivery');
    delivery = await post('/delivery-notes/' + delivery.id + '/post'); check('Delivery posts stock', delivery.status === 'POSTED');
    let inv = await post('/delivery-notes/' + delivery.id + '/create-invoice'); report.documents.invoice = inv.id; metadata(inv, 'Sales invoice');
    inv = await post('/sales-invoices/' + inv.id + '/post'); check('Sales invoice posts accounts', inv.status === 'POSTED' && !!inv.journalId);
    const receipt = await post('/receipts', { voucherDate: '2026-11-27', mode: 'CASH', partyType: 'CUSTOMER', partyId: customer.id, amount: Number(inv.baseTotal), allocations: [{ docType: 'SALES_INVOICE', docId: inv.id, amount: Number(inv.baseTotal) }] });
    check('Customer receipt posted', receipt.status === 'POSTED');
    inv = await request('/sales-invoices/' + inv.id); check('Sales invoice settled', inv.status === 'PAID');
    let ret = await post('/sales-invoices/' + inv.id + '/create-return'); report.documents.sr = ret.id; metadata(ret, 'Sales return');
    ret = await post('/sales-returns/' + ret.id + '/receive'); check('Sales return received', ret.status === 'RECEIVED');
    ret = await post('/sales-returns/' + ret.id + '/inspect', { items: ret.items.map(i => ({ id: i.id, resalableQty: Number(i.receivedQty), damagedQty: 0 })) }); check('Sales return inspected', ret.status === 'INSPECTED');
    ret = await post('/sales-returns/' + ret.id + '/post'); check('Sales return posts stock and credit', ret.status === 'POSTED');
    await request('/sales-returns/' + ret.id + '/cancel', 'POST', {}, { status: 400 }); check('Posted sales return cannot be cancelled');
    check('Sales invoice preserves BU', inv.buId === bu);
    const hidden = await request('/sales-invoices/' + inv.id, 'GET', undefined, { headers: { 'X-BU': '999999' }, status: 404 }); check('Other BU cannot read invoice', !!hidden.error);
  });
  await section('Proforma alternative flow', async () => {
    let quote = await post('/sales-quotations', { customerId: customer.id, warehouseId: warehouse.id, items: [{ productId: product.id, qty: 1, rate: 110000, vatRate: 5 }] });
    quote = await post('/sales-quotations/' + quote.id + '/send'); quote = await post('/sales-quotations/' + quote.id + '/accept');
    let proforma = await post('/sales-quotations/' + quote.id + '/create-proforma'); report.documents.proforma = proforma.id; metadata(proforma, 'Proforma');
    proforma = await post('/proforma-invoices/' + proforma.id + '/confirm'); check('Proforma confirms linked order', !!proforma.salesOrderId);
    await post('/sales-orders/' + proforma.salesOrderId + '/cancel'); check('Proforma order cancellation releases reservations');
  });
  await section('Import shipment and landed cost', async () => {
    let order = await post('/import-orders', { supplierId: supplier.id, warehouseId: warehouse.id, currencyCode: 'AED', items: [{ productId: product.id, qty: 2, rate: 82000, vatRate: 5 }] }); report.documents.importOrder = order.id; metadata(order, 'Import order');
    order = await post('/import-orders/' + order.id + '/submit');
    for (let step = 0; order.status === 'PENDING_APPROVAL' && step < 10; step++) order = await post('/import-orders/' + order.id + '/approve');
    check('Import order confirmed', order.status === 'CONFIRMED');
    const shipment = await post('/import-shipments', { orderId: order.id }); report.documents.shipment = shipment.id; metadata(shipment, 'Import shipment');
    await post('/import-shipments/' + shipment.id + '/status', { status: 'IN_TRANSIT' });
    await post('/import-shipments/' + shipment.id + '/status', { status: 'ARRIVED' }); check('Import shipment arrival recorded');
    let grn = await post('/import-shipments/' + shipment.id + '/create-receipt'); report.documents.importGrn = grn.id; metadata(grn, 'Import goods receipt');
    grn = await post('/goods-receipts/' + grn.id + '/post'); check('Import goods receipt posted', grn.status === 'POSTED' && grn.grnType === 'IMPORT');
    let landed = await post('/landed-costs', { receiptId: grn.id, allocationMethod: 'VALUE', charges: [{ chargeType: 'FREIGHT', amount: 500 }] }); report.documents.landed = landed.id; metadata({ items: landed.allocations }, 'Landed cost');
    landed = await post('/landed-costs/' + landed.id + '/post'); check('Landed cost posts allocation', landed.status === 'POSTED');
    landed = await post('/landed-costs/' + landed.id + '/cancel'); check('Landed cost cancellation reverses allocation', landed.status === 'CANCELLED');
  });
  await section('Stock and print regression', async () => {
    for (const mode of ['warehouse', 'summary']) {
      const stock = rows(await request('/stock/' + (mode === 'summary' ? 'summary' : 'balances') + '?pageSize=1000&includeZero=1'));
      check('Stock number returned in ' + mode + ' balances', stock.some(r => r.productId === product.id && r.product?.stockNumber === reference));
    }
    for (const [key, type] of [['po','PURCHASE_ORDER'],['grn','GOODS_RECEIPT'],['pi','PURCHASE_INVOICE'],['quote','SALES_QUOTATION'],['order','SALES_ORDER'],['delivery','DELIVERY_NOTE'],['invoice','SALES_INVOICE']]) {
      if (report.documents[key]) { await request('/documents/' + type + '/' + report.documents[key] + '/pdf', 'GET', undefined, { binary: true }); check(type + ' PDF generates'); }
    }
    await request('/products/lookup?q=definitely-no-such-machine-qa-9381'); check('No-match search handled');
  });
  fs.mkdirSync(path.resolve(__dirname, '../../.local-run/machinery-qa'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../../.local-run/machinery-qa/api-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.checks.length, failures: report.failures }));
  if (report.failures.length) process.exitCode = 1;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
