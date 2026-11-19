import type { ComponentType } from 'react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { ReportViewer } from '@/components/reports/ReportViewer';

/**
 * Thin screens, one per report. Ids = ribbon ids (see components/reports/reportRoutes.ts for the id -> catalog key map).
 * Ids shared with INVENTORY / FINANCE (stock-*, low-stock, dead-stock, pending-po/grn, warehouse-stock, finance reports)
 * are intentionally NOT registered here.
 */
const REPORTS: { id: string; title: string }[] = [
  { id: 'sales-register', title: 'Sales Register' },
  { id: 'sales-by-customer', title: 'Sales by Customer' },
  { id: 'sales-by-product', title: 'Sales by Product' },
  { id: 'sales-by-brand', title: 'Sales by Brand' },
  { id: 'salesman-sales', title: 'Salesman Sales' },
  { id: 'gross-profit', title: 'Gross Profit' },
  { id: 'invoice-register', title: 'Invoice Register' },
  { id: 'sales-return-report', title: 'Sales Return Report' },
  { id: 'purchase-register', title: 'Purchase Register' },
  { id: 'supplier-purchase', title: 'Supplier Purchase' },
  { id: 'product-purchase', title: 'Product Purchase' },
  { id: 'purchase-by-brand', title: 'Purchase by Brand' },
  { id: 'purchase-return-report', title: 'Purchase Return Report' },
  { id: 'import-purchase-report', title: 'Import Purchase Report' },
  { id: 'fast-moving', title: 'Fast Moving' },
  { id: 'slow-moving', title: 'Slow Moving' },
  { id: 'branch-performance', title: 'Branch Performance' },
];

const make = (id: string): ComponentType<ScreenProps> =>
  function ReportScreen({ params }: ScreenProps) {
    return <ReportViewer screenId={id} preset={params.preset} />;
  };

export default REPORTS.map((r) => ({ id: r.id, title: r.title, component: make(r.id), permission: 'reports' })) satisfies ScreenDef[];
