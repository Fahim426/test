import { fortuneCompany, seedFortuneCatalog } from '../src/services/products-catalog';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ACTIONS, PERMISSION_MODULES } from '../src/lib/permissions';
import { DOC_DEFAULTS } from '../src/services/numbering';

const prisma = new PrismaClient();

type Acc = { code: string; name: string; type: string; key?: string; group?: boolean; bank?: boolean; parent?: string };

const ACCOUNTS: Acc[] = [
  { code: '1000', name: 'Assets', type: 'ASSET', group: true },
  { code: '1100', name: 'Cash', type: 'ASSET', group: true, parent: '1000' },
  { code: '1110', name: 'Cash in Hand', type: 'ASSET', key: 'CASH', parent: '1100' },
  { code: '1200', name: 'Bank', type: 'ASSET', group: true, parent: '1000' },
  { code: '1210', name: 'Emirates NBD - Current', type: 'ASSET', key: 'BANK', bank: true, parent: '1200' },
  { code: '1300', name: 'Accounts Receivable', type: 'ASSET', key: 'AR', parent: '1000' },
  { code: '1400', name: 'Inventory', type: 'ASSET', key: 'INVENTORY', parent: '1000' },
  { code: '1450', name: 'Advances to Suppliers', type: 'ASSET', key: 'ADVANCE_TO_SUPPLIERS', parent: '1000' },
  { code: '1500', name: 'Input VAT', type: 'ASSET', key: 'VAT_INPUT', parent: '1000' },
  { code: '1600', name: 'Fixed Assets', type: 'ASSET', parent: '1000' },
  { code: '2000', name: 'Liabilities', type: 'LIABILITY', group: true },
  { code: '2100', name: 'Accounts Payable', type: 'LIABILITY', key: 'AP', parent: '2000' },
  { code: '2150', name: 'Goods Received Not Invoiced', type: 'LIABILITY', key: 'GRNI', parent: '2000' },
  { code: '2200', name: 'VAT Payable (Output VAT)', type: 'LIABILITY', key: 'VAT_OUTPUT', parent: '2000' },
  { code: '2300', name: 'Other Liabilities', type: 'LIABILITY', parent: '2000' },
  { code: '3000', name: 'Equity', type: 'EQUITY', group: true },
  { code: '3100', name: 'Owner Capital / Opening Balance Equity', type: 'EQUITY', key: 'OPENING_EQUITY', parent: '3000' },
  { code: '4000', name: 'Revenue', type: 'REVENUE', group: true },
  { code: '4100', name: 'Equipment & Consumables Sales', type: 'REVENUE', key: 'SALES', parent: '4000' },
  { code: '4150', name: 'Sales Returns', type: 'REVENUE', key: 'SALES_RETURNS', parent: '4000' },
  { code: '4200', name: 'Other Revenue', type: 'REVENUE', parent: '4000' },
  { code: '5000', name: 'Cost of Goods Sold', type: 'COGS', key: 'COGS' },
  { code: '5100', name: 'Stock Adjustment / Shrinkage', type: 'COGS', key: 'STOCK_ADJUSTMENT' },
  { code: '6000', name: 'Expenses', type: 'EXPENSE', group: true },
  { code: '6100', name: 'Rent', type: 'EXPENSE', parent: '6000' },
  { code: '6200', name: 'Salaries', type: 'EXPENSE', parent: '6000' },
  { code: '6300', name: 'Freight', type: 'EXPENSE', key: 'FREIGHT', parent: '6000' },
  { code: '6400', name: 'Utilities', type: 'EXPENSE', parent: '6000' },
  { code: '6500', name: 'Insurance', type: 'EXPENSE', parent: '6000' },
  { code: '6600', name: 'Vehicle', type: 'EXPENSE', parent: '6000' },
  { code: '6700', name: 'Bank Charges', type: 'EXPENSE', key: 'BANK_CHARGES', parent: '6000' },
  { code: '6800', name: 'Round Off', type: 'EXPENSE', key: 'ROUND_OFF', parent: '6000' },
  { code: '6900', name: 'Other Expenses', type: 'EXPENSE', parent: '6000' },
];

