import { ReactNode, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, LayoutDashboard, RefreshCw } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';
import { formScreenOf, normalizeDocType } from '@/lib/docRoutes';
import { useOpenScreen } from '@/store/workspace';
import { Badge, ErrorState, Panel, Skeleton, StatusBadge } from '@/components/ui';
import type { ScreenDef } from '@/screens/types';

/* ---------- response shape (all optional: render defensively) ---------- */
interface Kpi { value?: number; count?: number; amount?: number; overdue?: number; qty?: number }
interface TrendPoint { key?: string; label?: string; total?: number; count?: number }
interface CashPoint { key?: string; label?: string; inflow?: number; outflow?: number; net?: number }
interface Stage { stage?: string; key?: string; route?: string; count?: number; pending?: number }
interface TopProduct { productId?: number; code?: string; name?: string; qty?: number; value?: number }
interface LowProduct { productId?: number; code?: string; name?: string; onHand?: number; threshold?: number; shortage?: number }
interface OutCustomer { customerId?: number; code?: string; name?: string; balance?: number; overdue?: number }
interface OutSupplier { supplierId?: number; code?: string; name?: string; balance?: number }
interface RecentTx { type?: string; label?: string; id?: number; docNo?: string; date?: string; createdAt?: string; party?: string; amount?: number | null; status?: string }
interface Dashboard {
  generatedAt?: string;
  range?: string;
  kpis?: Record<string, Kpi | undefined>;
  charts?: { salesTrend?: TrendPoint[]; purchaseTrend?: TrendPoint[]; cashFlow?: CashPoint[] };
  salesTrend?: TrendPoint[];
  purchaseTrend?: TrendPoint[];
  cashFlow?: CashPoint[];
  topSellingProducts?: TopProduct[];
  lowStockProducts?: LowProduct[];
  outstandingCustomers?: OutCustomer[];
  outstandingSuppliers?: OutSupplier[];
  recentTransactions?: RecentTx[];
  workflows?: { purchase?: Stage[]; sales?: Stage[] };
  [flat: string]: unknown;
}

const PALETTE = { blue: '#1f5fae', light: '#7fa8dc', teal: '#2a9d8f', amber: '#d98a1c', red: '#c0392b', grid: '#e2e8f0' };

const STAGE_SCREEN: Record<string, string> = {
  material_request: 'material-requests',
  purchase_requisition: 'purchase-requisitions',
  purchase_enquiry: 'purchase-enquiries',
  supplier_quotation: 'supplier-quotations',
  purchase_order: 'purchase-orders',
  goods_receipt: 'goods-receipts',
  purchase_invoice: 'purchase-invoices',
  payments: 'bank-payments',
  sales_enquiry: 'sales-enquiries',
  sales_quotation: 'sales-quotations',
  sales_order: 'sales-orders',
  picking: 'pickings',
  delivery_note: 'delivery-notes',
  sales_invoice: 'sales-invoices',
  receipts: 'bank-receipts',
};

const TX_TYPE: Record<string, string> = { RECEIPT: 'RECEIPT_VOUCHER', PAYMENT: 'PAYMENT_VOUCHER' };

interface TileDef { key: string; label: string; screen: string; money?: boolean; sub?: (k: Kpi) => string | null; tone?: 'warn' }

