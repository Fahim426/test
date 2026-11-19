import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, LayoutGrid, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { toast } from '@/store/toast';
import { Button, Checkbox, ErrorState, LoadingBlock, Panel, SectionHeader, Toolbar } from '@/components/ui';
import type { ScreenDef } from '@/screens/types';

interface WidgetDef { key: string; label: string; type: 'kpi' | 'chart' | 'table' | 'workflow' | string }
interface WidgetsRes { enabled: string[]; customized: boolean; available: WidgetDef[] }
interface Kpi { value?: number; count?: number; amount?: number; overdue?: number; qty?: number }
interface Trend { label?: string; total?: number; inflow?: number; outflow?: number; net?: number }
interface Stage { stage?: string; count?: number; pending?: number }
interface Dash {
  kpis?: Record<string, Kpi | undefined>;
  charts?: Record<string, Trend[] | undefined>;
  workflows?: { purchase?: Stage[]; sales?: Stage[] };
  [k: string]: unknown;
}

const MONEY_KPIS = new Set(['todaysSales', 'monthlySales', 'todaysPurchase', 'monthlyPurchase', 'receivables', 'payables', 'stockValue']);
const TABLES: Record<string, { cols: { key: string; label: string; money?: boolean; qty?: boolean }[] }> = {
  topSellingProducts: { cols: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Product' }, { key: 'qty', label: 'Qty', qty: true }, { key: 'value', label: 'Value', money: true }] },
  lowStockProducts: { cols: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Product' }, { key: 'onHand', label: 'On hand', qty: true }, { key: 'shortage', label: 'Short', qty: true }] },
  outstandingCustomers: { cols: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Customer' }, { key: 'balance', label: 'Balance', money: true }, { key: 'overdue', label: 'Overdue', money: true }] },
  outstandingSuppliers: { cols: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Supplier' }, { key: 'balance', label: 'Balance', money: true }] },
  recentTransactions: { cols: [{ key: 'label', label: 'Type' }, { key: 'docNo', label: 'No' }, { key: 'party', label: 'Party' }, { key: 'amount', label: 'Amount', money: true }] },
};

function Preview({ w, dash }: { w: WidgetDef; dash: Dash }) {
  if (w.type === 'kpi') {
    const k = w.key.replace(/^kpi\./, '');
    const v = dash.kpis?.[k];
    const val = v?.value ?? v?.count ?? v?.amount;
    return (
      <div className="flex h-full flex-col justify-center">
        <div className="text-[11px] text-slate-500">{w.label}</div>
        <div className="text-[18px] font-semibold text-slate-800">{val === undefined ? '-' : MONEY_KPIS.has(k) ? fmt.money(val) : fmt.qty(val)}</div>
        {v?.count !== undefined && v.value !== undefined && <div className="text-[11px] text-slate-500">{v.count} documents</div>}
      </div>
    );
  }
  if (w.type === 'chart') {
    const data = (dash.charts?.[w.key] ?? (dash[w.key] as Trend[] | undefined) ?? []) as Trend[];
    return (
      <div className="h-36">
        <div className="text-[11px] font-semibold text-slate-600">{w.label}</div>
        <ResponsiveContainer width="100%" height="88%">
          {w.key === 'cashFlow' ? (
            <BarChart data={data}><CartesianGrid stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} width={40} /><Tooltip /><Bar dataKey="inflow" fill="#2a9d8f" /><Bar dataKey="outflow" fill="#c0392b" /></BarChart>
          ) : (
            <AreaChart data={data}><CartesianGrid stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} width={40} /><Tooltip /><Area dataKey="total" stroke="#1f5fae" fill="#7fa8dc" /></AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    );
  }
  if (w.type === 'table') {
    const spec = TABLES[w.key];
    const rows = ((dash[w.key] as Record<string, unknown>[] | undefined) ?? []).slice(0, 5);
    return (
      <div>
        <div className="mb-0.5 text-[11px] font-semibold text-slate-600">{w.label}</div>
        {!spec || rows.length === 0 ? <div className="text-[11px] text-slate-400">No data</div> : (
          <table className="w-full text-[11px]">
            <thead><tr>{spec.cols.map((c) => <th key={c.key} className={`border-b border-slate-200 px-1 text-left font-medium text-slate-500 ${c.money || c.qty ? '!text-right' : ''}`}>{c.label}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}>{spec.cols.map((c) => <td key={c.key} className={`truncate px-1 ${c.money || c.qty ? 'text-right tabular-nums' : ''}`}>{c.money ? fmt.money(r[c.key]) : c.qty ? fmt.qty(r[c.key]) : String(r[c.key] ?? '')}</td>)}</tr>
            ))}</tbody>
          </table>
        )}
      </div>
    );
  }
  if (w.type === 'workflow') {
    const stages = (w.key === 'purchaseWorkflow' ? dash.workflows?.purchase : dash.workflows?.sales) ?? [];
    return (
      <div>
        <div className="mb-1 text-[11px] font-semibold text-slate-600">{w.label}</div>
        <div className="flex flex-wrap gap-1">
          {stages.map((s, i) => (
            <span key={i} className="rounded border border-app-border bg-slate-50 px-1.5 py-0.5 text-[11px]">{s.stage}: <b>{s.count ?? 0}</b>{s.pending ? <span className="text-amber-600"> ({s.pending} pending)</span> : null}</span>
          ))}
        </div>
      </div>
    );
  }
  return <div className="text-[11px] text-slate-500">{w.label}</div>;
}

function WidgetsScreen() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['dashboard', 'widgets'], queryFn: async () => (await api.get<WidgetsRes>('/dashboard/widgets')).data });
  const catalog = useQuery({ queryKey: ['dashboard', 'widget-catalog'], staleTime: 10 * 60_000, queryFn: async () => (await api.get<{ widgets: WidgetDef[] }>('/dashboard/widget-catalog')).data.widgets });
  const dash = useQuery({ queryKey: ['dashboard', 'widget-preview'], retry: false, queryFn: async () => (await api.get<Dash>('/dashboard')).data });

  const [enabled, setEnabled] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (cfg.data) { setEnabled(cfg.data.enabled); setDirty(false); } }, [cfg.data]);

  const all = catalog.data ?? cfg.data?.available ?? [];
  const byKey = useMemo(() => new Map(all.map((w) => [w.key, w])), [all]);
  const disabled = all.filter((w) => !enabled.includes(w.key));
  const change = (e: string[]) => { setEnabled(e); setDirty(true); };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= enabled.length) return;
    const n = [...enabled];
    [n[i], n[j]] = [n[j], n[i]];
    change(n);
  };

  const save = useMutation({
    mutationFn: async () => (await api.put<WidgetsRes>('/dashboard/widgets', { enabled })).data,
    onSuccess: () => { toast.success('Dashboard widgets saved'); setDirty(false); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  if (cfg.isLoading || catalog.isLoading) return <LoadingBlock />;
  if (cfg.error) return <ErrorState message={apiError(cfg.error)} onRetry={() => cfg.refetch()} />;

  return (
    <div className="flex h-full flex-col bg-white">
      <Toolbar>
        <LayoutGrid size={14} className="text-brand" />
        <span className="text-[12px] font-semibold text-slate-700">Dashboard Widgets</span>
        <div className="flex-1" />
        {dirty && <span className="text-[11px] text-amber-600">Unsaved changes</span>}
        <Button size="sm" icon={RotateCcw} onClick={() => change(all.map((w) => w.key))}>Enable all</Button>
        <Button size="sm" icon={RefreshCw} loading={dash.isFetching} onClick={() => dash.refetch()}>Refresh preview</Button>
        <Button size="sm" variant="primary" icon={Save} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>Save</Button>
      </Toolbar>
      <div className="flex min-h-0 flex-1">
        <div className="w-[320px] shrink-0 overflow-auto border-r border-app-border">
          <SectionHeader title={`ENABLED (${enabled.length}) - display order`} />
          <ul>
            {enabled.map((k, i) => {
              const w = byKey.get(k);
              return (
                <li key={k} className="flex h-7 items-center gap-1 border-b border-slate-200 px-2 text-[12px]">
                  <Checkbox checked onChange={() => change(enabled.filter((x) => x !== k))} />
                  <span className="w-5 text-slate-400">{i + 1}</span>
                  <span className="flex-1 truncate">{w?.label ?? k}</span>
                  <span className="text-[10px] uppercase text-slate-400">{w?.type}</span>
                  <button title="Move up" disabled={i === 0} className="text-slate-500 hover:text-brand disabled:opacity-30" onClick={() => move(i, -1)}><ArrowUp size={13} /></button>
                  <button title="Move down" disabled={i === enabled.length - 1} className="text-slate-500 hover:text-brand disabled:opacity-30" onClick={() => move(i, 1)}><ArrowDown size={13} /></button>
                </li>
              );
            })}
            {enabled.length === 0 && <li className="px-2 py-3 text-[12px] text-slate-500">No widgets enabled.</li>}
          </ul>
          <SectionHeader title={`AVAILABLE (${disabled.length})`} />
          <ul>
            {disabled.map((w) => (
              <li key={w.key} className="flex h-7 items-center gap-2 border-b border-slate-200 px-2 text-[12px] text-slate-500">
                <Checkbox checked={false} onChange={() => change([...enabled, w.key])} />
                <span className="flex-1 truncate">{w.label}</span>
                <span className="text-[10px] uppercase text-slate-400">{w.type}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0 flex-1 overflow-auto bg-slate-50 p-2">
          {dash.isLoading && <LoadingBlock label="Loading preview..." />}
          {dash.error && <ErrorState message={apiError(dash.error)} onRetry={() => dash.refetch()} />}
          {dash.data && (
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              {enabled.map((k) => {
                const w = byKey.get(k);
                if (!w) return null;
                const wide = w.type === 'chart' || w.type === 'table' || w.type === 'workflow';
                return (
                  <Panel key={k} className={wide ? 'col-span-2' : ''} bodyClassName="min-h-[56px]">
                    <Preview w={w} dash={dash.data} />
                  </Panel>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default [{ id: 'report-widgets', title: 'Dashboard Widgets', icon: LayoutGrid, component: WidgetsScreen, permission: 'dashboard' }] satisfies ScreenDef[];
