import { useState } from 'react';
import { AlertTriangle, BadgeDollarSign, ClipboardList, Clock, LineChart, Lock, PackageSearch, ShoppingBag, TrendingDown, Truck, Warehouse } from 'lucide-react';
import type { ScreenDef } from '@/screens/types';
import { Column, DataTable } from '@/components/DataTable';
import { Select } from '@/components/ui';
import { ReportViewer } from '@/components/inventory/ReportViewer';
import { DocLink, STATUS_OPTIONS, useOptions } from '@/components/inventory/common';
import { api, Paged } from '@/lib/api';
import { fmt } from '@/lib/format';
import { useOpenScreen } from '@/store/workspace';

/* ------------------------- Inventory reports (generic viewer) ------------------------- */
const rep = (id: string, title: string, icon: ScreenDef['icon']): ScreenDef => ({
  id, title, icon, permission: 'reports', component: () => <ReportViewer reportKey={id} title={title} />,
});

/* ------------------------------- Reservations ------------------------------- */
interface ResRow {
  id: number; salesOrderId: number; salesOrderNo: string; status: string; qty: number; fulfilledQty: number; remainingQty: number; createdAt: string;
  customer?: { name: string } | null; product?: { code: string; name: string } | null; warehouse?: { name: string } | null;
}
function ReservationsScreen() {
  const open = useOpenScreen();
  const warehouses = useOptions('/warehouses');
  const [status, setStatus] = useState('ACTIVE');
  const [warehouseId, setWh] = useState('');
  const [totals, setTotals] = useState<{ qty?: number; fulfilledQty?: number; remainingQty?: number }>({});
  const columns: Column<ResRow>[] = [
    { key: 'salesOrderNo', header: 'Sales Order', width: 130, cell: (r) => <DocLink type="SALES_ORDER" id={r.salesOrderId} no={r.salesOrderNo} />, sortable: false },
    { key: 'createdAt', header: 'Reserved On', type: 'date', width: 100, sortable: false },
    { key: 'customer.name', header: 'Customer', sortable: false },
    { key: 'product.code', header: 'Code', width: 110, sortable: false },
    { key: 'product.name', header: 'Product', sortable: false },
    { key: 'warehouse.name', header: 'Warehouse', width: 120, sortable: false },
    { key: 'qty', header: 'Reserved', type: 'qty', width: 80, sortable: false, total: () => fmt.qty(totals.qty) },
    { key: 'fulfilledQty', header: 'Fulfilled', type: 'qty', width: 80, sortable: false, total: () => fmt.qty(totals.fulfilledQty) },
    { key: 'remainingQty', header: 'Remaining', type: 'qty', width: 80, sortable: false, total: () => fmt.qty(totals.remainingQty) },
    { key: 'status', header: 'Status', type: 'status', width: 90, sortable: false },
  ];
  return (
    <DataTable<ResRow>
      tableKey="reservations"
      queryKey="reservations"
      columns={columns}
      exportName="Stock Reservations"
      searchPlaceholder="Search sales order no..."
      filters={{ status, warehouseId }}
      fetcher={async (p) => {
        const r = (await api.get<Paged<ResRow> & { totals?: typeof totals }>('/stock/reservations', { params: { page: p.page, pageSize: p.pageSize, search: p.search || undefined, status, warehouseId: warehouseId || undefined } })).data;
        setTotals(r.totals ?? {});
        return r;
      }}
      onRowDoubleClick={(r) => open('sales-order-form', { id: r.salesOrderId }, r.salesOrderNo)}
      toolbarExtras={
        <>
          <Select className="w-32" value={status} onChange={(e) => setStatus(e.target.value)} options={[...STATUS_OPTIONS(['ACTIVE', 'FULFILLED', 'RELEASED']), { value: 'ALL', label: 'All' }]} />
          <Select className="w-40" options={warehouses.options} placeholder="All warehouses" value={warehouseId} onChange={(e) => setWh(e.target.value)} />
        </>
      }
    />
  );
}

