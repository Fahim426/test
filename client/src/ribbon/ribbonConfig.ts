import {
  LayoutDashboard, Star, Zap, CheckSquare, History, BookOpen, HandCoins, Wallet, Landmark, Banknote, FileSpreadsheet,
  FileMinus, FilePlus, FolderOpen, Library, BookText, Notebook, Users, UserCheck, Clock, AlarmClock, Scale, TrendingUp,
  BarChart3, Percent, Package, ClipboardList, FileQuestion, FileText, FileCheck, Truck, PackageCheck, Receipt,
  Undo2, ShoppingCart, ShoppingBag, FileSearch, GitCompare, Ship, Anchor, Boxes, Warehouse, ArrowLeftRight, SlidersHorizontal,
  PackagePlus, ListChecks, LineChart, AlertTriangle, MapPin, Activity, Hourglass, Layers, Lock, Hash, Workflow, Settings,
  ScrollText, Mail, MessageSquare, Upload, Download, DatabaseBackup, Building2, Network, GitBranch, Tag, Grid3x3,
  Contact, Globe, Briefcase, Flag, Ruler, CreditCard, Coins, Wrench, Gauge, LayoutGrid, Hammer, PackageSearch,
  ShieldCheck, KeyRound, Calculator, FileBarChart, BadgeDollarSign, ClipboardCheck, Container, Calendar, TrendingDown,
  type LucideIcon,
} from 'lucide-react';

export interface RibbonItem {
  /** screenId (see README-SHELL.md) */
  id: string;
  label: string;
  icon: LucideIcon;
}
export interface RibbonGroup {
  label: string;
  items: RibbonItem[];
}
export interface RibbonModule {
  module: string; // tab label
  key: string;
  groups: RibbonGroup[];
}

const i = (id: string, label: string, icon: LucideIcon): RibbonItem => ({ id, label, icon });

