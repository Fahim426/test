import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ColumnDef, flexRender, getCoreRowModel, useReactTable, VisibilityState } from '@tanstack/react-table';
import {
  ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Columns3, Download, Filter, Printer, RefreshCw, Search, X,
  type LucideIcon,
} from 'lucide-react';
import { api, apiError, Paged } from '@/lib/api';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';
import { downloadExport, ExportFormat, printRows } from '@/lib/export';
import { toast } from '@/store/toast';
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
      <span title={`${n} item${n === 1 ? '' : 's'} not yet carried to the next document`} className="inline-flex items-center whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold leading-3 text-amber-800">
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

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => lsGet<{ ps?: number }>(lsKey, {}).ps ?? defaultPageSize);
  const [search, setSearch] = useState('');
  const dSearch = useDebounced(search);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null);
  const [showFilters, setShowFilters] = useState(() => columns.some((c) => c.filter));
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

  return (
    <div
      ref={root}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        const t = e.target as HTMLElement;
        if (!t.closest('input,select,textarea,button,a')) root.current?.focus();
      }}
      className={cn('flex min-h-0 flex-col bg-white outline-none', props.height ?? 'h-full')}
    >
      {/* toolbar */}
      <div className="no-print flex flex-wrap items-center gap-1.5 border-b border-app-border bg-app-head px-2 py-1">
        {!noSearch && (
          <div className="relative">
            <Search size={13} className="absolute left-2 top-[7px] text-slate-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="ctl w-[220px] pl-7 pr-6"
            />
            {search && (
              <button className="absolute right-1.5 top-[7px] text-slate-400 hover:text-slate-700" onClick={() => setSearch('')}>
                <X size={13} />
              </button>
            )}
          </div>
        )}
        {toolbarExtras}
        <div className="flex-1" />
        {selCount > 0 && (
          <span className="rounded border border-brand/40 bg-brand-light px-2 text-[11px] leading-5 text-brand">{selCount} selected</span>
        )}
        <button className={cn('tb-btn', showFilters && 'bg-brand-mid')} onClick={() => setShowFilters((v) => !v)} title="Column filters">
          <Filter size={13} /> Filters
        </button>
        <div className="relative" data-menu>
          <button className="tb-btn" onClick={() => setMenu(menu === 'cols' ? null : 'cols')} title="Column visibility">
            <Columns3 size={13} /> Columns
          </button>
          {menu === 'cols' && (
            <div className="absolute right-0 top-7 z-40 max-h-[320px] w-[190px] overflow-auto border border-slate-400 bg-white p-1 shadow-lg">
              {table.getAllLeafColumns().map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 px-2 py-0.5 text-[12px] hover:bg-brand-light">
                  <input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} className="accent-[#1f5fae]" />
                  {String(c.columnDef.header)}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="relative" data-menu>
          <button className="tb-btn" onClick={() => setMenu(menu === 'export' ? null : 'export')} title="Export">
            <Download size={13} /> Export
          </button>
          {menu === 'export' && (
            <div className="absolute right-0 top-7 z-40 w-[150px] border border-slate-400 bg-white py-0.5 shadow-lg">
              {(
                [['csv', 'CSV'], ['xlsx', 'Excel (.xlsx)'], ['pdf', 'PDF'], ['docx', 'Word (.docx)']] as [ExportFormat, string][]
              ).map(([f, label]) => (
                <button key={f} className="block w-full px-3 py-1 text-left text-[12px] hover:bg-brand-light" onClick={() => doExport(f)}>
                  {label}
                </button>
              ))}
              <div className="my-0.5 h-px bg-app-border" />
              <button className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] hover:bg-brand-light" onClick={doPrint}>
                <Printer size={12} /> Print
              </button>
            </div>
          )}
        </div>
        <button className="tb-btn" onClick={() => q.refetch()} title="Refresh">
          <RefreshCw size={13} className={cn(q.isFetching && 'animate-spin')} />
        </button>
      </div>

      {/* bulk bar */}
      {selCount > 0 && bulkActions && bulkActions.length > 0 && (
        <div className="no-print flex items-center gap-2 border-b border-brand/30 bg-brand-light px-2 py-1 text-[12px]">
          <span className="font-semibold text-brand">{selCount} selected</span>
          {bulkActions.map((b) => (
            <button
              key={b.label}
              onClick={() => b.onClick(Object.values(selected), clearSel)}
              className={cn('inline-flex h-6 items-center gap-1 rounded border px-2 text-[11px]', b.danger ? 'border-red-300 bg-white text-red-700 hover:bg-red-50' : 'border-app-border bg-white hover:bg-slate-100')}
            >
              {b.icon && <b.icon size={12} />} {b.label}
            </button>
          ))}
          <button className="ml-auto text-[11px] text-slate-500 hover:text-slate-800" onClick={clearSel}>
            Clear selection
          </button>
        </div>
      )}

      {/* grid */}
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr className="h-7">
              {selectable && (
                <th className="grid-th w-7 !px-0 text-center">
                  <input type="checkbox" checked={allOnPage} onChange={toggleAll} className="accent-[#1f5fae]" aria-label="Select all" />
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
                    className={cn('grid-th select-none whitespace-nowrap', isRight(c) && '!text-right', c.align === 'center' && '!text-center', sortable && 'cursor-pointer hover:bg-slate-200')}
                    onClick={() => sortable && toggleSort(c.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.header}
                      {sorted === 'asc' && <ArrowUp size={11} />}
                      {sorted === 'desc' && <ArrowDown size={11} />}
                    </span>
                  </th>
                );
              })}
              {hasActions && <th className="grid-th w-[1%] whitespace-nowrap text-center">Actions</th>}
            </tr>
            {showFilters && (
              <tr className="no-print">
                {selectable && <th className="sticky top-7 z-10 border-b border-r border-app-border bg-white" />}
                {visibleCols.map((vc) => {
                  const c = colById.get(vc.id)!;
                  return (
                    <th key={vc.id} className="sticky top-7 z-10 border-b border-r border-app-border bg-white p-0.5 font-normal">
                      {c.filter === 'text' && (
                        <input className="ctl !h-6 !text-[11px]" value={fState.text[c.key] ?? ''} placeholder="filter" onChange={(e) => setFState((s) => ({ ...s, text: { ...s.text, [c.key]: e.target.value } }))} />
                      )}
                      {typeof c.filter === 'object' && (
                        <select className="ctl !h-6 !text-[11px]" value={fState.select[c.key] ?? ''} onChange={(e) => setFState((s) => ({ ...s, select: { ...s.select, [c.key]: e.target.value } }))}>
                          <option value="">All</option>
                          {c.filter.options.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      )}
                      {c.filter === 'date' && (
                        <div className="flex gap-0.5">
                          <input type="date" title="From" className="ctl !h-6 !px-1 !text-[10px]" value={fState.from[c.key] ?? ''} onChange={(e) => setFState((s) => ({ ...s, from: { ...s.from, [c.key]: e.target.value } }))} />
                          <input type="date" title="To" className="ctl !h-6 !px-1 !text-[10px]" value={fState.to[c.key] ?? ''} onChange={(e) => setFState((s) => ({ ...s, to: { ...s.to, [c.key]: e.target.value } }))} />
                        </div>
                      )}
                    </th>
                  );
                })}
                {hasActions && <th className="sticky top-7 z-10 border-b border-r border-app-border bg-white" />}
              </tr>
            )}
          </thead>
          <tbody>
            {q.isError && (
              <tr><td colSpan={colSpan}><ErrorState message={apiError(q.error)} onRetry={() => q.refetch()} /></td></tr>
            )}
            {q.isLoading && (
              <tr><td colSpan={colSpan}><div className="flex items-center justify-center gap-2 p-8 text-slate-500"><Spinner /> Loading...</div></td></tr>
            )}
            {!q.isLoading && !q.isError && tRows.length === 0 && (
              <tr><td colSpan={colSpan}><EmptyState title="No records found" hint={search || Object.keys(serverFilterParams).length ? 'Try changing the search or filters.' : undefined} /></td></tr>
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
                    'h-7',
                    onRowDoubleClick && 'cursor-default',
                    zebra && ri % 2 === 1 && 'bg-slate-50',
                    isSel && '!bg-brand-light',
                    isActive ? 'outline outline-1 -outline-offset-1 outline-brand' : '',
                    'hover:bg-brand-light/60',
                  )}
                >
                  {selectable && (
                    <td className="grid-td w-7 !px-0 text-center">
                      <input type="checkbox" checked={isSel} onChange={() => toggleRow(row.id, row.original)} className="accent-[#1f5fae]" />
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
                    <td className="grid-td whitespace-nowrap !px-1 text-center">
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
                              className={cn('inline-flex h-5 items-center rounded px-1 disabled:opacity-40', a.danger ? 'text-red-600 hover:bg-red-50' : 'text-brand hover:bg-brand-light')}
                            >
                              {a.icon ? <a.icon size={13} /> : <span className="text-[11px] underline">{a.label}</span>}
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
              <tr className="h-7">
                {selectable && <td className="sticky bottom-0 border-t-2 border-app-border bg-app-head" />}
                {visibleCols.map((vc, i) => {
                  const c = colById.get(vc.id)!;
                  const v = sumOf(c);
                  return (
                    <td key={vc.id} className={cn('sticky bottom-0 border-t-2 border-app-border bg-app-head px-2 text-[12px] font-semibold', isRight(c) && 'text-right tabular-nums')}>
                      {i === 0 && (v === '' || v === undefined) ? 'Total' : v}
                    </td>
                  );
                })}
                {hasActions && <td className="sticky bottom-0 border-t-2 border-app-border bg-app-head" />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* footer */}
      <div className="no-print flex shrink-0 items-center gap-3 border-t border-app-border bg-app-head px-2 py-1 text-[11px] text-slate-600">
        <span>
          {from}-{to} of <b>{total}</b> record{total === 1 ? '' : 's'}
        </span>
        {q.isFetching && <Spinner size={12} />}
        <div className="flex-1" />
        <label className="flex items-center gap-1">
          Rows
          <select className="h-6 border border-app-border bg-white px-1 text-[11px]" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {[...new Set([...PAGE_SIZES, pageSize])].sort((a, b) => a - b).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-0.5">
          <button className="pg-btn" disabled={page <= 1} onClick={() => setPage(1)}><ChevronsLeft size={13} /></button>
          <button className="pg-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={13} /></button>
          <span className="px-2">Page {page} / {pages}</span>
          <button className="pg-btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight size={13} /></button>
          <button className="pg-btn" disabled={page >= pages} onClick={() => setPage(pages)}><ChevronsRight size={13} /></button>
        </div>
      </div>
    </div>
  );
}
