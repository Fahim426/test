/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Additive demo-data seeder. Everything goes through the real REST API so posting logic, stock, journals and
 * approvals are exercised. Idempotent-ish: skipped when SystemSetting `demo.seeded` exists (use --force to run anyway).
 *
 *   cd server && BASE=http://localhost:4000/api npx tsx scripts/seed-demo.ts [--force]
 */
const BASE = process.env.BASE || 'http://localhost:4000/api';
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7); // re-run only sections whose name contains this (masters are always reused)
let token = '';
const counts: Record<string, number> = {};
const failures: string[] = [];
const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
async function ok(method: string, path: string, body?: unknown, count?: string): Promise<any> {
  const r = await call(method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(r.data).slice(0, 500)}`);
  if (count) bump(count);
  return r.data;
}
const dayStr = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const num = (v: any) => Number(v);
const r2 = (n: number) => Math.round(n * 100) / 100;

const MASTERS = ['products', 'customers', 'suppliers'];
async function section(name: string, fn: () => Promise<void>) {
  if (ONLY && !MASTERS.includes(name) && !name.includes(ONLY)) return;
  console.log(`\n== ${name}`);
  try { await fn(); console.log('   done'); } catch (e: any) { failures.push(`${name}: ${e.message}`); console.log('   FAILED', e.message); }
}
/** submit and (if an approval rule matched) approve */
async function submitApprove(base: string, id: number, count?: string) {
  const s = await ok('POST', `${base}/${id}/submit`);
  if (s.status === 'PENDING_APPROVAL' || s.status === 'SUBMITTED') return ok('POST', `${base}/${id}/approve`, { comment: 'Demo approval' }, count);
  if (count) bump(count);
  return s;
}

// ------------------------------------------------------------------------------------------------ master data
interface P { name: string; oem: string; alt: string[]; brand: number; cat: number; cost: number; retail: number; whole: number; min: number; reorder: number; max: number; rack: string; shelf: string; bin: string; unit?: string; vehicles: [string, string, number, number, string?][]; open: number; openShj?: number; origin?: string }
const PRODUCTS: P[] = [
  { name: 'Front Brake Pad Set - Camry', oem: '04465-33471', alt: ['D2200', 'GDB3523'], brand: 5, cat: 1, cost: 95, retail: 165, whole: 140, min: 10, reorder: 20, max: 120, rack: 'R01', shelf: 'S2', bin: 'B01', vehicles: [['Toyota', 'Camry', 2012, 2017, '2.5L'], ['Toyota', 'Avalon', 2013, 2018]], open: 60, openShj: 15 },
  { name: 'Rear Brake Pad Set - Corolla', oem: '04466-02220', alt: ['D1423'], brand: 5, cat: 1, cost: 70, retail: 125, whole: 105, min: 8, reorder: 16, max: 100, rack: 'R01', shelf: 'S2', bin: 'B02', vehicles: [['Toyota', 'Corolla', 2014, 2019]], open: 50 },
  { name: 'Front Brake Pad Set - Altima', oem: '41060-3TA0A', alt: ['D1650', 'GDB3478'], brand: 2, cat: 1, cost: 110, retail: 190, whole: 160, min: 6, reorder: 12, max: 80, rack: 'R01', shelf: 'S3', bin: 'B01', vehicles: [['Nissan', 'Altima', 2013, 2018], ['Nissan', 'Maxima', 2016, 2020]], open: 40, openShj: 10 },
  { name: 'Brake Disc Rotor - Accord', oem: '45251-T2A-A00', alt: ['DF4944'], brand: 3, cat: 1, cost: 160, retail: 270, whole: 230, min: 4, reorder: 8, max: 40, rack: 'R01', shelf: 'S3', bin: 'B02', vehicles: [['Honda', 'Accord', 2013, 2017], ['Honda', 'Civic', 2016, 2021]], open: 24 },
  { name: 'Brake Pad Set - Elantra', oem: '58101-3XA00', alt: ['D1647'], brand: 3, cat: 1, cost: 85, retail: 150, whole: 128, min: 6, reorder: 12, max: 80, rack: 'R01', shelf: 'S4', bin: 'B01', vehicles: [['Hyundai', 'Elantra', 2011, 2016], ['Kia', 'Cerato', 2012, 2016]], open: 36 },
  { name: 'Oil Filter - Hilux', oem: '90915-YZZE1', alt: ['W67/1', 'OX 188D'], brand: 4, cat: 3, cost: 14, retail: 28, whole: 22, min: 30, reorder: 60, max: 400, rack: 'R02', shelf: 'S1', bin: 'B01', vehicles: [['Toyota', 'Hilux', 2005, 2020], ['Toyota', 'Fortuner', 2008, 2020]], open: 200, openShj: 60 },
  { name: 'Oil Filter - Sunny', oem: '15208-65F0A', alt: ['W712/75'], brand: 3, cat: 3, cost: 12, retail: 24, whole: 19, min: 30, reorder: 60, max: 400, rack: 'R02', shelf: 'S1', bin: 'B02', vehicles: [['Nissan', 'Sunny', 2010, 2020], ['Nissan', 'Tiida', 2007, 2012]], open: 180 },
  { name: 'Air Filter - Accent', oem: '28113-1R100', alt: ['C 2620'], brand: 3, cat: 3, cost: 22, retail: 45, whole: 36, min: 15, reorder: 30, max: 200, rack: 'R02', shelf: 'S2', bin: 'B01', vehicles: [['Hyundai', 'Accent', 2011, 2017], ['Kia', 'Rio', 2012, 2017]], open: 90, openShj: 25 },
  { name: 'Cabin Air Filter - Land Cruiser', oem: '87139-YZZ08', alt: ['CU 25 001'], brand: 4, cat: 3, cost: 18, retail: 38, whole: 30, min: 10, reorder: 20, max: 120, rack: 'R02', shelf: 'S2', bin: 'B02', vehicles: [['Toyota', 'Land Cruiser', 2008, 2021]], open: 70 },
  { name: 'Fuel Filter - Civic', oem: '16010-SNA-A30', alt: ['KL 497'], brand: 3, cat: 3, cost: 30, retail: 58, whole: 48, min: 8, reorder: 16, max: 100, rack: 'R02', shelf: 'S3', bin: 'B01', vehicles: [['Honda', 'Civic', 2006, 2011], ['Honda', 'CR-V', 2007, 2011]], open: 45 },
  { name: 'Spark Plug Iridium - Camry', oem: '90919-01253', alt: ['SK20R11', 'IK20TT'], brand: 4, cat: 2, cost: 24, retail: 48, whole: 40, min: 40, reorder: 80, max: 500, rack: 'R03', shelf: 'S1', bin: 'B01', vehicles: [['Toyota', 'Camry', 2007, 2017], ['Toyota', 'RAV4', 2008, 2018]], open: 240, openShj: 80 },
  { name: 'Spark Plug - Nissan Patrol', oem: '22401-7S015', alt: ['BKR6E-11'], brand: 3, cat: 2, cost: 15, retail: 32, whole: 26, min: 40, reorder: 80, max: 500, rack: 'R03', shelf: 'S1', bin: 'B02', vehicles: [['Nissan', 'Patrol', 2005, 2019]], open: 200 },
  { name: 'Serpentine Belt - Elantra', oem: '25212-2E300', alt: ['6PK1195'], brand: 3, cat: 2, cost: 32, retail: 62, whole: 50, min: 8, reorder: 16, max: 80, rack: 'R03', shelf: 'S2', bin: 'B01', vehicles: [['Hyundai', 'Elantra', 2007, 2012], ['Hyundai', 'Tucson', 2010, 2015]], open: 40 },
  { name: 'Timing Belt Kit - Corolla', oem: '13568-09130', alt: ['CT1028K1'], brand: 1, cat: 2, cost: 140, retail: 245, whole: 205, min: 4, reorder: 8, max: 40, rack: 'R03', shelf: 'S2', bin: 'B02', vehicles: [['Toyota', 'Corolla', 2002, 2008], ['Toyota', 'Yaris', 2006, 2013]], open: 20 },
  { name: 'Front Shock Absorber - Land Cruiser', oem: '48510-60601', alt: ['333213'], brand: 1, cat: 4, cost: 260, retail: 440, whole: 380, min: 4, reorder: 8, max: 40, rack: 'R04', shelf: 'S1', bin: 'B01', unit: 'PCS', vehicles: [['Toyota', 'Land Cruiser', 2008, 2021]], open: 24, openShj: 6 },
  { name: 'Rear Shock Absorber - Camry', oem: '48530-06500', alt: ['341464'], brand: 5, cat: 4, cost: 120, retail: 210, whole: 175, min: 6, reorder: 12, max: 60, rack: 'R04', shelf: 'S1', bin: 'B02', vehicles: [['Toyota', 'Camry', 2012, 2017]], open: 30 },
  { name: 'Front Shock Absorber - Sunny', oem: '54303-1HM0A', alt: ['G8049'], brand: 2, cat: 4, cost: 105, retail: 185, whole: 155, min: 6, reorder: 12, max: 60, rack: 'R04', shelf: 'S2', bin: 'B01', vehicles: [['Nissan', 'Sunny', 2011, 2020]], open: 28 },
  { name: 'Control Arm Bushing - Accord', oem: '51391-SDA-A01', alt: ['K200329'], brand: 3, cat: 4, cost: 18, retail: 40, whole: 32, min: 10, reorder: 20, max: 120, rack: 'R04', shelf: 'S2', bin: 'B02', vehicles: [['Honda', 'Accord', 2003, 2007]], open: 60 },
  { name: 'Halogen Bulb H4 12V 60/55W', oem: '9005-H4-BOS', alt: ['H4', '64193'], brand: 3, cat: 5, cost: 6, retail: 15, whole: 11, min: 50, reorder: 100, max: 600, rack: 'R05', shelf: 'S1', bin: 'B01', vehicles: [['Toyota', 'Hilux', 2005, 2015], ['Nissan', 'Sunny', 2005, 2012], ['Honda', 'Accord', 2003, 2012]], open: 300, openShj: 100 },
  { name: 'LED Headlight Bulb H7', oem: 'LED-H7-DEN', alt: ['H7'], brand: 4, cat: 5, cost: 40, retail: 85, whole: 70, min: 20, reorder: 40, max: 200, rack: 'R05', shelf: 'S1', bin: 'B02', vehicles: [['Hyundai', 'Elantra', 2011, 2020], ['Kia', 'Sportage', 2011, 2020]], open: 100 },
  { name: 'Alternator 12V 90A - Camry', oem: '27060-0H070', alt: ['104210-4170'], brand: 4, cat: 5, cost: 380, retail: 640, whole: 550, min: 2, reorder: 4, max: 20, rack: 'R05', shelf: 'S2', bin: 'B01', vehicles: [['Toyota', 'Camry', 2007, 2011]], open: 10 },
  { name: 'Battery 12V 70Ah', oem: 'BAT-70-NS70', alt: ['NS70'], brand: 3, cat: 5, cost: 190, retail: 320, whole: 275, min: 5, reorder: 10, max: 50, rack: 'R05', shelf: 'S3', bin: 'B01', vehicles: [['Nissan', 'Patrol', 2005, 2019], ['Toyota', 'Land Cruiser', 2008, 2021]], open: 30, openShj: 8 },
  { name: 'Water Pump - Hilux', oem: '16100-09590', alt: ['GWT-92A'], brand: 1, cat: 2, cost: 130, retail: 225, whole: 190, min: 4, reorder: 8, max: 40, rack: 'R03', shelf: 'S3', bin: 'B01', vehicles: [['Toyota', 'Hilux', 2005, 2015]], open: 18 },
  { name: 'Radiator Cap 1.1 bar', oem: '16401-30060', alt: ['RC-11'], brand: 3, cat: 2, cost: 8, retail: 20, whole: 15, min: 20, reorder: 40, max: 200, rack: 'R03', shelf: 'S3', bin: 'B02', vehicles: [['Toyota', 'Corolla', 2002, 2019], ['Nissan', 'Sunny', 2005, 2020]], open: 120 },
  { name: 'Wiper Blade 24 inch', oem: 'WB-24-BOS', alt: ['A 953 S'], brand: 3, cat: 5, cost: 9, retail: 22, whole: 17, min: 30, reorder: 60, max: 300, rack: 'R05', shelf: 'S3', bin: 'B02', vehicles: [['Toyota', 'Camry', 2012, 2017], ['Honda', 'Accord', 2013, 2017], ['Hyundai', 'Sonata', 2011, 2019]], open: 150, openShj: 40 },
  { name: 'Tie Rod End - Nissan Patrol', oem: '48520-VC025', alt: ['CE-N23'], brand: 2, cat: 4, cost: 45, retail: 90, whole: 75, min: 6, reorder: 12, max: 80, rack: 'R04', shelf: 'S3', bin: 'B01', vehicles: [['Nissan', 'Patrol', 2005, 2019]], open: 40 },
];
const CUSTOMERS = [
  { name: 'Emirates Fleet Services LLC', city: 'Dubai', credit: 150000, term: 3, trn: '100300400500001', sm: 1 },
  { name: 'Sharjah Auto Parts Trading', city: 'Sharjah', credit: 60000, term: 2, trn: '100300400500002', sm: 2 },
  { name: 'Al Barsha Motors', city: 'Dubai', credit: 80000, term: 3, trn: '100300400500003', sm: 1 },
  { name: 'Ajman Garage Equipment', city: 'Ajman', credit: 40000, term: 1, trn: '100300400500004', sm: 2 },
  { name: 'Abu Dhabi Taxi Maintenance', city: 'Abu Dhabi', credit: 200000, term: 4, trn: '100300400500005', sm: 1 },
  { name: 'Desert Rally Workshop', city: 'Dubai', credit: 25000, term: 1, trn: '100300400500006', sm: 2 },
  { name: 'Quick Lube Express', city: 'Sharjah', credit: 35000, term: 2, trn: '100300400500007', sm: 1 },
  { name: 'Walk-in Cash Customer', city: 'Dubai', credit: 5000, term: 1, trn: null, sm: 2 },
];
const SUPPLIERS = [
  { name: 'Denso Corporation Japan', country: 'Japan', cur: 'JPY', term: 4 },
  { name: 'Aisin Trading Co. Ltd', country: 'Japan', cur: 'USD', term: 3 },
  { name: 'Gulf Auto Distributors LLC', country: 'UAE', cur: 'AED', term: 3 },
  { name: 'Sharjah Filter Industries', country: 'UAE', cur: 'AED', term: 2 },
  { name: 'Emirates Lubricants & Parts', country: 'UAE', cur: 'AED', term: 3 },
];

async function main() {
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  token = login.data.accessToken || login.data.token;
  if (!token) throw new Error('login failed');

  const settings = await ok('GET', '/settings?prefix=demo.');
  if (settings['demo.seeded'] && !FORCE) { console.log('demo.seeded marker present - nothing to do (use --force to run anyway)'); return; }

  const WH_MAIN = 1, WH_SHJ = 3;
  const prod: { id: number; code: string; p: P }[] = [];
  const sups: Record<string, number> = {};
  const custs: number[] = [];
  const existingSuppliers = (await ok('GET', '/suppliers?pageSize=100')).rows;
  const supUSD = existingSuppliers.find((s: any) => s.code === 'V0001')?.id;

  // -------------------------------------------------------------------------------- masters
  await section('products', async () => {
    for (const p of PRODUCTS) {
      const ex = (await ok('GET', `/products?search=${encodeURIComponent(p.oem)}`)).rows.find((r: any) => r.oemNumber === p.oem);
      if (ex) { prod.push({ id: ex.id, code: ex.code, p }); continue; }
      const created = await ok('POST', '/products', {
        name: p.name, oemNumber: p.oem, brandId: p.brand, categoryId: p.cat, vehicleMake: p.vehicles[0][0], vehicleModel: p.vehicles[0][1],
        yearInfo: `${p.vehicles[0][2]}-${p.vehicles[0][3]}`, purchaseUnit: 'PCS', salesUnit: 'PCS', costPrice: p.cost, retailPrice: p.retail, wholesalePrice: p.whole,
        minStock: p.min, maxStock: p.max, reorderLevel: p.reorder, vatRate: 5, defaultWarehouseId: WH_MAIN, rack: p.rack, shelf: p.shelf, bin: p.bin,
        countryOfOrigin: p.brand === 1 || p.brand === 2 || p.brand === 4 || p.brand === 5 ? 'Japan' : 'Germany', warranty: '6 months',
        partNumbers: p.alt.map((n) => ({ number: n, kind: 'ALTERNATE' })),
        vehicles: p.vehicles.map(([make, model, yf, yt, engine]) => ({ make, model, yearFrom: yf, yearTo: yt, engine: engine ?? null })),
      }, 'products');
      prod.push({ id: created.id, code: created.code, p });
    }
  });
  await section('customers', async () => {
    for (const c of CUSTOMERS) {
      const ex = (await ok('GET', `/customers?search=${encodeURIComponent(c.name)}`)).rows.find((r: any) => r.name === c.name);
      if (ex) { custs.push(ex.id); continue; }
      const x = await ok('POST', '/customers', { name: c.name, trn: c.trn, city: c.city, country: 'UAE', paymentTermId: c.term, creditLimit: c.credit, currencyCode: 'AED', salesmanId: c.sm, vatCategory: 'TAXABLE', email: `accounts@${c.name.toLowerCase().replace(/[^a-z]+/g, '')}.ae`, phone: '+9714' + String(3000000 + custs.length * 111111), contactPerson: 'Accounts Dept', openingBalance: 0 }, 'customers');
      custs.push(x.id);
    }
  });
  await section('suppliers', async () => {
    for (const s of SUPPLIERS) {
      const ex = (await ok('GET', `/suppliers?search=${encodeURIComponent(s.name)}`)).rows.find((r: any) => r.name === s.name);
      if (ex) { sups[s.name] = ex.id; continue; }
      const x = await ok('POST', '/suppliers', { name: s.name, country: s.country, currencyCode: s.cur, paymentTermId: s.term, vatCategory: s.country === 'UAE' ? 'TAXABLE' : 'ZERO_RATED', email: 'sales@' + s.name.toLowerCase().replace(/[^a-z]+/g, '') + '.com', phone: '+81-3-5555-0100', contactPerson: 'Sales Manager', creditLimit: 0 }, 'suppliers');
      sups[s.name] = x.id;
    }
  });
  const supJPY = sups['Denso Corporation Japan'], supUSD2 = sups['Aisin Trading Co. Ltd'], supL1 = sups['Gulf Auto Distributors LLC'], supL2 = sups['Sharjah Filter Industries'], supL3 = sups['Emirates Lubricants & Parts'];
  if (!prod.length || !custs.length || !supL1) throw new Error('masters missing, aborting');
  const pid = (i: number) => prod[i].id;

  // -------------------------------------------------------------------------------- opening stock
  await section('opening stock (OPENING adjustments, Dubai Main + Sharjah)', async () => {
    const had = (await ok('GET', '/stock-adjustments?search=Demo%20opening&pageSize=5')).rows ?? [];
    if (had.length) { console.log('   opening stock already present'); return; }
    const main = await ok('POST', '/stock-adjustments', { adjType: 'OPENING', warehouseId: WH_MAIN, txDate: dayStr(88), remarks: 'Demo opening stock', items: prod.map((x) => ({ productId: x.id, qtyChange: x.p.open, unitCost: x.p.cost })) }, 'adjustments');
    await ok('POST', `/stock-adjustments/${main.id}/post`);
    const shjItems = prod.filter((x) => x.p.openShj);
    const shj = await ok('POST', '/stock-adjustments', { adjType: 'OPENING', warehouseId: WH_SHJ, txDate: dayStr(88), remarks: 'Demo opening stock Sharjah', items: shjItems.map((x) => ({ productId: x.id, qtyChange: x.p.openShj, unitCost: x.p.cost })) }, 'adjustments');
    await ok('POST', `/stock-adjustments/${shj.id}/post`);
  });

  // -------------------------------------------------------------------------------- LOCAL PURCHASE
  let paidInvoices: { id: number; supplierId: number }[] = [];
  await section('local purchase flow: MR -> PR -> RFQ -> quotations -> comparative -> PO -> GRN -> invoice -> payments', async () => {
    const a = pid(0), b = pid(5), c = pid(10);
    const mr = await ok('POST', '/material-requests', { docDate: dayStr(80), requestedBy: 'Workshop Supervisor', department: 'Workshop', warehouseId: WH_MAIN, priority: 'HIGH', remarks: 'Restock brake pads / filters / plugs', items: [{ productId: a, qty: 80 }, { productId: b, qty: 150 }, { productId: c, qty: 200 }] }, 'materialRequests');
    await submitApprove('/material-requests', mr.id);
    const pr = await ok('POST', `/material-requests/${mr.id}/create-requisition`, { docDate: dayStr(79) }, 'requisitions');
    await submitApprove('/purchase-requisitions', pr.id);
    const rfq = await ok('POST', `/purchase-requisitions/${pr.id}/create-enquiry`, { supplierIds: [supL1, supL2], docDate: dayStr(78) }, 'rfqs');
    await ok('POST', `/purchase-enquiries/${rfq.id}/send`);
    const mkQ = (supplierId: number, rates: number[], days: number) => ok('POST', `/purchase-enquiries/${rfq.id}/create-quotation`, { supplierId, docDate: dayStr(76), paymentTerms: 'Net 30', deliveryDays: days, supplierRef: `Q-${supplierId}-${days}`, items: [{ productId: a, qty: 80, rate: rates[0] }, { productId: b, qty: 150, rate: rates[1] }, { productId: c, qty: 200, rate: rates[2] }] }, 'supplierQuotations');
    const q1 = await mkQ(supL1, [96, 14.5, 24], 7);
    await mkQ(supL2, [94, 15, 24.5], 4);
    const cmp = await ok('GET', `/comparative-statements/${rfq.id}`);
    const best = cmp.quotations.find((q: any) => q.cheapestTotal) ?? cmp.quotations[0];
    await ok('POST', `/comparative-statements/${rfq.id}/select`, { quotationId: best.quotationId });
    const po = await ok('POST', `/supplier-quotations/${best.quotationId}/create-order`, { warehouseId: WH_MAIN, docDate: dayStr(74) }, 'purchaseOrders');
    void q1;
    await submitApprove('/purchase-orders', po.id);
    const detail = await ok('GET', `/purchase-orders/${po.id}`);
    const itA = detail.items.find((i: any) => i.productId === a), itB = detail.items.find((i: any) => i.productId === b), itC = detail.items.find((i: any) => i.productId === c);
    const g1 = await ok('POST', `/purchase-orders/${po.id}/create-receipt`, { docDate: dayStr(68), supplierDeliveryNo: 'DN-GA-1021', items: [{ orderItemId: itA.id, qty: 50 }, { orderItemId: itB.id, qty: 100 }, { orderItemId: itC.id, qty: 120 }] }, 'goodsReceipts');
    await ok('POST', `/goods-receipts/${g1.id}/post`);
    const g2 = await ok('POST', `/purchase-orders/${po.id}/create-receipt`, { docDate: dayStr(55), supplierDeliveryNo: 'DN-GA-1088' }, 'goodsReceipts');
    await ok('POST', `/goods-receipts/${g2.id}/post`);
    const inv1 = await ok('POST', `/goods-receipts/${g1.id}/create-invoice`, { docDate: dayStr(66), supplierInvoiceNo: 'GAD-INV-5501' }, 'purchaseInvoices');
    await ok('POST', `/purchase-invoices/${inv1.id}/post`);
    const inv2 = await ok('POST', `/goods-receipts/${g2.id}/create-invoice`, { docDate: dayStr(52), supplierInvoiceNo: 'GAD-INV-5619' }, 'purchaseInvoices');
    await ok('POST', `/purchase-invoices/${inv2.id}/post`);
    // purchase return (damaged goods) against invoice 1
    const i1d = await ok('GET', `/purchase-invoices/${inv1.id}`);
    const ret = await ok('POST', `/purchase-invoices/${inv1.id}/create-return`, { docDate: dayStr(60), reason: 'DAMAGED', items: [{ invoiceItemId: i1d.items.find((i: any) => i.productId === a).id, qty: 4 }] }, 'purchaseReturns');
    await ok('POST', `/purchase-returns/${ret.id}/post`);
    // supplier payments: inv1 part by bank, rest by cash; inv2 left open
    const i1n = await ok('GET', `/purchase-invoices/${inv1.id}`);
    const out1 = num(i1n.outstanding ?? i1n.baseTotal);
    const part = r2(out1 * 0.6);
    await ok('POST', '/payments', { partyType: 'SUPPLIER', partyId: supL1, mode: 'BANK', voucherDate: dayStr(40), amount: part, reference: 'CHQ-100231', allocations: [{ docType: 'PURCHASE_INVOICE', docId: inv1.id, amount: part }] }, 'paymentVouchers');
    await ok('POST', '/payments', { partyType: 'SUPPLIER', partyId: supL1, mode: 'CASH', voucherDate: dayStr(25), amount: r2(out1 - part), narration: 'Balance settled in cash', allocations: [{ docType: 'PURCHASE_INVOICE', docId: inv1.id, amount: r2(out1 - part) }] }, 'paymentVouchers');
    paidInvoices = [{ id: inv1.id, supplierId: supL1 }];
  });

  await section('local purchase variety: second PO partially received, drafts, pending approval', async () => {
    const d = pid(6), e = pid(7), f = pid(11), g = pid(12);
    const po = await ok('POST', '/purchase-orders', { docDate: dayStr(45), supplierId: supL2, warehouseId: WH_MAIN, remarks: 'Filters & plugs replenishment', paymentTerms: 'Net 15', items: [{ productId: d, qty: 120, rate: 11.5 }, { productId: e, qty: 80, rate: 21 }, { productId: f, qty: 150, rate: 14 }, { productId: g, qty: 40, rate: 30 }] }, 'purchaseOrders');
    await submitApprove('/purchase-orders', po.id);
    const det = await ok('GET', `/purchase-orders/${po.id}`);
    const gr = await ok('POST', `/purchase-orders/${po.id}/create-receipt`, { docDate: dayStr(38), supplierDeliveryNo: 'SFI-DN-77', items: det.items.slice(0, 3).map((i: any) => ({ orderItemId: i.id, qty: Math.floor(num(i.qty) / 2) })) }, 'goodsReceipts');
    await ok('POST', `/goods-receipts/${gr.id}/post`);
    const inv = await ok('POST', `/goods-receipts/${gr.id}/create-invoice`, { docDate: dayStr(36), supplierInvoiceNo: 'SFI-INV-0412' }, 'purchaseInvoices'); // left DRAFT
    void inv;
    // PO pending approval
    const po2 = await ok('POST', '/purchase-orders', { docDate: dayStr(6), supplierId: supL3, warehouseId: WH_MAIN, remarks: 'Urgent - awaiting approval', items: [{ productId: pid(13), qty: 30, rate: 135 }, { productId: pid(14), qty: 24, rate: 250 }] }, 'purchaseOrders');
    await ok('POST', `/purchase-orders/${po2.id}/submit`);
    // PO approved, nothing received
    const po3 = await ok('POST', '/purchase-orders', { docDate: dayStr(10), supplierId: supL1, warehouseId: WH_MAIN, remarks: 'Alternators and batteries', items: [{ productId: pid(20), qty: 6, rate: 370 }, { productId: pid(21), qty: 20, rate: 185 }] }, 'purchaseOrders');
    await submitApprove('/purchase-orders', po3.id);
    // DRAFT PO
    await ok('POST', '/purchase-orders', { docDate: dayStr(2), supplierId: supL3, warehouseId: WH_MAIN, remarks: 'Draft - wipers & bulbs', items: [{ productId: pid(23), qty: 100, rate: 8.5 }, { productId: pid(17), qty: 200, rate: 5.5 }] }, 'purchaseOrders');
  });
  await section('purchase requests: MR/PR/RFQ in intermediate states', async () => {
    await ok('POST', '/material-requests', { docDate: dayStr(4), requestedBy: 'Store Keeper', department: 'Store', warehouseId: WH_MAIN, priority: 'MEDIUM', remarks: 'Draft request', items: [{ productId: pid(15), qty: 12 }] }, 'materialRequests');
    const mr2 = await ok('POST', '/material-requests', { docDate: dayStr(9), requestedBy: 'Sales Dept', department: 'Sales', warehouseId: WH_MAIN, priority: 'MEDIUM', remarks: 'Approved - not yet converted', items: [{ productId: pid(22), qty: 10 }, { productId: pid(24), qty: 20 }] }, 'materialRequests');
    await submitApprove('/material-requests', mr2.id);
    const mr3 = await ok('POST', '/material-requests', { docDate: dayStr(12), requestedBy: 'Workshop', department: 'Workshop', warehouseId: WH_MAIN, priority: 'LOW', remarks: 'For requisition', items: [{ productId: pid(3), qty: 10 }] }, 'materialRequests');
    await submitApprove('/material-requests', mr3.id);
    const pr = await ok('POST', `/material-requests/${mr3.id}/create-requisition`, { docDate: dayStr(11) }, 'requisitions');
    const rfq = await ok('POST', `/purchase-requisitions/${pr.id}/submit`).then(() => ok('POST', `/purchase-requisitions/${pr.id}/approve`)).then(() => ok('POST', `/purchase-requisitions/${pr.id}/create-enquiry`, { supplierIds: [supL1, supL3], docDate: dayStr(10) }, 'rfqs'));
    await ok('POST', `/purchase-enquiries/${rfq.id}/send`);
  });

  // -------------------------------------------------------------------------------- IMPORT
  await section('import flow (USD): request -> proforma -> PO -> shipment -> GRN -> landed cost -> invoice', async () => {
    const a = pid(14), b = pid(13), c = pid(22);
    const supImp = supUSD2;
    const ir = await ok('POST', '/import-requests', { docDate: dayStr(84), supplierId: supImp, warehouseId: WH_MAIN, remarks: 'Shocks & timing belts - Aisin', items: [{ productId: a, qty: 24 }, { productId: b, qty: 20 }, { productId: c, qty: 12 }] }, 'importRequests');
    await submitApprove('/import-requests', ir.id);
    const spf = await ok('POST', `/import-requests/${ir.id}/create-proforma`, { docDate: dayStr(82), supplierId: supImp, currencyCode: 'USD', exchangeRate: 3.6725, incoterms: 'CIF', supplierRef: 'AISIN-PF-8841', items: [{ productId: a, qty: 24, rate: 32 }, { productId: b, qty: 20, rate: 38 }, { productId: c, qty: 12, rate: 36 }] }, 'proformas');
    const ipo = await ok('POST', `/supplier-proformas/${spf.id}/create-order`, { docDate: dayStr(80), warehouseId: WH_MAIN, incoterms: 'CIF', portOfLoading: 'Nagoya', portOfDestination: 'Jebel Ali', shippingMethod: 'SEA', shippingAgent: 'Gulf Shipping Lines', clearingAgent: 'Al Nasr Clearing' }, 'importOrders');
    await ok('POST', `/import-orders/${ipo.id}/status`, { status: 'CONFIRMED' }).then(async (r) => { if (r.status === 'PENDING_APPROVAL') await ok('POST', `/import-orders/${ipo.id}/approve`, {}); });
    await ok('POST', `/import-orders/${ipo.id}/status`, { status: 'PAYMENT_PENDING' });
    const ship = await ok('POST', '/import-shipments', { orderId: ipo.id, containerNo: 'MSKU7723451', billOfLading: 'NGY-JEA-44120', etd: dayStr(70), eta: dayStr(48) }, 'shipments');
    for (const s of ['IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED']) await ok('POST', `/import-shipments/${ship.id}/status`, { status: s });
    const ig = await ok('POST', `/import-shipments/${ship.id}/create-receipt`, { docDate: dayStr(44) }, 'goodsReceipts');
    await ok('POST', `/goods-receipts/${ig.id}/post`);
    const lc = await ok('POST', '/landed-costs', { receiptId: ig.id, docDate: dayStr(42), allocationMethod: 'VALUE', remarks: 'Freight + customs duty', charges: [{ chargeType: 'FREIGHT', amount: 1450, supplierId: supL3, description: 'Sea freight Nagoya-Jebel Ali' }, { chargeType: 'CUSTOMS_DUTY', amount: 880 }] }, 'landedCosts');
    await ok('POST', `/landed-costs/${lc.id}/post`);
    const iinv = await ok('POST', `/goods-receipts/${ig.id}/create-invoice`, { docDate: dayStr(41), supplierInvoiceNo: 'AISIN-CI-20931' }, 'purchaseInvoices');
    await ok('POST', `/purchase-invoices/${iinv.id}/post`);
    const pd = await ok('GET', `/purchase-invoices/${iinv.id}`);
    const half = r2(num(pd.baseTotal) / 2);
    await ok('POST', '/payments', { partyType: 'SUPPLIER', partyId: supImp, mode: 'BANK', voucherDate: dayStr(30), amount: half, reference: 'TT-USD-0098', narration: 'Telegraphic transfer - 50%', allocations: [{ docType: 'PURCHASE_INVOICE', docId: iinv.id, amount: half }] }, 'paymentVouchers');
    paidInvoices.push({ id: iinv.id, supplierId: supImp });
  });
  await section('import flow (JPY): in-transit shipment + drafts', async () => {
    const ir = await ok('POST', '/import-requests', { docDate: dayStr(40), supplierId: supJPY, warehouseId: WH_MAIN, remarks: 'Denso spark plugs & alternators', items: [{ productId: pid(10), qty: 400 }, { productId: pid(20), qty: 10 }] }, 'importRequests');
    await submitApprove('/import-requests', ir.id);
    const spf = await ok('POST', `/import-requests/${ir.id}/create-proforma`, { docDate: dayStr(38), supplierId: supJPY, currencyCode: 'JPY', exchangeRate: 0.0245, incoterms: 'FOB', supplierRef: 'DENSO-PI-3310', items: [{ productId: pid(10), qty: 400, rate: 980 }, { productId: pid(20), qty: 10, rate: 15500 }] }, 'proformas');
    const ipo = await ok('POST', `/supplier-proformas/${spf.id}/create-order`, { docDate: dayStr(36), warehouseId: WH_MAIN, incoterms: 'FOB', portOfLoading: 'Yokohama', portOfDestination: 'Jebel Ali', shippingMethod: 'SEA', shippingAgent: 'NYK Line', clearingAgent: 'Al Nasr Clearing' }, 'importOrders');
    await ok('POST', `/import-orders/${ipo.id}/status`, { status: 'CONFIRMED' }).then(async (r) => { if (r.status === 'PENDING_APPROVAL') await ok('POST', `/import-orders/${ipo.id}/approve`, {}); });
    const ship = await ok('POST', '/import-shipments', { orderId: ipo.id, containerNo: 'NYKU5532091', billOfLading: 'YOK-JEA-90215', etd: dayStr(12), eta: dayStr(-9) }, 'shipments');
    await ok('POST', `/import-shipments/${ship.id}/status`, { status: 'IN_TRANSIT' });
    // draft import request + request awaiting approval
    await ok('POST', '/import-requests', { docDate: dayStr(3), supplierId: supUSD2, warehouseId: WH_MAIN, remarks: 'Draft request', items: [{ productId: pid(15), qty: 16 }] }, 'importRequests');
    const ir3 = await ok('POST', '/import-requests', { docDate: dayStr(5), supplierId: supUSD ?? supUSD2, warehouseId: WH_MAIN, remarks: 'Awaiting approval', items: [{ productId: pid(0), qty: 100 }] }, 'importRequests');
    await ok('POST', `/import-requests/${ir3.id}/submit`);
  });

  // -------------------------------------------------------------------------------- SALES
  const salesInvoices: { id: number; customerId: number; docNo: string }[] = [];
  const priceOf = (i: number) => prod[i].p.retail;

  async function fullChain(label: string, cust: number, lines: [number, number][], opts: { start: number; partial?: boolean; invoice?: boolean; deliveryPost?: boolean; poNo?: string }) {
    const enq = await ok('POST', '/sales-enquiries', { docDate: dayStr(opts.start), customerId: cust, salesmanId: 1, remarks: label, items: lines.map(([i, q]) => ({ productId: pid(i), qty: q })) }, 'salesEnquiries');
    const quo = await ok('POST', `/sales-enquiries/${enq.id}/create-quotation`, { warehouseId: WH_MAIN, docDate: dayStr(opts.start - 1) }, 'salesQuotations');
    await ok('POST', `/sales-quotations/${quo.id}/send`);
    await ok('POST', `/sales-quotations/${quo.id}/accept`);
    const so = await ok('POST', `/sales-quotations/${quo.id}/create-order`, { warehouseId: WH_MAIN, docDate: dayStr(opts.start - 2), customerPoNo: opts.poNo ?? `PO-${label.slice(0, 6)}` }, 'salesOrders');
    await submitApprove('/sales-orders', so.id);
    const pk = await ok('POST', `/sales-orders/${so.id}/create-picking`, { docDate: dayStr(opts.start - 3) }, 'pickingLists');
    const picks = pk.items.map((it: any) => ({ id: it.id, pickedQty: opts.partial ? Math.max(1, Math.floor(num(it.ordered) / 2)) : num(it.ordered) }));
    await ok('PUT', `/picking-lists/${pk.id}/pick`, { pickedBy: 'Store picker', items: picks });
    const pickDetail = await ok('GET', `/picking-lists/${pk.id}`);
    const pl = await ok('POST', `/picking-lists/${pk.id}/create-packing`, { docDate: dayStr(opts.start - 3), boxes: 2, dimensions: '50x40x30', remarks: label, items: pickDetail.items.filter((it: any) => num(it.picked ?? it.pickedQty) > 0).map((it: any, k: number) => ({ productId: it.productId, boxNo: (k % 2) + 1, qty: num(it.picked ?? it.pickedQty) })) }, 'packingLists');
    await ok('POST', `/packing-lists/${pl.id}/pack`);
    const dn = await ok('POST', `/picking-lists/${pk.id}/create-delivery`, { docDate: dayStr(opts.start - 4), driver: 'Imran', vehicleNo: 'DXB-A-4421' }, 'deliveryNotes');
    if (opts.deliveryPost === false) return { so, dn: dn };
    await ok('POST', `/delivery-notes/${dn.id}/post`);
    let inv: any = null;
    if (opts.invoice !== false) {
      inv = await ok('POST', `/delivery-notes/${dn.id}/create-invoice`, { docDate: dayStr(opts.start - 4), remarks: label }, 'salesInvoices');
      await ok('POST', `/sales-invoices/${inv.id}/post`);
      salesInvoices.push({ id: inv.id, customerId: cust, docNo: inv.docNo });
    }
    return { so, dn, inv, pk };
  }
  async function simpleChain(label: string, cust: number, lines: [number, number][], start: number, opts: { invoice?: boolean; price?: 'WHOLESALE' | 'RETAIL' } = {}) {
    const so = await ok('POST', '/sales-orders', { docDate: dayStr(start), customerId: cust, salesmanId: 2, warehouseId: WH_MAIN, priceType: opts.price ?? 'RETAIL', customerPoNo: `CPO-${label.slice(0, 5)}`, remarks: label, items: lines.map(([i, q]) => ({ productId: pid(i), qty: q })) }, 'salesOrders');
    await submitApprove('/sales-orders', so.id);
    const dn = await ok('POST', `/sales-orders/${so.id}/create-delivery`, { docDate: dayStr(start - 1) }, 'deliveryNotes');
    await ok('POST', `/delivery-notes/${dn.id}/post`);
    if (opts.invoice === false) return { so, dn };
    const inv = await ok('POST', `/delivery-notes/${dn.id}/create-invoice`, { docDate: dayStr(start - 1), remarks: label }, 'salesInvoices');
    await ok('POST', `/sales-invoices/${inv.id}/post`);
    salesInvoices.push({ id: inv.id, customerId: cust, docNo: inv.docNo });
    return { so, dn, inv };
  }

  let returnInvoice: any = null;
  await section('sales: full chains enquiry -> quotation -> order -> pick -> pack -> delivery -> invoice', async () => {
    const r1 = await fullChain('Fleet monthly brake service', custs[0], [[0, 12], [2, 8], [3, 6]], { start: 70 });
    returnInvoice = r1.inv;
    await fullChain('Taxi maintenance bulk', custs[4], [[5, 60], [10, 80], [18, 40]], { start: 55, poNo: 'ADTM-PO-7781' });
    await fullChain('Partial delivery order', custs[2], [[7, 20], [9, 10]], { start: 30, partial: true }); // half picked + delivered; invoice for delivered part
  });
  await section('sales: simple order -> delivery -> invoice cycles', async () => {
    await simpleChain('Sharjah parts order', custs[1], [[1, 10], [4, 6], [11, 24]], 62, { price: 'WHOLESALE' });
    await simpleChain('Garage equipment order', custs[3], [[14, 3], [15, 4], [22, 6]], 48);
    await simpleChain('Rally workshop', custs[5], [[13, 2], [20, 4], [21, 2]], 35);
    await simpleChain('Quick lube express', custs[6], [[5, 40], [6, 30], [19, 20]], 22, { price: 'WHOLESALE' });
  });
  await section('sales: simple order cycles (continued)', async () => {
    await simpleChain('Cash sale', custs[7], [[24, 4], [23, 6]], 15);
    await simpleChain('Emirates fleet batteries', custs[0], [[21, 8], [20, 1]], 12);
    await simpleChain('Dubai garage restock', custs[2], [[0, 6], [8, 10], [24, 5]], 8);
    await simpleChain('Delivered not yet invoiced', custs[4], [[10, 40], [12, 20]], 5, { invoice: false });
  });

  await section('sales: customer receipts (bank + cash, partial/full/on-account) with allocation', async () => {
    const byId = async (id: number) => ok('GET', `/sales-invoices/${id}`);
    for (let i = 0; i < salesInvoices.length; i++) {
      const si = salesInvoices[i];
      const d = await byId(si.id);
      const out = num(d.outstanding ?? d.baseTotal);
      if (i % 4 === 3) continue; // leave unpaid -> overdue / open
      const full = i % 3 !== 1;
      const amt = full ? r2(out) : r2(out * 0.5);
      await ok('POST', '/receipts', { partyType: 'CUSTOMER', partyId: si.customerId, mode: i % 2 === 0 ? 'BANK' : 'CASH', voucherDate: dayStr(Math.max(1, 50 - i * 4)), amount: amt, reference: i % 2 === 0 ? `CHQ-${40000 + i}` : null, bankCharges: i % 2 === 0 && i % 4 === 0 ? 5 : undefined, allocations: [{ docType: 'SALES_INVOICE', docId: si.id, amount: amt }] }, 'receiptVouchers');
    }
    await ok('POST', '/receipts', { partyType: 'CUSTOMER', partyId: custs[4], mode: 'BANK', voucherDate: dayStr(3), amount: 2500, reference: 'ADVANCE-TT-221', narration: 'On-account payment' }, 'receiptVouchers');
  });

  await section('sales return with inspection + credit note', async () => {
    if (!returnInvoice) throw new Error('no invoice for return');
    const inv = await ok('GET', `/sales-invoices/${returnInvoice.id}`);
    const it = inv.items[0];
    const sr = await ok('POST', '/sales-returns', { docDate: dayStr(40), invoiceId: returnInvoice.id, reason: 'Wrong fitment - customer return', items: [{ invoiceItemId: it.id, qty: 4 }] }, 'salesReturns');
    await ok('POST', `/sales-returns/${sr.id}/receive`, { items: [{ id: sr.items[0].id, receivedQty: 4 }] });
    await ok('POST', `/sales-returns/${sr.id}/inspect`, { items: [{ id: sr.items[0].id, resalableQty: 3, damagedQty: 1 }] });
    await ok('POST', `/sales-returns/${sr.id}/post`);
    // a second return left in DRAFT
    const inv2 = salesInvoices[1] ? await ok('GET', `/sales-invoices/${salesInvoices[1].id}`) : null;
    if (inv2) await ok('POST', '/sales-returns', { docDate: dayStr(4), invoiceId: inv2.id, reason: 'Customer changed mind', items: [{ invoiceItemId: inv2.items[0].id, qty: 2 }] }, 'salesReturns');
  });

  await section('sales intermediate states (draft / pending / reserved / picking / draft delivery / draft invoice)', async () => {
    await ok('POST', '/sales-enquiries', { docDate: dayStr(2), customerId: custs[1], salesmanId: 2, remarks: 'New enquiry - open', items: [{ productId: pid(3), qty: 6 }, { productId: pid(16), qty: 4 }] }, 'salesEnquiries');
    await ok('POST', '/sales-quotations', { docDate: dayStr(7), validUntil: dayStr(-23), customerId: custs[2], warehouseId: WH_MAIN, remarks: 'Draft quotation', items: [{ productId: pid(0), qty: 20 }, { productId: pid(1), qty: 20 }] }, 'salesQuotations');
    const q2 = await ok('POST', '/sales-quotations', { docDate: dayStr(9), validUntil: dayStr(-21), customerId: custs[0], warehouseId: WH_MAIN, remarks: 'Sent quotation', items: [{ productId: pid(14), qty: 4 }, { productId: pid(15), qty: 4 }] }, 'salesQuotations');
    await ok('POST', `/sales-quotations/${q2.id}/send`);
    const q3 = await ok('POST', '/sales-quotations', { docDate: dayStr(14), validUntil: dayStr(-16), customerId: custs[6], warehouseId: WH_MAIN, remarks: 'Accepted quotation', items: [{ productId: pid(5), qty: 30 }] }, 'salesQuotations');
    await ok('POST', `/sales-quotations/${q3.id}/send`); await ok('POST', `/sales-quotations/${q3.id}/accept`);
    const pf = await ok('POST', `/sales-quotations/${q3.id}/create-proforma`, { docDate: dayStr(13) }, 'proformaInvoices');
    await ok('POST', `/proforma-invoices/${pf.id}/issue`);
    // SO pending approval
    const sp = await ok('POST', '/sales-orders', { docDate: dayStr(3), customerId: custs[2], warehouseId: WH_MAIN, remarks: 'Pending approval', customerPoNo: 'ABM-PO-1190', items: [{ productId: pid(3), qty: 6 }, { productId: pid(16), qty: 5 }] }, 'salesOrders');
    await ok('POST', `/sales-orders/${sp.id}/submit`);
    // SO draft
    await ok('POST', '/sales-orders', { docDate: dayStr(1), customerId: custs[5], warehouseId: WH_MAIN, remarks: 'Draft order', items: [{ productId: pid(2), qty: 4 }] }, 'salesOrders');
    // SO approved + reserved with open picking list
    const sa = await ok('POST', '/sales-orders', { docDate: dayStr(4), customerId: custs[1], warehouseId: WH_MAIN, remarks: 'Approved - reserved, picking open', items: [{ productId: pid(8), qty: 12 }, { productId: pid(18), qty: 8 }] }, 'salesOrders');
    await submitApprove('/sales-orders', sa.id);
    await ok('POST', `/sales-orders/${sa.id}/create-picking`, { docDate: dayStr(3) }, 'pickingLists');
    // SO approved with a draft delivery
    const sb = await ok('POST', '/sales-orders', { docDate: dayStr(6), customerId: custs[6], warehouseId: WH_MAIN, remarks: 'Approved - draft delivery', items: [{ productId: pid(7), qty: 10 }] }, 'salesOrders');
    await submitApprove('/sales-orders', sb.id);
    await ok('POST', `/sales-orders/${sb.id}/create-delivery`, { docDate: dayStr(5) }, 'deliveryNotes');
    // SO approved + delivered -> draft invoice
    const sc = await simpleChain('Delivered, invoice draft', custs[3], [[1, 5], [4, 3]], 10, { invoice: false });
    await ok('POST', `/delivery-notes/${sc.dn.id}/create-invoice`, { docDate: dayStr(9) }, 'salesInvoices');
  });

  // -------------------------------------------------------------------------------- INVENTORY
  await section('stock transfers (all stages), count adjustment, damage/adjustment', async () => {
    const t1 = await ok('POST', '/stock-transfers', { txDate: dayStr(30), fromWarehouseId: WH_MAIN, toWarehouseId: WH_SHJ, remarks: 'Rebalance Sharjah showroom', items: [{ productId: pid(5), qty: 40 }, { productId: pid(10), qty: 60 }, { productId: pid(1), qty: 10 }] }, 'stockTransfers');
    await ok('POST', `/stock-transfers/${t1.id}/approve`);
    await ok('POST', `/stock-transfers/${t1.id}/dispatch`);
    await ok('POST', `/stock-transfers/${t1.id}/receive`, { items: [{ productId: pid(5), receivedQty: 40 }, { productId: pid(10), receivedQty: 30 }] });
    await ok('POST', `/stock-transfers/${t1.id}/receive`, { receiveAll: true });
    const t2 = await ok('POST', '/stock-transfers', { txDate: dayStr(6), fromWarehouseId: WH_MAIN, toWarehouseId: WH_SHJ, remarks: 'In transit to Sharjah', items: [{ productId: pid(7), qty: 20 }, { productId: pid(17), qty: 20 }] }, 'stockTransfers');
    await ok('POST', `/stock-transfers/${t2.id}/approve`);
    await ok('POST', `/stock-transfers/${t2.id}/dispatch`);
    await ok('POST', '/stock-transfers', { txDate: dayStr(1), fromWarehouseId: WH_MAIN, toWarehouseId: WH_SHJ, remarks: 'Requested - awaiting approval', items: [{ productId: pid(23), qty: 30 }] }, 'stockTransfers');
    const t4 = await ok('POST', '/stock-transfers', { txDate: dayStr(9), fromWarehouseId: WH_SHJ, toWarehouseId: WH_MAIN, remarks: 'Approved - not dispatched', items: [{ productId: pid(10), qty: 10 }] }, 'stockTransfers');
    await ok('POST', `/stock-transfers/${t4.id}/approve`);
    // count adjustment
    const sheet = await ok('GET', `/stock-adjustments/count-sheet?warehouseId=${WH_MAIN}&search=Spark`);
    const cnt = await ok('POST', '/stock-adjustments', { adjType: 'COUNT', warehouseId: WH_MAIN, txDate: dayStr(14), reason: 'Monthly cycle count - spark plugs', items: sheet.items.slice(0, 2).map((x: any, k: number) => ({ productId: x.productId, countedQty: Math.max(0, num(x.systemQty) - (k + 2)) })) }, 'adjustments');
    await ok('POST', `/stock-adjustments/${cnt.id}/post`);
    const dmg = await ok('POST', '/stock-adjustments', { adjType: 'DAMAGE', warehouseId: WH_MAIN, txDate: dayStr(20), reason: 'Water damage in rack R04', items: [{ productId: pid(16), qtyChange: -2 }] }, 'adjustments');
    await ok('POST', `/stock-adjustments/${dmg.id}/post`);
    await ok('POST', '/stock-adjustments', { adjType: 'ADJUSTMENT', warehouseId: WH_MAIN, txDate: dayStr(1), reason: 'Draft - recount pending', items: [{ productId: pid(9), qtyChange: -1 }] }, 'adjustments'); // DRAFT
  });

  // -------------------------------------------------------------------------------- FINANCE
  await section('manual journals', async () => {
    const accs = (await ok('GET', '/accounts?all=1')).rows;
    const acc = (code: string) => accs.find((a: any) => a.code === code);
    const jv = await ok('POST', '/journals', { date: dayStr(45), narration: 'Monthly warehouse rent accrual', lines: [{ accountId: acc('6100').id, debit: 12000, description: 'Rent' }, { accountId: acc('2300').id, credit: 12000, description: 'Accrued rent' }] }, 'journals');
    void jv;
    await ok('POST', '/journals', { date: dayStr(20), narration: 'Utilities paid in cash', lines: [{ accountId: acc('6400').id, debit: 1850 }, { accountId: acc('1110').id, credit: 1850 }] }, 'journals');
    await ok('POST', '/journals', { date: dayStr(10), narration: 'Salaries paid by bank', lines: [{ accountId: acc('6200').id, debit: 18500 }, { accountId: acc('1210').id, credit: 18500 }] }, 'journals');
  });
  await section('credit and debit notes', async () => {
    const accs = (await ok('GET', '/accounts?all=1')).rows; void accs;
    const openSI = (await ok('GET', '/sales-invoices?status=POSTED&pageSize=20')).rows;
    const openPI = (await ok('GET', '/purchase-invoices?status=POSTED&pageSize=20')).rows;
    const salesInvoices = openSI.map((r: any) => ({ id: r.id, customerId: r.customerId }));
    const paidInvoices = openPI.map((r: any) => ({ id: r.id, supplierId: r.supplierId }));
    if (salesInvoices[0]) await ok('POST', '/notes', { noteType: 'CREDIT', partyType: 'CUSTOMER', partyId: salesInvoices[0].customerId, noteDate: dayStr(18), amount: 150, vatCode: 'VAT5', reason: 'Price adjustment / volume rebate', refType: 'SALES_INVOICE', refId: salesInvoices[0].id, applyToInvoice: true }, 'creditNotes');
    await ok('POST', '/notes', { noteType: 'CREDIT', partyType: 'CUSTOMER', partyId: custs[6], noteDate: dayStr(8), amount: 80, vatCode: 'VAT5', reason: 'Goodwill credit (on account)' }, 'creditNotes');
    if (paidInvoices[0]) await ok('POST', '/notes', { noteType: 'DEBIT', partyType: 'SUPPLIER', partyId: paidInvoices[0].supplierId, noteDate: dayStr(24), amount: 120, vatCode: 'VAT5', reason: 'Supplier charge-back for short supply', refType: 'PURCHASE_INVOICE', refId: paidInvoices[0].id }, 'debitNotes');
    await ok('POST', '/notes', { noteType: 'DEBIT', partyType: 'CUSTOMER', partyId: custs[3], noteDate: dayStr(11), amount: 60, vatCode: 'VAT5', reason: 'Late payment / bounced cheque charges' }, 'debitNotes');
  });

  await ok('PUT', '/settings', { 'demo.seeded': failures.length ? 'partial' : 'true' });
  console.log('\n================ SEED SUMMARY ================');
  console.log(JSON.stringify(counts, null, 1));
  if (failures.length) { console.log('\nFAILED SECTIONS:'); failures.forEach((f) => console.log(' -', f)); }
  else console.log('\nAll sections completed.');
}
main().catch((e) => { console.error('FATAL', e.message || e); process.exit(2); });