export const ribbonConfig: RibbonModule[] = [
  {
    module: 'HOME',
    key: 'home',
    groups: [
      { label: 'Dashboard', items: [i('dashboard', 'Dashboard', LayoutDashboard)] },
      { label: 'Favorites', items: [i('favorites', 'Favorites', Star)] },
      { label: 'Quick Actions', items: [i('quick-actions', 'Quick Actions', Zap)] },
      { label: 'Pending Approvals', items: [i('pending-approvals', 'Pending Approvals', CheckSquare)] },
      { label: 'Reminders', items: [i('reminder-centre', 'Reminder Centre', AlarmClock)] },
      { label: 'Recent Documents', items: [i('recent-documents', 'Recent Documents', History)] },
    ],
  },
  {
    module: 'FINANCE',
    key: 'finance',
    groups: [
      { label: 'Chart of Accounts', items: [i('chart-of-accounts', 'Chart of Accounts', BookOpen)] },
      { label: 'Receipts', items: [i('bank-receipts', 'Bank Receipt', Landmark), i('cash-receipts', 'Cash Receipt', HandCoins)] },
      { label: 'Payments', items: [i('bank-payments', 'Bank Payment', Banknote), i('cash-payments', 'Cash Payment', Wallet)] },
      {
        label: 'Journal Entries',
        items: [
          i('journal-vouchers', 'Journal Voucher', FileSpreadsheet),
          i('debit-notes', 'Debit Note', FileMinus),
          i('credit-notes', 'Credit Note', FilePlus),
          i('opening-balances', 'Opening Balance', FolderOpen),
        ],
      },
      { label: 'General Ledger', items: [i('general-ledger', 'General Ledger', Library)] },
      { label: 'Registers', items: [i('bank-book', 'Bank Book', BookText), i('cash-book', 'Cash Book', Notebook), i('day-book', 'Day Book', Calendar)] },
      {
        label: 'Receivables',
        items: [
          i('customer-statement', 'Customer Statement', Users),
          i('ar-aging', 'AR Aging', Clock),
          i('outstanding-invoices', 'Outstanding Invoices', Receipt),
          i('overdue-invoices', 'Due / Overdue', AlarmClock),
        ],
      },
      {
        label: 'Payables',
        items: [
          i('supplier-statement', 'Supplier Statement', UserCheck),
          i('ap-aging', 'AP Aging', Hourglass),
          i('outstanding-bills', 'Outstanding Bills', FileText),
        ],
      },
      {
        label: 'Final Reports',
        items: [
          i('trial-balance', 'Trial Balance', Scale),
          i('profit-loss', 'Profit & Loss', TrendingUp),
          i('balance-sheet', 'Balance Sheet', BarChart3),
          i('cash-flow', 'Cash Flow', Activity),
          i('vat-report', 'VAT Report', Percent),
        ],
      },
    ],
  },
  {
    module: 'INVENTORY',
    key: 'inventory',
    groups: [
      { label: 'Products', items: [i('products', 'Products', Package), i('equipment-register', 'Machine Serial Register', Hash), i('vehicle-compatibility', 'Equipment Compatibility', Wrench)] },
      {
        label: 'Sales',
        items: [
          i('sales-enquiries', 'Sales Enquiry', FileQuestion),
          i('sales-quotations', 'Quotation', FileText),
          i('proforma-invoices', 'Proforma Invoice', FileCheck),
          i('sales-orders', 'Sales Order', ClipboardList),
          i('pickings', 'Picking', ListChecks),
          i('packing-lists', 'Packing List', PackageCheck),
          i('delivery-notes', 'Delivery Note', Truck),
          i('sales-invoices', 'Sales Invoice', Receipt),
          i('sales-returns', 'Sales Return', Undo2),
        ],
      },
      {
        label: 'Purchase',
        items: [
          i('material-requests', 'Material Request', ClipboardList),
          i('purchase-requisitions', 'Purchase Requisition', FileText),
          i('purchase-enquiries', 'Purchase Enquiry', FileSearch),
          i('supplier-quotations', 'Supplier Quotation', FileCheck),
          i('comparative-statements', 'Comparative Statement', GitCompare),
          i('purchase-orders', 'Purchase Order', ShoppingCart),
          i('goods-receipts', 'Goods Receipt', PackagePlus),
          i('purchase-invoices', 'Purchase Invoice', Receipt),
          i('purchase-returns', 'Purchase Return', Undo2),
          i('import-requests', 'Import Request', Globe),
          i('supplier-proformas', 'Supplier Proforma', Receipt),
          i('import-purchase-orders', 'Import PO', Ship),
          i('goods-in-transit', 'Goods in Transit', Container),
          i('landed-costs', 'Landed Cost', Anchor),
        ],
      },
      {
        label: 'Stock',
        items: [
          i('stock-balances', 'Balances', Boxes),
          i('stock-ledger', 'Stock Ledger', BookText),
          i('stock-transfers', 'Transfers', ArrowLeftRight),
          i('stock-adjustments', 'Adjustments', SlidersHorizontal),
          i('opening-stock', 'Opening Stock', FolderOpen),
          i('stock-counts', 'Stock Count', ClipboardCheck),
        ],
      },
      {
        label: 'Reports',
        items: [
          i('stock-valuation', 'Stock Valuation', BadgeDollarSign),
          i('warehouse-stock', 'Warehouse Stock', Warehouse),
          i('low-stock', 'Low Stock', AlertTriangle),
          i('stock-movement', 'Stock Movement', LineChart),
          i('stock-aging', 'Stock Aging', Clock),
          i('dead-stock', 'Dead Stock', TrendingDown),
        ],
      },
      {
        label: 'Order Management',
        items: [
          i('reservations', 'Reservations', Lock),
          i('pending-sales-orders', 'Pending Sales Orders', ClipboardList),
          i('pending-deliveries', 'Pending Deliveries', Truck),
          i('pending-po', 'Pending PO', ShoppingBag),
          i('pending-grn', 'Pending GRN', PackageSearch),
        ],
      },
    ],
  },
  {
    module: 'REPORTS',
    key: 'reports',
    groups: [
      { label: 'Report Builder', items: [i('report-builder', 'Report Builder', Hammer)] },
      { label: 'Report List', items: [i('report-list', 'Report List', FileBarChart)] },
      { label: 'Dashboard', items: [i('dashboard', 'Dashboard', Gauge)] },
      { label: 'Widgets', items: [i('report-widgets', 'Widgets', LayoutGrid)] },
      {
        label: 'Financial Reports',
        items: [
          i('trial-balance', 'Trial Balance', Scale),
          i('profit-loss', 'Profit & Loss', TrendingUp),
          i('balance-sheet', 'Balance Sheet', BarChart3),
          i('cash-flow', 'Cash Flow', Activity),
          i('general-ledger', 'General Ledger', Library),
          i('customer-statement', 'Customer Statement', Users),
          i('supplier-statement', 'Supplier Statement', UserCheck),
          i('ar-aging', 'AR Aging', Clock),
          i('ap-aging', 'AP Aging', Hourglass),
          i('vat-report', 'VAT Report', Percent),
        ],
      },
      {
        label: 'Inventory Reports',
        items: [
          i('stock-balances', 'Stock Summary', Boxes),
          i('stock-ledger', 'Stock Ledger', BookText),
          i('stock-valuation', 'Stock Valuation', BadgeDollarSign),
          i('warehouse-stock', 'Warehouse Stock', Warehouse),
          i('low-stock', 'Low Stock', AlertTriangle),
          i('dead-stock', 'Dead Stock', TrendingDown),
          i('fast-moving', 'Fast Moving', TrendingUp),
          i('slow-moving', 'Slow Moving', Hourglass),
          i('stock-movement', 'Stock Movement', LineChart),
          i('stock-aging', 'Stock Aging', Clock),
        ],
      },
      {
        label: 'Sales Reports',
        items: [
          i('sales-register', 'Sales Register', BookText),
          i('sales-by-customer', 'Sales by Customer', Users),
          i('sales-by-product', 'Sales by Product', Package),
          i('sales-by-brand', 'Sales by Brand', Tag),
          i('salesman-sales', 'Salesman Sales', Briefcase),
          i('gross-profit', 'Gross Profit', Calculator),
          i('invoice-register', 'Invoice Register', Receipt),
          i('sales-return-report', 'Sales Return', Undo2),
        ],
      },
      {
        label: 'Purchase Reports',
        items: [
          i('purchase-register', 'Purchase Register', BookText),
          i('supplier-purchase', 'Supplier Purchase', UserCheck),
          i('product-purchase', 'Product Purchase', Package),
          i('purchase-by-brand', 'Purchase by Brand', Tag),
          i('pending-po', 'Pending PO', ShoppingBag),
          i('pending-grn', 'Pending GRN', PackageSearch),
          i('purchase-return-report', 'Purchase Return', Undo2),
          i('import-purchase-report', 'Import Purchase', Ship),
        ],
      },
      {
        label: 'Management Reports',
        items: [
          i('branch-performance', 'Branch Performance', BarChart3),
        ],
      },
    ],
  },
  {
    module: 'HR',
    key: 'hr',
    groups: [
      { label: 'Overview', items: [i('hr-dashboard', 'HR Dashboard', Gauge)] },
      {
        label: 'Employees',
        items: [
          i('hr-employees', 'Employees', Users),
          i('hr-departments', 'Departments', Network),
          i('hr-designations', 'Designations', Briefcase),
        ],
      },
      { label: 'Attendance', items: [i('hr-attendance', 'Attendance', Calendar)] },
      { label: 'Leave', items: [i('hr-leave', 'Leave Requests', AlarmClock)] },
      { label: 'Payroll', items: [i('hr-payroll', 'Payroll', Coins)] },
    ],
  },
  {
    module: 'AMC',
    key: 'amc',
    groups: [
      { label: 'Contracts', items: [i('amc-contracts', 'AMC Contracts', Wrench)] },
      { label: 'Reports', items: [i('amc-reports', 'AMC Reports', TrendingUp)] },
    ],
  },
  {
    module: 'MASTERS',
    key: 'dimensions',
    groups: [
      {
        label: 'Organization',
        items: [
          i('companies', 'Company', Building2),
          i('business-units', 'Business Unit', Network),
          i('branches', 'Branch', GitBranch),
          i('warehouses', 'Warehouse', Warehouse),
        ],
      },
      {
        label: 'Product Setup',
        items: [
          i('categories', 'Category', Layers),
          i('brands', 'Brands', Tag),
          i('product-groups', 'Product Groups', Grid3x3),
          i('product-types', 'Product Types', Wrench),
          i('units', 'Units', Ruler),
        ],
      },
      {
        label: 'Sales Setup',
        items: [i('areas', 'Area', MapPin), i('salesmen', 'Salesman', Contact), i('territories', 'Territory', Flag)],
      },
      { label: 'Parties', items: [i('customers', 'Customers', Users), i('suppliers', 'Suppliers', Truck)] },
      {
        label: 'Finance Setup',
        items: [i('payment-terms', 'Payment Terms', CreditCard), i('currencies', 'Currencies', Coins), i('vat-codes', 'VAT', Percent)],
      },
    ],
  },
  {
    module: 'ADMIN',
    key: 'admin',
    groups: [
      { label: 'Security', items: [i('users', 'Users', Users), i('roles', 'Roles', ShieldCheck), i('permissions', 'Permissions', KeyRound)] },
      {
        label: 'Configuration',
        items: [i('document-numbering', 'Document Numbering', Hash), i('approval-workflows', 'Approval Workflows', Workflow), i('system-settings', 'System Settings', Settings)],
      },
      { label: 'Monitoring', items: [i('audit-logs', 'Audit Logs', ScrollText)] },
      { label: 'Communication', items: [i('email-settings', 'Email', Mail), i('sms-settings', 'SMS', MessageSquare)] },
      { label: 'Data', items: [i('data-import', 'Import', Upload), i('data-export', 'Export', Download), i('backup', 'Backup', DatabaseBackup)] },
    ],
  },
];

export interface ScreenLocation {
  module: string;
  group: string;
  label: string;
}

const locIndex = new Map<string, ScreenLocation>();
for (const m of ribbonConfig)
  for (const g of m.groups) for (const it of g.items) if (!locIndex.has(it.id)) locIndex.set(it.id, { module: m.module, group: g.label, label: it.label });

/** Find Module/Group for a screen id (document screens `x-form` resolve through their list screen). */
export function locateScreen(screenId: string): ScreenLocation | undefined {
  const direct = locIndex.get(screenId);
  if (direct) return direct;
  if (screenId.endsWith('-form')) {
    const base = screenId.slice(0, -5);
    return locIndex.get(base) ?? locIndex.get(base + 's') ?? locIndex.get(base + 'es') ?? locIndex.get(base.replace(/y$/, 'ies'));
  }
  return undefined;
}

