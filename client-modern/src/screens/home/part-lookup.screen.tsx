import { ReactNode, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, PackageSearch, Search, SlidersHorizontal } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';
import { formScreenOf } from '@/lib/docRoutes';
import { useOpenScreen } from '@/store/workspace';
import { Badge, Button, ErrorState, LoadingBlock, Panel, StatusBadge } from '@/components/ui';
import type { ScreenDef, ScreenProps } from '@/screens/types';

interface Party { id: number; code?: string; name?: string }
interface HistRow {
  type?: string;
  docId: number;
  docNo?: string;
  date?: string;
  status?: string;
  supplier?: Party | null;
  customer?: Party | null;
  qty?: number;
  receivedQty?: number;
  rate?: number;
  landedRate?: number;
  amount?: number;
  discount?: number;
}
interface WhStock {
  warehouseId: number;
  warehouse?: { id: number; code?: string; name?: string } | null;
  onHand?: number;
  reserved?: number;
  available?: number;
  avgCost?: number;
  value?: number;
}
interface PartNo { id: number; number: string; kind?: string; brand?: string | null }
interface Vehicle { id: number; make?: string; model?: string; variant?: string | null; yearFrom?: number | null; yearTo?: number | null; engine?: string | null }
interface Product {
  id: number;
  code: string;
  name: string;
  arabicName?: string | null;
  description?: string | null;
  oemNumber?: string | null;
  stockNumber?: string | null;
  barcode?: string | null;
  brand?: { name?: string } | null;
  category?: { name?: string } | null;
  purchaseUnit?: string;
  salesUnit?: string;
  costPrice?: number | string;
  averageCost?: number | string;
  lastPurchasePrice?: number | string;
  retailPrice?: number | string;
  wholesalePrice?: number | string;
  vatRate?: number | string;
  isActive?: boolean;
  rack?: string | null;
  shelf?: string | null;
  bin?: string | null;
  partNumbers?: PartNo[];
  vehicles?: Vehicle[];
}
interface CustTx { customer?: Party | null; qty?: number; amount?: number; invoices?: number; lastDate?: string; lastRate?: number }
interface PartResult {
  query?: string;
  matches?: { id: number; code: string; name: string; oemNumber?: string | null }[];
  product: Product;
  stock?: { onHand?: number; reserved?: number; available?: number; value?: number; warehouses?: WhStock[] };
  purchaseHistory?: { purchaseOrders?: HistRow[]; goodsReceipts?: HistRow[]; purchaseInvoices?: HistRow[]; last?: { docNo?: string; date?: string; supplier?: Party | null; qty?: number; rate?: number } | null };
  salesHistory?: { salesInvoices?: HistRow[]; deliveries?: HistRow[]; quotations?: HistRow[]; last?: { docNo?: string; date?: string; customer?: Party | null; qty?: number; rate?: number } | null };
  primarySupplier?: { id: number; code?: string; name?: string; phone?: string | null; email?: string | null } | null;
  customerTransactions?: CustTx[];
  totals?: { purchasedQty?: number; soldQty?: number };
}

const num = (v: unknown): number => Number(v) || 0;

function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2 py-1 text-[13px]">
      <span className="w-[120px] shrink-0 text-ink-faint">{label}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-ink">{children || <span className="text-ink-faint">-</span>}</span>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'green' }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="text-xs font-medium text-ink-muted">{label}</div>
      <div className={cn('mt-1 text-xl font-semibold tracking-tight tabular-nums', tone === 'red' && 'text-danger', tone === 'green' && 'text-success')}>{value}</div>
    </div>
  );
}

