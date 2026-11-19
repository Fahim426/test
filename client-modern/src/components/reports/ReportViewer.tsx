import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play, RotateCcw, Star } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { encodeRoute, useFavorites } from '@/hooks/useFavorites';
import { Button, DateInput, ErrorState, Field, Input, LoadingBlock, Select, Toolbar, ToolbarSep } from '@/components/ui';
import { EntityPicker, isEntityKind } from './EntityPicker';
import { ExportMenu } from './ExportMenu';
import { ResultGrid } from './ResultGrid';
import { DRILL, keyOfScreen } from './reportRoutes';
import { useDrill } from './useDrill';
import { cleanParams, downloadFile, fetchPrintHtml, printHtml, type Catalog, type CatalogReport, type ExportFmt, type ReportResult } from './reportTypes';

type Vals = Record<string, string | number>;

const loadLast = (key: string): Vals => {
  try { return JSON.parse(localStorage.getItem(`rpt.params.${key}`) ?? '{}') as Vals; } catch { return {}; }
};

export function useCatalog() {
  return useQuery({
    queryKey: ['reports', 'catalog'],
    staleTime: 10 * 60_000,
    queryFn: async () => (await api.get<Catalog>('/reports/catalog')).data,
  });
}

const defaultsOf = (def: CatalogReport): Vals =>
  Object.fromEntries(def.params.filter((p) => p.default !== undefined).map((p) => [p.key, p.default as string | number]));

const monthRange = (offset: number): { from: string; to: string } => {
  const n = new Date();
  const a = new Date(n.getFullYear(), n.getMonth() + offset, 1);
  const b = new Date(n.getFullYear(), n.getMonth() + offset + 1, 0);
  return { from: fmt.isoDate(a), to: fmt.isoDate(b) };
};
const PERIODS: { label: string; get: () => { from: string; to: string } }[] = [
  { label: 'This month', get: () => monthRange(0) },
  { label: 'Last month', get: () => monthRange(-1) },
  { label: 'This quarter', get: () => { const n = new Date(); const q = Math.floor(n.getMonth() / 3) * 3; return { from: fmt.isoDate(new Date(n.getFullYear(), q, 1)), to: fmt.isoDate(new Date(n.getFullYear(), q + 3, 0)) }; } },
  { label: 'This year', get: () => { const y = new Date().getFullYear(); return { from: `${y}-01-01`, to: `${y}-12-31` }; } },
  { label: 'Last year', get: () => { const y = new Date().getFullYear() - 1; return { from: `${y}-01-01`, to: `${y}-12-31` }; } },
];

/**
 * Generic report screen driven by GET /reports/catalog + GET /reports/run/:key.
 * `screenId` is the ribbon id of the hosting screen; the catalog key is derived from it unless `reportKey` is given.
 */
export function ReportViewer({ screenId, reportKey, preset }: { screenId: string; reportKey?: string; preset?: unknown }) {
  const key = reportKey ?? keyOfScreen(screenId);
  const cat = useCatalog();
  const def = useMemo(() => cat.data?.groups.flatMap((g) => g.reports).find((r) => r.key === key), [cat.data, key]);

  if (cat.isLoading) return <LoadingBlock />;
  if (cat.error) return <ErrorState message={apiError(cat.error)} onRetry={() => cat.refetch()} />;
  if (!def) return <ErrorState message={`Report '${key}' is not in the catalog.`} />;
  if (def.source === 'finance') return <ErrorState message={`'${def.title}' is a finance report (screen '${def.route ?? def.key}').`} />;
  return <Viewer def={def} screenId={screenId} preset={preset} />;
}

