import { Home, Landmark, Package, BarChart3, Network, ShieldCheck, Wrench, Users, type LucideIcon } from 'lucide-react';
import { ribbonConfig } from '@/ribbon/ribbonConfig';

export const MODULE_ICONS: Record<string, LucideIcon> = {
  home: Home,
  finance: Landmark,
  inventory: Package,
  reports: BarChart3,
  dimensions: Network,
  admin: ShieldCheck,
  amc: Wrench,
  hr: Users,
};

export interface NavEntry {
  id: string;
  label: string;
  moduleKey: string;
  module: string;
  group: string;
  icon: LucideIcon;
}

/** Every ribbon item flattened (screen id de-duplicated, first location wins). */
export const navEntries: NavEntry[] = (() => {
  const seen = new Set<string>();
  const out: NavEntry[] = [];
  for (const m of ribbonConfig)
    for (const g of m.groups)
      for (const it of g.items) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        out.push({ id: it.id, label: it.label, moduleKey: m.key, module: m.module, group: g.label, icon: it.icon });
      }
  return out;
})();

export const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export interface QuickAction {
  label: string;
  form: string;
  perm: string;
}
const g = (label: string, form: string, perm: string): QuickAction => ({ label, form, perm });

export const QUICK_GROUPS: { name: string; items: QuickAction[] }[] = [
  {
    name: 'Sales',
    items: [
      g('New Sales Enquiry', 'sales-enquiry-form', 'sales_enquiry'),
      g('New Quotation', 'sales-quotation-form', 'sales_quotation'),
      g('New Sales Order', 'sales-order-form', 'sales_order'),
      g('New Sales Invoice', 'sales-invoice-form', 'sales_invoice'),
    ],
  },
  {
    name: 'Purchase',
    items: [
      g('New Material Request', 'material-request-form', 'material_request'),
      g('New Purchase Order', 'purchase-order-form', 'purchase_order'),
      g('New Goods Receipt', 'goods-receipt-form', 'goods_receipt'),
      g('New Purchase Invoice', 'purchase-invoice-form', 'purchase_invoice'),
    ],
  },
  {
    name: 'Finance',
    items: [
      g('Bank Receipt', 'bank-receipt-form', 'receipts'),
      g('Cash Receipt', 'cash-receipt-form', 'receipts'),
      g('Bank Payment', 'bank-payment-form', 'payments'),
      g('Cash Payment', 'cash-payment-form', 'payments'),
      g('Journal Voucher', 'journal-voucher-form', 'journal'),
    ],
  },
  {
    name: 'Inventory',
    items: [
      g('New Product', 'product-form', 'products'),
      g('Stock Transfer', 'stock-transfer-form', 'stock_transfer'),
      g('Stock Adjustment', 'stock-adjustment-form', 'stock_adjustment'),
    ],
  },
  {
    name: 'Masters',
    items: [g('New Customer', 'customer-form', 'customers'), g('New Supplier', 'supplier-form', 'suppliers')],
  },
];