interface Col<T> { header: string; cell: (r: T) => ReactNode; right?: boolean }
function Table<T>({ rows, cols, onRow }: { rows: T[]; cols: Col<T>[]; onRow?: (r: T) => void }) {
  if (!rows.length) return <div className="p-6 text-center text-xs text-ink-faint">No records</div>;
  return (
    <div className="max-h-[240px] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="h-8">
            {cols.map((c) => <th key={c.header} className={cn('grid-th sticky top-0', c.right && '!text-right')}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cn('h-10 transition-colors hover:bg-brand-soft/50', onRow && 'cursor-pointer')} onDoubleClick={() => onRow?.(r)} onClick={() => onRow?.(r)}>
              {cols.map((c) => <td key={c.header} className={cn('grid-td whitespace-nowrap', c.right && 'text-right tabular-nums')}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ advanced search */
interface AdvRow {
  id: number; code: string; stockNumber?: string | null; oemNumber?: string | null; name: string; brand?: { name?: string } | null;
  retailPrice?: number; averageCost?: number; lastPurchasePrice?: number; lastPurchaseAt?: string | null; onHand?: number; available?: number;
}
interface Adv { code: string; stockNumber: string; oem: string; altNo: string; brandIds: number[]; make: string; model: string; year: string }
const ADV0: Adv = { code: '', stockNumber: '', oem: '', altNo: '', brandIds: [], make: '', model: '', year: '' };

/** One box per condition; a product must match every filled box. Results: most recently purchased first. */
function AdvancedSearch({ onPick }: { onPick: (code: string) => void }) {
  const [f, setF] = useState<Adv>(ADV0);
  const [applied, setApplied] = useState<Adv | null>(null);
  const brands = useQuery({ queryKey: ['adv-brands'], staleTime: 300_000, queryFn: async () => (await api.get<{ rows: { id: number; code: string; name: string }[] }>('/brands', { params: { pageSize: 1000 } })).data.rows });
  const filled = (a: Adv) => !!(a.code || a.stockNumber || a.oem || a.altNo || a.brandIds.length || a.make || a.model || a.year);
  const res = useQuery({
    queryKey: ['adv-search', applied],
    enabled: !!applied && filled(applied),
    queryFn: async () => {
      const a = applied!;
      const params = { code: a.code || undefined, stockNumber: a.stockNumber || undefined, oem: a.oem || undefined, altNo: a.altNo || undefined, brandIds: a.brandIds.join(',') || undefined, make: a.make || undefined, model: a.model || undefined, year: a.year || undefined, pageSize: 100 };
      return (await api.get<{ rows: AdvRow[]; total: number }>('/products', { params })).data;
    },
  });
  const set = (k: keyof Adv, v: string) => setF((x) => ({ ...x, [k]: v }));
  const box = (k: Exclude<keyof Adv, 'brandIds'>, label: string, ph?: string, w = 'w-40') => (
    <label className="flex flex-col gap-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
      {label}
      <input className={cn('ctl', w)} placeholder={ph} value={f[k]} onChange={(e) => set(k, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setApplied({ ...f })} />
    </label>
  );
  const brandName = (id: number) => brands.data?.find((b) => b.id === id)?.name ?? `#${id}`;
  return (
    <Panel title="Advanced search" right={<span className="text-xs text-ink-muted">All filled conditions must match</span>}>
      <div className="flex flex-wrap items-end gap-3">
        {box('code', 'Product code')}
        {box('stockNumber', 'Stock No')}
        {box('oem', 'Mfr Part No')}
        {box('altNo', 'Alternative No / brand')}
        <label className="flex flex-col gap-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          Brand (multiple)
          <select className="ctl w-44" value="" onChange={(e) => { const id = Number(e.target.value); if (id && !f.brandIds.includes(id)) setF((x) => ({ ...x, brandIds: [...x.brandIds, id] })); }}>
            <option value="">+ Add brand...</option>
            {(brands.data ?? []).filter((b) => !f.brandIds.includes(b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        {box('make', 'Vehicle make', 'Toyota', 'w-32')}
        {box('model', 'Model', 'Hilux', 'w-32')}
        {box('year', 'Year', '2018', 'w-20')}
        <Button variant="primary" icon={Search} onClick={() => setApplied({ ...f })} disabled={!filled(f)}>Search</Button>
        <Button onClick={() => { setF(ADV0); setApplied(null); }}>Clear</Button>
      </div>
      {f.brandIds.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {f.brandIds.map((id) => (
            <button key={id} className="rounded-full border border-brand/30 bg-brand-soft px-2.5 py-0.5 text-xs text-brand-ink" onClick={() => setF((x) => ({ ...x, brandIds: x.brandIds.filter((b) => b !== id) }))} title="Remove">
              {brandName(id)} ×
            </button>
          ))}
        </div>
      )}
      {applied && filled(applied) && (
        <div className="mt-3 rounded-lg border border-line">
          {res.isLoading ? (
            <LoadingBlock />
          ) : res.isError ? (
            <ErrorState message={apiError(res.error)} onRetry={() => res.refetch()} />
          ) : (
            <>
              <div className="border-b border-line px-3 py-1.5 text-xs text-ink-muted">{res.data?.total ?? 0} products{(res.data?.total ?? 0) > 100 ? ' (first 100 shown)' : ''} · most recently purchased first · click to open</div>
              <Table<AdvRow>
                rows={res.data?.rows ?? []}
                onRow={(r) => onPick(r.code)}
                cols={[
                  { header: 'Code', cell: (r) => <span className="font-medium text-brand">{r.code}</span> },
                  { header: 'Stock No', cell: (r) => r.stockNumber },
                  { header: 'OEM', cell: (r) => r.oemNumber },
                  { header: 'Name', cell: (r) => <span className="inline-block max-w-[280px] truncate align-bottom">{r.name}</span> },
                  { header: 'Brand', cell: (r) => r.brand?.name },
                  { header: 'Retail', right: true, cell: (r) => fmt.money(r.retailPrice) },
                  { header: 'Avg cost', right: true, cell: (r) => fmt.money(r.averageCost) },
                  { header: 'Last pur.', right: true, cell: (r) => fmt.money(r.lastPurchasePrice) },
                  { header: 'Last purchased', cell: (r) => fmt.date(r.lastPurchaseAt) },
                  { header: 'On hand', right: true, cell: (r) => fmt.qty(r.onHand) },
                ]}
              />
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

function PartLookupScreen({ params }: ScreenProps) {
  const open = useOpenScreen();
  const initial = typeof params.number === 'string' ? params.number : params.number !== undefined ? String(params.number) : '';
  const [number, setNumber] = useState(initial);
  const [input, setInput] = useState(initial);
  const [advOpen, setAdvOpen] = useState(false);
  useEffect(() => {
    setNumber(initial);
    setInput(initial);
  }, [initial]);

  const q = useQuery({
    queryKey: ['part-lookup', number],
    enabled: !!number.trim(),
    retry: false,
    queryFn: async () => (await api.get<PartResult>(`/search/part/${encodeURIComponent(number.trim())}`)).data,
  });
  const d = q.data;
  const p = d?.product;

  const search = () => {
    if (input.trim()) setNumber(input.trim());
  };
  const openDoc = (type: string | undefined, id: number, no?: string) => type && open(formScreenOf(type), { id }, no);
  const hist = (title: string, rows: HistRow[] | undefined, party: 'supplier' | 'customer', extra: Col<HistRow>[]) => (
    <Panel title={`${title} (${rows?.length ?? 0})`} bodyClassName="p-0">
      <Table<HistRow>
        rows={rows ?? []}
        onRow={(r) => openDoc(r.type, r.docId, r.docNo)}
        cols={[
          { header: 'Doc No', cell: (r) => <span className="font-medium text-brand hover:underline">{r.docNo}</span> },
          { header: 'Date', cell: (r) => fmt.date(r.date) },
          { header: party === 'supplier' ? 'Supplier' : 'Customer', cell: (r) => (party === 'supplier' ? r.supplier?.name : r.customer?.name) },
          { header: 'Qty', right: true, cell: (r) => fmt.qty(r.qty) },
          ...extra,
          { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
    </Panel>
  );
  const rate: Col<HistRow> = { header: 'Rate', right: true, cell: (r) => fmt.money(r.rate) };
  const amount: Col<HistRow> = { header: 'Amount', right: true, cell: (r) => fmt.money(r.amount) };

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-6 py-3.5">
        <span className="mr-2 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand"><PackageSearch size={20} /></span>
        <span className="mr-3 text-xl font-semibold tracking-tight text-ink">Part Lookup</span>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-[10px] text-ink-faint" />
          <input
            className="ctl w-[280px] pl-9"
            placeholder="Product / manufacturer part / code / barcode"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
        </div>
        <Button variant="primary" onClick={search}>Search</Button>
        <Button icon={SlidersHorizontal} variant={advOpen ? 'primary' : 'default'} onClick={() => setAdvOpen((x) => !x)}>Advanced search</Button>
        {d?.matches && d.matches.length > 1 && (
          <select
            className="ctl !w-[320px]"
            value={p?.code ?? ''}
            onChange={(e) => {
              setNumber(e.target.value);
              setInput(e.target.value);
            }}
            title="Multiple products match"
          >
            {d.matches.map((m) => (
              <option key={m.id} value={m.code}>{m.code} - {m.name}{m.oemNumber ? ` (${m.oemNumber})` : ''}</option>
            ))}
          </select>
        )}
        <div className="flex-1" />
        {p && <Button icon={ExternalLink} onClick={() => open('product-form', { id: p.id }, p.code)}>Open product</Button>}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-6">
        {advOpen && <AdvancedSearch onPick={(code) => { setInput(code); setNumber(code); }} />}
        {!number.trim() && !advOpen && <div className="mx-auto max-w-sm rounded-card border border-dashed border-line-strong bg-surface p-10 text-center text-[13px] text-ink-muted">Enter a part number to look up stock, purchase and sales history.</div>}
        {q.isLoading && number.trim() && <LoadingBlock />}
        {q.isError && <ErrorState message={apiError(q.error)} onRetry={() => q.refetch()} />}

        {p && d && (
          <>
            {d.matches && d.matches.length > 1 && (
              <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
                {d.matches.length} products match "{d.query}". Showing {p.code}; pick another from the selector above.
              </div>
            )}

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              <Panel title="Product" className="xl:col-span-2">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-ink">{p.name}</span>
                  {p.isActive === false && <Badge tone="red">Inactive</Badge>}
                </div>
                <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
                  <div>
                    <KV label="Code">{p.code}</KV>
                    <KV label="Stock No">{p.stockNumber}</KV>
                    <KV label="Mfr Part No">{p.oemNumber}</KV>
                    <KV label="Barcode">{p.barcode}</KV>
                    <KV label="Brand">{p.brand?.name}</KV>
                    <KV label="Category">{p.category?.name}</KV>
                    <KV label="Units">{`${p.purchaseUnit ?? ''} / ${p.salesUnit ?? ''}`}</KV>
                    <KV label="Location">{[p.rack, p.shelf, p.bin].filter(Boolean).join(' / ')}</KV>
                  </div>
                  <div>
                    <KV label="Retail price">{fmt.money(p.retailPrice)}</KV>
                    <KV label="Wholesale price">{fmt.money(p.wholesalePrice)}</KV>
                    <KV label="Cost price">{fmt.money(p.costPrice)}</KV>
                    <KV label="Average cost">{fmt.money(p.averageCost)}</KV>
                    <KV label="Last purchase">{fmt.money(p.lastPurchasePrice)}</KV>
                    <KV label="VAT">{fmt.percent(p.vatRate)}</KV>
                  </div>
                </div>
                {(p.partNumbers?.length ?? 0) > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                    <span className="text-ink-muted">Part numbers:</span>
                    {p.partNumbers?.map((n) => (
                      <button key={n.id} className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 leading-4 transition hover:border-brand/40 hover:bg-brand-soft" title={n.kind} onClick={() => { setInput(n.number); setNumber(n.number); }}>
                        {n.number}
                        {n.brand && <span className="ml-1 text-ink-faint">{n.brand}</span>}
                        {n.kind && n.kind !== 'ALTERNATE' && <span className="ml-1 text-ink-faint">{n.kind.toLowerCase()}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {(p.vehicles?.length ?? 0) > 0 && (
                  <div className="mt-1 text-xs text-ink-muted">
                    <span className="text-ink-muted">Fits: </span>
                    {p.vehicles?.slice(0, 8).map((v) => `${v.make ?? ''} ${v.model ?? ''}${v.yearFrom ? ` ${v.yearFrom}${v.yearTo ? `-${v.yearTo}` : '+'}` : ''}`.trim()).join('; ')}
                    {(p.vehicles?.length ?? 0) > 8 && ` (+${(p.vehicles?.length ?? 0) - 8} more)`}
                  </div>
                )}
              </Panel>

              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="On hand" value={fmt.qty(d.stock?.onHand ?? 0)} />
                  <Stat label="Reserved" value={fmt.qty(d.stock?.reserved ?? 0)} />
                  <Stat label="Available" value={fmt.qty(d.stock?.available ?? 0)} tone={num(d.stock?.available) <= 0 ? 'red' : 'green'} />
                  <Stat label="Stock value" value={fmt.money(d.stock?.value ?? 0)} />
                </div>
                <Panel title="Primary Supplier">
                  {d.primarySupplier ? (
                    <>
                      <KV label="Name">
                        <button className="font-medium text-brand hover:underline" onClick={() => open('supplier-form', { id: d.primarySupplier!.id }, d.primarySupplier!.name)}>{d.primarySupplier.name}</button>
                      </KV>
                      <KV label="Code">{d.primarySupplier.code}</KV>
                      <KV label="Phone">{d.primarySupplier.phone}</KV>
                      <KV label="Email">{d.primarySupplier.email}</KV>
                      {d.purchaseHistory?.last && <KV label="Last purchase">{`${fmt.date(d.purchaseHistory.last.date)} @ ${fmt.money(d.purchaseHistory.last.rate)}`}</KV>}
                    </>
                  ) : (
                    <div className="text-xs text-ink-faint">No supplier on record</div>
                  )}
                </Panel>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Purchased qty" value={fmt.qty(d.totals?.purchasedQty ?? 0)} />
              <Stat label="Sold qty" value={fmt.qty(d.totals?.soldQty ?? 0)} />
              <Stat label="Last purchase rate" value={d.purchaseHistory?.last ? fmt.money(d.purchaseHistory.last.rate) : '-'} />
              <Stat label="Last sale rate" value={d.salesHistory?.last ? fmt.money(d.salesHistory.last.rate) : '-'} />
            </div>

            <Panel title="Stock by Warehouse" bodyClassName="p-0">
              <Table<WhStock>
                rows={d.stock?.warehouses ?? []}
                cols={[
                  { header: 'Warehouse', cell: (r) => `${r.warehouse?.code ?? ''} ${r.warehouse?.name ?? ''}`.trim() },
                  { header: 'On Hand', right: true, cell: (r) => fmt.qty(r.onHand) },
                  { header: 'Reserved', right: true, cell: (r) => fmt.qty(r.reserved) },
                  { header: 'Available', right: true, cell: (r) => fmt.qty(r.available) },
                  { header: 'Avg Cost', right: true, cell: (r) => fmt.money(r.avgCost) },
                  { header: 'Value', right: true, cell: (r) => fmt.money(r.value) },
                ]}
              />
            </Panel>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              {hist('Purchase Orders', d.purchaseHistory?.purchaseOrders, 'supplier', [rate, { header: 'Received', right: true, cell: (r) => fmt.qty(r.receivedQty) }, amount])}
              {hist('Goods Receipts', d.purchaseHistory?.goodsReceipts, 'supplier', [rate, { header: 'Landed', right: true, cell: (r) => fmt.money(r.landedRate) }])}
              {hist('Purchase Invoices', d.purchaseHistory?.purchaseInvoices, 'supplier', [rate, amount])}
              {hist('Sales Invoices', d.salesHistory?.salesInvoices, 'customer', [rate, amount])}
              {hist('Delivery Notes', d.salesHistory?.deliveries, 'customer', [])}
              {hist('Quotations', d.salesHistory?.quotations, 'customer', [rate, amount])}
            </div>

            <Panel title={`Customer Transactions (${d.customerTransactions?.length ?? 0})`} bodyClassName="p-0">
              <Table<CustTx>
                rows={d.customerTransactions ?? []}
                onRow={(r) => r.customer && open('customer-form', { id: r.customer.id }, r.customer.name)}
                cols={[
                  { header: 'Customer', cell: (r) => <span className="font-medium text-brand hover:underline">{r.customer?.name}</span> },
                  { header: 'Invoices', right: true, cell: (r) => fmt.qty(r.invoices) },
                  { header: 'Qty', right: true, cell: (r) => fmt.qty(r.qty) },
                  { header: 'Amount', right: true, cell: (r) => fmt.money(r.amount) },
                  { header: 'Last Date', cell: (r) => fmt.date(r.lastDate) },
                  { header: 'Last Rate', right: true, cell: (r) => fmt.money(r.lastRate) },
                ]}
              />
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

export default [{ id: 'part-lookup', title: 'Part Lookup', icon: PackageSearch, component: PartLookupScreen, permission: 'products' }] satisfies ScreenDef[];
