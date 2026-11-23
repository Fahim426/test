/** Salesman monthly sales targets + incentive slabs (achievement % of target -> % of gross profit). */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeDollarSign, ChevronLeft, ChevronRight, Copy, Plus, RotateCcw, Save, Target, Trash2 } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { toast } from '@/store/toast';
import { usePermission } from '@/store/auth';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { Badge, Button, EmptyState, ErrorState, IconButton, LoadingBlock, NumberInput, Panel, Select, Toolbar, ToolbarSep } from '@/components/ui';

interface TargetRow {
  salesmanId: number;
  code: string;
  name: string;
  isActive: boolean;
  /** any default ever saved (else the first one saved applies to all months) */
  hasDefault: boolean;
  defaultTarget: number;
  /** month the default in effect started (null = initial default, all months) */
  defaultFrom: string | null;
  /** month of the next later default change, if any */
  defaultUntil: string | null;
  target: number | null;
  effective: number;
}
interface Slab {
  fromPct: number;
  ratePct: number;
}
/** Input text per salesman; month '' = no override (default applies). */
type Draft = { def: string; month: string };

const pad = (n: number) => String(n).padStart(2, '0');
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const shift = (period: string, by: number) => {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const monthLabel = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
};
/** Under the default input: where the default in effect comes from, or which months an edit will apply to. */
function defaultNote(r: TargetRow, period: string, editing: boolean): string {
  const until = r.defaultUntil ? ` until ${monthLabel(shift(r.defaultUntil, -1))}` : ' onward';
  if (editing) return r.hasDefault ? `applies from ${monthLabel(period)}${until}` : 'applies to all months';
  if (!r.hasDefault) return 'not set';
  return r.defaultFrom ? `since ${monthLabel(r.defaultFrom)}${r.defaultUntil ? `, changes ${monthLabel(r.defaultUntil)}` : ''}` : r.defaultUntil ? `initial, changes ${monthLabel(r.defaultUntil)}` : 'all months';
}
const asDraft = (r: TargetRow): Draft => ({ def: String(r.defaultTarget), month: r.target === null ? '' : String(r.target) });
const n = (s: string) => (s.trim() === '' ? null : Math.max(0, Number(s) || 0));

