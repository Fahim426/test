import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ColumnDef, flexRender, getCoreRowModel, useReactTable, VisibilityState } from '@tanstack/react-table';
import {
  AlignJustify, ArrowDown, ArrowUp, ChevronLeft, ChevronsUpDown, Rows3, ChevronRight, ChevronsLeft, ChevronsRight, Columns3, Download, Filter, Printer, RefreshCw, Search, X,
  type LucideIcon,
} from 'lucide-react';
import { api, apiError, Paged } from '@/lib/api';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';
import { downloadExport, ExportFormat, printRows } from '@/lib/export';
import { toast } from '@/store/toast';
import { useUi } from '@/store/ui';
import { StatusBadge, Spinner, EmptyState, ErrorState } from '@/components/ui';

export type ColumnType = 'text' | 'money' | 'qty' | 'number' | 'percent' | 'date' | 'datetime' | 'status' | 'boolean';

export type ColumnFilter = 'text' | 'date' | { type: 'select'; options: { value: string; label: string }[] };

export interface Column<T> {
  /** Field name; supports nested paths ("supplier.name"). Also the sort key sent as `sort`. */
  key: string;
  header: string;
  type?: ColumnType;
  /** custom value getter (default: row[key]) */
  accessor?: (row: T) => unknown;
  /** custom cell renderer (overrides `type` rendering) */
  cell?: (row: T) => ReactNode;
  width?: number;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean; // default true
  /** hide by default; user can enable from the Columns menu */
  hidden?: boolean;
  /**
   * Column filter row control.
   * - 'text': client-side filter on loaded rows, unless `filterParam` is given (then sent to the server).
   * - select: sent as `?<filterParam ?? key>=value`
   * - 'date': date range sent as `?<filterParam>From=&<filterParam>To=` (default `from` / `to`)
   */
  filter?: ColumnFilter;
  filterParam?: string;
  /** footer total: 'sum' of loaded rows, or custom renderer of loaded rows */
  total?: 'sum' | ((rows: T[]) => ReactNode);
  /** value used for CSV/Excel/PDF/print (default derived from type) */
  exportValue?: (row: T) => string | number;
  /** omit from exports (e.g. icon columns) */
  noExport?: boolean;
}

export interface RowAction<T> {
  label: string;
  icon?: LucideIcon;
  onClick: (row: T) => void;
  danger?: boolean;
  hidden?: (row: T) => boolean;
  disabled?: (row: T) => boolean;
}
export interface BulkAction<T> {
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  onClick: (rows: T[], clearSelection: () => void) => void;
}

export type TableParams = Record<string, string | number | boolean | undefined | null>;

export interface DataTableProps<T extends object> {
  /** unique per table; used to persist column visibility / page size */
  tableKey: string;
  columns: Column<T>[];
  /** server list endpoint (relative to /api), e.g. '/purchase-orders' */
  url?: string;
  /** or a custom fetcher that receives page,pageSize,search,sort,dir + filters */
  fetcher?: (params: TableParams) => Promise<Paged<T>>;
  /** react-query key prefix; invalidate with queryClient.invalidateQueries({ queryKey: ['table', queryKey] }). Defaults to url/tableKey. */
  queryKey?: string;
  /** extra query params (status, from, to, supplierId...). Changing them refetches and resets to page 1. */
  filters?: TableParams;
  rowActions?: RowAction<T>[] | ((row: T) => RowAction<T>[]);
  bulkActions?: BulkAction<T>[];
  onRowDoubleClick?: (row: T) => void;
  exportName?: string;
  toolbarExtras?: ReactNode;
  /** server supplied totals row, keyed by column key (rendered in footer instead of 'sum') */
  totals?: Record<string, ReactNode | number | string>;
  getRowId?: (row: T) => string | number;
  zebra?: boolean;
  defaultPageSize?: number;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  /** enable row checkboxes (default: true when bulkActions given) */
  selectable?: boolean;
  searchPlaceholder?: string;
  height?: string;
  /** hide the search box */
  noSearch?: boolean;
}

const PAGE_SIZES = [25, 50, 100, 200];

const getPath = (o: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), o);