/* --------------------------- Pending sales orders --------------------------- */
interface SORow {
  id: number; docNo: string; docDate: string; deliveryDate?: string | null; status: string; total: number; customerPoNo?: string | null;
  customer?: { name: string } | null; warehouse?: { name: string } | null; orderedQty: number; deliveredQty: number; invoicedQty: number; deliveredPct: number;
}
const SO_STAGES: Record<string, string> = {
  APPROVED: 'APPROVED,PARTIALLY_DELIVERED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  DELIVERED: 'DELIVERED',
};
function PendingSalesOrdersScreen() {
  const open = useOpenScreen();
  const [stage, setStage] = useState('APPROVED');
  const columns: Column<SORow>[] = [
    { key: 'docNo', header: 'SO No', width: 130 },
    { key: 'docDate', header: 'Date', type: 'date', width: 100, filter: 'date' },
    { key: 'customer.name', header: 'Customer', sortable: false },
    { key: 'customerPoNo', header: 'Customer PO', width: 110, sortable: false },
    { key: 'warehouse.name', header: 'Warehouse', width: 120, sortable: false },
    { key: 'deliveryDate', header: 'Delivery Date', type: 'date', width: 100, sortable: false },
    { key: 'orderedQty', header: 'Ordered', type: 'qty', width: 75, sortable: false, total: 'sum' },
    { key: 'deliveredQty', header: 'Delivered', type: 'qty', width: 75, sortable: false, total: 'sum' },
    { key: 'pendingQty', header: 'Pending', type: 'qty', width: 75, sortable: false, accessor: (r) => Math.max(0, r.orderedQty - r.deliveredQty), total: (rows) => fmt.qty(rows.reduce((s, r) => s + Math.max(0, r.orderedQty - r.deliveredQty), 0)) },
    { key: 'deliveredPct', header: 'Delivered %', type: 'percent', width: 85, sortable: false },
    { key: 'total', header: 'Amount', type: 'money', width: 100, total: 'sum' },
    { key: 'status', header: 'Status', type: 'status', width: 130 },
  ];
  return (
    <DataTable<SORow>
      tableKey="pending-sales-orders"
      url="/sales-orders"
      columns={columns}
      exportName="Pending Sales Orders"
      filters={{ status: SO_STAGES[stage] }}
      defaultSort={{ key: 'docDate', dir: 'asc' }}
      onRowDoubleClick={(r) => open('sales-order-form', { id: r.id }, r.docNo)}
      rowActions={[{ label: 'Open', onClick: (r) => open('sales-order-form', { id: r.id }, r.docNo) }]}
      toolbarExtras={<Select className="w-52" value={stage} onChange={(e) => setStage(e.target.value)} options={[{ value: 'APPROVED', label: 'Approved - to deliver' }, { value: 'PENDING_APPROVAL', label: 'Awaiting approval' }, { value: 'DELIVERED', label: 'Delivered - to invoice' }]} />}
    />
  );
}

/* ----------------------------- Pending deliveries ----------------------------- */
interface DNRow {
  id: number; docNo: string; docDate: string; status: string; invoiced?: boolean; totalQty: number; invoicedQty: number; driver?: string | null; vehicleNo?: string | null;
  customer?: { name: string } | null; warehouse?: { name: string } | null; salesOrder?: { id: number; docNo: string } | null;
}
function PendingDeliveriesScreen() {
  const open = useOpenScreen();
  const [stage, setStage] = useState('DRAFT');
  const columns: Column<DNRow>[] = [
    { key: 'docNo', header: 'DN No', width: 130 },
    { key: 'docDate', header: 'Date', type: 'date', width: 100, filter: 'date' },
    { key: 'salesOrder.docNo', header: 'Sales Order', width: 130, sortable: false, cell: (r) => <DocLink type="SALES_ORDER" id={r.salesOrder?.id} no={r.salesOrder?.docNo} /> },
    { key: 'customer.name', header: 'Customer', sortable: false },
    { key: 'warehouse.name', header: 'Warehouse', width: 120, sortable: false },
    { key: 'driver', header: 'Driver', width: 100, sortable: false, hidden: true },
    { key: 'vehicleNo', header: 'Vehicle', width: 90, sortable: false, hidden: true },
    { key: 'totalQty', header: 'Qty', type: 'qty', width: 80, sortable: false, total: 'sum' },
    { key: 'invoicedQty', header: 'Invoiced', type: 'qty', width: 80, sortable: false },
    { key: 'status', header: 'Status', type: 'status', width: 100 },
  ];
  return (
    <DataTable<DNRow>
      tableKey="pending-deliveries"
      url="/delivery-notes"
      columns={columns}
      exportName="Pending Deliveries"
      filters={stage === 'DRAFT' ? { status: 'DRAFT' } : { status: 'POSTED', invoiced: 'false' }}
      defaultSort={{ key: 'docDate', dir: 'asc' }}
      onRowDoubleClick={(r) => open('delivery-note-form', { id: r.id }, r.docNo)}
      rowActions={[{ label: 'Open', onClick: (r) => open('delivery-note-form', { id: r.id }, r.docNo) }]}
      toolbarExtras={<Select className="w-52" value={stage} onChange={(e) => setStage(e.target.value)} options={[{ value: 'DRAFT', label: 'Draft - to post / dispatch' }, { value: 'POSTED', label: 'Delivered - not invoiced' }]} />}
    />
  );
}

