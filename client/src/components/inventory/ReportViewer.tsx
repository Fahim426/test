import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, FileText, Play, Printer } from 'lucide-react';
import { api, apiError, saveBlob } from '@/lib/api';
import { printRows } from '@/lib/export';
import { fmt } from '@/lib/format';
import { Button, DateInput, ErrorState, Field, Input, LoadingBlock, Select, Toolbar } from '@/components/ui';
import { ProductPicker } from '@/components/doc';
import { useMasterRows } from './common';

interface ParamDef {
  key: string; label: string; type: 'date' | 'number' | 'select' | 'text'; entity?: string; options?: { value: string; label: string }[]; default?: string | number;
}
interface ColDef { key: string; label: string; type: 'text' | 'number' | 'money' | 'qty' | 'percent' | 'date'; align: 'left' | 'right' | 'center' }
interface Catalog { groups: { reports: { key: string; title: string; description: string; params: ParamDef[]; columns: ColDef[] }[] }[] }
interface Result { key: string; title: string; columns: ColDef[]; rows: Record<string, unknown>[]; totals: Record<string, unknown>; total: number; page?: number; pageSize?: number; generatedAt: string }

const ENTITY_URL: Record<string, string> = {
  warehouse: '/warehouses', customer: '/customers', supplier: '/suppliers', brand: '/brands', category: '/categories', salesman: '/salesmen', branch: '/branches', product: '/products',
};
const PAGE = 200;

function EntitySelect({ entity, value, onChange }: { entity: string; value: string; onChange: (v: string) => void }) {
  const q = useMasterRows(ENTITY_URL[entity] ?? '/warehouses', entity === 'product' ? { pageSize: 200 } : undefined);
  return (
    <Select className="w-44" value={value} onChange={(e) => onChange(e.target.value)} placeholder="All">
      {(q.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.code ? `${r.code} - ${r.name}` : r.name}</option>)}
    </Select>
  );
}

const cellText = (v: unknown, c: ColDef): string => {
  if (v === null || v === undefined || v === '') return '';
  switch (c.type) {
    case 'money': return fmt.money(v);
    case 'qty': return fmt.qty(v);
    case 'number': return fmt.num(v);
    case 'percent': return fmt.percent(v);
    case 'date': return fmt.date(v as string);
    default: return String(v);
  }
};