async function main() {
  // ---- Roles & permissions
  const roleDefs: Record<string, { desc: string; modules: readonly string[] | '*'; actions: readonly string[] }> = {
    Admin: { desc: 'Full system access', modules: '*', actions: ACTIONS },
    Manager: { desc: 'Approves purchase / sales documents', modules: '*', actions: ['view', 'create', 'edit', 'approve', 'reject', 'post', 'print', 'export'] },
    Finance: {
      desc: 'Accounting & payments',
      modules: ['dashboard', 'chart_of_accounts', 'receipts', 'payments', 'journal', 'notes', 'ledger', 'vat', 'reports', 'purchase_invoice', 'sales_invoice', 'purchase_order', 'customers', 'suppliers'],
      actions: ['view', 'create', 'edit', 'approve', 'reject', 'post', 'print', 'export'],
    },
    Management: { desc: 'Top-level approver', modules: '*', actions: ['view', 'approve', 'reject', 'print', 'export'] },
    'Sales Executive': {
      desc: 'Sales documents',
      modules: ['dashboard', 'products', 'customers', 'sales_enquiry', 'sales_quotation', 'proforma_invoice', 'sales_order', 'stock', 'reports'],
      actions: ['view', 'create', 'edit', 'print', 'export'],
    },
    'Warehouse Staff': {
      desc: 'Picking, packing, delivery, stock',
      modules: ['dashboard', 'products', 'picking', 'packing', 'delivery_note', 'goods_receipt', 'stock', 'stock_transfer', 'stock_adjustment'],
      actions: ['view', 'create', 'edit', 'post', 'print'],
    },
    'Purchase Officer': {
      desc: 'Purchase documents',
      modules: ['dashboard', 'products', 'suppliers', 'material_request', 'purchase_requisition', 'purchase_enquiry', 'supplier_quotation', 'comparative_statement', 'purchase_order', 'import_purchase', 'goods_receipt', 'landed_cost', 'purchase_invoice', 'purchase_return', 'reports'],
      actions: ['view', 'create', 'edit', 'print', 'export'],
    },
  };
  for (const [name, def] of Object.entries(roleDefs)) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name, description: def.desc, isSystem: name === 'Admin' } });
    const mods = def.modules === '*' ? PERMISSION_MODULES : def.modules;
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: mods.flatMap((module) => def.actions.map((action) => ({ roleId: role.id, module, action }))),
      skipDuplicates: true,
    });
  }
  const admin = await prisma.role.findUniqueOrThrow({ where: { name: 'Admin' } });
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: { username: 'admin', fullName: 'System Administrator', email: 'admin@smartspare.local', passwordHash: await bcrypt.hash('admin123', 10), roleId: admin.id },
  });
  const mgr = await prisma.role.findUniqueOrThrow({ where: { name: 'Manager' } });
  await prisma.user.upsert({
    where: { username: 'manager' },
    update: {},
    create: { username: 'manager', fullName: 'Operations Manager', passwordHash: await bcrypt.hash('manager123', 10), roleId: mgr.id },
  });

  // ---- Company / Branch / Warehouses
  await prisma.company.upsert({ where: { code: fortuneCompany.code }, update: {}, create: fortuneCompany });
  const branches = [
    ['DXB', 'Dubai'],
    ['SHJ', 'Sharjah'],
    ['AUH', 'Abu Dhabi'],
    ['AJM', 'Ajman'],
  ];
  for (const [code, name] of branches) await prisma.branch.upsert({ where: { code }, update: {}, create: { code, name } });
  const br = Object.fromEntries((await prisma.branch.findMany()).map((b) => [b.code, b.id]));
  const whs = [
    ['WH-DXB-MAIN', 'Dubai Main', 'DXB'],
    ['WH-DXB-BR', 'Dubai Branch', 'DXB'],
    ['WH-SHJ', 'Sharjah', 'SHJ'],
    ['WH-AUH', 'Abu Dhabi', 'AUH'],
    ['WH-AJM', 'Ajman', 'AJM'],
  ];
  for (const [code, name, b] of whs) await prisma.warehouse.upsert({ where: { code }, update: {}, create: { code, name, branchId: br[b] } });
  const main = await prisma.warehouse.findUniqueOrThrow({ where: { code: 'WH-DXB-MAIN' } });
  for (const [zone, rack, shelf, bin] of [['A', 'R01', 'S1', 'B01'], ['A', 'R01', 'S1', 'B02'], ['A', 'R02', 'S2', 'B01'], ['B', 'R05', 'S1', 'B03']]) {
    const code = `${zone}-${rack}-${shelf}-${bin}`;
    await prisma.warehouseLocation.upsert({ where: { warehouseId_code: { warehouseId: main.id, code } }, update: {}, create: { warehouseId: main.id, zone, rack, shelf, bin, code } });
  }
  await prisma.businessUnit.upsert({ where: { code: 'BU1' }, update: {}, create: { code: 'BU1', name: 'Printing & Industrial Equipment Trading' } });

  // ---- Currency / VAT / Units / Payment terms
  for (const [code, name, symbol, rate, isBase] of [['AED', 'UAE Dirham', 'د.إ', 1, true], ['USD', 'US Dollar', '$', 3.6725, false], ['EUR', 'Euro', '€', 4.0, false], ['JPY', 'Japanese Yen', '¥', 0.0245, false], ['CNY', 'Chinese Yuan', '¥', 0.51, false]] as const) {
    await prisma.currency.upsert({ where: { code }, update: {}, create: { code, name, symbol, rate, isBase } });
  }
  for (const [code, name, rate, category, isDefault] of [['VAT5', 'Standard Rated 5%', 5, 'TAXABLE', true], ['VAT0', 'Zero Rated', 0, 'ZERO_RATED', false], ['EXEMPT', 'Exempt', 0, 'EXEMPT', false], ['OOS', 'Out of Scope', 0, 'OUT_OF_SCOPE', false]] as const) {
    await prisma.vatCode.upsert({ where: { code }, update: {}, create: { code, name, rate, category, isDefault } });
  }
  for (const [code, name] of [['PCS', 'Pieces'], ['SET', 'Set'], ['BOX', 'Box'], ['PAIR', 'Pair'], ['LTR', 'Litre'], ['KG', 'Kilogram']]) await prisma.unit.upsert({ where: { code }, update: {}, create: { code, name } });
  for (const [code, name, days] of [['COD', 'Cash on Delivery', 0], ['NET15', 'Net 15 Days', 15], ['NET30', 'Net 30 Days', 30], ['NET60', 'Net 60 Days', 60], ['NET90', 'Net 90 Days', 90], ['ADV', 'Advance Payment', 0]] as const) {
    await prisma.paymentTerm.upsert({ where: { code }, update: {}, create: { code, name, days } });
  }

  // ---- Chart of accounts
  const idByCode: Record<string, number> = {};
  for (const a of ACCOUNTS) {
    const row = await prisma.account.upsert({
      where: { code: a.code },
      update: {},
      create: { code: a.code, name: a.name, type: a.type, isGroup: !!a.group, systemKey: a.key, isBank: !!a.bank, parentId: a.parent ? idByCode[a.parent] : null },
    });
    idByCode[a.code] = row.id;
  }

  // ---- Document numbering
  for (const [docType, prefix] of Object.entries(DOC_DEFAULTS)) {
    await prisma.documentNumbering.upsert({ where: { docType }, update: {}, create: { docType, prefix } });
  }

  // ---- Approval rules (editable in Admin; not hard-coded in code)
  if ((await prisma.approvalRule.count()) === 0) {
    await prisma.approvalRule.createMany({
      data: [
        { docType: 'PURCHASE_ORDER', name: 'PO under 10,000', minAmount: 0, maxAmount: 10000, steps: JSON.stringify(['Manager']) },
        { docType: 'PURCHASE_ORDER', name: 'PO 10,000 - 50,000', minAmount: 10000, maxAmount: 50000, steps: JSON.stringify(['Manager', 'Finance']) },
        { docType: 'PURCHASE_ORDER', name: 'PO above 50,000', minAmount: 50000, maxAmount: null, steps: JSON.stringify(['Manager', 'Finance', 'Management']) },
        { docType: 'SALES_ORDER', name: 'SO under 25,000', minAmount: 0, maxAmount: 25000, steps: JSON.stringify(['Manager']) },
        { docType: 'SALES_ORDER', name: 'SO above 25,000', minAmount: 25000, maxAmount: null, steps: JSON.stringify(['Manager', 'Finance']) },
      ],
    });
  }

  // ---- Sample master data
  const mk = async (model: 'brand' | 'category' | 'productGroup' | 'productType' | 'area' | 'territory' | 'salesman', rows: Array<Record<string, unknown>>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = (prisma as any)[model];
    for (const r of rows) await d.upsert({ where: { code: r.code }, update: {}, create: r });
  };
  await mk('area', [{ code: 'DEIRA', name: 'Deira' }, { code: 'BURDUBAI', name: 'Bur Dubai' }, { code: 'SHJIND', name: 'Sharjah Industrial' }]);
  await mk('territory', [{ code: 'DXB', name: 'Dubai' }, { code: 'NE', name: 'Northern Emirates' }, { code: 'AUH', name: 'Abu Dhabi' }]);
  await mk('salesman', [{ code: 'S001', name: 'Ahmed Khan', phone: '+971500000001' }, { code: 'S002', name: 'Rashid Ali', phone: '+971500000002' }]);

  const net30 = await prisma.paymentTerm.findUniqueOrThrow({ where: { code: 'NET30' } });
  const s1 = await prisma.salesman.findUniqueOrThrow({ where: { code: 'S001' } });
  for (const c of [
    { code: 'C0001', name: 'Al Futtaim Auto Service', trn: '100200300400003', city: 'Dubai', country: 'UAE', creditLimit: 100000 },
    { code: 'C0002', name: 'Gulf Garage LLC', trn: '100200300400011', city: 'Sharjah', country: 'UAE', creditLimit: 50000 },
    { code: 'C0003', name: 'Desert Motors', trn: '100200300400029', city: 'Abu Dhabi', country: 'UAE', creditLimit: 75000 },
  ]) await prisma.customer.upsert({ where: { code: c.code }, update: {}, create: { ...c, paymentTermId: net30.id, salesmanId: s1.id } });
  for (const s of [
    { code: 'V0001', name: 'Toyota Tsusho Japan', country: 'Japan', currencyCode: 'USD' },
    { code: 'V0002', name: 'Bosch Middle East FZE', country: 'UAE', currencyCode: 'AED' },
    { code: 'V0003', name: 'Al Madina Printing & Industrial Equipment Trading', country: 'UAE', currencyCode: 'AED' },
  ]) await prisma.supplier.upsert({ where: { code: s.code }, update: {}, create: { ...s, paymentTermId: net30.id } });

  await seedFortuneCatalog(prisma);

  // HR demo data
  const depts = await Promise.all([
    prisma.department.upsert({ where: { code: 'HR' }, update: {}, create: { code: 'HR', name: 'Human Resources' } }),
    prisma.department.upsert({ where: { code: 'SALES' }, update: {}, create: { code: 'SALES', name: 'Sales' } }),
    prisma.department.upsert({ where: { code: 'WHOUSE' }, update: {}, create: { code: 'WHOUSE', name: 'Warehouse' } }),
    prisma.department.upsert({ where: { code: 'FIN' }, update: {}, create: { code: 'FIN', name: 'Finance' } }),
    prisma.department.upsert({ where: { code: 'IT' }, update: {}, create: { code: 'IT', name: 'IT & Systems' } }),
  ]);
  const desigs = await Promise.all([
    prisma.designation.upsert({ where: { code: 'MGR' }, update: {}, create: { code: 'MGR', name: 'Manager' } }),
    prisma.designation.upsert({ where: { code: 'EXEC' }, update: {}, create: { code: 'EXEC', name: 'Executive' } }),
    prisma.designation.upsert({ where: { code: 'COORD' }, update: {}, create: { code: 'COORD', name: 'Coordinator' } }),
    prisma.designation.upsert({ where: { code: 'TECH' }, update: {}, create: { code: 'TECH', name: 'Technician' } }),
    prisma.designation.upsert({ where: { code: 'ACCT' }, update: {}, create: { code: 'ACCT', name: 'Accountant' } }),
  ]);

  const hrEmployees = [
    { no: 'EMP-001', first: 'Ahmed', last: 'Al Mansouri', dept: 0, desig: 0, type: 'FULL_TIME', basic: 12000, housing: 3000, transport: 1000, join: '2020-01-15', passport: '2026-05-01', visa: '2026-05-01' },
    { no: 'EMP-002', first: 'Sarah', last: 'Johnson', dept: 1, desig: 1, type: 'FULL_TIME', basic: 9000, housing: 2000, transport: 800, join: '2021-03-01', passport: '2027-08-15', visa: '2027-08-15' },
    { no: 'EMP-003', first: 'Mohammed', last: 'Al Rashidi', dept: 2, desig: 3, type: 'FULL_TIME', basic: 6000, housing: 1500, transport: 600, join: '2019-07-10', passport: '2025-12-01', visa: '2025-12-01' },
    { no: 'EMP-004', first: 'Priya', last: 'Sharma', dept: 3, desig: 4, type: 'FULL_TIME', basic: 8500, housing: 2000, transport: 700, join: '2022-01-05', passport: '2028-02-20', visa: '2028-02-20' },
    { no: 'EMP-005', first: 'Khalid', last: 'Al Hamdan', dept: 1, desig: 1, type: 'FULL_TIME', basic: 7500, housing: 1800, transport: 600, join: '2021-09-15', passport: '2026-11-30', visa: '2026-11-30' },
    { no: 'EMP-006', first: 'Raju', last: 'Patel', dept: 2, desig: 3, type: 'FULL_TIME', basic: 5500, housing: 1200, transport: 500, join: '2020-11-01', passport: '2024-11-15', visa: '2024-11-15' },
    { no: 'EMP-007', first: 'Fatima', last: 'Al Zaabi', dept: 0, desig: 2, type: 'FULL_TIME', basic: 7000, housing: 1500, transport: 500, join: '2023-02-01', passport: '2029-01-10', visa: '2029-01-10' },
    { no: 'EMP-008', first: 'David', last: 'Chen', dept: 4, desig: 0, type: 'FULL_TIME', basic: 11000, housing: 2500, transport: 900, join: '2022-06-01', passport: '2027-06-30', visa: '2027-06-30' },
    { no: 'EMP-009', first: 'Aisha', last: 'Al Nuaimi', dept: 3, desig: 2, type: 'PART_TIME', basic: 4000, housing: 800, transport: 300, join: '2023-05-15', passport: '2028-05-20', visa: '2028-05-20' },
    { no: 'EMP-010', first: 'Ivan', last: 'Petrov', dept: 1, desig: 1, type: 'CONTRACT', basic: 8000, housing: 0, transport: 0, join: '2024-01-01', passport: '2026-07-15', visa: '2026-07-15' },
  ];

  for (const e of hrEmployees) {
    const existing = await prisma.employee.findUnique({ where: { employeeNo: e.no } });
    if (!existing) {
      await prisma.employee.create({
        data: {
          employeeNo: e.no,
          firstName: e.first,
          lastName: e.last,
          fullName: `${e.first} ${e.last}`,
          gender: 'MALE',
          departmentId: depts[e.dept].id,
          designationId: desigs[e.desig].id,
          employmentType: e.type as 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'PROBATION',
          joinDate: new Date(e.join),
          basicSalary: e.basic,
          housingAllowance: e.housing,
          transportAllowance: e.transport,
          status: 'ACTIVE',
          passportNo: `P${Math.floor(Math.random() * 9000000 + 1000000)}`,
          passportExpiry: new Date(e.passport),
          visaExpiry: new Date(e.visa),
        },
      });
    }
  }

  console.log('Seed complete. Login: admin / admin123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