/* ------------------------------- Pending PO ------------------------------- */
interface PORow {
  id: number; docNo: string; docDate: string; status: string; orderType?: string; total: number; currencyCode?: string;
  supplier?: { name: string } | null; warehouse?: { name: string } | null; orderedQty: number; receivedQty: number; pendingQty: number; receivedPct: number;
}
const PO_PENDING_STATUS = 'APPROVED,PARTIALLY_RECEIVED,CONFIRMED,PAYMENT_PENDING,IN_TRANSIT,ARRIVED,CUSTOMS';
function PendingPOScreen() {
  const open = useOpenScreen();
  const [orderType, setType] = useState('ALL');
  const columns: Column<PORow>[] = [
    { key: 'docNo', header: 'PO No', width: 130 },
    { key: 'docDate', header: 'Date', type: 'date', width: 100, filter: 'date' },
    { key: 'orderType', header: 'Type', width: 70, sortable: false },
    { key: 'supplier.name', header: 'Supplier', sortable: false },
    { key: 'warehouse.name', header: 'Warehouse', width: 120, sortable: false },
    { key: 'orderedQty', header: 'Ordered', type: 'qty', width: 80, sortable: false, total: 'sum' },
    { key: 'receivedQty', header: 'Received', type: 'qty', width: 80, sortable: false, total: 'sum' },
    { key: 'pendingQty', header: 'Pending', type: 'qty', width: 80, sortable: false, total: 'sum' },
    { key: 'receivedPct', header: 'Received %', type: 'percent', width: 85, sortable: false },
    { key: 'total', header: 'Amount', type: 'money', width: 100, total: 'sum' },
    { key: 'status', header: 'Status', type: 'status', width: 130 },
  ];
  const openRow = (r: PORow) => open(r.orderType === 'IMPORT' ? 'import-purchase-order-form' : 'purchase-order-form', { id: r.id }, r.docNo);
  return (
    <DataTable<PORow>
      tableKey="pending-po"
      queryKey="pending-po"
      columns={columns}
      exportName="Pending Purchase Orders"
      filters={{ orderType }}
      defaultSort={{ key: 'docDate', dir: 'asc' }}
      fetcher={async (p) => {
        const r = (await api.get<Paged<PORow>>('/purchase-orders', { params: { page: p.page, pageSize: p.pageSize, search: p.search || undefined, sort: p.sort, dir: p.dir, orderType, status: PO_PENDING_STATUS, from: p.from, to: p.to } })).data;
        return r;
      }}
      onRowDoubleClick={openRow}
      rowActions={[{ label: 'Open', onClick: openRow }]}
      toolbarExtras={<Select className="w-36" value={orderType} onChange={(e) => setType(e.target.value)} options={[{ value: 'ALL', label: 'Local + Import' }, { value: 'LOCAL', label: 'Local' }, { value: 'IMPORT', label: 'Import' }]} />}
    />
  );
}

