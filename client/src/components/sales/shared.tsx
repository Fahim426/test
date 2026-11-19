/* Shared helpers for the SALES screens (lists, forms, pickers, actions). */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFormContext, useWatch, UseFormReturn, FieldValues } from 'react-hook-form';
import { AlertTriangle, Plus } from 'lucide-react';
import { DataTable, Column, RowAction } from '@/components/DataTable';
import { ConfirmDialog, Button, DateInput, Select, SelectOption } from '@/components/ui';
import { api, apiError, Paged } from '@/lib/api';
import { num } from '@/lib/calc';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';
import { usePermission } from '@/store/auth';
import { toast } from '@/store/toast';
import { useOpenScreen, useWorkspace } from '@/store/workspace';

export type AnyRec = Record<string, any>;

/* ------------------------------------------------------------------ masters */
export function useOptions(url: string, label: (r: any) => string, value: (r: any) => string | number = (r) => r.id, params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: ['sales-opts', url, JSON.stringify(params)],
    staleTime: 60_000,
    queryFn: async (): Promise<SelectOption[]> => {
      const d = (await api.get<Paged<AnyRec> | AnyRec[]>(url, { params: { pageSize: 500, ...params } })).data;
      const rows = Array.isArray(d) ? d : d.rows;
      return rows.map((r) => ({ value: value(r), label: label(r) }));
    },
  });
}
export const useSalesmen = () => useOptions('/salesmen', (r) => `${r.code} - ${r.name}`);
export const useWarehouses = () => useOptions('/warehouses', (r) => `${r.code} - ${r.name}`, (r) => r.id, { isActive: true });
export const usePaymentTerms = () => useOptions('/payment-terms', (r) => r.name, (r) => r.name);
export const useCurrencies = () => useOptions('/currencies', (r) => r.code, (r) => r.code);

/** RHF register option: empty select -> undefined, otherwise a number */
export const idReg = { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? undefined : Number(v)) };

export const isoOrNull = (v: unknown): string | null => (v ? fmt.isoDate(v as string) : null) || null;

/* ------------------------------------------------------------------ customer picker */
export interface CustomerLite {
  id: number;
  code: string;
  name: string;
  trn?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  creditLimit?: number;
  currencyCode?: string | null;
  salesmanId?: number | null;
  paymentTermName?: string | null;
  isActive?: boolean;
}