const TILES: TileDef[] = [
  { key: 'todaysSales', label: "Today's Sales", screen: 'sales-invoices', money: true, sub: (k) => (k.count !== undefined ? `${k.count} invoices` : null) },
  { key: 'monthlySales', label: 'Monthly Sales', screen: 'sales-invoices', money: true, sub: (k) => (k.count !== undefined ? `${k.count} invoices` : null) },
  { key: 'todaysPurchase', label: "Today's Purchase", screen: 'purchase-invoices', money: true, sub: (k) => (k.count !== undefined ? `${k.count} invoices` : null) },
  { key: 'monthlyPurchase', label: 'Monthly Purchase', screen: 'purchase-invoices', money: true, sub: (k) => (k.count !== undefined ? `${k.count} invoices` : null) },
  { key: 'receivables', label: 'Receivables', screen: 'ar-aging', money: true, sub: (k) => (k.overdue ? `Overdue ${fmt.money(k.overdue)}` : null) },
  { key: 'payables', label: 'Payables', screen: 'ap-aging', money: true, sub: (k) => (k.overdue ? `Overdue ${fmt.money(k.overdue)}` : null) },
  { key: 'stockValue', label: 'Stock Value', screen: 'stock-valuation', money: true, sub: (k) => (k.qty !== undefined ? `${fmt.qty(k.qty)} units` : null) },
  { key: 'lowStockCount', label: 'Low Stock', screen: 'low-stock', tone: 'warn', sub: () => 'items at/below reorder' },
  { key: 'pendingQuotations', label: 'Pending Quotations', screen: 'sales-quotations', sub: (k) => (k.amount ? fmt.money(k.amount) : null) },
  { key: 'pendingPurchaseOrders', label: 'Pending Purchase Orders', screen: 'purchase-orders', sub: (k) => (k.amount ? fmt.money(k.amount) : null) },
  { key: 'pendingDeliveries', label: 'Pending Deliveries', screen: 'pending-deliveries', sub: (k) => (k.amount ? fmt.money(k.amount) : null) },
  { key: 'pendingPayments', label: 'Pending Payments', screen: 'outstanding-bills', sub: (k) => (k.amount ? fmt.money(k.amount) : null) },
];

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

function kpiOf(d: Dashboard | undefined, key: string): Kpi {
  const k = d?.kpis?.[key];
  if (k && typeof k === 'object') return k;
  const flat = d?.[key];
  return typeof flat === 'number' ? { value: flat } : {};
}