function SalesTargetsScreen({ tabId }: ScreenProps) {
  const can = usePermission();
  const canEdit = can('sales_incentive', 'edit');
  const qc = useQueryClient();
  const ws = useWorkspace();
  const open = useOpenScreen();

  const [period, setPeriod] = useState(thisMonth);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [bulk, setBulk] = useState('');
  const [bulkTo, setBulkTo] = useState<'month' | 'def'>('month');
  const [slabDraft, setSlabDraft] = useState<{ fromPct: string; ratePct: string }[] | null>(null);

  const q = useQuery({
    queryKey: ['sales-targets', period],
    queryFn: async () => (await api.get<{ rows: TargetRow[] }>(`/sales-targets/${period}`)).data.rows,
  });
  const slabsQ = useQuery({ queryKey: ['incentive-slabs'], queryFn: async () => (await api.get<{ rows: Slab[] }>('/incentive-slabs')).data.rows });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const slabs = slabsQ.data ?? [];

  const changed = useMemo(
    () =>
      rows.filter((r) => {
        const d = drafts[r.salesmanId];
        if (!d) return false;
        return n(d.def) !== r.defaultTarget || n(d.month) !== r.target;
      }),
    [rows, drafts],
  );
  const slabsDirty = slabDraft !== null;
  useEffect(() => {
    ws.setDirty(tabId, changed.length > 0 || slabsDirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changed.length, slabsDirty, tabId]);

  const draftOf = (r: TargetRow) => drafts[r.salesmanId] ?? asDraft(r);
  const patch = (r: TargetRow, p: Partial<Draft>) => setDrafts((d) => ({ ...d, [r.salesmanId]: { ...(d[r.salesmanId] ?? asDraft(r)), ...p } }));

  const changeMonth = (p: string) => {
    if (changed.length && !window.confirm('Discard unsaved target changes?')) return;
    setDrafts({});
    setPeriod(p);
  };

  const saveTargets = useMutation({
    mutationFn: async () =>
      api.put(`/sales-targets/${period}`, {
        rows: changed.map((r) => {
          const d = drafts[r.salesmanId];
          const def = n(d.def) ?? 0;
          return { salesmanId: r.salesmanId, ...(def !== r.defaultTarget ? { defaultTarget: def } : {}), target: n(d.month) };
        }),
      }),
    onSuccess: () => {
      toast.success(`Targets for ${monthLabel(period)} saved`);
      setDrafts({});
      qc.invalidateQueries({ queryKey: ['sales-targets'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const copyPrevious = async () => {
    try {
      const prev = (await api.get<{ rows: TargetRow[] }>(`/sales-targets/${shift(period, -1)}`)).data.rows;
      const byId = new Map(prev.map((p) => [p.salesmanId, p.effective]));
      setDrafts((d) => {
        const next = { ...d };
        for (const r of rows) if (byId.has(r.salesmanId)) next[r.salesmanId] = { ...(d[r.salesmanId] ?? asDraft(r)), month: String(byId.get(r.salesmanId)) };
        return next;
      });
      toast.success(`Copied targets from ${monthLabel(shift(period, -1))}; review and save`);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const applyBulk = () => {
    const v = n(bulk);
    if (v === null) return;
    setDrafts((d) => {
      const next = { ...d };
      for (const r of rows) next[r.salesmanId] = { ...(d[r.salesmanId] ?? asDraft(r)), [bulkTo]: String(v) };
      return next;
    });
  };

  // ---- slabs
  const editSlabs = slabDraft ?? slabs.map((s) => ({ fromPct: String(s.fromPct), ratePct: String(s.ratePct) }));
  const setSlab = (i: number, p: Partial<{ fromPct: string; ratePct: string }>) => setSlabDraft(editSlabs.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const saveSlabs = useMutation({
    mutationFn: async () =>
      api.put('/incentive-slabs', { rows: editSlabs.filter((s) => s.fromPct.trim() !== '').map((s) => ({ fromPct: Number(s.fromPct) || 0, ratePct: Number(s.ratePct) || 0 })) }),
    onSuccess: () => {
      toast.success('Incentive slabs saved');
      setSlabDraft(null);
      qc.invalidateQueries({ queryKey: ['incentive-slabs'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const sortedPreview = [...editSlabs].filter((s) => s.fromPct.trim() !== '').sort((a, b) => Number(a.fromPct) - Number(b.fromPct));

  const totalTarget = rows.reduce((a, r) => a + (n(draftOf(r).month) ?? n(draftOf(r).def) ?? 0), 0);

  if (q.isError) return <ErrorState message={apiError(q.error)} onRetry={() => q.refetch()} />;
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <IconButton icon={ChevronLeft} label="Previous month" onClick={() => changeMonth(shift(period, -1))} />
        <input type="month" className="ctl w-40" value={period} onChange={(e) => e.target.value && changeMonth(e.target.value)} />
        <IconButton icon={ChevronRight} label="Next month" onClick={() => changeMonth(shift(period, 1))} />
        {canEdit && (
          <>
            <ToolbarSep />
            <Button size="sm" icon={Copy} onClick={copyPrevious}>Copy previous month</Button>
            <ToolbarSep />
            <NumberInput className="w-32" min={0} placeholder="Amount" value={bulk} onChange={(e) => setBulk(e.target.value)} />
            <Select className="w-40" value={bulkTo} onChange={(e) => setBulkTo(e.target.value as 'month' | 'def')} options={[{ value: 'month', label: `For ${monthLabel(period)}` }, { value: 'def', label: 'As default (every month)' }]} />
            <Button size="sm" disabled={n(bulk) === null} onClick={applyBulk}>Set for all</Button>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {changed.length > 0 && <Badge tone="amber">{changed.length} unsaved</Badge>}
          {canEdit && changed.length > 0 && <Button size="sm" icon={RotateCcw} onClick={() => setDrafts({})}>Undo</Button>}
          {canEdit && <Button size="sm" variant="primary" icon={Save} disabled={!changed.length} loading={saveTargets.isPending} onClick={() => saveTargets.mutate()}>Save targets</Button>}
          <Button size="sm" icon={BadgeDollarSign} onClick={() => open('salesman-incentive', undefined, 'Salesman Incentive')}>Incentive report</Button>
        </div>
      </Toolbar>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 lg:flex-row">
        <Panel title={`Sales targets — ${monthLabel(period)}`} className="min-w-0 flex-1" bodyClassName="p-0">
          {q.isLoading ? (
            <LoadingBlock />
          ) : rows.length === 0 ? (
            <EmptyState title="No active salesmen" hint="Add salesmen under Masters → Sales Setup → Salesman." />
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="grid-th text-left">Code</th>
                  <th className="grid-th text-left">Salesman</th>
                  <th className="grid-th text-right" title={`A change applies from ${monthLabel(period)} onward; earlier months keep their target. The first default set applies to all months.`}>Default monthly target</th>
                  <th className="grid-th text-right" title="Leave empty to use the default">Target for {monthLabel(period)}</th>
                  <th className="grid-th text-right">Applies</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = draftOf(r);
                  const dirty = n(d.def) !== r.defaultTarget || n(d.month) !== r.target;
                  const eff = n(d.month) ?? n(d.def) ?? 0;
                  return (
                    <tr key={r.salesmanId} className={dirty ? 'h-9 bg-warning-soft' : 'h-9 hover:bg-surface-2'}>
                      <td className="grid-td font-mono text-xs">{r.code}</td>
                      <td className="grid-td">
                        {r.name} {!r.isActive && <Badge className="ml-1">inactive</Badge>}
                      </td>
                      <td className="grid-td text-right">
                        <NumberInput className="ml-auto w-36" min={0} disabled={!canEdit} value={d.def} onChange={(e) => patch(r, { def: e.target.value })} />
                        <div className="text-[11px] text-ink-faint">{defaultNote(r, period, n(d.def) !== r.defaultTarget)}</div>
                      </td>
                      <td className="grid-td">
                        <NumberInput className="ml-auto w-36" min={0} disabled={!canEdit} placeholder="Default" value={d.month} onChange={(e) => patch(r, { month: e.target.value })} />
                      </td>
                      <td className="grid-td text-right tabular-nums">
                        {fmt.money(eff)}
                        <div className="text-[11px] text-ink-faint">{n(d.month) !== null ? 'month target' : 'default'}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="h-9 font-semibold">
                  <td className="grid-td" colSpan={4}>Total target</td>
                  <td className="grid-td text-right tabular-nums">{fmt.money(totalTarget)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Panel>

        <Panel
          title="Incentive slabs"
          className="lg:w-[340px] lg:shrink-0"
          right={slabsDirty ? <Badge tone="amber">unsaved</Badge> : undefined}
        >
          <p className="mb-3 text-xs text-ink-muted">
            Achievement = net sales of the month ÷ target. The highest slab reached sets the % of the month&apos;s <b>gross profit</b> paid as incentive. Below the first slab, nothing is paid.
          </p>
          {slabsQ.isLoading ? (
            <LoadingBlock />
          ) : (
            <>
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="grid-th text-left">Achieved from %</th>
                    <th className="grid-th text-left">% of profit</th>
                    <th className="grid-th" />
                  </tr>
                </thead>
                <tbody>
                  {editSlabs.map((s, i) => (
                    <tr key={i} className="h-9">
                      <td className="grid-td"><NumberInput min={0} disabled={!canEdit} value={s.fromPct} onChange={(e) => setSlab(i, { fromPct: e.target.value })} /></td>
                      <td className="grid-td"><NumberInput min={0} max={100} disabled={!canEdit} value={s.ratePct} onChange={(e) => setSlab(i, { ratePct: e.target.value })} /></td>
                      <td className="grid-td w-8">{canEdit && <IconButton icon={Trash2} label="Remove slab" variant="danger" onClick={() => setSlabDraft(editSlabs.filter((_, k) => k !== i))} />}</td>
                    </tr>
                  ))}
                  {editSlabs.length === 0 && (
                    <tr>
                      <td className="grid-td text-center text-xs text-ink-muted" colSpan={3}>No slabs yet: no incentive is paid.</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {sortedPreview.length > 0 && (
                <ul className="mt-3 space-y-0.5 text-xs text-ink-muted">
                  {sortedPreview.map((s, i) => {
                    const next = sortedPreview[i + 1];
                    return (
                      <li key={i}>
                        {next ? `${Number(s.fromPct)}% to below ${Number(next.fromPct)}%` : `${Number(s.fromPct)}% and above`} → <b className="text-ink">{Number(s.ratePct) || 0}%</b> of gross profit
                      </li>
                    );
                  })}
                </ul>
              )}
              {canEdit && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" icon={Plus} onClick={() => setSlabDraft([...editSlabs, { fromPct: '', ratePct: '' }])}>Add slab</Button>
                  {slabsDirty && <Button size="sm" icon={RotateCcw} onClick={() => setSlabDraft(null)}>Undo</Button>}
                  <Button size="sm" variant="primary" icon={Save} className="ml-auto" disabled={!slabsDirty} loading={saveSlabs.isPending} onClick={() => saveSlabs.mutate()}>Save slabs</Button>
                </div>
              )}
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

export default [{ id: 'sales-targets', title: 'Sales Targets & Incentive', icon: Target, component: SalesTargetsScreen, permission: 'sales_incentive' }] satisfies ScreenDef[];