function Viewer({ def, screenId, preset }: { def: CatalogReport; screenId: string; preset?: unknown }) {
  const initial = useMemo<Vals>(
    () => ({ ...defaultsOf(def), ...loadLast(def.key), ...((preset && typeof preset === 'object' ? preset : {}) as Vals) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [def.key],
  );
  const [draft, setDraft] = useState<Vals>(initial);
  const [applied, setApplied] = useState<Vals>(initial);
  const [period, setPeriod] = useState('');
  const fav = useFavorites();
  const drill = useDrill();

  const q = useQuery({
    queryKey: ['report-run', def.key, applied],
    retry: false,
    queryFn: async () => (await api.get<ReportResult>(`/reports/run/${def.key}`, { params: cleanParams(applied) })).data,
  });

  useEffect(() => { try { localStorage.setItem(`rpt.params.${def.key}`, JSON.stringify(applied)); } catch { /* ignore */ } }, [applied, def.key]);

  const set = (k: string, v: string | number) => setDraft((d) => ({ ...d, [k]: v }));
  const run = () => (JSON.stringify(draft) === JSON.stringify(applied) ? q.refetch() : setApplied({ ...draft }));
  const reset = () => { const d = defaultsOf(def); setDraft(d); setApplied(d); setPeriod(''); };

  const exportAs = (f: ExportFmt) =>
    downloadFile(api.get(`/reports/run/${def.key}`, { params: { ...cleanParams(applied), format: f }, responseType: 'blob' }), `${def.key}.${f}`);
  const print = async () => printHtml(await fetchPrintHtml(`/reports/print/${def.key}`, cleanParams(applied)));

  const res = q.data;
  const drillMap = DRILL[def.key];

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="no-print border-b border-line bg-surface-2 px-2 py-1.5">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-ink">{def.title}</span>
          <span className="truncate text-xs text-ink-muted">{def.description}</span>
        </div>
        <form className="flex flex-wrap items-end gap-x-2 gap-y-1" onSubmit={(e) => { e.preventDefault(); run(); }}>
          {def.params.some((p) => p.key === 'from') && (
            <Field label="Period" className="w-28">
              <Select
                value={period}
                placeholder="Custom"
                options={PERIODS.map((p) => ({ value: p.label, label: p.label }))}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  const p = PERIODS.find((x) => x.label === e.target.value);
                  if (p) setDraft((d) => ({ ...d, ...p.get() }));
                }}
              />
            </Field>
          )}
          {def.params.map((p) => (
            <Field key={p.key} label={p.label} required={p.required} className={p.entity ? 'w-44' : p.type === 'date' ? 'w-32' : 'w-28'}>
              {p.type === 'date' ? (
                <DateInput value={String(draft[p.key] ?? '')} onChange={(e) => { set(p.key, e.target.value); setPeriod(''); }} />
              ) : p.entity && isEntityKind(p.entity) ? (
                <EntityPicker entity={p.entity} value={typeof draft[p.key] === 'number' || draft[p.key] ? Number(draft[p.key]) : ''} onChange={(id) => set(p.key, id)} />
              ) : p.type === 'select' ? (
                <Select
                  value={String(draft[p.key] ?? '')}
                  placeholder={p.default === undefined ? (p.key === 'groupBy' ? 'Default' : 'All') : undefined}
                  options={(p.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
                  onChange={(e) => set(p.key, e.target.value)}
                />
              ) : p.type === 'number' ? (
                <Input type="number" min={1} className="text-right" value={String(draft[p.key] ?? '')} onChange={(e) => set(p.key, e.target.value)} />
              ) : (
                <Input value={String(draft[p.key] ?? '')} onChange={(e) => set(p.key, e.target.value)} />
              )}
            </Field>
          ))}
          <Button type="submit" variant="primary" size="md" icon={Play} loading={q.isFetching}>Run</Button>
          <Button size="md" icon={RotateCcw} onClick={reset} title="Reset parameters">Reset</Button>
        </form>
      </div>
      <Toolbar>
        <ExportMenu disabled={!res} onExport={exportAs} onPrint={print} />
        <ToolbarSep />
        <Button
          size="sm"
          icon={Star}
          loading={fav.add.isPending}
          onClick={() => fav.add.mutate({ label: def.title, route: encodeRoute(screenId, { preset: cleanParams(applied) as Record<string, unknown> }) })}
        >
          Save as favourite
        </Button>
        <div className="flex-1" />
        {res && <span className="text-xs text-ink-muted">Generated {fmt.dateTime(res.generatedAt)}</span>}
      </Toolbar>
      <div className="min-h-0 flex-1">
        {q.isLoading && <LoadingBlock label="Running report..." />}
        {q.error && !q.isLoading && <ErrorState message={apiError(q.error)} onRetry={() => q.refetch()} />}
        {res && !q.error && (
          <ResultGrid
            storageKey={def.key}
            columns={res.columns}
            rows={res.rows}
            totals={res.totals}
            drill={drillMap}
            onDrill={drill}
            rowCountLabel={`${res.total} row${res.total === 1 ? '' : 's'}`}
          />
        )}
      </div>
    </div>
  );
}
