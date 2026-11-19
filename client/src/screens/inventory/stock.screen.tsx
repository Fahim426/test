import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookText, Boxes, Download, Printer, RefreshCw } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column, DataTable } from '@/components/DataTable';
import { ProductPicker } from '@/components/doc';
import { Button, Checkbox, DateInput, ErrorState, Field, LoadingBlock, Select, Toolbar } from '@/components/ui';
import { api, apiError, Paged } from '@/lib/api';
import { downloadExport, printRows } from '@/lib/export';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useOpenScreen } from '@/store/workspace';
import { DocLink, STATUS_OPTIONS, useOptions } from '@/components/inventory/common';

/* ------------------------------- STOCK BALANCES ------------------------------- */
interface BalRow {
  id?: number;
  productId: number;
  warehouseId?: number;
  warehouse?: { code?: string; name: string } | null;
  product: { id: number; code: string; name: string; oemNumber?: string | null; brand?: { name: string } | null; category?: { name: string } | null };
  onHand: number;
  reserved: number;
  available: number;
  avgCost: number;
  value: number;
  lowStock: boolean;
  warehouses?: number;
}
interface BalTotals { onHand?: number; reserved?: number; value?: number }

function StockBalancesScreen() {
  const open = useOpenScreen();
  const warehouses = useOptions('/warehouses');
  const brands = useOptions('/brands');
  const cats = useOptions('/categories');
  const [mode, setMode] = useState<'warehouse' | 'summary'>('warehouse');
  const [warehouseId, setWh] = useState('');
  const [brandId, setBrand] = useState('');
  const [categoryId, setCat] = useState('');
  const [lowStockOnly, setLow] = useState(false);
  const [includeZero, setZero] = useState(false);
  const [totals, setTotals] = useState<BalTotals>({});

  const base: Column<BalRow>[] = [
    { key: 'product.code', header: 'Code', width: 110, sortable: false },
    { key: 'product.oemNumber', header: 'Mfr Part No', width: 130, sortable: false },
    { key: 'product.name', header: 'Description', sortable: false },
    { key: 'product.brand.name', header: 'Brand', width: 100, sortable: false },
    { key: 'product.category.name', header: 'Category', width: 110, sortable: false, hidden: true },
  ];
  const nums: Column<BalRow>[] = [
    { key: 'onHand', header: 'On Hand', type: 'qty', width: 85, sortable: false, cell: (r) => <span className={cn(r.lowStock && 'font-semibold text-red-600')}>{fmt.qty(r.onHand)}</span>, total: () => fmt.qty(totals.onHand) },
    { key: 'reserved', header: 'Reserved', type: 'qty', width: 85, sortable: false, total: () => fmt.qty(totals.reserved) },
    { key: 'available', header: 'Available', type: 'qty', width: 85, sortable: false, cell: (r) => <span className={cn(r.available <= 0 && 'text-red-600')}>{fmt.qty(r.available)}</span> },
    { key: 'avgCost', header: 'Avg Cost', type: 'money', width: 90, sortable: false },
    { key: 'value', header: 'Value', type: 'money', width: 100, sortable: false, total: () => fmt.money(totals.value) },
    { key: 'lowStock', header: 'Low', width: 50, sortable: false, align: 'center', cell: (r) => (r.lowStock ? <span className="font-bold text-red-600">!</span> : null), exportValue: (r) => (r.lowStock ? 'Low' : '') },
  ];
  const columns: Column<BalRow>[] =
    mode === 'warehouse'
      ? [...base.slice(0, 3), { key: 'warehouse.name', header: 'Warehouse', width: 140, sortable: false }, base[3], base[4], ...nums]
      : [...base, { key: 'warehouses', header: 'Whs', type: 'number', width: 50, sortable: false }, ...nums];

  return (
    <DataTable<BalRow>
      key={mode}
      tableKey={`stock-balances-${mode}`}
      queryKey="stock-balances"
      columns={columns}
      exportName="Stock Balances"
      zebra
      filters={{ mode, warehouseId, brandId, categoryId, lowStockOnly: lowStockOnly ? '1' : '', includeZero: includeZero ? '1' : '' }}
      searchPlaceholder="Search code / OEM / alternate / barcode / name..."
      getRowId={(r) => `${r.productId}:${r.warehouseId ?? 'all'}`}
      fetcher={async (p) => {
        const params: Record<string, unknown> = { page: p.page, pageSize: p.pageSize, search: p.search || undefined, warehouseId: warehouseId || undefined, brandId: brandId || undefined, categoryId: categoryId || undefined, lowStockOnly: lowStockOnly ? '1' : undefined, includeZero: includeZero ? '1' : undefined };
        const r = (await api.get<Paged<BalRow> & { totals?: BalTotals }>(mode === 'summary' ? '/stock/summary' : '/stock/balances', { params })).data;
        // balances endpoint has no totals: compute for the loaded page
        setTotals(r.totals ?? { onHand: r.rows.reduce((s, x) => s + x.onHand, 0), reserved: r.rows.reduce((s, x) => s + x.reserved, 0), value: r.rows.reduce((s, x) => s + x.value, 0) });
        return r;
      }}
      onRowDoubleClick={(r) => open('stock-ledger', { productId: r.productId, warehouseId: r.warehouseId, productLabel: `${r.product.code} - ${r.product.name}` })}
      rowActions={[
        { label: 'Stock Ledger', onClick: (r) => open('stock-ledger', { productId: r.productId, warehouseId: r.warehouseId, productLabel: `${r.product.code} - ${r.product.name}` }) },
        { label: 'Open Product', onClick: (r) => open('product-form', { id: r.productId }, r.product.code) },
      ]}
      toolbarExtras={
        <>
          <Select className="w-36" value={mode} onChange={(e) => setMode(e.target.value as 'warehouse' | 'summary')} options={[{ value: 'warehouse', label: 'Product x Warehouse' }, { value: 'summary', label: 'Product Summary' }]} />
          <Select className="w-36" options={warehouses.options} placeholder="All warehouses" value={warehouseId} onChange={(e) => setWh(e.target.value)} disabled={mode === 'summary'} />
          <Select className="w-32" options={brands.options} placeholder="All brands" value={brandId} onChange={(e) => setBrand(e.target.value)} />
          <Select className="w-36" options={cats.options} placeholder="All categories" value={categoryId} onChange={(e) => setCat(e.target.value)} />
          <Checkbox label="Low stock only" checked={lowStockOnly} onChange={(e) => setLow(e.target.checked)} />
          <Checkbox label="Include zero" checked={includeZero} onChange={(e) => setZero(e.target.checked)} />
        </>
      }
    />
  );
}