/** Generic viewer for GET /reports/run/:key (params from GET /reports/catalog). */
export function ReportViewer({ reportKey, title }: { reportKey: string; title: string }) {
  const cat = useQuery({ queryKey: ['reports-catalog'], staleTime: 300_000, queryFn: async () => (await api.get<Catalog>('/reports/catalog')).data });
  const def = cat.data?.groups.flatMap((g) => g.reports).find((r) => r.key === reportKey);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, string> | null>(null);
  const [page, setPage] = useState(1);
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    if (def && applied === null) {
      const init = Object.fromEntries(def.params.filter((p) => p.default !== undefined).map((p) => [p.key, String(p.default)]));
      setVals(init);
      setApplied(init);
    }
  }, [def, applied]);

  const run = useQuery({
    queryKey: ['report-run', reportKey, applied, page],
    enabled: applied !== null,
    queryFn: async () => (await api.get<Result>(`/reports/run/${reportKey}`, { params: { ...Object.fromEntries(Object.entries(applied ?? {}).filter(([, v]) => v !== '')), page, pageSize: PAGE } })).data,
  });
  const R = run.data;
  const cols = R?.columns ?? def?.columns ?? [];

  const exportFile = async (format: 'xlsx' | 'pdf' | 'csv') => {
    try {
      const res = await api.get(`/reports/run/${reportKey}`, { params: { ...Object.fromEntries(Object.entries(applied ?? {}).filter(([, v]) => v !== '')), format }, responseType: 'blob' });
      saveBlob(res.data as Blob, `${reportKey}.${format}`);
    } catch (e) {
      alert(apiError(e));
    }
  };
  const doPrint = () =>
    printRows(R?.title ?? title, cols.map((c) => ({ key: c.key, header: c.label, align: c.align })), (R?.rows ?? []).map((r) => Object.fromEntries(cols.map((c) => [c.key, cellText(r[c.key], c)]))));

  const pages = R ? Math.max(1, Math.ceil(R.total / PAGE)) : 1;
  const th = 'grid-th px-2 whitespace-nowrap';

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <Toolbar className="items-end">
        <span className="mr-2 self-center text-[13px] font-semibold text-brand">{title}</span>
        {(def?.params ?? []).map((p) => (
          <Field key={p.key} label={p.label}>
            {p.type === 'date' ? <DateInput value={vals[p.key] ?? ''} onChange={(e) => setVals((s) => ({ ...s, [p.key]: e.target.value }))} />
              : p.type === 'select' && p.entity === 'product' ? (
                <div className="w-56 border border-app-border bg-white"><ProductPicker text={labels[p.key] ?? ''} onPick={(x) => { setVals((s) => ({ ...s, [p.key]: String(x.id) })); setLabels((s) => ({ ...s, [p.key]: x.code + ' - ' + x.name })); }} onClear={() => { setVals((s) => ({ ...s, [p.key]: '' })); setLabels((s) => ({ ...s, [p.key]: '' })); }} /></div>
              )
              : p.type === 'select' && p.entity ? <EntitySelect entity={p.entity} value={vals[p.key] ?? ''} onChange={(v) => setVals((s) => ({ ...s, [p.key]: v }))} />
              : p.type === 'select' ? <Select className="w-32" options={p.options} value={vals[p.key] ?? ''} onChange={(e) => setVals((s) => ({ ...s, [p.key]: e.target.value }))} placeholder="" />
              : <Input type={p.type === 'number' ? 'number' : 'text'} className="w-24" value={vals[p.key] ?? ''} onChange={(e) => setVals((s) => ({ ...s, [p.key]: e.target.value }))} />}
          </Field>
        ))}
        <Button variant="primary" icon={Play} onClick={() => { setPage(1); setApplied({ ...vals }); }}>Run</Button>
        <Button icon={Download} disabled={!R} onClick={() => exportFile('xlsx')}>Excel</Button>
        <Button icon={FileText} disabled={!R} onClick={() => exportFile('pdf')}>PDF</Button>
        <Button icon={Printer} disabled={!R} onClick={doPrint}>Print</Button>
      </Toolbar>
      {def?.description && <div className="shrink-0 border-b border-app-border px-3 py-1 text-[11px] text-slate-500">{def.description}</div>}
      {(cat.isLoading || run.isLoading) && <LoadingBlock />}
      {cat.error && <ErrorState message={apiError(cat.error)} />}
      {run.error && <ErrorState message={apiError(run.error)} onRetry={() => run.refetch()} />}
      {R && (
        <>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-app-head">
                <tr>{cols.map((c) => <th key={c.key} className={`${th} ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'}`}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {R.rows.length === 0 && <tr><td colSpan={cols.length} className="p-8 text-center text-slate-400">No data for the selected parameters</td></tr>}
                {R.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-brand-light">
                    {cols.map((c) => <td key={c.key} className={`grid-td px-2 ${c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : ''}`}>{cellText(r[c.key], c)}</td>)}
                  </tr>
                ))}
              </tbody>
              {R.rows.length > 0 && Object.keys(R.totals ?? {}).length > 0 && (
                <tfoot className="sticky bottom-0 bg-app-head font-semibold">
                  <tr>{cols.map((c, i) => <td key={c.key} className={`grid-td px-2 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>{R.totals[c.key] !== undefined ? cellText(R.totals[c.key], c) : i === 0 ? 'Total' : ''}</td>)}</tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t border-app-border bg-app-head px-3 py-1 text-[11px] text-slate-600">
            <span>{R.total} rows</span>
            <span className="flex-1" />
            <Button size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <span>Page {page} / {pages}</span>
            <Button size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight size={12} /></Button>
            <span className="ml-3 text-slate-400">Generated {fmt.dateTime(R.generatedAt)}</span>
          </div>
        </>
      )}
    </div>
  );
}