const useDebounced = <V,>(v: V, ms = 300): V => {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
};

const lsGet = <V,>(k: string, fallback: V): V => {
  try {
    const s = localStorage.getItem(k);
    return s ? (JSON.parse(s) as V) : fallback;
  } catch {
    return fallback;
  }
};
const lsSet = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};

function renderValue(v: unknown, type: ColumnType | undefined): ReactNode {
  switch (type) {
    case 'money': return fmt.money(v);
    case 'qty': return fmt.qty(v);
    case 'number': return fmt.num(v);
    case 'percent': return fmt.percent(v);
    case 'date': return fmt.date(v as string);
    case 'datetime': return fmt.dateTime(v as string);
    case 'status': return <StatusBadge status={v as string} />;
    case 'boolean': return v ? 'Yes' : 'No';
    default: return v === null || v === undefined ? '' : String(v);
  }
}
/** Status cell + "Pending n" chip when the server marked the row (pendingCount: items not carried to the next document). */
function withPending(node: ReactNode, row: unknown): ReactNode {
  const n = Number((row as { pendingCount?: number } | null)?.pendingCount ?? 0);
  if (!n) return node;
  return (
    <span className="inline-flex items-center gap-1.5">
      {node}
      <span title={`${n} item${n === 1 ? '' : 's'} not yet carried to the next document`} className="inline-flex items-center whitespace-nowrap rounded-full border border-warning/40 bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold leading-3 text-warning">
        Pending {n}
      </span>
    </span>
  );
}
const isRight = (c: { type?: ColumnType; align?: string }) => c.align === 'right' || (!c.align && (c.type === 'money' || c.type === 'qty' || c.type === 'number' || c.type === 'percent'));

