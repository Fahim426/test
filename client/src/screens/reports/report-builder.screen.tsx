import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, FolderOpen, Hammer, Play, Plus, Save, Trash2, X } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { printRows } from '@/lib/export';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/toast';
import { Button, Checkbox, ConfirmDialog, DateInput, ErrorState, Field, Input, LoadingBlock, Modal, SectionHeader, Select, Textarea, Toolbar, ToolbarSep } from '@/components/ui';
import { EntityPicker, type EntityKind } from '@/components/reports/EntityPicker';
import { ExportMenu } from '@/components/reports/ExportMenu';
import { ResultGrid, formatCell } from '@/components/reports/ResultGrid';
import { cleanParams, downloadFile, type ColType, type ExportFmt, type ReportCol, type Row } from '@/components/reports/reportTypes';
import type { ScreenDef } from '@/screens/types';

/* ---------- API shapes ---------- */
interface FieldInfo { key: string; label: string; type: ColType; filterable: boolean; groupable: boolean; aggregatable: boolean }
interface EntityInfo { key: string; label: string; description: string; dateField: string | null; supports: string[]; fields: FieldInfo[] }
interface EntitiesRes { entities: EntityInfo[]; operators: string[]; aggregates: string[] }

type Op = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'between' | 'in';
type Fn = 'sum' | 'count' | 'avg' | 'min' | 'max';
interface FilterRow { field: string; op: Op; value: string }
interface AggRow { fn: Fn; field: string }
interface SortRow { field: string; dir: 'asc' | 'desc' }

interface Def {
  entity: string;
  columns: string[];
  filters: FilterRow[];
  groupBy: string[];
  aggregates: AggRow[];
  sort: SortRow[];
  dateField: string;
  from: string;
  to: string;
  ids: Partial<Record<'warehouseId' | 'branchId' | 'customerId' | 'supplierId' | 'productId' | 'brandId' | 'categoryId', number | ''>>;
  limit: number;
}
const emptyDef = (entity = ''): Def => ({ entity, columns: [], filters: [], groupBy: [], aggregates: [], sort: [], dateField: '', from: '', to: '', ids: {}, limit: 1000 });

const SELECTORS: { key: keyof Def['ids']; entity: EntityKind; label: string }[] = [
  { key: 'warehouseId', entity: 'warehouse', label: 'Warehouse' },
  { key: 'branchId', entity: 'branch', label: 'Branch' },
  { key: 'customerId', entity: 'customer', label: 'Customer' },
  { key: 'supplierId', entity: 'supplier', label: 'Supplier' },
  { key: 'productId', entity: 'product', label: 'Product' },
  { key: 'brandId', entity: 'brand', label: 'Brand' },
  { key: 'categoryId', entity: 'category', label: 'Category' },
];