/* ------------------------------- Pending GRN ------------------------------- */
interface GRRow {
  id: number; docNo: string; docDate: string; status: string; grnType?: string; totalQty?: number; invoicedQty?: number; totalValue?: number; pendingQty?: number; pendingValue?: number;
  supplier?: { name: string } | null; warehouse?: { name: string } | null; order?: { id: number; docNo: string } | null; orderId?: number;
}
function PendingGRNScreen() {
  const open = useOpenScreen();
  const [stage, setStage] = useState('DRAFT');
  const columns: Column<GRRow>[] = [
    { key: 'docNo', header: 'GRN No', width: 130 },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'grnType', header: 'Type', width: 80, sortable: false, hidden: true },
    { key: 'supplier.name', header: 'Supplier', sortable: false },
    { key: 'warehouse.name', header: 'Warehouse', width: 120, sortable: false },
    { key: 'order.docNo', header: 'PO No', width: 130, sortable: false, cell: (r) => <DocLink type="PURCHASE_ORDER" id={r.order?.id ?? r.orderId} no={r.order?.docNo} /> },
    stage === 'DRAFT'
      ? { key: 'totalQty', header: 'Qty', type: 'qty', width: 80, sortable: false, total: 'sum' }
      : { key: 'pendingQty', header: 'Uninvoiced Qty', type: 'qty', width: 100, sortable: false, total: 'sum' },
    stage === 'DRAFT'
      ? { key: 'totalValue', header: 'Value', type: 'money', width: 100, sortable: false, total: 'sum' }
      : { key: 'pendingValue', header: 'Uninvoiced Value', type: 'money', width: 110, sortable: false, total: 'sum' },
    { key: 'status', header: 'Status', type: 'status', width: 100, sortable: false, accessor: (r) => r.status ?? 'POSTED' },
  ];
  return (
    <DataTable<GRRow>
      key={stage}
      tableKey={`pending-grn-${stage}`}
      queryKey="pending-grn"
      columns={columns}
      exportName="Pending GRN"
      filters={{ stage }}
      fetcher={async (p) => {
        if (stage === 'DRAFT') return (await api.get<Paged<GRRow>>('/goods-receipts', { params: { page: p.page, pageSize: p.pageSize, search: p.search || undefined, sort: p.sort, dir: p.dir, status: 'DRAFT' } })).data;
        const rows = (await api.get<{ rows: GRRow[] }>('/goods-receipts/pending-invoice')).data.rows.map((r) => ({ ...r, status: 'POSTED' }));
        const s = String(p.search ?? '').toLowerCase();
        const f = s ? rows.filter((r) => r.docNo.toLowerCase().includes(s) || (r.supplier?.name ?? '').toLowerCase().includes(s)) : rows;
        const ps = Number(p.pageSize) || 50;
        const pg = Number(p.page) || 1;
        return { rows: f.slice((pg - 1) * ps, pg * ps), total: f.length, page: pg, pageSize: ps };
      }}
      onRowDoubleClick={(r) => open('goods-receipt-form', { id: r.id }, r.docNo)}
      rowActions={[{ label: 'Open', onClick: (r) => open('goods-receipt-form', { id: r.id }, r.docNo) }]}
      toolbarExtras={<Select className="w-52" value={stage} onChange={(e) => setStage(e.target.value)} options={[{ value: 'DRAFT', label: 'Draft - to post' }, { value: 'POSTED', label: 'Received - not invoiced' }]} />}
    />
  );
}

export default [
  rep('stock-valuation', 'Stock Valuation', BadgeDollarSign),
  rep('warehouse-stock', 'Warehouse Stock', Warehouse),
  rep('low-stock', 'Low Stock', AlertTriangle),
  rep('stock-movement', 'Stock Movement', LineChart),
  rep('stock-aging', 'Stock Aging', Clock),
  rep('dead-stock', 'Dead Stock', TrendingDown),
  { id: 'reservations', title: 'Stock Reservations', icon: Lock, component: ReservationsScreen, permission: 'stock' },
  { id: 'pending-sales-orders', title: 'Pending Sales Orders', icon: ClipboardList, component: PendingSalesOrdersScreen, permission: 'sales_order' },
  { id: 'pending-deliveries', title: 'Pending Deliveries', icon: Truck, component: PendingDeliveriesScreen, permission: 'delivery_note' },
  { id: 'pending-po', title: 'Pending Purchase Orders', icon: ShoppingBag, component: PendingPOScreen, permission: 'purchase_order' },
  { id: 'pending-grn', title: 'Pending GRN', icon: PackageSearch, component: PendingGRNScreen, permission: 'goods_receipt' },
] satisfies ScreenDef[];