function plainValue<T>(c: Column<T>, row: T): string | number {
  if (c.exportValue) return c.exportValue(row);
  const v = c.accessor ? c.accessor(row) : getPath(row, c.key);
  switch (c.type) {
    case 'money': case 'qty': case 'number': case 'percent': return v === null || v === undefined || v === '' ? '' : Number(v);
    case 'date': return fmt.date(v as string);
    case 'datetime': return fmt.dateTime(v as string);
    case 'status': return fmt.status(v as string);
    case 'boolean': return v ? 'Yes' : 'No';
    default: return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}

interface FilterState {
  text: Record<string, string>;
  select: Record<string, string>;
  from: Record<string, string>;
  to: Record<string, string>;
}
const emptyFilters: FilterState = { text: {}, select: {}, from: {}, to: {} };

export function DataTable<T extends object>(props: DataTableProps<T>) {
  const {
    tableKey, columns, url, fetcher, filters, rowActions, bulkActions, onRowDoubleClick, exportName, toolbarExtras, totals, zebra = true,
    defaultPageSize = 50, defaultSort, searchPlaceholder = 'Search...', noSearch,
  } = props;
  const selectable = props.selectable ?? !!bulkActions?.length;
  const getRowId = props.getRowId ?? ((r: T) => (r as { id?: string | number }).id ?? JSON.stringify(r));
  const lsKey = `ss-table:${tableKey}`;
  const density = useUi((s) => s.density);
  const setDensity = useUi((s) => s.setDensity);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => lsGet<{ ps?: number }>(lsKey, {}).ps ?? defaultPageSize);
  const [search, setSearch] = useState('');
  const dSearch = useDebounced(search);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null);
  const [showFilters, setShowFilters] = useState(false);
  const [fState, setFState] = useState<FilterState>(emptyFilters);
  const dFState = useDebounced(fState);
  const [visibility, setVisibility] = useState<VisibilityState>(() => {
    const saved = lsGet<{ vis?: VisibilityState }>(lsKey, {}).vis;
    return saved ?? Object.fromEntries(columns.filter((c) => c.hidden).map((c) => [c.key, false]));
  });
  const [selected, setSelected] = useState<Record<string, T>>({});
  const [active, setActive] = useState(0);
  const [menu, setMenu] = useState<'cols' | 'export' | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => lsSet(lsKey, { vis: visibility, ps: pageSize }), [visibility, pageSize, lsKey]);
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-menu]')) setMenu(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);

  // server-side params
  const serverFilterParams = useMemo(() => {
    const p: TableParams = {};
    for (const c of columns) {
      if (!c.filter) continue;
      const name = c.filterParam ?? c.key;
      if (typeof c.filter === 'object' && dFState.select[c.key]) p[name] = dFState.select[c.key];
      if (c.filter === 'text' && c.filterParam && dFState.text[c.key]) p[name] = dFState.text[c.key];
      if (c.filter === 'date') {
        const base = c.filterParam;
        if (dFState.from[c.key]) p[base ? `${base}From` : 'from'] = dFState.from[c.key];
        if (dFState.to[c.key]) p[base ? `${base}To` : 'to'] = dFState.to[c.key];
      }
    }
    return p;
  }, [columns, dFState]);

  const extraKey = JSON.stringify(filters ?? {});
  const params: TableParams = useMemo(
    () => ({
      page,
      pageSize,
      search: dSearch || undefined,
      sort: sort?.key,
      dir: sort?.dir,
      ...(filters ?? {}),
      ...serverFilterParams,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, pageSize, dSearch, sort, extraKey, serverFilterParams],
  );

  // reset to first page when query changes
  useEffect(() => setPage(1), [dSearch, extraKey, serverFilterParams, pageSize, sort]);
  useEffect(() => setActive(0), [page, dSearch, extraKey]);

  const qkey = props.queryKey ?? url ?? tableKey;
  const q = useQuery({
    queryKey: ['table', qkey, params],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Paged<T>> => {
      if (fetcher) return fetcher(params);
      const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      const res = await api.get<Paged<T> | T[]>(url!, { params: clean });
      const d = res.data;
      return Array.isArray(d) ? { rows: d, total: d.length, page: 1, pageSize: d.length } : d;
    },
  });

  const allRows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  // client-side text column filters
  const rows = useMemo(() => {
    const active = columns.filter((c) => c.filter === 'text' && !c.filterParam && fState.text[c.key]);
    if (!active.length) return allRows;
    return allRows.filter((r) =>
      active.every((c) => String(c.accessor ? c.accessor(r) : getPath(r, c.key) ?? '').toLowerCase().includes(fState.text[c.key].toLowerCase())),
    );
  }, [allRows, columns, fState.text]);

  const colDefs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((c) => ({
        id: c.key,
        header: c.header,
        accessorFn: (r: T) => (c.accessor ? c.accessor(r) : getPath(r, c.key)),
        cell: (ctx) => (c.cell ? c.cell(ctx.row.original) : c.type === 'status' ? withPending(renderValue(ctx.getValue(), c.type), ctx.row.original) : renderValue(ctx.getValue(), c.type)),
        enableSorting: false,
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows,
    columns: colDefs,
    state: { columnVisibility: visibility },
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => String(getRowId(r)),
    manualPagination: true,
    manualSorting: true,
  });

  const visibleCols = table.getVisibleLeafColumns();
  const colById = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);
  const tRows = table.getRowModel().rows;

  const clearSel = useCallback(() => setSelected({}), []);
  const selCount = Object.keys(selected).length;
  const allOnPage = tRows.length > 0 && tRows.every((r) => selected[r.id]);
  const toggleRow = (id: string, row: T) =>
    setSelected((s) => {
      const n = { ...s };
      if (n[id]) delete n[id];
      else n[id] = row;
      return n;
    });
  const toggleAll = () =>
    setSelected((s) => {
      const n = { ...s };
      if (allOnPage) tRows.forEach((r) => delete n[r.id]);
      else tRows.forEach((r) => (n[r.id] = r.original));
      return n;
    });

  const exportCols = visibleCols.map((vc) => colById.get(vc.id)).filter((c): c is Column<T> => !!c && !c.noExport);
  const exportData = () => ({
    columns: exportCols.map((c) => ({ key: c.key, header: c.header, align: isRight(c) ? ('right' as const) : undefined })),
    rows: rows.map((r) => Object.fromEntries(exportCols.map((c) => [c.key, plainValue(c, r)]))),
  });
  const doExport = async (format: ExportFormat) => {
    setMenu(null);
    const d = exportData();
    try {
      await downloadExport({ title: exportName ?? tableKey, columns: d.columns, rows: d.rows, format });
    } catch (e) {
      toast.error(apiError(e));
    }
  };
  const doPrint = () => {
    setMenu(null);
    const d = exportData();
    printRows(exportName ?? tableKey, d.columns, d.rows);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if (typing) return;
    const n = tRows.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, n - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(n - 1, 0)); }
    else if (e.key === 'PageDown') { e.preventDefault(); setPage((p) => Math.min(p + 1, pages)); }
    else if (e.key === 'PageUp') { e.preventDefault(); setPage((p) => Math.max(p - 1, 1)); }
    else if (e.key === 'Enter' && tRows[active] && onRowDoubleClick) { e.preventDefault(); onRowDoubleClick(tRows[active].original); }
    else if (e.key === ' ' && tRows[active] && selectable) { e.preventDefault(); toggleRow(tRows[active].id, tRows[active].original); }
  };

  useEffect(() => {
    scroller.current?.querySelector<HTMLElement>(`[data-ri="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));

  const actionsOf = (r: T) => (typeof rowActions === 'function' ? rowActions(r) : (rowActions ?? []));
  const hasActions = !!rowActions;
  const hasTotals = !!totals || columns.some((c) => c.total);
  const sumOf = (c: Column<T>) => {
    if (totals && c.key in totals) return totals[c.key];
    if (!c.total) return '';
    if (c.total === 'sum') {
      const s = rows.reduce((acc, r) => acc + (Number(c.accessor ? c.accessor(r) : getPath(r, c.key)) || 0), 0);
      return renderValue(s, c.type ?? 'money');
    }
    return c.total(rows);
  };

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const colSpan = visibleCols.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0);

  const compact = density === 'compact';
  const rowH = compact ? 'h-8' : 'h-11';
  const filterChips: { label: string; clear: () => void }[] = [];
  for (const c of columns) {
    if (fState.text[c.key]) filterChips.push({ label: `${c.header}: ${fState.text[c.key]}`, clear: () => setFState((s) => ({ ...s, text: { ...s.text, [c.key]: '' } })) });
    if (fState.select[c.key]) {
      const opt = typeof c.filter === 'object' ? c.filter.options.find((o) => o.value === fState.select[c.key])?.label : fState.select[c.key];
      filterChips.push({ label: `${c.header}: ${opt}`, clear: () => setFState((s) => ({ ...s, select: { ...s.select, [c.key]: '' } })) });
    }
    if (fState.from[c.key] || fState.to[c.key])
      filterChips.push({
        label: `${c.header}: ${fState.from[c.key] || '…'} → ${fState.to[c.key] || '…'}`,
        clear: () => setFState((s) => ({ ...s, from: { ...s.from, [c.key]: '' }, to: { ...s.to, [c.key]: '' } })),
      });
  }
  const popover = 'absolute right-0 top-full z-40 mt-2 animate-pop-in rounded-xl border border-line bg-surface p-1 shadow-pop';
  const fctl = 'ctl !h-7 !rounded-md !px-2 !text-xs';

  return (
    <div
      ref={root}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        const t = e.target as HTMLElement;
        if (!t.closest('input,select,textarea,button,a')) root.current?.focus();
      }}
      className={cn('flex min-h-0 flex-col p-4 outline-none', props.height ?? 'h-full')}
    >
      <div className="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-surface shadow-card">
        {/* toolbar */}
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          {!noSearch && (
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-[10px] text-ink-faint" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="ctl w-[260px] pl-9 pr-8"
              />
              {search && (
                <button className="absolute right-2 top-[9px] rounded p-0.5 text-ink-faint hover:bg-surface-3 hover:text-ink" onClick={() => setSearch('')} aria-label="Clear search">
                  <X size={14} />
                </button>
              )}
            </div>
          )}
          {toolbarExtras}
          <div className="flex-1" />
          <button className={cn('tb-btn', showFilters && '!border-brand/40 !bg-brand-soft !text-brand-ink')} onClick={() => setShowFilters((v) => !v)} title="Column filters">
            <Filter size={14} /> Filters
            {filterChips.length > 0 && <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] text-white dark:text-[#0c0d14]">{filterChips.length}</span>}
          </button>
          <div className="relative" data-menu>
            <button className="tb-btn" onClick={() => setMenu(menu === 'cols' ? null : 'cols')} title="Column visibility">
              <Columns3 size={14} /> Columns
            </button>
            {menu === 'cols' && (
              <div className={cn(popover, 'max-h-[340px] w-[210px] overflow-auto')}>
                {table.getAllLeafColumns().map((c) => (
                  <label key={c.id} className="menu-item cursor-pointer">
                    <input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} className="h-4 w-4 accent-[rgb(var(--brand))]" />
                    {String(c.columnDef.header)}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="relative" data-menu>
            <button className="tb-btn" onClick={() => setMenu(menu === 'export' ? null : 'export')} title="Export">
              <Download size={14} /> Export
            </button>
            {menu === 'export' && (
              <div className={cn(popover, 'w-[170px]')}>
                {([['csv', 'CSV'], ['xlsx', 'Excel (.xlsx)'], ['pdf', 'PDF'], ['docx', 'Word (.docx)']] as [ExportFormat, string][]).map(([f, label]) => (
                  <button key={f} className="menu-item" onClick={() => doExport(f)}>
                    {label}
                  </button>
                ))}
                <div className="my-1 h-px bg-line" />
                <button className="menu-item" onClick={doPrint}>
                  <Printer size={14} className="text-ink-faint" /> Print
                </button>
              </div>
            )}
          </div>
          <div className="flex rounded-lg border border-line-strong bg-surface p-0.5 shadow-card" title="Row density">
            {(['comfortable', 'compact'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDensity(d)}
                aria-label={d}
                className={cn('flex h-7 w-7 items-center justify-center rounded-md transition', density === d ? 'bg-brand-soft text-brand' : 'text-ink-faint hover:text-ink')}
              >
                {d === 'comfortable' ? <Rows3 size={14} /> : <AlignJustify size={14} />}
              </button>
            ))}
          </div>
          <button className="tb-btn !w-9 !justify-center !px-0" onClick={() => q.refetch()} title="Refresh" aria-label="Refresh">
            <RefreshCw size={14} className={cn(q.isFetching && 'animate-spin')} />
          </button>
        </div>

        {/* active filter chips */}
        {(filterChips.length > 0 || (search && !noSearch)) && (
          <div className="no-print flex flex-wrap items-center gap-1.5 border-b border-line bg-surface-2 px-3 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">Filtered by</span>
            {search && !noSearch && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-0.5 pl-2.5 pr-1 text-xs text-brand-ink">
                “{search}”
                <button onClick={() => setSearch('')} className="rounded-full p-0.5 hover:bg-brand/20"><X size={11} /></button>
              </span>
            )}
            {filterChips.map((c) => (
              <span key={c.label} className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-0.5 pl-2.5 pr-1 text-xs text-brand-ink">
                {c.label}
                <button onClick={c.clear} className="rounded-full p-0.5 hover:bg-brand/20"><X size={11} /></button>
              </span>
            ))}
            <button className="ml-1 text-xs text-ink-muted hover:text-ink" onClick={() => { setFState(emptyFilters); setSearch(''); }}>
              Clear all
            </button>
          </div>
        )}

        {/* bulk bar */}
        {selCount > 0 && bulkActions && bulkActions.length > 0 && (
          <div className="no-print flex items-center gap-2 border-b border-brand/20 bg-brand-soft px-3 py-2 text-[13px]">
            <span className="font-semibold text-brand-ink">{selCount} selected</span>
            <span className="mx-1 h-4 w-px bg-brand/20" />
            {bulkActions.map((b) => (
              <button
                key={b.label}
                onClick={() => b.onClick(Object.values(selected), clearSel)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition',
                  b.danger ? 'border-danger/30 bg-surface text-danger hover:bg-danger-soft' : 'border-line-strong bg-surface text-ink hover:bg-surface-3',
                )}
              >
                {b.icon && <b.icon size={13} />} {b.label}
              </button>
            ))}
            <button className="ml-auto text-xs text-ink-muted hover:text-ink" onClick={clearSel}>
              Clear selection
            </button>
          </div>
        )}

        {/* grid */}
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr className="h-10">
                {selectable && (
                  <th className="grid-th w-10 !px-0 text-center">
                    <input type="checkbox" checked={allOnPage} onChange={toggleAll} className="h-4 w-4 accent-[rgb(var(--brand))]" aria-label="Select all" />
                  </th>
                )}
                {visibleCols.map((vc) => {
                  const c = colById.get(vc.id)!;
                  const sortable = c.sortable !== false;
                  const sorted = sort?.key === c.key ? sort.dir : null;
                  return (
                    <th
                      key={vc.id}
                      style={{ width: c.width, minWidth: c.width }}
                      className={cn('grid-th select-none whitespace-nowrap transition-colors', isRight(c) && '!text-right', c.align === 'center' && '!text-center', sortable && 'cursor-pointer hover:text-ink', sorted && '!text-brand')}
                      onClick={() => sortable && toggleSort(c.key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.header}
                        {sorted === 'asc' && <ArrowUp size={12} />}
                        {sorted === 'desc' && <ArrowDown size={12} />}
                        {sortable && !sorted && <ChevronsUpDown size={11} className="opacity-30" />}
                      </span>
                    </th>
                  );
                })}
                {hasActions && <th className="grid-th w-[1%] whitespace-nowrap text-center">Actions</th>}
              </tr>
              {showFilters && (
                <tr className="no-print">
                  {selectable && <th className="sticky top-10 z-10 border-b border-line bg-surface" />}
                  {visibleCols.map((vc) => {
                    const c = colById.get(vc.id)!;
                    return (
                      <th key={vc.id} className="sticky top-10 z-10 border-b border-line bg-surface px-2 py-1.5 font-normal">
                        {c.filter === 'text' && (
                          <input className={fctl} value={fState.text[c.key] ?? ''} placeholder="Filter…" onChange={(e) => setFState((s) => ({ ...s, text: { ...s.text, [c.key]: e.target.value } }))} />
                        )}
                        {typeof c.filter === 'object' && (
                          <select className={fctl} value={fState.select[c.key] ?? ''} onChange={(e) => setFState((s) => ({ ...s, select: { ...s.select, [c.key]: e.target.value } }))}>
                            <option value="">All</option>
                            {c.filter.options.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        )}
                        {c.filter === 'date' && (
                          <div className="flex gap-1">
                            <input type="date" title="From" className={cn(fctl, '!px-1.5 !text-[11px]')} value={fState.from[c.key] ?? ''} onChange={(e) => setFState((s) => ({ ...s, from: { ...s.from, [c.key]: e.target.value } }))} />
                            <input type="date" title="To" className={cn(fctl, '!px-1.5 !text-[11px]')} value={fState.to[c.key] ?? ''} onChange={(e) => setFState((s) => ({ ...s, to: { ...s.to, [c.key]: e.target.value } }))} />
                          </div>
                        )}
                      </th>
                    );
                  })}
                  {hasActions && <th className="sticky top-10 z-10 border-b border-line bg-surface" />}
                </tr>
              )}
            </thead>
            <tbody>
              {q.isError && (
                <tr><td colSpan={colSpan}><ErrorState message={apiError(q.error)} onRetry={() => q.refetch()} /></td></tr>
              )}
              {q.isLoading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`sk${i}`} className={rowH}>
                    {Array.from({ length: Math.max(colSpan, 3) }).map((__, j) => (
                      <td key={j} className="border-b border-line px-3">
                        <div className="skeleton h-3.5" style={{ width: `${40 + ((i * 7 + j * 13) % 50)}%` }} />
                      </td>
                    ))}
                  </tr>
                ))}
              {!q.isLoading && !q.isError && tRows.length === 0 && (
                <tr><td colSpan={colSpan}><EmptyState title="No records found" hint={search || Object.keys(serverFilterParams).length ? 'Try changing the search or filters.' : 'Nothing to show here yet.'} /></td></tr>
              )}
              {tRows.map((row, ri) => {
                const isSel = !!selected[row.id];
                const isActive = ri === active;
                return (
                  <tr
                    key={row.id}
                    data-ri={ri}
                    onClick={() => setActive(ri)}
                    onDoubleClick={() => onRowDoubleClick?.(row.original)}
                    className={cn(
                      'group/row transition-colors',
                      rowH,
                      onRowDoubleClick && 'cursor-default',
                      zebra && ri % 2 === 1 && 'bg-surface-2/60',
                      'hover:bg-brand-soft/50',
                      isSel && '!bg-brand-soft',
                      isActive && 'shadow-[inset_3px_0_0_rgb(var(--brand))]',
                    )}
                  >
                    {selectable && (
                      <td className="grid-td w-10 !px-0 text-center">
                        <input type="checkbox" checked={isSel} onChange={() => toggleRow(row.id, row.original)} className="h-4 w-4 accent-[rgb(var(--brand))]" />
                      </td>
                    )}
                    {row.getVisibleCells().map((cell) => {
                      const c = colById.get(cell.column.id)!;
                      return (
                        <td key={cell.id} className={cn('grid-td whitespace-nowrap', isRight(c) && 'text-right tabular-nums', c.align === 'center' && 'text-center')}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                    {hasActions && (
                      <td className="grid-td whitespace-nowrap !px-2 text-center">
                        <span className="inline-flex items-center gap-0.5">
                          {actionsOf(row.original)
                            .filter((a) => !a.hidden?.(row.original))
                            .map((a) => (
                              <button
                                key={a.label}
                                title={a.label}
                                disabled={a.disabled?.(row.original)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  a.onClick(row.original);
                                }}
                                className={cn('inline-flex h-7 min-w-[28px] items-center justify-center rounded-md px-1.5 transition disabled:opacity-40', a.danger ? 'text-danger hover:bg-danger-soft' : 'text-ink-muted hover:bg-surface-3 hover:text-brand')}
                              >
                                {a.icon ? <a.icon size={15} /> : <span className="text-xs font-medium">{a.label}</span>}
                              </button>
                            ))}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            {hasTotals && tRows.length > 0 && (
              <tfoot>
                <tr className="h-10">
                  {selectable && <td className="sticky bottom-0 border-t border-line-strong bg-surface-2" />}
                  {visibleCols.map((vc, i) => {
                    const c = colById.get(vc.id)!;
                    const v = sumOf(c);
                    return (
                      <td key={vc.id} className={cn('sticky bottom-0 border-t border-line-strong bg-surface-2 px-3 text-[13px] font-semibold', isRight(c) && 'text-right tabular-nums')}>
                        {i === 0 && (v === '' || v === undefined) ? 'Total' : v}
                      </td>
                    );
                  })}
                  {hasActions && <td className="sticky bottom-0 border-t border-line-strong bg-surface-2" />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* footer */}
        <div className="no-print flex shrink-0 flex-wrap items-center gap-3 rounded-b-card border-t border-line px-3 py-2 text-xs text-ink-muted">
          <span>
            Showing <b className="text-ink">{from}–{to}</b> of <b className="text-ink">{total}</b> record{total === 1 ? '' : 's'}
          </span>
          {q.isFetching && <Spinner size={13} />}
          <div className="flex-1" />
          <label className="flex items-center gap-2">
            Rows per page
            <select className="ctl !h-8 !w-[72px] !rounded-md !px-2 !text-xs" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {[...new Set([...PAGE_SIZES, pageSize])].sort((a, b) => a - b).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <button className="pg-btn" disabled={page <= 1} onClick={() => setPage(1)} aria-label="First page"><ChevronsLeft size={14} /></button>
            <button className="pg-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
            <span className="px-2 tabular-nums">Page <b className="text-ink">{page}</b> of {pages}</span>
            <button className="pg-btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
            <button className="pg-btn" disabled={page >= pages} onClick={() => setPage(pages)} aria-label="Last page"><ChevronsRight size={14} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