const OP_LABEL: Record<Op, string> = { eq: '=', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=', contains: 'contains', between: 'between', in: 'in list' };
const FN_LABEL: Record<Fn, string> = { sum: 'Sum', count: 'Count', avg: 'Average', min: 'Min', max: 'Max' };

/** Def (UI state) -> request body of POST /report-builder/run (also the persisted `definition`). */
function toBody(d: Def, title?: string) {
  const filters = d.filters
    .filter((f) => f.field && f.value.trim() !== '')
    .map((f) => ({
      field: f.field,
      op: f.op,
      value: f.op === 'between' || f.op === 'in' ? f.value.split(',').map((s) => s.trim()).filter(Boolean) : f.value,
    }))
    // 'between' needs two values
    .filter((f) => f.op !== 'between' || (f.value as string[]).length >= 2);
  const ids = cleanParams(d.ids as Record<string, unknown>);
  return {
    entity: d.entity,
    columns: d.columns,
    filters,
    groupBy: d.groupBy,
    aggregates: d.aggregates.filter((a) => a.fn === 'count' || a.field).map((a) => (a.field ? { fn: a.fn, field: a.field } : { fn: a.fn })),
    sort: d.sort.filter((s) => s.field),
    ...(d.from || d.to ? { dateRange: { ...(d.dateField ? { field: d.dateField } : {}), from: d.from || null, to: d.to || null } } : {}),
    ...ids,
    limit: d.limit,
    ...(title ? { title } : {}),
  };
}

interface BuilderResult { title: string; entity: string; columns: ReportCol[]; rows: Row[]; totals: Row; total: number; truncated: boolean; generatedAt: string }
type SavedBody = ReturnType<typeof toBody>;
interface Saved { id: string; name: string; description?: string; shared: boolean; definition: SavedBody; createdBy: number; createdByName: string; updatedAt: string }

/** Rebuild UI state from a persisted definition. */
function fromBody(b: Partial<SavedBody> & Record<string, unknown>): Def {
  const d = emptyDef(String(b.entity ?? ''));
  d.columns = (b.columns as string[]) ?? [];
  d.filters = ((b.filters as { field: string; op: Op; value: unknown }[]) ?? []).map((f) => ({ field: f.field, op: f.op, value: Array.isArray(f.value) ? f.value.join(', ') : String(f.value ?? '') }));
  d.groupBy = (b.groupBy as string[]) ?? [];
  d.aggregates = ((b.aggregates as { fn: Fn; field?: string }[]) ?? []).map((a) => ({ fn: a.fn, field: a.field ?? '' }));
  d.sort = (b.sort as SortRow[]) ?? [];
  const dr = b.dateRange as { field?: string; from?: string | null; to?: string | null } | undefined;
  d.dateField = dr?.field ?? '';
  d.from = dr?.from ?? '';
  d.to = dr?.to ?? '';
  for (const s of SELECTORS) { const v = b[s.key]; if (typeof v === 'number') d.ids[s.key] = v; }
  d.limit = typeof b.limit === 'number' ? b.limit : 1000;
  return d;
}

const arrMove = <T,>(a: T[], i: number, dir: -1 | 1): T[] => {
  const j = i + dir;
  if (j < 0 || j >= a.length) return a;
  const n = [...a];
  [n[i], n[j]] = [n[j], n[i]];
  return n;
};

function ReportBuilderScreen() {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const ent = useQuery({ queryKey: ['report-builder', 'entities'], staleTime: 10 * 60_000, queryFn: async () => (await api.get<EntitiesRes>('/report-builder/entities')).data });
  const savedQ = useQuery({ queryKey: ['report-builder', 'saved'], queryFn: async () => (await api.get<{ rows: Saved[] }>('/report-builder/saved')).data.rows });

  const [def, setDef] = useState<Def>(() => emptyDef());
  const [applied, setApplied] = useState<Def | null>(null);
  const [live, setLive] = useState(true);
  const [loaded, setLoaded] = useState<Saved | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [delTarget, setDelTarget] = useState<Saved | null>(null);
  const [form, setForm] = useState({ name: '', description: '', shared: false, asNew: false });

  // default entity
  useEffect(() => {
    if (!def.entity && ent.data?.entities.length) setDef(emptyDef(ent.data.entities[0].key));
  }, [ent.data, def.entity]);

  const entity = ent.data?.entities.find((e) => e.key === def.entity);
  const fields = entity?.fields ?? [];
  const fieldOf = (k: string) => fields.find((f) => f.key === k);
  const patch = (p: Partial<Def>) => setDef((d) => ({ ...d, ...p }));

  // live preview (debounced)
  const valid = !!def.entity;
  useEffect(() => {
    if (!live || !valid) return;
    const t = setTimeout(() => setApplied(def), 700);
    return () => clearTimeout(t);
  }, [def, live, valid]);

  const body = useMemo(() => (applied ? toBody(applied) : null), [applied]);
  const run = useQuery({
    queryKey: ['report-builder', 'run', body],
    enabled: !!body && !!body.entity,
    retry: false,
    queryFn: async () => (await api.post<BuilderResult>('/report-builder/run', body)).data,
  });

  const changeEntity = (key: string) => { setDef(emptyDef(key)); setApplied(null); setLoaded(null); };

  const exportAs = (f: ExportFmt) =>
    downloadFile(api.post('/report-builder/run', toBody(def), { params: { format: f }, responseType: 'blob' }), `report.${f}`);
  const print = async () => {
    const r = run.data;
    if (!r) return;
    const cols = r.columns.map((c) => ({ key: c.key, header: c.label, align: c.align }));
    const rows = r.rows.map((row) => Object.fromEntries(r.columns.map((c) => [c.key, formatCell(c, row[c.key])])));
    if (r.columns.some((c) => r.totals[c.key] !== undefined)) rows.push(Object.fromEntries(r.columns.map((c, i) => [c.key, i === 0 && r.totals[c.key] === undefined ? 'Total' : formatCell(c, r.totals[c.key])])));
    printRows(r.title, cols, rows);
  };

  /* ---- saved reports ---- */
  const canModify = (s: Saved) => !!me && (me.role === 'Admin' || s.createdBy === me.id);
  const saveM = useMutation({
    mutationFn: async () => {
      const payload = { name: form.name.trim(), description: form.description.trim() || undefined, shared: form.shared, definition: toBody(def, form.name.trim()) };
      if (loaded && !form.asNew) return (await api.put<Saved>(`/report-builder/saved/${loaded.id}`, payload)).data;
      return (await api.post<Saved>('/report-builder/saved', payload)).data;
    },
    onSuccess: (s) => { toast.success(`Saved "${s.name}"`); setLoaded(s); setSaveOpen(false); qc.invalidateQueries({ queryKey: ['report-builder', 'saved'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const delM = useMutation({
    mutationFn: async (s: Saved) => { await api.delete(`/report-builder/saved/${s.id}`); return s; },
    onSuccess: (s) => { toast.success(`Deleted "${s.name}"`); if (loaded?.id === s.id) setLoaded(null); setDelTarget(null); qc.invalidateQueries({ queryKey: ['report-builder', 'saved'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const openSave = (asNew: boolean) => {
    setForm({ name: loaded && !asNew ? loaded.name : '', description: loaded && !asNew ? loaded.description ?? '' : '', shared: loaded && !asNew ? loaded.shared : false, asNew });
    setSaveOpen(true);
  };
  const loadSaved = (s: Saved) => { setDef(fromBody(s.definition as unknown as Record<string, unknown>)); setLoaded(s); setLoadOpen(false); setApplied(null); };

  if (ent.isLoading) return <LoadingBlock />;
  if (ent.error || !ent.data) return <ErrorState message={apiError(ent.error)} onRetry={() => ent.refetch()} />;

  const selectedFields = def.columns.map((k) => fieldOf(k)).filter((f): f is FieldInfo => !!f);
  const numFields = fields.filter((f) => f.aggregatable);
  const dateFields = fields.filter((f) => f.type === 'date');
  const sortChoices: { key: string; label: string }[] = [
    ...(def.groupBy.length || def.aggregates.length
      ? [...def.groupBy.map((k) => ({ key: k, label: fieldOf(k)?.label ?? k })), ...def.aggregates.map((a) => ({ key: a.field ? `${a.fn}_${a.field}` : 'count', label: `${FN_LABEL[a.fn]}${a.field ? ' of ' + (fieldOf(a.field)?.label ?? a.field) : ''}` }))]
      : fields.map((f) => ({ key: f.key, label: f.label }))),
  ];
  const grouped = def.groupBy.length > 0 || def.aggregates.length > 0;

  return (
    <div className="flex h-full flex-col bg-white">
      <Toolbar>
        <Hammer size={14} className="text-brand" />
        <span className="text-[12px] font-semibold text-slate-700">Report Builder</span>
        {loaded && <span className="rounded bg-brand-light px-1.5 text-[11px] text-brand">{loaded.name}{loaded.shared ? ' (shared)' : ''}</span>}
        <ToolbarSep />
        <Button size="sm" icon={FolderOpen} onClick={() => setLoadOpen(true)}>Saved reports</Button>
        <Button size="sm" icon={Save} onClick={() => openSave(false)} disabled={!valid || (!!loaded && !canModify(loaded))}>{loaded ? 'Save' : 'Save as...'}</Button>
        {loaded && <Button size="sm" onClick={() => openSave(true)}>Save as new</Button>}
        <Button size="sm" icon={Plus} onClick={() => { setDef(emptyDef(ent.data.entities[0].key)); setLoaded(null); setApplied(null); }}>New</Button>
        <ToolbarSep />
        <ExportMenu disabled={!run.data} onExport={exportAs} onPrint={print} />
      </Toolbar>

      <div className="flex min-h-0 flex-1">
        {/* ---------------- configuration ---------------- */}
        <div className="no-print w-[400px] shrink-0 overflow-auto border-r border-app-border">
          <SectionHeader title="DATA SOURCE" />
          <div className="space-y-1.5 p-2">
            <Field label="Entity" hint={entity?.description}>
              <Select value={def.entity} options={ent.data.entities.map((e) => ({ value: e.key, label: e.label }))} onChange={(e) => changeEntity(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-1.5">
              {entity && entity.supports.includes('dateRange') && (
                <>
                  <Field label="Date field" className="col-span-2">
                    <Select value={def.dateField} placeholder={`Default (${fieldOf(entity.dateField ?? '')?.label ?? 'none'})`} options={dateFields.map((f) => ({ value: f.key, label: f.label }))} onChange={(e) => patch({ dateField: e.target.value })} />
                  </Field>
                  <Field label="From"><DateInput value={def.from} onChange={(e) => patch({ from: e.target.value })} /></Field>
                  <Field label="To"><DateInput value={def.to} onChange={(e) => patch({ to: e.target.value })} /></Field>
                </>
              )}
              {SELECTORS.filter((s) => entity?.supports.includes(s.key)).map((s) => (
                <Field key={s.key} label={s.label}>
                  <EntityPicker entity={s.entity} value={def.ids[s.key] ?? ''} onChange={(id) => patch({ ids: { ...def.ids, [s.key]: id } })} />
                </Field>
              ))}
              <Field label="Row limit"><Input type="number" min={1} max={20000} className="text-right" value={def.limit} onChange={(e) => patch({ limit: Math.min(20000, Math.max(1, Number(e.target.value) || 1000)) })} /></Field>
            </div>
          </div>

          <SectionHeader title={`COLUMNS (${def.columns.length || 'all'})`} right={def.columns.length > 0 && <button className="text-[11px] text-brand hover:underline" onClick={() => patch({ columns: [] })}>Clear</button>} />
          <div className="p-2">
            <div className="mb-1 text-[11px] text-slate-500">{grouped ? 'Ignored while grouping / aggregating.' : 'Tick to add; none ticked = all columns.'}</div>
            <div className="grid max-h-40 grid-cols-2 gap-x-2 overflow-auto rounded border border-app-border p-1.5">
              {fields.map((f) => (
                <Checkbox key={f.key} label={f.label} checked={def.columns.includes(f.key)} onChange={(e) => patch({ columns: e.target.checked ? [...def.columns, f.key] : def.columns.filter((k) => k !== f.key) })} />
              ))}
            </div>
            {selectedFields.length > 0 && (
              <ul className="mt-1.5 rounded border border-app-border">
                {selectedFields.map((f, i) => (
                  <li key={f.key} className="flex h-6 items-center gap-1 border-b border-slate-200 px-1.5 text-[12px] last:border-b-0">
                    <span className="w-5 text-slate-400">{i + 1}</span>
                    <span className="flex-1 truncate">{f.label}</span>
                    <button title="Move up" className="text-slate-500 hover:text-brand disabled:opacity-30" disabled={i === 0} onClick={() => patch({ columns: arrMove(def.columns, i, -1) })}><ArrowUp size={12} /></button>
                    <button title="Move down" className="text-slate-500 hover:text-brand disabled:opacity-30" disabled={i === selectedFields.length - 1} onClick={() => patch({ columns: arrMove(def.columns, i, 1) })}><ArrowDown size={12} /></button>
                    <button title="Remove" className="text-slate-500 hover:text-red-600" onClick={() => patch({ columns: def.columns.filter((k) => k !== f.key) })}><X size={12} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <SectionHeader title="FILTERS" right={<button className="text-[11px] text-brand hover:underline" onClick={() => patch({ filters: [...def.filters, { field: fields[0]?.key ?? '', op: 'eq', value: '' }] })}>+ Add</button>} />
          <div className="space-y-1 p-2">
            {def.filters.length === 0 && <div className="text-[11px] text-slate-500">No filters.</div>}
            {def.filters.map((f, i) => {
              const upd = (p: Partial<FilterRow>) => patch({ filters: def.filters.map((x, j) => (j === i ? { ...x, ...p } : x)) });
              const ft = fieldOf(f.field)?.type;
              return (
                <div key={i} className="flex items-center gap-1">
                  <Select className="!w-32" value={f.field} options={fields.map((x) => ({ value: x.key, label: x.label }))} onChange={(e) => upd({ field: e.target.value })} />
                  <Select className="!w-24" value={f.op} options={ent.data.operators.map((o) => ({ value: o, label: OP_LABEL[o as Op] ?? o }))} onChange={(e) => upd({ op: e.target.value as Op })} />
                  <Input
                    className="min-w-0 flex-1"
                    type={ft === 'date' && f.op !== 'between' && f.op !== 'in' ? 'date' : 'text'}
                    placeholder={f.op === 'between' ? 'from, to' : f.op === 'in' ? 'a, b, c' : 'value'}
                    value={f.value}
                    onChange={(e) => upd({ value: e.target.value })}
                  />
                  <button title="Remove" className="text-slate-500 hover:text-red-600" onClick={() => patch({ filters: def.filters.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
                </div>
              );
            })}
          </div>

          <SectionHeader title="GROUP BY" />
          <div className="p-2">
            <div className="grid grid-cols-2 gap-x-2 rounded border border-app-border p-1.5">
              {fields.filter((f) => f.groupable).map((f) => (
                <Checkbox key={f.key} label={f.label} checked={def.groupBy.includes(f.key)} onChange={(e) => patch({ groupBy: e.target.checked ? [...def.groupBy, f.key].slice(0, 5) : def.groupBy.filter((k) => k !== f.key) })} />
              ))}
            </div>
          </div>

          <SectionHeader title="AGGREGATES" right={<button className="text-[11px] text-brand hover:underline" onClick={() => patch({ aggregates: [...def.aggregates, { fn: 'sum', field: numFields[0]?.key ?? '' }] })}>+ Add</button>} />
          <div className="space-y-1 p-2">
            {def.aggregates.length === 0 && <div className="text-[11px] text-slate-500">{def.groupBy.length ? 'Row count is added automatically.' : 'None.'}</div>}
            {def.aggregates.map((a, i) => {
              const upd = (p: Partial<AggRow>) => patch({ aggregates: def.aggregates.map((x, j) => (j === i ? { ...x, ...p } : x)) });
              return (
                <div key={i} className="flex items-center gap-1">
                  <Select className="!w-24" value={a.fn} options={ent.data.aggregates.map((f) => ({ value: f, label: FN_LABEL[f as Fn] ?? f }))} onChange={(e) => upd({ fn: e.target.value as Fn })} />
                  <Select
                    className="flex-1"
                    value={a.field}
                    placeholder={a.fn === 'count' ? '(rows)' : 'Field'}
                    options={(a.fn === 'count' || a.fn === 'min' || a.fn === 'max' ? fields : numFields).map((f) => ({ value: f.key, label: f.label }))}
                    onChange={(e) => upd({ field: e.target.value })}
                  />
                  <button title="Remove" className="text-slate-500 hover:text-red-600" onClick={() => patch({ aggregates: def.aggregates.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
                </div>
              );
            })}
          </div>

          <SectionHeader title="SORT" right={<button className="text-[11px] text-brand hover:underline" onClick={() => patch({ sort: [...def.sort, { field: sortChoices[0]?.key ?? '', dir: 'asc' as const }].slice(0, 5) })}>+ Add</button>} />
          <div className="space-y-1 p-2">
            {def.sort.length === 0 && <div className="text-[11px] text-slate-500">Default order.</div>}
            {def.sort.map((s, i) => {
              const upd = (p: Partial<SortRow>) => patch({ sort: def.sort.map((x, j) => (j === i ? { ...x, ...p } : x)) });
              const opts = sortChoices.some((c) => c.key === s.field) ? sortChoices : [...sortChoices, { key: s.field, label: s.field }];
              return (
                <div key={i} className="flex items-center gap-1">
                  <Select className="flex-1" value={s.field} options={opts.map((c) => ({ value: c.key, label: c.label }))} onChange={(e) => upd({ field: e.target.value })} />
                  <Select className="!w-24" value={s.dir} options={[{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }]} onChange={(e) => upd({ dir: e.target.value as 'asc' | 'desc' })} />
                  <button title="Remove" className="text-slate-500 hover:text-red-600" onClick={() => patch({ sort: def.sort.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---------------- preview ---------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="no-print flex items-center gap-2 border-b border-app-border bg-app-head px-2 py-1">
            <Button variant="primary" size="sm" icon={Play} loading={run.isFetching} onClick={() => setApplied({ ...def })}>Run</Button>
            <Checkbox label="Live preview" checked={live} onChange={(e) => setLive(e.target.checked)} />
            <div className="flex-1" />
            {run.data && (
              <span className="text-[11px] text-slate-500">
                {run.data.rows.length} of {run.data.total} rows{run.data.truncated ? ' (truncated by row limit)' : ''} - {fmt.dateTime(run.data.generatedAt)}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {!applied && <div className="p-6 text-center text-[12px] text-slate-500">Configure the report on the left{live ? '' : ' and press Run'}.</div>}
            {run.isLoading && <LoadingBlock label="Running..." />}
            {run.error && !run.isLoading && <ErrorState message={apiError(run.error)} onRetry={() => run.refetch()} />}
            {run.data && !run.error && (
              <ResultGrid
                key={`${run.data.entity}|${run.data.columns.map((c) => c.key).join(',')}`}
                storageKey={`builder.${run.data.entity}`}
                columns={run.data.columns}
                rows={run.data.rows}
                totals={run.data.totals}
                rowCountLabel={`${run.data.rows.length} rows`}
              />
            )}
          </div>
        </div>
      </div>

      {/* ---------------- save dialog ---------------- */}
      <Modal
        open={saveOpen}
        title={loaded && !form.asNew ? 'Update saved report' : 'Save report'}
        onClose={() => setSaveOpen(false)}
        width="sm"
        footer={<><Button onClick={() => setSaveOpen(false)}>Cancel</Button><Button variant="primary" icon={Save} loading={saveM.isPending} disabled={!form.name.trim()} onClick={() => saveM.mutate()}>Save</Button></>}
      >
        <div className="space-y-2">
          <Field label="Name" required><Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} /></Field>
          <Field label="Description"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Checkbox label="Share with all users" checked={form.shared} onChange={(e) => setForm({ ...form, shared: e.target.checked })} />
        </div>
      </Modal>

      {/* ---------------- saved list ---------------- */}
      <Modal open={loadOpen} title="Saved reports" onClose={() => setLoadOpen(false)} width="lg">
        {savedQ.isLoading && <LoadingBlock />}
        {savedQ.error && <ErrorState message={apiError(savedQ.error)} onRetry={() => savedQ.refetch()} />}
        {savedQ.data?.length === 0 && <div className="py-6 text-center text-[12px] text-slate-500">No saved reports yet.</div>}
        {!!savedQ.data?.length && (
          <table className="w-full border-separate border-spacing-0 text-[12px]">
            <thead><tr className="h-7"><th className="grid-th">Name</th><th className="grid-th">Entity</th><th className="grid-th">Owner</th><th className="grid-th">Shared</th><th className="grid-th">Updated</th><th className="grid-th" /></tr></thead>
            <tbody>
              {savedQ.data.map((s) => (
                <tr key={s.id} className="h-7 hover:bg-brand-light/60">
                  <td className="grid-td"><button className="font-medium text-brand hover:underline" onClick={() => loadSaved(s)}>{s.name}</button>{s.description && <div className="text-[11px] text-slate-500">{s.description}</div>}</td>
                  <td className="grid-td">{ent.data.entities.find((e) => e.key === s.definition.entity)?.label ?? s.definition.entity}</td>
                  <td className="grid-td">{s.createdByName}</td>
                  <td className="grid-td text-center">{s.shared ? 'Yes' : 'No'}</td>
                  <td className="grid-td whitespace-nowrap">{fmt.dateTime(s.updatedAt)}</td>
                  <td className="grid-td text-center">
                    <Button size="sm" onClick={() => loadSaved(s)}>Load</Button>{' '}
                    {canModify(s) && <Button size="sm" variant="danger" icon={Trash2} onClick={() => setDelTarget(s)}>Delete</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
      <ConfirmDialog open={!!delTarget} danger title="Delete saved report" message={`Delete "${delTarget?.name}"? This cannot be undone.`} confirmLabel="Delete" loading={delM.isPending} onConfirm={() => delTarget && delM.mutate(delTarget)} onCancel={() => setDelTarget(null)} />
    </div>
  );
}

export default [{ id: 'report-builder', title: 'Report Builder', icon: Hammer, component: ReportBuilderScreen, permission: 'report_builder' }] satisfies ScreenDef[];