function Tile({ def, kpi, onOpen }: { def: TileDef; kpi: Kpi; onOpen: () => void }) {
  const sub = def.sub?.(kpi);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Open ${def.label}`}
      className="min-w-0 border border-app-border border-l-[3px] border-l-brand bg-white px-2 py-1 text-left hover:bg-brand-light"
    >
      <div className="truncate text-[11px] text-slate-500">{def.label}</div>
      <div className={cn('truncate text-[16px] font-semibold leading-5 tabular-nums', def.tone === 'warn' && num(kpi.value) > 0 ? 'text-amber-700' : 'text-slate-800')}>
        {def.money ? fmt.money(kpi.value ?? 0) : fmt.qty(kpi.value ?? 0)}
      </div>
      <div className="h-[14px] truncate text-[10px] text-slate-400">{sub ?? ''}</div>
    </button>
  );
}

const axisTick = { fontSize: 10, fill: '#64748b' };
const tipStyle = { fontSize: 11, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 2 };
const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v));

function TrendChart({ data, color }: { data: TrendPoint[]; color: string }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={170}>
      <AreaChart data={data} margin={{ top: 4, right: 6, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={PALETTE.grid} vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: PALETTE.grid }} interval="preserveStartEnd" />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={compact} width={42} />
        <Tooltip contentStyle={tipStyle} formatter={(v) => [fmt.money(v), 'Total']} isAnimationActive={false} />
        <Area type="monotone" dataKey="total" stroke={color} fill={color} fillOpacity={0.15} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function CashChart({ data }: { data: CashPoint[] }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={data} margin={{ top: 4, right: 6, left: -8, bottom: 0 }} barGap={1}>
        <CartesianGrid stroke={PALETTE.grid} vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: PALETTE.grid }} interval="preserveStartEnd" />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={compact} width={42} />
        <Tooltip contentStyle={tipStyle} formatter={(v, n) => [fmt.money(v), String(n)]} isAnimationActive={false} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="inflow" name="Inflow" fill={PALETTE.blue} isAnimationActive={false} />
        <Bar dataKey="outflow" name="Outflow" fill={PALETTE.light} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const Empty = ({ text = 'No data' }: { text?: string }) => <div className="p-4 text-center text-[11px] text-slate-400">{text}</div>;

interface Col<T> { header: string; cell: (r: T) => ReactNode; right?: boolean }
function MiniTable<T>({ rows, cols, onRow, empty }: { rows: T[]; cols: Col<T>[]; onRow?: (r: T) => void; empty?: string }) {
  if (!rows.length) return <Empty text={empty} />;
  return (
    <table className="w-full border-separate border-spacing-0 text-[12px]">
      <thead>
        <tr className="h-6">
          {cols.map((c) => (
            <th key={c.header} className={cn('grid-th', c.right && '!text-right')}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={cn('h-6 hover:bg-brand-light/60', onRow && 'cursor-pointer', i % 2 === 1 && 'bg-slate-50')} onClick={() => onRow?.(r)}>
            {cols.map((c) => (
              <td key={c.header} className={cn('grid-td max-w-[220px] truncate whitespace-nowrap', c.right && 'text-right tabular-nums')}>{c.cell(r)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Workflow({ title, stages, onOpen }: { title: string; stages: Stage[]; onOpen: (s: Stage) => void }) {
  return (
    <Panel title={title} bodyClassName="p-2 overflow-x-auto">
      {stages.length === 0 ? (
        <Empty />
      ) : (
        <div className="flex items-stretch gap-0.5">
          {stages.map((s, i) => (
            <div key={`${s.key}-${i}`} className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => onOpen(s)}
                className="relative w-[96px] border border-app-border bg-white px-1.5 py-1 text-left hover:border-brand hover:bg-brand-light"
                title={`Open ${s.stage}`}
              >
                <div className="truncate text-[11px] text-slate-600">{s.stage}</div>
                <div className="text-[15px] font-semibold leading-5 tabular-nums text-brand">{fmt.qty(s.count ?? 0)}</div>
                <div className="h-4">{num(s.pending) > 0 && <Badge tone="amber">{fmt.qty(s.pending)} pending</Badge>}</div>
              </button>
              {i < stages.length - 1 && <ArrowRight size={13} className="shrink-0 text-slate-400" />}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function DashboardScreen() {
  const open = useOpenScreen();
  const [range, setRange] = useState('12m');
  const q = useQuery({
    queryKey: ['dashboard', range],
    refetchInterval: 120000,
    queryFn: async () => (await api.get<Dashboard>('/dashboard', { params: { range } })).data,
  });
  const d = q.data;

  const salesTrend = d?.charts?.salesTrend ?? d?.salesTrend ?? [];
  const purchaseTrend = d?.charts?.purchaseTrend ?? d?.purchaseTrend ?? [];
  const cashFlow = d?.charts?.cashFlow ?? d?.cashFlow ?? [];
  const updated = useMemo(() => (q.dataUpdatedAt ? fmt.dateTime(new Date(q.dataUpdatedAt)) : ''), [q.dataUpdatedAt]);

  const openStage = (s: Stage) => {
    const screen = s.key ? STAGE_SCREEN[s.key] : undefined;
    if (screen) open(screen);
  };
  const openTx = (r: RecentTx) => {
    if (!r.type || r.id === undefined) return;
    const t = normalizeDocType(r.type);
    open(formScreenOf(TX_TYPE[t] ?? t), { id: r.id }, r.docNo);
  };

  return (
    <div className="flex h-full flex-col bg-app-bg">
      <div className="flex shrink-0 items-center gap-2 border-b border-app-border bg-app-head px-2 py-1">
        <LayoutDashboard size={14} className="text-brand" />
        <span className="text-[12px] font-semibold text-slate-700">Dashboard</span>
        <div className="flex-1" />
        {updated && <span className="text-[11px] text-slate-500">Updated {updated}</span>}
        <select className="ctl !w-[110px]" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Trend range">
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="6m">Last 6 months</option>
          <option value="12m">Last 12 months</option>
        </select>
        <button className="tb-btn" onClick={() => q.refetch()} title="Refresh">
          <RefreshCw size={13} className={cn(q.isFetching && 'animate-spin')} /> Refresh
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        {q.isError && <ErrorState message={apiError(q.error)} onRetry={() => q.refetch()} />}

        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {TILES.map((t) =>
            q.isLoading ? (
              <div key={t.key} className="border border-app-border bg-white px-2 py-1">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-1.5 h-4 w-14" />
                <Skeleton className="mt-1.5 h-2 w-24" />
              </div>
            ) : (
              <Tile key={t.key} def={t} kpi={kpiOf(d, t.key)} onOpen={() => open(t.screen)} />
            ),
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
          <Panel title="Sales Trend" bodyClassName="p-1">{q.isLoading ? <Skeleton className="h-[170px]" /> : <TrendChart data={salesTrend} color={PALETTE.blue} />}</Panel>
          <Panel title="Purchase Trend" bodyClassName="p-1">{q.isLoading ? <Skeleton className="h-[170px]" /> : <TrendChart data={purchaseTrend} color={PALETTE.teal} />}</Panel>
          <Panel title="Cash Flow (12 months)" bodyClassName="p-1">{q.isLoading ? <Skeleton className="h-[170px]" /> : <CashChart data={cashFlow} />}</Panel>
        </div>

        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          <Workflow title="Purchase Workflow" stages={d?.workflows?.purchase ?? []} onOpen={openStage} />
          <Workflow title="Sales Workflow" stages={d?.workflows?.sales ?? []} onOpen={openStage} />
        </div>

        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          <Panel title="Top Selling Products" bodyClassName="p-0">
            <MiniTable<TopProduct>
              rows={d?.topSellingProducts ?? []}
              onRow={(r) => r.productId !== undefined && open('product-form', { id: r.productId }, r.code)}
              cols={[
                { header: 'Code', cell: (r) => r.code },
                { header: 'Product', cell: (r) => r.name },
                { header: 'Qty', right: true, cell: (r) => fmt.qty(r.qty) },
                { header: 'Value', right: true, cell: (r) => fmt.money(r.value) },
              ]}
            />
          </Panel>
          <Panel title="Low Stock Products" bodyClassName="p-0">
            <MiniTable<LowProduct>
              rows={d?.lowStockProducts ?? []}
              onRow={(r) => r.productId !== undefined && open('product-form', { id: r.productId }, r.code)}
              cols={[
                { header: 'Code', cell: (r) => r.code },
                { header: 'Product', cell: (r) => r.name },
                { header: 'On Hand', right: true, cell: (r) => fmt.qty(r.onHand) },
                { header: 'Reorder', right: true, cell: (r) => fmt.qty(r.threshold) },
                { header: 'Short', right: true, cell: (r) => <span className="font-semibold text-red-600">{fmt.qty(r.shortage)}</span> },
              ]}
            />
          </Panel>
          <Panel title="Outstanding Customers" bodyClassName="p-0">
            <MiniTable<OutCustomer>
              rows={d?.outstandingCustomers ?? []}
              onRow={(r) => r.customerId !== undefined && open('customer-form', { id: r.customerId }, r.name)}
              cols={[
                { header: 'Code', cell: (r) => r.code },
                { header: 'Customer', cell: (r) => r.name },
                { header: 'Balance', right: true, cell: (r) => fmt.money(r.balance) },
                { header: 'Overdue', right: true, cell: (r) => (num(r.overdue) > 0 ? <span className="text-red-600">{fmt.money(r.overdue)}</span> : '') },
              ]}
            />
          </Panel>
          <Panel title="Outstanding Suppliers" bodyClassName="p-0">
            <MiniTable<OutSupplier>
              rows={d?.outstandingSuppliers ?? []}
              onRow={(r) => r.supplierId !== undefined && open('supplier-form', { id: r.supplierId }, r.name)}
              cols={[
                { header: 'Code', cell: (r) => r.code },
                { header: 'Supplier', cell: (r) => r.name },
                { header: 'Balance', right: true, cell: (r) => fmt.money(r.balance) },
              ]}
            />
          </Panel>
        </div>

        <Panel title="Recent Transactions" bodyClassName="p-0">
          <MiniTable<RecentTx>
            rows={d?.recentTransactions ?? []}
            onRow={openTx}
            cols={[
              { header: 'Type', cell: (r) => r.label ?? fmt.status(r.type) },
              { header: 'Doc No', cell: (r) => <span className="text-brand underline">{r.docNo}</span> },
              { header: 'Date', cell: (r) => fmt.date(r.date) },
              { header: 'Party', cell: (r) => r.party },
              { header: 'Amount', right: true, cell: (r) => (r.amount === null || r.amount === undefined ? '' : fmt.money(r.amount)) },
              { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

export default [{ id: 'dashboard', title: 'Dashboard', icon: LayoutDashboard, component: DashboardScreen }] satisfies ScreenDef[];
