import { Zap, FilePlus2 } from 'lucide-react';
import { usePermission } from '@/store/auth';
import { useOpenScreen } from '@/store/workspace';
import { Panel } from '@/components/ui';
import type { ScreenDef } from '@/screens/types';

interface QA { label: string; form: string; perm: string }
const g = (label: string, form: string, perm: string): QA => ({ label, form, perm });

const GROUPS: { name: string; items: QA[] }[] = [
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
    name: 'Dimensions',
    items: [g('New Customer', 'customer-form', 'customers'), g('New Supplier', 'supplier-form', 'suppliers')],
  },
];

function QuickActionsScreen() {
  const can = usePermission();
  const open = useOpenScreen();
  return (
    <div className="h-full overflow-auto bg-app-bg p-2">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-slate-700">
        <Zap size={14} className="text-brand" /> Quick Actions
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {GROUPS.map((grp) => (
          <Panel key={grp.name} title={grp.name} bodyClassName="grid grid-cols-2 gap-1.5">
            {grp.items.map((a) => {
              const allowed = can(a.perm, 'create');
              return (
                <button
                  key={a.form}
                  type="button"
                  disabled={!allowed}
                  title={allowed ? a.label : `No permission (${a.perm}:create)`}
                  onClick={() => open(a.form, {}, a.label)}
                  className="flex h-8 items-center gap-1.5 rounded border border-app-border bg-white px-2 text-left text-[12px] hover:border-brand hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-app-border disabled:hover:bg-white"
                >
                  <FilePlus2 size={13} className="shrink-0 text-brand" />
                  <span className="truncate">{a.label}</span>
                </button>
              );
            })}
          </Panel>
        ))}
      </div>
    </div>
  );
}

export default [{ id: 'quick-actions', title: 'Quick Actions', icon: Zap, component: QuickActionsScreen }] satisfies ScreenDef[];