/* -------------------------------- STOCK LEDGER -------------------------------- */
interface LedgerEntry {
  id: number; date: string; txType: string; warehouseId: number; warehouse?: { name: string } | null;
  qty: number; inQty: number; outQty: number; unitCost: number; value: number; runningQty: number; runningValue: number;
  refType?: string | null; refId?: number | null; refNo?: string | null; remarks?: string | null;
}
interface Ledger {
  product: { id: number; code: string; name: string; oemNumber?: string | null; purchaseUnit?: string } | null;
  openingQty: number; openingValue: number; totalIn: number; totalOut: number; closingQty: number; closingValue: number; entries: LedgerEntry[];
}
const TX_TYPES = ['OPENING', 'PURCHASE', 'GRN', 'SALE', 'DELIVERY', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'COUNT', 'DAMAGE', 'SCRAP', 'SALES_RETURN', 'PURCHASE_RETURN', 'WAREHOUSE_RECEIPT'];

function StockLedgerScreen({ params }: ScreenProps) {
  const warehouses = useOptions('/warehouses');
  const [productId, setProductId] = useState<number | undefined>(params.productId ? Number(params.productId) : undefined);
  const [label, setLabel] = useState<string>(typeof params.productLabel === 'string' ? params.productLabel : '');
  const [warehouseId, setWh] = useState(params.warehouseId ? String(params.warehouseId) : '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('');

  useEffect(() => {
    if (params.productId) {
      setProductId(Number(params.productId));
      if (typeof params.productLabel === 'string') setLabel(params.productLabel);
      setWh(params.warehouseId ? String(params.warehouseId) : '');
    }
  }, [params.productId, params.warehouseId, params.productLabel]);

  const q = useQuery({
    queryKey: ['stock-ledger', productId, warehouseId, from, to, type],
    enabled: !!productId,
    queryFn: async () =>
      (await api.get<Ledger>('/stock/ledger', { params: { productId, warehouseId: warehouseId || undefined, from: from || undefined, to: to || undefined, type: type || undefined } })).data,
  });
  const L = q.data;

  const exportCols = [
    { key: 'date', header: 'Date' }, { key: 'txType', header: 'Type' }, { key: 'warehouse', header: 'Warehouse' }, { key: 'ref', header: 'Reference' },
    { key: 'inQty', header: 'In', align: 'right' as const }, { key: 'outQty', header: 'Out', align: 'right' as const }, { key: 'runningQty', header: 'Balance', align: 'right' as const },
    { key: 'unitCost', header: 'Unit Cost', align: 'right' as const }, { key: 'value', header: 'Value', align: 'right' as const }, { key: 'runningValue', header: 'Running Value', align: 'right' as const },
  ];
  const exportRows = () => [
    { date: 'Opening', txType: '', warehouse: '', ref: '', inQty: '', outQty: '', runningQty: L?.openingQty, unitCost: '', value: '', runningValue: L?.openingValue },
    ...(L?.entries ?? []).map((e) => ({ date: fmt.date(e.date), txType: fmt.status(e.txType), warehouse: e.warehouse?.name ?? '', ref: e.refNo ?? '', inQty: e.inQty || '', outQty: e.outQty || '', runningQty: e.runningQty, unitCost: e.unitCost, value: e.value, runningValue: e.runningValue })),
  ];
  const title = `Stock Ledger - ${L?.product?.code ?? ''}`;
  const th = 'grid-th px-2 whitespace-nowrap';
  const tdn = 'grid-td px-2 text-right tabular-nums';

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <Toolbar className="items-end">
        <Field label="Product" className="w-72">
          <div className="border border-app-border bg-white">
            <ProductPicker text={label} onPick={(p) => { setProductId(p.id); setLabel(`${p.code} - ${p.name}`); }} onClear={() => { setProductId(undefined); setLabel(''); }} />
          </div>
        </Field>
        <Field label="Warehouse"><Select className="w-40" options={warehouses.options} placeholder="All warehouses" value={warehouseId} onChange={(e) => setWh(e.target.value)} /></Field>
        <Field label="From"><DateInput value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><DateInput value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Type"><Select className="w-32" options={STATUS_OPTIONS(TX_TYPES)} placeholder="All" value={type} onChange={(e) => setType(e.target.value)} /></Field>
        <Button icon={RefreshCw} onClick={() => q.refetch()} disabled={!productId}>Refresh</Button>
        <Button icon={Download} disabled={!L} onClick={() => downloadExport({ title, columns: exportCols, rows: exportRows(), format: 'xlsx' })}>Excel</Button>
        <Button icon={Printer} disabled={!L} onClick={() => printRows(title, exportCols, exportRows())}>Print</Button>
      </Toolbar>
      {!productId && <div className="p-8 text-center text-[12px] text-slate-400">Pick a product to view its stock ledger.</div>}
      {productId && q.isLoading && <LoadingBlock />}
      {q.error && <ErrorState message={apiError(q.error)} onRetry={() => q.refetch()} />}
      {L && (
        <>
          <div className="flex shrink-0 flex-wrap gap-x-6 gap-y-1 border-b border-app-border bg-app-head px-3 py-1 text-[12px]">
            <span className="font-semibold text-brand">{L.product?.code} - {L.product?.name}</span>
            <span>OEM: {L.product?.oemNumber ?? '-'}</span>
            <span>Opening: <b>{fmt.qty(L.openingQty)}</b> ({fmt.money(L.openingValue)})</span>
            <span>In: <b className="text-green-700">{fmt.qty(L.totalIn)}</b></span>
            <span>Out: <b className="text-red-600">{fmt.qty(L.totalOut)}</b></span>
            <span>Closing: <b>{fmt.qty(L.closingQty)}</b> ({fmt.money(L.closingValue)})</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-app-head">
                <tr>
                  <th className={`${th} text-left`}>Date</th><th className={`${th} text-left`}>Type</th><th className={`${th} text-left`}>Warehouse</th><th className={`${th} text-left`}>Reference</th>
                  <th className={`${th} text-right`}>In</th><th className={`${th} text-right`}>Out</th><th className={`${th} text-right`}>Balance</th>
                  <th className={`${th} text-right`}>Unit Cost</th><th className={`${th} text-right`}>Value</th><th className={`${th} text-right`}>Running Value</th><th className={`${th} text-left`}>Remarks</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-slate-50 font-semibold">
                  <td className="grid-td px-2" colSpan={6}>Opening balance</td>
                  <td className={tdn}>{fmt.qty(L.openingQty)}</td><td className="grid-td" /><td className="grid-td" /><td className={tdn}>{fmt.money(L.openingValue)}</td><td className="grid-td" />
                </tr>
                {L.entries.length === 0 && <tr><td colSpan={11} className="p-6 text-center text-slate-400">No movements in the selected period</td></tr>}
                {L.entries.map((e) => (
                  <tr key={e.id} className="hover:bg-brand-light">
                    <td className="grid-td px-2 whitespace-nowrap">{fmt.date(e.date)}</td>
                    <td className="grid-td px-2">{fmt.status(e.txType)}</td>
                    <td className="grid-td px-2">{e.warehouse?.name ?? e.warehouseId}</td>
                    <td className="grid-td px-2"><DocLink type={e.refType} id={e.refId} no={e.refNo} /></td>
                    <td className={cn(tdn, 'text-green-700')}>{e.inQty ? '+' + fmt.qty(e.inQty) : ''}</td>
                    <td className={cn(tdn, 'text-red-600')}>{e.outQty ? '-' + fmt.qty(e.outQty) : ''}</td>
                    <td className={cn(tdn, 'font-medium', e.runningQty < 0 && 'text-red-600')}>{fmt.qty(e.runningQty)}</td>
                    <td className={tdn}>{fmt.money(e.unitCost)}</td>
                    <td className={tdn}>{fmt.money(e.value)}</td>
                    <td className={tdn}>{fmt.money(e.runningValue)}</td>
                    <td className="grid-td px-2 text-slate-500">{e.remarks}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-app-head font-semibold">
                <tr><td className="grid-td px-2" colSpan={4}>Closing</td><td className={tdn}>{fmt.qty(L.totalIn)}</td><td className={tdn}>{fmt.qty(L.totalOut)}</td><td className={tdn}>{fmt.qty(L.closingQty)}</td><td className="grid-td" /><td className="grid-td" /><td className={tdn}>{fmt.money(L.closingValue)}</td><td className="grid-td" /></tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default [
  { id: 'stock-balances', title: 'Stock Balances', icon: Boxes, component: StockBalancesScreen, permission: 'stock' },
  { id: 'stock-ledger', title: 'Stock Ledger', icon: BookText, component: StockLedgerScreen, permission: 'stock' },
] satisfies ScreenDef[];
