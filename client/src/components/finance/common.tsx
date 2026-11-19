/** Shared building blocks for the FINANCE screens: money display, combo picker, report shell/grid, export + print helpers. */
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Download, Play, Printer } from 'lucide-react';
import { api, apiError, Paged, saveBlob } from '@/lib/api';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';
import { printRows } from '@/lib/export';
import { toast } from '@/store/toast';
import { Button, DateInput, ErrorState, LoadingBlock, Toolbar } from '@/components/ui';
import { formScreenOf } from '@/lib/docRoutes';

/* ------------------------------------------------------------------ numbers */
export const n0 = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** 1,234.50 ; negatives in parentheses */
export const moneyText = (v: unknown, blankZero = false): string => {
  if (v === null || v === undefined || v === '') return '';
  const n = n0(v);
  if (blankZero && Math.abs(n) < 0.005) return '';
  return n < 0 ? `(${fmt.money(-n)})` : fmt.money(n);
};
export function Money({ v, bold, blankZero, className }: { v: unknown; bold?: boolean; blankZero?: boolean; className?: string }) {
  const n = n0(v);
  return <span className={cn('tabular-nums', n < -0.004 && 'text-red-600', bold && 'font-semibold', className)}>{moneyText(v, blankZero)}</span>;
}

/* ------------------------------------------------------------------ master lookups */
export interface AccountLite {
  id: number;
  code: string;
  name: string;
  type: string;
  parentId: number | null;
  isGroup: boolean;
  isBank: boolean;
  isActive: boolean;
  systemKey: string | null;
}
export function useAccounts() {
  return useQuery({
    queryKey: ['fin-accounts-all'],
    staleTime: 30_000,
    queryFn: async () => (await api.get<Paged<AccountLite>>('/accounts', { params: { all: 1 } })).data.rows,
  });
}
export interface PartyLite {
  id: number;
  code: string;
  name: string;
}
export function useParties(type: 'CUSTOMER' | 'SUPPLIER' | 'OTHER' | undefined) {
  return useQuery({
    queryKey: ['fin-parties', type],
    enabled: type === 'CUSTOMER' || type === 'SUPPLIER',
    staleTime: 60_000,
    queryFn: async () => (await api.get<Paged<PartyLite>>(type === 'CUSTOMER' ? '/customers' : '/suppliers', { params: { pageSize: 500 } })).data.rows,
  });
}
export const accLabel = (a: { code: string; name: string }) => `${a.code} - ${a.name}`;

