import { useFeatures } from '@/hooks/useFeatures';
import { ReactNode, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Banknote, Boxes, CalendarDays, Clock, FileCheck, FilePlus2, FileText, HandCoins, LayoutDashboard, PackageSearch,
  Receipt, RefreshCw, ScanSearch, ShoppingBag, ShoppingCart, Truck, TrendingUp, Wallet, type LucideIcon,
} from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';
import { formScreenOf, normalizeDocType } from '@/lib/docRoutes';
import { useOpenScreen } from '@/store/workspace';
import { useAuth, usePermission } from '@/store/auth';
import { PriceCheck } from '@/components/PriceCheck';
import { useChartTheme } from '@/hooks/useChartTheme';
import { Badge, Button, ErrorState, Skeleton, StatusBadge } from '@/components/ui';
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
  proforma_invoice: 'proforma-invoices',
  sales_order: 'proforma-invoices',
  delivery_note: 'delivery-notes',
  sales_invoice: 'sales-invoices',
  receipts: 'bank-receipts',
};

const TX_TYPE: Record<string, string> = { RECEIPT: 'RECEIPT_VOUCHER', PAYMENT: 'PAYMENT_VOUCHER' };

type Hue = 'brand' | 'success' | 'warning' | 'danger' | 'info';
const hue: Record<Hue, string> = {
  brand: 'bg-brand-soft text-brand',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

interface TileDef { key: string; label: string; screen: string; icon: LucideIcon; hue: Hue; money?: boolean; spark?: 'sales' | 'purchase'; sub?: (k: Kpi) => string | null; tone?: 'warn' }

const TILES: TileDef[] = [
  { key: 'todaysSales', label: "Today's Sales", screen: 'sales-invoices', icon: ShoppingCart, hue: 'brand', money: true, sub: (k) => (k.count !== undefined ? `${k.count} invoices` : null) },
  { key: 'monthlySales', label: 'Monthly Sales', screen: 'sales-invoices', icon: TrendingUp, hue: 'brand', money: true, spark: 'sales', sub: (k) => (k.count !== undefined ? `${k.count} invoices` : null) },
  { key: 'todaysPurchase', label: "Today's Purchase", screen: 'purchase-invoices', icon: ShoppingBag, hue: 'info', money: true, sub: (k) => (k.count !== undefined ? `${k.count} invoices` : null) },
  { key: 'monthlyPurchase', label: 'Monthly Purchase', screen: 'purchase-invoices', icon: Truck, hue: 'info', money: true, spark: 'purchase', sub: (k) => (k.count !== undefined ? `${k.count} invoices` : null) },
  { key: 'receivables', label: 'Receivables', screen: 'ar-aging', icon: HandCoins, hue: 'success', money: true, sub: (k) => (k.overdue ? `Overdue ${fmt.money(k.overdue)}` : null) },
  { key: 'payables', label: 'Payables', screen: 'ap-aging', icon: Wallet, hue: 'warning', money: true, sub: (k) => (k.overdue ? `Overdue ${fmt.money(k.overdue)}` : null) },
  { key: 'stockValue', label: 'Stock Value', screen: 'stock-valuation', icon: Boxes, hue: 'brand', money: true, sub: (k) => (k.qty !== undefined ? `${fmt.qty(k.qty)} units` : null) },
  { key: 'lowStockCount', label: 'Low Stock', screen: 'low-stock', icon: AlertTriangle, hue: 'danger', tone: 'warn', sub: () => 'items at/below reorder' },
  { key: 'pendingQuotations', label: 'Pending Quotations', screen: 'sales-quotations', icon: FileText, hue: 'info', sub: (k) => (k.amount ? fmt.money(k.amount) : null) },
  { key: 'pendingPurchaseOrders', label: 'Pending Purchase Orders', screen: 'purchase-orders', icon: PackageSearch, hue: 'warning', sub: (k) => (k.amount ? fmt.money(k.amount) : null) },
  { key: 'pendingDeliveries', label: 'Pending Deliveries', screen: 'pending-deliveries', icon: Truck, hue: 'warning', sub: (k) => (k.amount ? fmt.money(k.amount) : null) },
  { key: 'pendingPayments', label: 'Pending Payments', screen: 'outstanding-bills', icon: Banknote, hue: 'danger', sub: (k) => (k.amount ? fmt.money(k.amount) : null) },
];

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

function kpiOf(d: Dashboard | undefined, key: string): Kpi {
  const k = d?.kpis?.[key];
  if (k && typeof k === 'object') return k;
  const flat = d?.[key];
  return typeof flat === 'number' ? { value: flat } : {};
}

const initials = (n?: string) =>
  (n ?? '?')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
const AV = ['bg-indigo-500', 'bg-violet-500', 'bg-sky-500', 'bg-teal-500', 'bg-amber-500', 'bg-rose-500', 'bg-emerald-500'];
function Avatar({ name }: { name?: string }) {
  const h = [...(name ?? '?')].reduce((a, c) => a + c.charCodeAt(0), 0);
  return <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white', AV[h % AV.length])}>{initials(name)}</span>;
}

function Spark({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const w = 72, h = 28, r = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 3 - ((v - min) / r) * (h - 6)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden>
      <defs>
        <linearGradient id={`sp${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#sp${color.slice(1)})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Tile({ def, kpi, onOpen, spark, sparkColor }: { def: TileDef; kpi: Kpi; onOpen: () => void; spark?: number[]; sparkColor: string }) {
  const sub = def.sub?.(kpi);
  const Icon = def.icon;
  const warn = def.tone === 'warn' && num(kpi.value) > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Open ${def.label}`}
      className="group min-w-0 rounded-card border border-line bg-surface p-4 text-left shadow-card transition duration-150 hover:-translate-y-px hover:border-brand/40 hover:shadow-pop"
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', hue[def.hue])}>
          <Icon size={18} />
        </span>
        {spark && spark.length > 1 ? <Spark data={spark} color={sparkColor} /> : <ArrowUpRight size={15} className="text-ink-faint opacity-0 transition group-hover:opacity-100" />}
      </div>
      <div className="mt-3 truncate text-xs font-medium text-ink-muted">{def.label}</div>
      <div className={cn('mt-0.5 truncate text-[22px] font-semibold leading-7 tracking-tight tabular-nums', warn ? 'text-warning' : 'text-ink')}>
        {def.money ? fmt.money(kpi.value ?? 0) : fmt.qty(kpi.value ?? 0)}
      </div>
      <div className="mt-0.5 h-4 truncate text-xs text-ink-faint">{sub ?? ''}</div>
    </button>
  );
}

const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v));

