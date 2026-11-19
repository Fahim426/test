type Acc = {
  code: string;
  name: string;
  type: string;
  key?: string;
  group?: boolean;
  bank?: boolean;
  parent?: string;
};

export const ACCOUNTS: Acc[] = [
  { code: "1000", name: "Assets", type: "ASSET", group: true },
  { code: "1100", name: "Cash", type: "ASSET", group: true, parent: "1000" },
  {
    code: "1110",
    name: "Cash in Hand",
    type: "ASSET",
    key: "CASH",
    parent: "1100",
  },
  { code: "1200", name: "Bank", type: "ASSET", group: true, parent: "1000" },
  {
    code: "1210",
    name: "Main Bank Account",
    type: "ASSET",
    key: "BANK",
    bank: true,
    parent: "1200",
  },
  {
    code: "1300",
    name: "Accounts Receivable",
    type: "ASSET",
    key: "AR",
    parent: "1000",
  },
  {
    code: "1400",
    name: "Inventory",
    type: "ASSET",
    key: "INVENTORY",
    parent: "1000",
  },
  {
    code: "1450",
    name: "Advances to Suppliers",
    type: "ASSET",
    key: "ADVANCE_TO_SUPPLIERS",
    parent: "1000",
  },
  {
    code: "1500",
    name: "Input VAT",
    type: "ASSET",
    key: "VAT_INPUT",
    parent: "1000",
  },
  { code: "1600", name: "Fixed Assets", type: "ASSET", parent: "1000" },
  { code: "2000", name: "Liabilities", type: "LIABILITY", group: true },
  {
    code: "2100",
    name: "Accounts Payable",
    type: "LIABILITY",
    key: "AP",
    parent: "2000",
  },
  {
    code: "2150",
    name: "Goods Received Not Invoiced",
    type: "LIABILITY",
    key: "GRNI",
    parent: "2000",
  },
  {
    code: "2200",
    name: "VAT Payable (Output VAT)",
    type: "LIABILITY",
    key: "VAT_OUTPUT",
    parent: "2000",
  },
  {
    code: "2300",
    name: "Other Liabilities",
    type: "LIABILITY",
    parent: "2000",
  },
  { code: "3000", name: "Equity", type: "EQUITY", group: true },
  {
    code: "3100",
    name: "Owner Capital / Opening Balance Equity",
    type: "EQUITY",
    key: "OPENING_EQUITY",
    parent: "3000",
  },
  { code: "4000", name: "Revenue", type: "REVENUE", group: true },
  {
    code: "4100",
    name: "Equipment & Consumables Sales",
    type: "REVENUE",
    key: "SALES",
    parent: "4000",
  },
  {
    code: "4150",
    name: "Sales Returns",
    type: "REVENUE",
    key: "SALES_RETURNS",
    parent: "4000",
  },
  { code: "4200", name: "Other Revenue", type: "REVENUE", parent: "4000" },
  { code: "5000", name: "Cost of Goods Sold", type: "COGS", key: "COGS" },
  {
    code: "5100",
    name: "Stock Adjustment / Shrinkage",
    type: "COGS",
    key: "STOCK_ADJUSTMENT",
  },
  { code: "6000", name: "Expenses", type: "EXPENSE", group: true },
  { code: "6100", name: "Rent", type: "EXPENSE", parent: "6000" },
  { code: "6200", name: "Salaries", type: "EXPENSE", parent: "6000" },
  {
    code: "6300",
    name: "Freight",
    type: "EXPENSE",
    key: "FREIGHT",
    parent: "6000",
  },
  { code: "6400", name: "Utilities", type: "EXPENSE", parent: "6000" },
  { code: "6500", name: "Insurance", type: "EXPENSE", parent: "6000" },
  { code: "6600", name: "Transport Expenses", type: "EXPENSE", parent: "6000" },
  {
    code: "6700",
    name: "Bank Charges",
    type: "EXPENSE",
    key: "BANK_CHARGES",
    parent: "6000",
  },
  {
    code: "6800",
    name: "Round Off",
    type: "EXPENSE",
    key: "ROUND_OFF",
    parent: "6000",
  },
  { code: "6900", name: "Other Expenses", type: "EXPENSE", parent: "6000" },
];
