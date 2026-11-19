import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Columns3, Layers } from 'lucide-react';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button, Checkbox } from '@/components/ui';
import type { ReportCol, Row } from './reportTypes';

export interface DrillSpec {
  /** backend doc type (UPPER_SNAKE, see lib/docRoutes) */
  type: string;
  /** row key holding the numeric id, when the report provides one */
  idKey?: string;
}
export type DrillMap = Record<string, DrillSpec>;

const NUMERIC = new Set(['number', 'money', 'qty', 'percent']);

export function formatCell(c: ReportCol, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  switch (c.type) {
    case 'money': return fmt.money(v);
    case 'qty': return fmt.qty(v);
    case 'number': return typeof v === 'number' ? fmt.qty(v) : String(v);
    case 'percent': return fmt.percent(v);
    case 'date': return fmt.date(v as string);
    default: return String(v);
  }
}

const cmp = (a: unknown, b: unknown, numeric: boolean): number => {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return -1;
  if (b === null || b === undefined || b === '') return 1;
  if (numeric) return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true });
};

const load = <T,>(k: string, d: T): T => {
  try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as T) : d; } catch { return d; }
};
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

export function ResultGrid({ storageKey, columns, rows, totals, drill, onDrill, rowCountLabel }: {
  storageKey: string;
  columns: ReportCol[];
  rows: Row[];
  totals?: Row;
  drill?: DrillMap;
  onDrill?: (spec: DrillSpec, row: Row, col: ReportCol) => void;
  rowCountLabel?: string;
}) {
  const [hidden, setHidden] = useState<string[]>(() => load(`rpt.hidden.${storageKey}`, []));
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [groupKey, setGroupKey] = useState<string>('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);

  useEffect(() => save(`rpt.hidden.${storageKey}`, hidden), [hidden, storageKey]);
  // a different column set (groupBy variant) invalidates sort/group
  const sig = columns.map((c) => c.key).join('|');
  useEffect(() => { setSort(null); setGroupKey(''); setCollapsed(new Set()); }, [sig]);

  const visible = columns.filter((c) => !hidden.includes(c.key));
  const colOf = (k: string) => columns.find((c) => c.key === k);

  const sorted = useMemo(() => {
    const c = sort ? colOf(sort.key) : undefined;
    let out = rows;
    if (sort && c) {
      const num = NUMERIC.has(c.type);
      out = [...rows].sort((a, b) => (sort.dir === 'asc' ? 1 : -1) * cmp(a[sort.key], b[sort.key], num));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, sig]);

  const groups = useMemo(() => {
    if (!groupKey) return null;
    const map = new Map<string, Row[]>();
    for (const r of sorted) {
      const k = String(r[groupKey] ?? '') || '(blank)';
      (map.get(k) ?? map.set(k, []).get(k)!).push(r);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [sorted, groupKey]);

  const toggleSort = (key: string) =>
    setSort((s) => (!s || s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));

  const sums = (rs: Row[]) => {
    const t: Record<string, number> = {};
    for (const c of visible) if (c.sum) t[c.key] = rs.reduce((a, r) => a + (Number(r[c.key]) || 0), 0);
    return t;
  };

  const renderRow = (r: Row, i: number) => (
    <tr key={i} className={cn('h-6 hover:bg-brand-light/60', i % 2 ? 'bg-slate-50' : '')}>
      {visible.map((c) => {
        const spec = drill?.[c.key];
        const v = r[c.key];
        const text = formatCell(c, v);
        const canDrill = !!spec && !!onDrill && text !== '';
        return (
          <td key={c.key} className={cn('grid-td whitespace-nowrap', c.align === 'right' && 'text-right tabular-nums', c.align === 'center' && 'text-center')}>
            {canDrill ? (
              <button type="button" className="text-brand hover:underline" onClick={() => onDrill!(spec, r, c)}>{text}</button>
            ) : (
              text
            )}
          </td>
        );
      })}
    </tr>
  );

  const textCols = columns.filter((c) => c.type === 'text');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="no-print flex items-center gap-2 border-b border-app-border bg-white px-2 py-1">
        <div className="relative">
          <Button size="sm" icon={Columns3} onClick={() => setMenu((m) => !m)}>Columns</Button>
          {menu && (
            <div className="absolute left-0 top-7 z-30 max-h-72 w-52 overflow-auto rounded border border-app-border bg-white p-2 shadow">
              {columns.map((c) => (
                <div key={c.key} className="py-0.5">
                  <Checkbox
                    label={c.label}
                    checked={!hidden.includes(c.key)}
                    onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((k) => k !== c.key) : [...h, c.key]))}
                  />
                </div>
              ))}
              <button type="button" className="mt-1 text-[11px] text-brand hover:underline" onClick={() => { setHidden([]); setMenu(false); }}>Show all</button>
            </div>
          )}
        </div>
        {textCols.length > 0 && (
          <label className="flex items-center gap-1 text-[11px] text-slate-600">
            <Layers size={13} /> Group rows by
            <select className="ctl !h-6 !w-36" value={groupKey} onChange={(e) => { setGroupKey(e.target.value); setCollapsed(new Set()); }}>
              <option value="">None</option>
              {textCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
        )}
        <div className="flex-1" />
        <span className="text-[11px] text-slate-500">{rowCountLabel ?? `${rows.length} rows`}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-white" onClick={() => menu && setMenu(false)}>
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr className="h-7">
              {visible.map((c) => (
                <th
                  key={c.key}
                  className={cn('grid-th cursor-pointer select-none whitespace-nowrap', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}
                  onClick={() => toggleSort(c.key)}
                >
                  {c.label}
                  {sort?.key === c.key && (sort.dir === 'asc' ? <ArrowUp size={10} className="ml-0.5 inline" /> : <ArrowDown size={10} className="ml-0.5 inline" />)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={Math.max(1, visible.length)} className="px-3 py-8 text-center text-[12px] text-slate-500">No data for the selected parameters.</td></tr>
            )}
            {groups
              ? groups.map(([k, rs]) => {
                  const open = !collapsed.has(k);
                  const s = sums(rs);
                  return (
                    <Fragment key={k}>
                      <tr className="h-6 cursor-pointer bg-slate-100 font-semibold" onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>
                        {visible.map((c, ci) => (
                          <td key={c.key} className={cn('grid-td whitespace-nowrap', c.align === 'right' && 'text-right tabular-nums')}>
                            {ci === 0 ? (
                              <span className="inline-flex items-center gap-1">
                                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                {k} <span className="font-normal text-slate-500">({rs.length})</span>
                              </span>
                            ) : c.sum ? formatCell(c, s[c.key]) : ''}
                          </td>
                        ))}
                      </tr>
                      {open && rs.map(renderRow)}
                    </Fragment>
                  );
                })
              : sorted.map(renderRow)}
          </tbody>
          {rows.length > 0 && totals && visible.some((c) => totals[c.key] !== undefined) && (
            <tfoot>
              <tr className="h-7 font-semibold">
                {visible.map((c, ci) => (
                  <td key={c.key} className={cn('sticky bottom-0 border-r border-t-2 border-app-border bg-app-head px-2 whitespace-nowrap', c.align === 'right' && 'text-right tabular-nums')}>
                    {ci === 0 && totals[c.key] === undefined ? 'Total' : totals[c.key] !== undefined ? formatCell(c, totals[c.key]) : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