export function CustomerPicker({
  value, onChange, disabled, invalid, placeholder = 'Search customer...', className,
}: {
  value?: number | null;
  onChange: (id: number | undefined, customer?: CustomerLite) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [editing, setEditing] = useState(false);
  const [hi, setHi] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);
  const cur = useQuery({
    queryKey: ['customer-lite', value],
    enabled: !!value,
    staleTime: 60_000,
    queryFn: async () => (await api.get<CustomerLite>(`/customers/${value}`)).data,
  });
  const list = useQuery({
    queryKey: ['customer-search', dq],
    enabled: editing,
    staleTime: 15_000,
    queryFn: async () => (await api.get<Paged<CustomerLite>>('/customers', { params: { search: dq, pageSize: 15, isActive: true } })).data.rows,
  });
  const rows = list.data ?? [];
  const text = value && cur.data ? `${cur.data.code} - ${cur.data.name}` : '';
  const pick = (c: CustomerLite) => {
    onChange(c.id, c);
    setEditing(false);
    setQ('');
  };
  return (
    <div className={cn('relative', className)}>
      <input
        className={cn('ctl w-full', invalid && 'border-red-500')}
        disabled={disabled}
        placeholder={placeholder}
        value={editing ? q : text}
        onFocus={(e) => {
          setEditing(true);
          setQ('');
          e.target.select();
        }}
        onBlur={() => setTimeout(() => setEditing(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          if (!e.target.value && value) onChange(undefined);
        }}
        onKeyDown={(e) => {
          if (!editing) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, rows.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && rows[hi]) {
            e.preventDefault();
            pick(rows[hi]);
          } else if (e.key === 'Escape') setEditing(false);
        }}
      />
      {editing && (
        <div className="absolute left-0 top-full z-[200] mt-px max-h-[240px] min-w-[320px] overflow-auto border border-slate-400 bg-white text-[12px] shadow-lg" onMouseDown={(e) => e.preventDefault()}>
          {list.isFetching && rows.length === 0 && <div className="px-2 py-1.5 text-slate-500">Searching...</div>}
          {!list.isFetching && rows.length === 0 && <div className="px-2 py-1.5 text-slate-500">No customers found</div>}
          {rows.map((c, i) => (
            <div key={c.id} onClick={() => pick(c)} onMouseEnter={() => setHi(i)} className={cn('flex cursor-pointer gap-2 px-2 py-0.5', i === hi && 'bg-brand-light')}>
              <span className="w-[90px] shrink-0 font-medium">{c.code}</span>
              <span className="truncate">{c.name}</span>
              {c.trn && <span className="ml-auto shrink-0 text-slate-400">{c.trn}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** marks the workspace tab dirty (amber dot + close confirm) */
export function useDirtyTab(tabId: string, dirty: boolean) {
  const setDirty = useWorkspace().setDirty;
  useEffect(() => {
    setDirty(tabId, dirty);
  }, [tabId, dirty, setDirty]);
}

/* ------------------------------------------------------------------ confirm */
export function useConfirm() {
  const [st, setSt] = useState<{ message: ReactNode; title?: string; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);
  const ask = (message: ReactNode, o: { title?: string; confirmLabel?: string; danger?: boolean } = {}) =>
    new Promise<boolean>((resolve) => setSt({ message, ...o, resolve }));
  const done = (v: boolean) => {
    st?.resolve(v);
    setSt(null);
  };
  const node = <ConfirmDialog open={!!st} title={st?.title} message={st?.message} confirmLabel={st?.confirmLabel} danger={st?.danger} onConfirm={() => done(true)} onCancel={() => done(false)} />;
  return { ask, node };
}

/* ------------------------------------------------------------------ document actions */
/** Posts workflow actions / conversions on a sales document with consistent error toasts. */
export function useSalesActions(base: string, id: number | string | undefined, invalidate: () => void) {
  const ws = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const post = async <R = AnyRec,>(action: string, body?: unknown, okMsg?: string): Promise<R | undefined> => {
    setBusy(action);
    try {
      const r = (await api.post<R>(`${base}/${id}/${action}`, body ?? {})).data;
      if (okMsg) toast.success(okMsg);
      invalidate();
      return r;
    } catch (e) {
      toast.error(apiError(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  };
  /** POST a conversion endpoint and open the created document */
  const convert = async (action: string, screenId: string, okMsg?: string, body?: unknown) => {
    const r = await post<{ id: number; docNo: string }>(action, body, okMsg);
    if (r?.id) ws.open({ screenId, params: { id: r.id }, title: r.docNo });
    return r;
  };
  return { post, convert, busy, open: ws.open };
}

export async function openPdf(type: string, id: number | string) {
  try {
    const r = await api.get(`/documents/${type}/${id}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(r.data as Blob);
    const w = window.open(url, '_blank');
    if (!w) toast.warning('Pop-up blocked: allow pop-ups to view the PDF');
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (e) {
    toast.error(apiError(e) || 'Could not generate PDF');
  }
}

/* ------------------------------------------------------------------ banners */
export function WarningsBanner({ warnings, onClose }: { warnings: string[]; onClose?: () => void }) {
  if (!warnings.length) return null;
  return (
    <div className="flex items-start gap-2 border border-amber-400 bg-amber-50 px-3 py-2 text-[12px] text-amber-900" role="alert">
      <AlertTriangle size={16} className="mt-px shrink-0 text-amber-600" />
      <div className="flex-1">
        <div className="font-semibold">Warnings from the server</div>
        <ul className="list-disc pl-4">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      </div>
      {onClose && <button className="text-[11px] underline" onClick={onClose}>dismiss</button>}
    </div>
  );
}

export function InfoBanner({ tone = 'blue', children }: { tone?: 'blue' | 'amber' | 'red' | 'green'; children: ReactNode }) {
  const t = { blue: 'border-blue-300 bg-blue-50 text-blue-900', amber: 'border-amber-400 bg-amber-50 text-amber-900', red: 'border-red-300 bg-red-50 text-red-800', green: 'border-green-300 bg-green-50 text-green-900' }[tone];
  return <div className={cn('border px-3 py-2 text-[12px]', t)}>{children}</div>;
}

/** Highlights grid rows (0-based indexes) by injecting CSS scoped to `scope` (put `scope` on the LineItemsGrid className). */
export function RowHighlight({ scope, rows, color = '#fee2e2' }: { scope: string; rows: number[]; color?: string }) {
  if (!rows.length) return null;
  const css = rows.map((i) => `.${scope} tbody tr:nth-child(${i + 1}) td{background:${color} !important}`).join('\n');
  return <style>{css}</style>;
}
export const scopeOf = (tabId: string) => `sg-${tabId.replace(/[^a-zA-Z0-9]/g, '')}`;

/* ------------------------------------------------------------------ line mapping */
export function toLine(i: AnyRec): AnyRec {
  return {
    id: i.id,
    productId: i.productId ?? undefined,
    productCode: i.product?.code ?? i.productCode ?? '',
    product: i.product ?? undefined,
    oemNumber: i.oemNumber ?? i.product?.oemNumber ?? '',
    description: i.description ?? i.product?.name ?? '',
    unit: i.unit ?? '',
    qty: num(i.qty),
    rate: num(i.rate),
    discount: num(i.discount),
    vatRate: num(i.vatRate),
    onHand: num(i.availability?.availableStock),
    reserved: num(i.availability?.reservedStock),
    // sales-order progress (server computed)
    soReserved: num(i.reserved),
    picked: num(i.picked),
    delivered: num(i.delivered),
    invoiced: num(i.invoiced),
    pending: num(i.pending),
    backorder: !!i.backorder,
    backorderQty: num(i.backorderQty),
  };
}

export function toBodyLine(l: AnyRec) {
  return {
    productId: Number(l.productId),
    qty: num(l.qty),
    rate: num(l.rate),
    discount: num(l.discount),
    vatRate: num(l.vatRate),
    description: l.description || null,
    oemNumber: l.oemNumber || null,
    unit: l.unit || null,
  };
}

export const ats = (l: AnyRec) => Math.max(0, num(l.onHand) - num(l.reserved));
export const shortRows = (items: AnyRec[]) => items.map((l, i) => (l.productId && num(l.qty) > ats(l) + 0.0005 ? i : -1)).filter((i) => i >= 0);

/** Re-reads stock availability (/sales/availability) for the lines whenever products or warehouse change. */
export function useAvailabilityRefresh(form: UseFormReturn<any>, warehouseId: number | undefined, enabled: boolean) {
  const items = (useWatch({ control: form.control, name: 'items' }) as AnyRec[] | undefined) ?? [];
  const ids = [...new Set(items.map((l) => Number(l?.productId)).filter((n) => n > 0))].sort((a, b) => a - b);
  const key = `${ids.join(',')}|${warehouseId ?? ''}`;
  useEffect(() => {
    if (!enabled || !ids.length) return;
    let dead = false;
    api
      .get('/sales/availability', { params: { productId: ids.join(','), warehouseId: warehouseId || undefined } })
      .then((r) => {
        if (dead) return;
        const arr: AnyRec[] = Array.isArray(r.data) ? r.data : [r.data];
        const map = new Map(arr.map((a) => [a.productId as number, a]));
        const cur = (form.getValues('items') as AnyRec[] | undefined) ?? [];
        cur.forEach((l, i) => {
          const a = map.get(Number(l?.productId));
          if (!a) return;
          if (num(l.onHand) !== num(a.availableStock)) form.setValue(`items.${i}.onHand`, num(a.availableStock));
          if (num(l.reserved) !== num(a.reservedStock)) form.setValue(`items.${i}.reserved`, num(a.reservedStock));
        });
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
}

/** Source document for "Duplicate tab" (params.copyFrom) */
export function useCopySource(url: string, params: AnyRec, isNew: boolean) {
  const copyFrom = params.copyFrom as number | string | undefined;
  return useQuery({
    queryKey: ['copy-src', url, copyFrom],
    enabled: isNew && !!copyFrom,
    staleTime: 0,
    queryFn: async () => (await api.get<AnyRec>(`${url}/${copyFrom}`)).data,
  });
}

/** Stock shortage panel under a quotation / order grid */
export function ShortagePanel({ items, label = 'Stock shortage' }: { items: AnyRec[]; label?: string }) {
  const rows = shortRows(items);
  if (!rows.length) return null;
  return (
    <div className="mt-2 border border-red-300 bg-red-50 px-3 py-1.5 text-[12px] text-red-800">
      <div className="font-semibold">{label}: {rows.length} line(s) exceed the available-to-sell quantity</div>
      <ul className="list-disc pl-4">
        {rows.map((i) => {
          const l = items[i];
          return (
            <li key={i}>
              {l.productCode || `Line ${i + 1}`}: requested {fmt.qty(l.qty)}, available to sell {fmt.qty(ats(l))} (short {fmt.qty(num(l.qty) - ats(l))})
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** read form values of the shared header with a typed watch */
export function useW<T = any>(name: string): T {
  const { control } = useFormContext();
  return useWatch({ control, name }) as T;
}

/* ------------------------------------------------------------------ list factory */
export interface SalesListConfig<T> {
  tableKey: string;
  url: string;
  exportName: string;
  formScreen: string;
  permission: string;
  statuses: string[];
  columns: Column<T>[];
  newLabel?: string;
  /** custom "New" handler (e.g. invoices open a picker). Return nothing to use the default */
  onNew?: (open: ReturnType<typeof useOpenScreen>) => void;
  /** "New" opens this picker modal instead of a blank form (derived documents) */
  picker?: (p: { open: boolean; onClose: () => void }) => ReactNode;
  hideNew?: boolean;
  rowActions?: (open: ReturnType<typeof useOpenScreen>) => RowAction<T>[];
  toolbarLeft?: ReactNode;
  extraFilters?: Record<string, string | number | boolean | undefined>;
  noCustomer?: boolean;
}

export function makeSalesList<T extends AnyRec>(cfg: SalesListConfig<T>) {
  return function SalesListScreen() {
    const open = useOpenScreen();
    const can = usePermission();
    const [status, setStatus] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [customerId, setCustomerId] = useState<number | undefined>();
    const [pickerOpen, setPickerOpen] = useState(false);
    const filters = useMemo(
      () => ({ ...(cfg.extraFilters ?? {}), status: status || undefined, from: from || undefined, to: to || undefined, customerId }),
      [status, from, to, customerId],
    );
    const openRow = (r: T) => open(cfg.formScreen, { id: r.id }, r.docNo);
    const table = (
      <DataTable<T>
        tableKey={cfg.tableKey}
        url={cfg.url}
        columns={cfg.columns}
        filters={filters}
        exportName={cfg.exportName}
        defaultSort={{ key: 'id', dir: 'desc' }}
        onRowDoubleClick={openRow}
        rowActions={[{ label: 'Open', onClick: openRow }, ...(cfg.rowActions?.(open) ?? [])]}
        toolbarExtras={
          <>
            {!cfg.hideNew && can(cfg.permission, 'create') && (
              <Button variant="primary" icon={Plus} onClick={() => (cfg.picker ? setPickerOpen(true) : cfg.onNew ? cfg.onNew(open) : open(cfg.formScreen, {}, cfg.newLabel ?? 'New'))}>
                {cfg.newLabel ?? 'New'}
              </Button>
            )}
            {cfg.toolbarLeft}
            <Select className="w-[150px]" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={cfg.statuses.map((s) => ({ value: s, label: fmt.status(s) }))} title="Status" />
            {!cfg.noCustomer && <CustomerPicker className="w-[200px]" value={customerId} onChange={(id) => setCustomerId(id)} placeholder="All customers" />}
            <DateInput className="w-[120px]" value={from} onChange={(e) => setFrom(e.target.value)} title="From date" />
            <span className="text-[11px] text-slate-400">to</span>
            <DateInput className="w-[120px]" value={to} onChange={(e) => setTo(e.target.value)} title="To date" />
          </>
        }
      />
    );
    return cfg.picker ? (
      <>
        {table}
        {cfg.picker({ open: pickerOpen, onClose: () => setPickerOpen(false) })}
      </>
    ) : (
      table
    );
  };
}

/** progress cell: "60%" with a thin bar */
export function pctCell(v: unknown) {
  const p = Math.max(0, Math.min(100, num(v)));
  return (
    <div className="flex items-center justify-end gap-1">
      <div className="h-1.5 w-12 overflow-hidden rounded-sm bg-slate-200">
        <div className={cn('h-full', p >= 100 ? 'bg-green-500' : p > 0 ? 'bg-amber-500' : 'bg-slate-300')} style={{ width: `${p}%` }} />
      </div>
      <span className="w-9 tabular-nums">{fmt.num(p, 0)}%</span>
    </div>
  );
}

export type { FieldValues };