function Card({ title, subtitle, right, children, className, bodyClassName }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded-card border border-line bg-surface shadow-card', className)}>
      <header className="flex items-start justify-between gap-3 px-5 pb-1 pt-4">
        <div>
          <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>}
        </div>
        {right}
      </header>
      <div className={cn('min-h-0 flex-1', bodyClassName ?? 'p-5 pt-3')}>{children}</div>
    </section>
  );
}

const Empty = ({ text = 'No data' }: { text?: string }) => <div className="p-6 text-center text-xs text-ink-faint">{text}</div>;

function SalesPurchaseChart({ sales, purchase }: { sales: TrendPoint[]; purchase: TrendPoint[] }) {
  const c = useChartTheme();
  const data = useMemo(() => {
    const map = new Map<string, { label: string; sales: number; purchase: number }>();
    for (const p of sales) map.set(p.key ?? p.label ?? '', { label: p.label ?? p.key ?? '', sales: num(p.total), purchase: 0 });
    for (const p of purchase) {
      const k = p.key ?? p.label ?? '';
      const e = map.get(k) ?? { label: p.label ?? k, sales: 0, purchase: 0 };
      e.purchase = num(p.total);
      map.set(k, e);
    }
    return [...map.values()];
  }, [sales, purchase]);
  if (!data.length) return <Empty />;
  const tick = { fontSize: 11, fill: c.axis };
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
        <defs>
          <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={c.brand} stopOpacity={0.35} />
            <stop offset="1" stopColor={c.brand} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gPurch" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={c.teal} stopOpacity={0.3} />
            <stop offset="1" stopColor={c.teal} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={c.grid} strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} interval="preserveStartEnd" dy={6} />
        <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={compact} width={44} />
        <Tooltip
          contentStyle={{ fontSize: 12, padding: '8px 10px', background: c.tipBg, border: `1px solid ${c.tipBorder}`, borderRadius: 10, color: c.tipText, boxShadow: '0 8px 24px rgb(0 0 0 / .12)' }}
          labelStyle={{ color: c.tipText, fontWeight: 600, marginBottom: 4 }}
          formatter={(v, n) => [fmt.money(v), String(n)]}
          cursor={{ stroke: c.grid }}
          isAnimationActive={false}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Area type="monotone" dataKey="sales" name="Sales" stroke={c.brand} strokeWidth={2.2} fill="url(#gSales)" dot={false} activeDot={{ r: 4 }} />
        <Area type="monotone" dataKey="purchase" name="Purchase" stroke={c.teal} strokeWidth={2.2} fill="url(#gPurch)" dot={false} activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function CashChart({ data }: { data: CashPoint[] }) {
  const c = useChartTheme();
  if (!data.length) return <Empty />;
  const tick = { fontSize: 11, fill: c.axis };
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barGap={2} barCategoryGap="28%">
        <CartesianGrid stroke={c.grid} strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} interval="preserveStartEnd" dy={6} />
        <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={compact} width={42} />
        <Tooltip
          contentStyle={{ fontSize: 12, padding: '8px 10px', background: c.tipBg, border: `1px solid ${c.tipBorder}`, borderRadius: 10, color: c.tipText }}
          labelStyle={{ color: c.tipText, fontWeight: 600 }}
          formatter={(v, n) => [fmt.money(v), String(n)]}
          cursor={{ fill: c.grid, opacity: 0.5 }}
          isAnimationActive={false}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Bar dataKey="inflow" name="Inflow" fill={c.brand} radius={[5, 5, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="outflow" name="Outflow" fill={c.accent} fillOpacity={0.45} radius={[5, 5, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

interface Col<T> { header: string; cell: (r: T) => ReactNode; right?: boolean }
function MiniTable<T>({ rows, cols, onRow, empty }: { rows: T[]; cols: Col<T>[]; onRow?: (r: T) => void; empty?: string }) {
  if (!rows.length) return <Empty text={empty ?? 'Nothing to show'} />;
  return (
    <table className="w-full border-separate border-spacing-0 text-[13px]">
      <thead>
        <tr className="h-9">
          {cols.map((c, i) => (
            <th key={c.header} className={cn('grid-th', i === 0 && '!pl-5', i === cols.length - 1 && '!pr-5', c.right && '!text-right')}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={cn('h-11 transition-colors hover:bg-brand-soft/50', onRow && 'cursor-pointer')} onClick={() => onRow?.(r)}>
            {cols.map((c, ci) => (
              <td key={c.header} className={cn('grid-td max-w-[240px] truncate whitespace-nowrap', ci === 0 && '!pl-5', ci === cols.length - 1 && '!pr-5', c.right && 'text-right tabular-nums')}>{c.cell(r)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Workflow({ title, stages, onOpen }: { title: string; stages: Stage[]; onOpen: (s: Stage) => void }) {
  return (
    <Card title={title} bodyClassName="p-5 pt-3 overflow-x-auto">
      {stages.length === 0 ? (
        <Empty />
      ) : (
        <div className="flex items-stretch">
          {stages.map((s, i) => (
            <div key={`${s.key}-${i}`} className="flex items-center">
              <button
                type="button"
                onClick={() => onOpen(s)}
                className="group w-[112px] rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-left transition duration-150 hover:border-brand/50 hover:bg-brand-soft"
                title={`Open ${s.stage}`}
              >
                <div className="truncate text-[11px] font-medium text-ink-muted">{s.stage}</div>
                <div className="text-xl font-semibold leading-7 tabular-nums text-ink group-hover:text-brand">{fmt.qty(s.count ?? 0)}</div>
                <div className="h-5">{num(s.pending) > 0 && <Badge tone="amber">{fmt.qty(s.pending)} pending</Badge>}</div>
              </button>
              {i < stages.length - 1 && (
                <span className="flex w-6 shrink-0 items-center justify-center text-ink-faint">
                  <ArrowRight size={14} />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const TX_ICON: Record<string, LucideIcon> = { SALES_INVOICE: Receipt, PURCHASE_INVOICE: ShoppingBag, RECEIPT: HandCoins, PAYMENT: Banknote, SALES_ORDER: ShoppingCart, PROFORMA_INVOICE: FileCheck, PURCHASE_ORDER: PackageSearch };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function DashboardScreen() {
  const features = useFeatures();
  const open = useOpenScreen();
  const can = usePermission();
  const user = useAuth((s) => s.user);
  const c = useChartTheme();
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
  const first = (user?.fullName ?? user?.username ?? '').split(' ')[0];
  const topMax = Math.max(1, ...(d?.topSellingProducts ?? []).map((p) => num(p.value)));

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
    <div className="flex h-full flex-col bg-canvas">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-5 p-6">
          {/* header */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-ink-faint">
                <CalendarDays size={14} />
                {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                {updated && <span className="hidden sm:inline">· Updated {updated}</span>}
              </div>
              <h1 className="mt-1 text-[26px] font-semibold leading-9 tracking-tight text-ink">
                {greeting()}{first ? `, ${first}` : ''}
              </h1>
              <p className="mt-0.5 text-sm text-ink-muted">Here is what is happening across your business today.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {can('sales_order', 'create') && <Button icon={FilePlus2} onClick={() => open('sales-order-form', {}, 'New Sales Order')}>New Sales Order</Button>}
              {can('proforma_invoice', 'create') && <Button icon={FilePlus2} variant="primary" onClick={() => open('proforma-invoice-form', {}, 'New Proforma Invoice')}>New Proforma Invoice</Button>}
              {can('purchase_order', 'create') && <Button icon={FilePlus2} onClick={() => open('purchase-order-form', {}, 'New Purchase Order')}>New Purchase Order</Button>}
              {features.partNumbers && <Button icon={ScanSearch} onClick={() => open('part-lookup', {}, 'Part Lookup')}>Part Lookup</Button>}
              <span className="mx-1 hidden h-6 w-px bg-line md:block" />
              <select className="ctl !w-[150px]" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Trend range">
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="6m">Last 6 months</option>
                <option value="12m">Last 12 months</option>
              </select>
              <button className="tb-btn !w-9 !justify-center !px-0" onClick={() => q.refetch()} title="Refresh" aria-label="Refresh">
                <RefreshCw size={14} className={cn(q.isFetching && 'animate-spin')} />
              </button>
            </div>
          </div>

          {/* quick item price check */}
          {can('products', 'view') && <PriceCheck />}

          {q.isError && <ErrorState message={apiError(q.error)} onRetry={() => q.refetch()} />}

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
            {TILES.map((t) =>
              q.isLoading ? (
                <div key={t.key} className="rounded-card border border-line bg-surface p-4 shadow-card">
                  <Skeleton className="h-9 w-9 !rounded-lg" />
                  <Skeleton className="mt-3 h-3 w-20" />
                  <Skeleton className="mt-2 h-6 w-28" />
                </div>
              ) : (
                <Tile
                  key={t.key}
                  def={t}
                  kpi={kpiOf(d, t.key)}
                  onOpen={() => open(t.screen)}
                  spark={(t.spark === 'sales' ? salesTrend : t.spark === 'purchase' ? purchaseTrend : []).map((p) => num(p.total))}
                  sparkColor={t.spark === 'purchase' ? c.teal : c.brand}
                />
              ),
            )}
          </div>

          {/* charts */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Card title="Sales vs Purchase" subtitle="Invoiced totals per period" className="xl:col-span-2">
              {q.isLoading ? <Skeleton className="h-[260px]" /> : <SalesPurchaseChart sales={salesTrend} purchase={purchaseTrend} />}
            </Card>
            <Card title="Cash flow" subtitle="Receipts and payments">
              {q.isLoading ? <Skeleton className="h-[260px]" /> : <CashChart data={cashFlow} />}
            </Card>
          </div>

          {/* ranked lists + activity */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Card title="Top selling products" subtitle="By value sold" right={<TrendingUp size={16} className="text-ink-faint" />}>
              {(d?.topSellingProducts ?? []).length === 0 ? (
                <Empty />
              ) : (
                <ol className="flex flex-col gap-3.5">
                  {(d?.topSellingProducts ?? []).map((p, i) => (
                    <li key={i}>
                      <button className="group block w-full text-left" onClick={() => p.productId !== undefined && open('product-form', { id: p.productId }, p.code)}>
                        <div className="flex items-center gap-3">
                          <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold', i === 0 ? 'bg-brand text-white dark:text-[#0c0d14]' : 'bg-surface-3 text-ink-muted')}>{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium text-ink group-hover:text-brand">{p.name}</div>
                            <div className="text-xs text-ink-faint">{p.code} · {fmt.qty(p.qty)} sold</div>
                          </div>
                          <div className="text-[13px] font-semibold tabular-nums text-ink">{fmt.money(p.value)}</div>
                        </div>
                        <div className="ml-9 mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                          <div className="h-full rounded-full bg-gradient-to-r from-brand to-accent transition-all duration-500" style={{ width: `${Math.max(4, (num(p.value) / topMax) * 100)}%` }} />
                        </div>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card title="Low stock" subtitle="At or below reorder level" bodyClassName="p-0 pt-2" right={<AlertTriangle size={16} className="text-warning" />}>
              <MiniTable<LowProduct>
                rows={d?.lowStockProducts ?? []}
                empty="All stock levels are healthy"
                onRow={(r) => r.productId !== undefined && open('product-form', { id: r.productId }, r.code)}
                cols={[
                  { header: 'Product', cell: (r) => (
                    <span className="flex items-center gap-2.5">
                      <Avatar name={r.name} />
                      <span className="min-w-0"><span className="block truncate font-medium text-ink">{r.name}</span><span className="block text-xs text-ink-faint">{r.code}</span></span>
                    </span>
                  ) },
                  { header: 'On hand', right: true, cell: (r) => fmt.qty(r.onHand) },
                  { header: 'Short', right: true, cell: (r) => <Badge tone="red" dot={false}>{fmt.qty(r.shortage)}</Badge> },
                ]}
              />
            </Card>

            <Card title="Recent activity" subtitle="Latest transactions" right={<Clock size={16} className="text-ink-faint" />} bodyClassName="p-5 pt-3">
              {(d?.recentTransactions ?? []).length === 0 ? (
                <Empty />
              ) : (
                <ol className="relative flex flex-col gap-1 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-line">
                  {(d?.recentTransactions ?? []).slice(0, 8).map((r, i) => {
                    const Icon = TX_ICON[normalizeDocType(r.type ?? '')] ?? FileText;
                    return (
                      <li key={i} className="relative">
                        <button onClick={() => openTx(r)} className="flex w-full items-start gap-3 rounded-lg p-1.5 text-left transition hover:bg-surface-2">
                          <span className="relative z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-muted">
                            <Icon size={14} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-[13px] font-medium text-ink">{r.docNo}</span>
                              <StatusBadge status={r.status} />
                            </span>
                            <span className="block truncate text-xs text-ink-faint">{r.label ?? fmt.status(r.type)}{r.party ? ` · ${r.party}` : ''} · {fmt.date(r.date)}</span>
                          </span>
                          {r.amount !== null && r.amount !== undefined && <span className="shrink-0 pt-0.5 text-[13px] font-semibold tabular-nums text-ink">{fmt.money(r.amount)}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Card>
          </div>

          {/* workflows */}
          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
            <Workflow title="Sales workflow" stages={d?.workflows?.sales ?? []} onOpen={openStage} />
            <Workflow title="Purchase workflow" stages={d?.workflows?.purchase ?? []} onOpen={openStage} />
          </div>

          {/* outstanding */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card title="Outstanding customers" subtitle="Receivable balances" bodyClassName="p-0 pt-2">
              <MiniTable<OutCustomer>
                rows={d?.outstandingCustomers ?? []}
                onRow={(r) => r.customerId !== undefined && open('customer-form', { id: r.customerId }, r.name)}
                cols={[
                  { header: 'Customer', cell: (r) => (
                    <span className="flex items-center gap-2.5"><Avatar name={r.name} /><span className="min-w-0"><span className="block truncate font-medium text-ink">{r.name}</span><span className="block text-xs text-ink-faint">{r.code}</span></span></span>
                  ) },
                  { header: 'Balance', right: true, cell: (r) => fmt.money(r.balance) },
                  { header: 'Overdue', right: true, cell: (r) => (num(r.overdue) > 0 ? <Badge tone="red" dot={false}>{fmt.money(r.overdue)}</Badge> : <span className="text-ink-faint">-</span>) },
                ]}
              />
            </Card>
            <Card title="Outstanding suppliers" subtitle="Payable balances" bodyClassName="p-0 pt-2">
              <MiniTable<OutSupplier>
                rows={d?.outstandingSuppliers ?? []}
                onRow={(r) => r.supplierId !== undefined && open('supplier-form', { id: r.supplierId }, r.name)}
                cols={[
                  { header: 'Supplier', cell: (r) => (
                    <span className="flex items-center gap-2.5"><Avatar name={r.name} /><span className="min-w-0"><span className="block truncate font-medium text-ink">{r.name}</span><span className="block text-xs text-ink-faint">{r.code}</span></span></span>
                  ) },
                  { header: 'Balance', right: true, cell: (r) => fmt.money(r.balance) },
                ]}
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default [{ id: 'dashboard', title: 'Dashboard', icon: LayoutDashboard, component: DashboardScreen }] satisfies ScreenDef[];