/* ------------------------------------------------------------------ Combo (typeahead select) */
export interface ComboOption {
  value: number | string;
  label: string;
}
export function Combo({
  options, value, onChange, placeholder = 'Select...', disabled, invalid, allowClear, className,
}: {
  options: ComboOption[];
  value: number | string | null | undefined;
  onChange: (v: number | string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  allowClear?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const sel = options.find((o) => o.value === value);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options).slice(0, 100);
  }, [options, q]);
  const openIt = () => {
    if (disabled) return;
    setRect(ref.current?.getBoundingClientRect() ?? null);
    setQ('');
    setHi(0);
    setOpen(true);
  };
  const pick = (o: ComboOption | undefined) => {
    if (o) onChange(o.value);
    setOpen(false);
  };
  return (
    <div className={cn('relative', className)}>
      <input
        ref={ref}
        className={cn('ctl', invalid && 'border-red-500')}
        disabled={disabled}
        placeholder={placeholder}
        value={open ? q : sel?.label ?? ''}
        onFocus={openIt}
        onClick={() => !open && openIt()}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
          if (!open) openIt();
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, list.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            pick(list[hi]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {allowClear && !disabled && value !== null && value !== undefined && value !== '' && (
        <button type="button" tabIndex={-1} className="absolute right-1 top-1 text-[11px] text-slate-400 hover:text-red-600" onMouseDown={(e) => { e.preventDefault(); onChange(null); }}>
          x
        </button>
      )}
      {open && rect && (
        <div
          className="fixed z-[200] max-h-60 overflow-auto rounded border border-slate-400 bg-white text-[12px] shadow-lg"
          style={{ left: rect.left, top: rect.bottom + 1, minWidth: Math.max(rect.width, 280) }}
        >
          {list.length === 0 && <div className="px-2 py-1 text-slate-400">No matches</div>}
          {list.map((o, i) => (
            <div
              key={o.value}
              className={cn('cursor-pointer whitespace-nowrap px-2 py-0.5', i === hi ? 'bg-brand text-white' : 'hover:bg-brand-light')}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setHi(i)}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ report columns / grid */
export type RType = 'text' | 'money' | 'date' | 'qty' | 'number' | 'percent';
export interface RCol<T> {
  key: string;
  header: string;
  type?: RType;
  align?: 'left' | 'right' | 'center';
  width?: number;
  blankZero?: boolean;
  render?: (r: T, i: number) => ReactNode;
  value?: (r: T) => unknown;
}
const isRightType = (t?: RType) => t === 'money' || t === 'qty' || t === 'number' || t === 'percent';
const getVal = <T,>(c: RCol<T>, r: T) => (c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]);

export function cellText(v: unknown, t?: RType, blankZero?: boolean): string {
  if (v === null || v === undefined) return '';
  switch (t) {
    case 'money': return moneyText(v, blankZero);
    case 'qty': return fmt.qty(v);
    case 'number': return fmt.num(v);
    case 'percent': return fmt.percent(v);
    case 'date': return fmt.date(v as string);
    default: return String(v);
  }
}

export function ReportGrid<T>({
  columns, rows, totals, totalsLabel = 'Total', onRowClick, rowClass, empty = 'No data for the selected criteria', stickyFirst,
}: {
  columns: RCol<T>[];
  rows: T[];
  totals?: Record<string, unknown>;
  totalsLabel?: string;
  onRowClick?: (r: T) => void;
  rowClass?: (r: T) => string | undefined;
  empty?: string;
  stickyFirst?: boolean;
}) {
  if (!rows.length) return <div className="p-6 text-center text-[12px] text-slate-400">{empty}</div>;
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="h-6">
          {columns.map((c, ci) => (
            <th key={c.key} className={cn('grid-th', (c.align === 'right' || (!c.align && isRightType(c.type))) && 'text-right', c.align === 'center' && 'text-center', stickyFirst && ci === 0 && 'left-0 z-20')} style={c.width ? { width: c.width, minWidth: c.width } : undefined}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={cn('h-6', onRowClick && 'cursor-pointer hover:bg-brand-light', rowClass?.(r))} onDoubleClick={onRowClick ? () => onRowClick(r) : undefined}>
            {columns.map((c) => (
              <td key={c.key} className={cn('grid-td whitespace-nowrap', (c.align === 'right' || (!c.align && isRightType(c.type))) && 'text-right tabular-nums', c.align === 'center' && 'text-center')}>
                {c.render ? c.render(r, i) : c.type === 'money' ? <Money v={getVal(c, r)} blankZero={c.blankZero} /> : cellText(getVal(c, r), c.type)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {totals && (
        <tfoot>
          <tr className="h-6 bg-app-head font-semibold">
            {columns.map((c, ci) => (
              <td key={c.key} className={cn('border-t-2 border-app-border px-2 text-[12px] whitespace-nowrap', isRightType(c.type) && 'text-right tabular-nums')}>
                {c.key in totals ? (c.type === 'money' ? <Money v={totals[c.key]} bold /> : cellText(totals[c.key], c.type)) : ci === 0 ? totalsLabel : ''}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/* ------------------------------------------------------------------ export / print */
export interface ExportCfg<T = never> {
  title: string;
  subtitle?: string;
  columns: RCol<T>[];
  rows: T[];
  totals?: Record<string, unknown>;
}
function toRecords<T>(cfg: ExportCfg<T>, forPrint: boolean): Record<string, unknown>[] {
  const mk = (r: unknown) => {
    const o: Record<string, unknown> = {};
    for (const c of cfg.columns as RCol<unknown>[]) {
      const v = getVal(c, r);
      if (forPrint) o[c.key] = cellText(v, c.type, c.blankZero);
      else if (c.type === 'date') o[c.key] = fmt.date(v as string);
      else if (c.type === 'money' || c.type === 'qty' || c.type === 'number' || c.type === 'percent') o[c.key] = v === null || v === undefined || v === '' ? null : n0(v);
      else o[c.key] = v === null || v === undefined ? '' : String(v);
    }
    return o;
  };
  const rows = (cfg.rows as unknown[]).map(mk);
  if (cfg.totals) {
    const t: Record<string, unknown> = {};
    for (const c of cfg.columns as RCol<unknown>[]) t[c.key] = c.key in cfg.totals ? (forPrint ? cellText(cfg.totals[c.key], c.type) : cfg.totals[c.key]) : '';
    const first = (cfg.columns[0] as RCol<unknown>).key;
    if (!(first in cfg.totals)) t[first] = 'Total';
    rows.push(t);
  }
  return rows;
}

/** POST /api/export/report -> blob download (csv | xlsx | pdf) */
export async function exportReport<T>(cfg: ExportCfg<T>, format: 'csv' | 'xlsx' | 'pdf') {
  try {
    const cols = (cfg.columns as RCol<unknown>[]).map((c) => ({
      key: c.key,
      label: c.header,
      type: c.type === 'date' ? 'text' : c.type ?? 'text',
      align: c.align ?? (isRightType(c.type) ? 'right' : 'left'),
    }));
    const res = await api.post(
      '/export/report',
      { title: cfg.title, subtitle: cfg.subtitle, columns: cols, rows: toRecords(cfg, false), format },
      { responseType: 'blob' },
    );
    saveBlob(res.data as Blob, `${cfg.title.replace(/[^\w\- ]+/g, '_')}.${format}`);
  } catch (e) {
    toast.error(apiError(e));
  }
}
export function printReport<T>(cfg: ExportCfg<T>) {
  const cols = (cfg.columns as RCol<unknown>[]).map((c) => ({ key: c.key, header: c.header, align: (c.align ?? (isRightType(c.type) ? 'right' : 'left')) as 'left' | 'right' | 'center' }));
  printRows(cfg.subtitle ? `${cfg.title} - ${cfg.subtitle}` : cfg.title, cols, toRecords(cfg, true));
}

/** print arbitrary HTML through a hidden iframe */
export function printHtml(title: string, bodyHtml: string, css = '') {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow!.document;
  doc.open();
  doc.write(`<!doctype html><html><head><title>${title}</title><style>
    @page { size: A4; margin: 12mm }
    body{font-family:Segoe UI,Arial,sans-serif;font-size:11px;color:#111}
    h1{font-size:16px;margin:0} h2{font-size:13px;margin:0 0 4px}
    table{border-collapse:collapse;width:100%} th,td{border:1px solid #bbb;padding:3px 6px;text-align:left}
    th{background:#eef1f5} .r{text-align:right} .meta td{border:0;padding:2px 6px}
    ${css}</style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(() => iframe.remove(), 2000);
  }, 200);
}
export const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ------------------------------------------------------------------ filter bar + shell */
export function FilterField({ label, children, width }: { label: string; children: ReactNode; width?: number }) {
  return (
    <div className="flex flex-col gap-0" style={{ width }}>
      <span className="text-[10px] font-medium uppercase leading-3 text-slate-500">{label}</span>
      {children}
    </div>
  );
}
export function FilterDate({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <FilterField label={label} width={120}>
      <DateInput value={value} onChange={(e) => onChange(e.target.value)} />
    </FilterField>
  );
}

export function ExportMenu<T>({ cfg, disabled }: { cfg: ExportCfg<T> | null; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const h = () => setOpen(false);
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, [open]);
  return (
    <div className="relative">
      <Button icon={Download} disabled={disabled || !cfg} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        Export <ChevronDown size={12} />
      </Button>
      {open && cfg && (
        <div className="absolute right-0 top-8 z-50 w-28 rounded border border-app-border bg-white py-0.5 text-[12px] shadow-lg">
          {(['csv', 'xlsx', 'pdf'] as const).map((f) => (
            <button key={f} className="block w-full px-3 py-1 text-left hover:bg-brand-light" onClick={() => exportReport(cfg, f)}>
              {f === 'xlsx' ? 'Excel (.xlsx)' : f === 'csv' ? 'CSV' : 'PDF'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReportShell<T>({
  title, filters, onRun, running, error, cfg, children, extraActions, footer,
}: {
  title: string;
  filters: ReactNode;
  onRun: () => void;
  running?: boolean;
  error?: string;
  cfg: ExportCfg<T> | null;
  children: ReactNode;
  extraActions?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg">
      <Toolbar className="items-end">
        {filters}
        <Button variant="primary" icon={Play} loading={running} onClick={onRun}>Run</Button>
        <div className="flex-1" />
        {extraActions}
        <ExportMenu cfg={cfg} />
        <Button icon={Printer} disabled={!cfg} onClick={() => cfg && printReport(cfg)}>Print</Button>
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <div className="px-3 pb-1 pt-2">
          <h2 className="text-[14px] font-semibold text-slate-800">{title}</h2>
          {cfg?.subtitle && <div className="text-[11px] text-slate-500">{cfg.subtitle}</div>}
        </div>
        {error ? <ErrorState message={error} /> : running ? <LoadingBlock /> : children}
      </div>
      {footer && <div className="shrink-0 border-t border-app-border bg-app-head px-3 py-1 text-[12px]">{footer}</div>}
    </div>
  );
}

/** draft filters + applied filters (applied drives the query; Run applies / refetches) */
export function useApplied<T extends object>(init: T) {
  const [draft, setDraft] = useState<T>(init);
  const [applied, setApplied] = useState<T>(init);
  const set = <K extends keyof T>(k: K, v: T[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const run = (refetch: () => unknown) => {
    if (JSON.stringify(draft) === JSON.stringify(applied)) void refetch();
    else setApplied(draft);
  };
  return { draft, applied, set, run, setDraft, setApplied };
}

export const yearStart = () => `${new Date().getFullYear()}-01-01`;

/* ------------------------------------------------------------------ drill-down */
export interface SourceRef {
  sourceType?: string | null;
  sourceId?: number | null;
  journalId?: number | null;
  entryType?: string | null;
  entryNo?: string | null;
  sourceNo?: string | null;
}
/** which screen to open for a journal line's source document */
export function sourceTarget(e: SourceRef): { screen: string; id: number; title: string } | null {
  const st = (e.sourceType ?? '').toUpperCase();
  const jTitle = e.entryNo ?? 'Journal';
  if (st === 'RECEIPT_VOUCHER' && e.sourceId) return { screen: 'receipt-voucher-form', id: e.sourceId, title: e.sourceNo ?? 'Receipt' };
  if ((st === 'PAYMENT_VOUCHER' || st === 'ADVANCE_SETTLEMENT') && e.sourceId) return { screen: 'payment-voucher-form', id: e.sourceId, title: e.sourceNo ?? 'Payment' };
  if ((st === 'NOTE' || st === 'NOTE_APPLIED') && e.sourceId) return { screen: e.entryType === 'DEBIT_NOTE' ? 'debit-note-form' : 'credit-note-form', id: e.sourceId, title: e.sourceNo ?? 'Note' };
  if (st && !['JOURNAL_VOUCHER', 'OPENING_BALANCE'].includes(st) && e.sourceId) {
    const screen = formScreenOf(st);
    return { screen, id: e.sourceId, title: e.sourceNo ?? st };
  }
  if (e.journalId) return { screen: 'journal-voucher-form', id: e.journalId, title: jTitle };
  return null;
}

/** react-query helper for GET with params */
export function useGet<T>(key: unknown[], url: string, params: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: ['fin', url, ...key, params],
    enabled,
    queryFn: async () => (await api.get<T>(url, { params })).data,
  });
}
