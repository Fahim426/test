/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared building blocks for the PURCHASE screens (lists, document forms, toolbars, pickers).
 * Everything here is composed from the shell kit (DataTable, DocumentLayout, useDocument, ui).
 */
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Controller, FormProvider, get, Resolver, useForm, useFormContext, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodTypeAny } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, FileDown, Plus, Printer, RefreshCw, Save, Trash2, XCircle, type LucideIcon } from 'lucide-react';
import { DataTable, Column, RowAction } from '@/components/DataTable';
import { ApprovalSection, AttachmentsSection, AuditSection, DocAction, DocActionSep, DocSection, DocumentFlow } from '@/components/doc';
import { Button, Checkbox, DateInput, Field, Input, Modal, NumberInput, Select, SelectOption, StatusBadge, Textarea } from '@/components/ui';
import { useDocument } from '@/hooks/useDocument';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { api, apiError, Paged, saveBlob } from '@/lib/api';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';
import { toast } from '@/store/toast';
import type { ScreenParams } from '@/screens/types';

export type FV = Record<string, any>;
export type AnyDoc = Record<string, any> & { id: number; docNo?: string; status?: string };

/* ------------------------------------------------------------------ small helpers */
/** yyyy-MM-dd of a server ISO string (uses the date part as stored, no timezone shift) */
export const isoOf = (v: unknown): string => {
  if (!v) return '';
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : fmt.isoDate(s);
};
/** positive number or null (selects/ids) */
export const idOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return v === '' || v === null || v === undefined || !Number.isFinite(n) || n <= 0 ? null : n;
};
export const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
export const n0 = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const errMsg = (errors: unknown, name: string): string | undefined => (get(errors, name) as { message?: string } | undefined)?.message;

export const PRIORITIES: SelectOption[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => ({ value: p, label: fmt.status(p) }));
export const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
export const SHIPPING_METHODS: SelectOption[] = [
  { value: 'SEA', label: 'Sea freight' },
  { value: 'AIR', label: 'Air freight' },
  { value: 'ROAD', label: 'Road' },
  { value: 'COURIER', label: 'Courier' },
];
export const statusOptions = (list: string[]): SelectOption[] => list.map((s) => ({ value: s, label: fmt.status(s) }));

/* ------------------------------------------------------------------ lookups */
export function useRows<T = any>(url: string, params?: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: ['purchase-opts', url, params ?? {}],
    staleTime: 60_000,
    enabled,
    queryFn: async (): Promise<T[]> => {
      const d = (await api.get<Paged<T> | T[]>(url, { params: { pageSize: 500, ...(params ?? {}) } })).data;
      return Array.isArray(d) ? d : d.rows;
    },
  });
}
export interface SupplierRow { id: number; code: string; name: string; country?: string | null; currencyCode?: string; vatCategory?: string; paymentTermName?: string | null; isActive?: boolean }
export interface WarehouseRow { id: number; code: string; name: string }
export interface CurrencyRow { id: number; code: string; name: string; rate: number; isBase: boolean }

const EMPTY: never[] = [];
export function useLookups() {
  const suppliers = useRows<SupplierRow>('/suppliers', { isActive: 'true' }).data ?? EMPTY;
  const warehouses = useRows<WarehouseRow>('/warehouses').data ?? EMPTY;
  const currencies = useRows<CurrencyRow>('/currencies').data ?? EMPTY;
  const terms = useRows<{ id: number; name: string }>('/payment-terms').data ?? EMPTY;
  const bus = useRows<{ id: number; name: string }>('/business-units').data ?? EMPTY;
  return useMemo(
    () => ({
      suppliers,
      supplierOptions: suppliers.map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` })),
      warehouses,
      warehouseOptions: warehouses.map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` })),
      currencies,
      currencyOptions: currencies.map((c) => ({ value: c.code, label: c.code })),
      termNames: terms.map((t) => t.name),
      buOptions: bus.map((b) => ({ value: b.id, label: b.name })),
    }),
    [suppliers, warehouses, currencies, terms, bus],
  );
}

/* ------------------------------------------------------------------ confirm / comment dialog */
export interface AskOptions {
  title?: string;
  message?: ReactNode;
  commentLabel?: string;
  commentRequired?: boolean;
  confirmLabel?: string;
  danger?: boolean;
}
export function useAsk() {
  const [st, setSt] = useState<(AskOptions & { resolve: (v: { ok: boolean; text: string }) => void }) | null>(null);
  const [text, setText] = useState('');
  const ask = (o: AskOptions) =>
    new Promise<{ ok: boolean; text: string }>((resolve) => {
      setText('');
      setSt({ ...o, resolve });
    });
  const close = (ok: boolean) => {
    if (!st) return;
    if (ok && st.commentRequired && !text.trim()) {
      toast.warning('A comment is required');
      return;
    }
    st.resolve({ ok, text: text.trim() });
    setSt(null);
  };
  const dialog = st ? (
    <Modal
      open
      title={st.title ?? 'Confirm'}
      onClose={() => close(false)}
      width="sm"
      footer={
        <>
          <Button onClick={() => close(false)}>No</Button>
          <Button variant={st.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{st.confirmLabel ?? 'Yes'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-[13px] text-ink">
        {st.message && <div>{st.message}</div>}
        {st.commentLabel && (
          <Field label={st.commentLabel} required={st.commentRequired}>
            <Textarea rows={3} autoFocus value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  ) : null;
  return { ask, dialog };
}

/* ------------------------------------------------------------------ small form modal (conversion dialogs) */
export interface PickField {
  name: string;
  label: string;
  type?: 'select' | 'date' | 'text' | 'number';
  options?: SelectOption[];
  value?: string | number;
  required?: boolean;
}
export function PickModal({
  open, title, fields, onClose, onSubmit, submitLabel = 'OK', children, width = 'md',
}: {
  open: boolean;
  title: string;
  fields: PickField[];
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => Promise<void> | void;
  submitLabel?: string;
  children?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setVals(Object.fromEntries(fields.map((f) => [f.name, f.value !== undefined ? String(f.value) : ''])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  const submit = async () => {
    const missing = fields.find((f) => f.required && !vals[f.name]);
    if (missing) return toast.warning(`${missing.label} is required`);
    setBusy(true);
    try {
      await onSubmit(vals);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      width={width}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>{submitLabel}</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {fields.map((f) => (
          <Field key={f.name} label={f.label} required={f.required}>
            {f.type === 'select' ? (
              <Select options={f.options} placeholder="Select..." value={vals[f.name] ?? ''} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
            ) : f.type === 'date' ? (
              <DateInput value={vals[f.name] ?? ''} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
            ) : f.type === 'number' ? (
              <NumberInput value={vals[f.name] ?? ''} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
            ) : (
              <Input value={vals[f.name] ?? ''} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
            )}
          </Field>
        ))}
      </div>
      {children}
    </Modal>
  );
}

/* ------------------------------------------------------------------ PDF / print */
export async function fetchPdf(docType: string, id: number | string, download: boolean) {
  try {
    const r = await api.get(`/documents/${docType}/${id}/pdf`, { responseType: 'blob', params: download ? { download: 1 } : undefined });
    const blob = r.data as Blob;
    if (download) saveBlob(blob, `${docType}-${id}.pdf`);
    else {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  } catch (e) {
    // error bodies arrive as blobs
    const b = (e as any)?.response?.data;
    if (b instanceof Blob) {
      try {
        toast.error(JSON.parse(await b.text()).error ?? 'PDF failed');
        return;
      } catch { /* fall through */ }
    }
    toast.error(apiError(e));
  }
}

/* ------------------------------------------------------------------ document form controller */
export interface DocCtl {
  doc: ReturnType<typeof useDocument<AnyDoc>>;
  form: ReturnType<typeof useForm<FV>>;
  status?: string;
  editable: boolean;
  err?: string;
  setErr: (s?: string) => void;
  /** run a transition; shows server errors as toast + banner; returns the response or undefined on failure */
  run: (action: string, body?: unknown) => Promise<AnyDoc | undefined>;
  /** submit-handler for the Save button */
  save: (toPayload: (v: FV) => unknown) => () => Promise<AnyDoc | undefined>;
  tabId: string;
}

export function useDocForm(o: {
  url: string;
  params: ScreenParams;
  tabId: string;
  schema: ZodTypeAny;
  toForm: (d: AnyDoc) => FV;
  defaults: FV;
  titleOf?: (d: AnyDoc) => string | undefined;
  /** values for a NEW document (e.g. built from a prefill endpoint) */
  newValues?: FV;
  editableStatuses?: string[];
}): DocCtl {
  const ws = useWorkspace();
  const doc = useDocument<AnyDoc>(o.url, o.params.id, { tabId: o.tabId, titleOf: o.titleOf });
  const copyId = o.params.copyFrom as number | string | undefined;
  const copy = useQuery({
    queryKey: ['doc-copy', o.url, copyId],
    enabled: doc.isNew && !!copyId,
    queryFn: async () => (await api.get<AnyDoc>(`${o.url}/${copyId}`)).data,
  });
  const values = useMemo(
    () => (doc.data ? o.toForm(doc.data) : copy.data ? o.toForm(copy.data) : o.newValues),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc.data, copy.data, o.newValues],
  );
  const form = useForm<FV>({ resolver: zodResolver(o.schema) as Resolver<FV>, values, defaultValues: o.defaults });
  const dirty = form.formState.isDirty;
  useEffect(() => {
    ws.setDirty(o.tabId, dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, o.tabId]);
  const [err, setErr] = useState<string>();
  const status = doc.data?.status;
  const editable = doc.isNew || (o.editableStatuses ?? ['DRAFT']).includes(status ?? '');

  const run = async (action: string, body?: unknown) => {
    try {
      const r = await doc.transition(action, body);
      setErr(undefined);
      return r;
    } catch (e) {
      setErr(apiError(e));
      return undefined;
    }
  };
  const save = (toPayload: (v: FV) => unknown) =>
    form.handleSubmit(
      async (v) => {
        try {
          const r = await doc.save(toPayload(v));
          setErr(undefined);
          return r;
        } catch (e) {
          setErr(apiError(e));
          return undefined;
        }
      },
      (errs) => {
        const first = Object.values(errs)[0] as any;
        toast.warning(first?.message ? String(first.message) : 'Please fix the highlighted fields');
      },
    ) as () => Promise<AnyDoc | undefined>;
  return { doc, form, status, editable, err, setErr, run, save, tabId: o.tabId };
}

export function ServerError({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="rounded-lg border border-danger bg-danger-soft px-3 py-1.5 text-[13px] text-danger">{message}</div>;
}

/* ------------------------------------------------------------------ toolbar */
export interface TransitionDef {
  action: string;
  label: string;
  icon?: LucideIcon;
  from: string[];
  /** permission action on `module` (edit / approve / reject / post / cancel) */
  perm: string;
  variant?: 'primary' | 'default' | 'danger';
  ask?: AskOptions;
  /** save pending edits first */
  saveFirst?: boolean;
  /** return a message to block the action (client side validation) */
  guard?: () => string | undefined;
  onSuccess?: (r: AnyDoc) => void;
}

export function StdActions({
  ctl, module, transitions, onSave, canSave = true, pdfType, deletable = true, extra, deleteStatuses = ['DRAFT'], after,
}: {
  ctl: DocCtl;
  module: string;
  transitions?: TransitionDef[];
  onSave: () => Promise<AnyDoc | undefined>;
  canSave?: boolean;
  pdfType?: string;
  deletable?: boolean;
  deleteStatuses?: string[];
  extra?: ReactNode;
  after?: ReactNode;
}) {
  const can = usePermission();
  const ws = useWorkspace();
  const { doc, status, editable, run, form } = ctl;
  const { ask, dialog } = useAsk();
  const dirty = form.formState.isDirty;

  const doTransition = async (t: TransitionDef) => {
    const blocked = t.guard?.();
    if (blocked) {
      toast.warning(blocked);
      return;
    }
    let body: Record<string, unknown> | undefined;
    if (t.ask) {
      const r = await ask(t.ask);
      if (!r.ok) return;
      if (r.text) body = { comment: r.text, reason: r.text };
    }
    if (t.saveFirst && dirty && editable) {
      const saved = await onSave();
      if (!saved) return;
    }
    const res = await run(t.action, body);
    if (res) t.onSuccess?.(res);
  };
  const doDelete = async () => {
    const r = await ask({ title: 'Delete', message: 'Delete this draft document permanently?', danger: true, confirmLabel: 'Delete' });
    if (!r.ok) return;
    try {
      await doc.remove();
      ws.close(ctl.tabId, true);
    } catch (e) {
      ctl.setErr(apiError(e));
    }
  };
  return (
    <>
      <DocAction icon={Save} variant="primary" hidden={!editable || !canSave || !can(module, doc.isNew ? 'create' : 'edit')} loading={doc.saving} onClick={onSave}>Save</DocAction>
      {(transitions ?? []).map((t) => (
        <DocAction
          key={t.action}
          icon={t.icon ?? (t.variant === 'danger' ? XCircle : Check)}
          variant={t.variant ?? 'default'}
          hidden={doc.isNew || !t.from.includes(status ?? '') || !can(module, t.perm)}
          disabled={doc.acting}
          onClick={() => doTransition(t)}
        >
          {t.label}
        </DocAction>
      ))}
      <DocAction icon={Trash2} hidden={doc.isNew || !deletable || !deleteStatuses.includes(status ?? '') || !can(module, 'delete')} onClick={doDelete}>Delete</DocAction>
      {extra}
      <DocActionSep />
      {pdfType && (
        <>
          <DocAction icon={Printer} hidden={doc.isNew} onClick={() => fetchPdf(pdfType, doc.id as number, false)}>Print</DocAction>
          <DocAction icon={FileDown} hidden={doc.isNew} onClick={() => fetchPdf(pdfType, doc.id as number, true)}>PDF</DocAction>
        </>
      )}
      <DocAction icon={RefreshCw} hidden={doc.isNew} onClick={() => doc.refetch()}>Refresh</DocAction>
      {after}
      {dialog}
    </>
  );
}

/* ------------------------------------------------------------------ form fields (use inside <FormProvider>) */
type FieldBase = { name: string; label: string; disabled?: boolean; required?: boolean; className?: string; hint?: string };
export function FText({ name, label, disabled, required, className, hint, list, placeholder, readOnly }: FieldBase & { list?: string; placeholder?: string; readOnly?: boolean }) {
  const { register, formState } = useFormContext();
  return (
    <Field label={label} required={required} error={errMsg(formState.errors, name)} className={className} hint={hint}>
      <Input list={list} placeholder={placeholder} readOnly={readOnly} disabled={disabled} invalid={!!errMsg(formState.errors, name)} {...register(name)} />
    </Field>
  );
}
export function FDate({ name, label, disabled, required, className }: FieldBase) {
  const { register, formState } = useFormContext();
  return (
    <Field label={label} required={required} error={errMsg(formState.errors, name)} className={className}>
      <DateInput disabled={disabled} invalid={!!errMsg(formState.errors, name)} {...register(name)} />
    </Field>
  );
}
export function FNum({ name, label, disabled, required, className, hint }: FieldBase) {
  const { register, formState } = useFormContext();
  return (
    <Field label={label} required={required} error={errMsg(formState.errors, name)} className={className} hint={hint}>
      <NumberInput disabled={disabled} invalid={!!errMsg(formState.errors, name)} {...register(name, { setValueAs: (v) => (v === '' || v === null || v === undefined ? null : Number(v)) })} />
    </Field>
  );
}
export function FSelect({ name, label, options, disabled, required, className, placeholder = 'Select...', onChange }: FieldBase & { options?: SelectOption[]; placeholder?: string; onChange?: (value: string) => void }) {
  const { control, formState } = useFormContext();
  return (
    <Field label={label} required={required} error={errMsg(formState.errors, name)} className={className}>
      {/* controlled so the selected value survives options that arrive after the form values */}
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Select
            ref={field.ref}
            options={options}
            placeholder={placeholder}
            disabled={disabled}
            invalid={!!errMsg(formState.errors, name)}
            value={field.value ?? ''}
            onBlur={field.onBlur}
            onChange={(e) => {
              field.onChange(e.target.value);
              onChange?.(e.target.value);
            }}
          />
        )}
      />
    </Field>
  );
}
export function FArea({ name, label, disabled, className }: FieldBase) {
  const { register } = useFormContext();
  return (
    <Field label={label} className={className}>
      <Textarea rows={3} disabled={disabled} {...register(name)} />
    </Field>
  );
}
export const ReadField = ({ label, value, className }: { label: string; value?: ReactNode; className?: string }) => (
  <Field label={label} className={className}>
    <div className="ctl flex items-center bg-surface-2 text-ink">{value ?? ''}</div>
  </Field>
);

/** Currency select + exchange-rate input. Picking a currency fills the rate from Currency master. */
export function CurrencyFields({ disabled, currencies, options }: { disabled?: boolean; currencies: CurrencyRow[]; options: SelectOption[] }) {
  const { setValue } = useFormContext();
  const code = useWatch({ name: 'currencyCode' }) as string | undefined;
  const base = currencies.find((c) => c.isBase)?.code ?? 'AED';
  return (
    <>
      <FSelect
        name="currencyCode"
        label="Currency"
        options={options}
        disabled={disabled}
        placeholder={base}
        onChange={(v) => setValue('exchangeRate', currencies.find((c) => c.code === v)?.rate ?? 1, { shouldDirty: true })}
      />
      <FNum name="exchangeRate" label={`Exchange Rate (to ${base})`} disabled={disabled || !code || code === base} />
    </>
  );
}

/** Supplier select that reports the chosen supplier (to default currency / country / terms). */
export function SupplierSelect({
  name = 'supplierId', suppliers, disabled, onPicked, label = 'Supplier', required = true,
}: {
  name?: string;
  suppliers: SupplierRow[];
  disabled?: boolean;
  onPicked?: (s: SupplierRow | undefined) => void;
  label?: string;
  required?: boolean;
}) {
  return (
    <FSelect
      name={name}
      label={label}
      required={required}
      disabled={disabled}
      options={suppliers.map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` }))}
      onChange={(v) => onPicked?.(suppliers.find((s) => String(s.id) === v))}
    />
  );
}

/* ------------------------------------------------------------------ sections */
export function DocFooter({
  docType, entity, doc, approvalDoc = true, isNew, readOnlyAttach,
}: {
  docType: string;
  entity: string;
  doc?: AnyDoc;
  approvalDoc?: boolean;
  isNew?: boolean;
  readOnlyAttach?: boolean;
}) {
  const id = doc?.id;
  return (
    <>
      {approvalDoc && <ApprovalSection approval={doc?.approval} />}
      <AttachmentsSection docType={docType} docId={id} readOnly={readOnlyAttach} />
      {!isNew && <DocumentFlow docType={docType} docId={id} />}
      {!isNew && <HistorySection entity={entity} id={id} />}
      <AuditSection doc={doc} />
    </>
  );
}

interface AuditRow { id: number; action: string; username?: string | null; details?: string | null; createdAt: string }
/** Status / approval history from the audit log (hidden when the user may not read audit logs). */
export function HistorySection({ entity, id }: { entity: string; id?: number | string }) {
  const q = useQuery({
    queryKey: ['audit-history', entity, id],
    enabled: !!id,
    retry: false,
    queryFn: async () => (await api.get<Paged<AuditRow>>('/audit-logs', { params: { entity, entityId: id, pageSize: 50 } })).data.rows,
  });
  if (!q.data || q.data.length === 0) return null;
  const note = (r: AuditRow) => {
    try {
      const d = JSON.parse(r.details ?? '{}') as Record<string, unknown>;
      return [d.comment, d.reason, d.from && d.to ? `${d.from} -> ${d.to}` : d.status, d.journal ? `Journal ${d.journal}` : undefined, d.creditNote ? `Credit note ${d.creditNote}` : undefined]
        .filter(Boolean)
        .join(' | ');
    } catch {
      return '';
    }
  };
  return (
    <DocSection title="History (approval / status trail)">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-muted"><th className="py-1.5">Date</th><th>User</th><th>Action</th><th>Details</th></tr>
        </thead>
        <tbody>
          {q.data.map((r) => (
            <tr key={r.id} className="border-b border-line">
              <td className="py-1.5 text-ink-muted">{fmt.dateTime(r.createdAt)}</td>
              <td>{r.username ?? 'system'}</td>
              <td><StatusBadge status={r.action} /></td>
              <td className="text-ink-muted">{note(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DocSection>
  );
}

export interface ChipDoc { screenId: string; id: number; label: string; status?: string | null; extra?: string }
export function LinkedDocs({ title, docs, right }: { title: string; docs: ChipDoc[]; right?: ReactNode }) {
  const open = useOpenScreen();
  return (
    <DocSection title={title} right={right}>
      {docs.length === 0 ? (
        <div className="px-1 text-[13px] text-ink-muted">None</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {docs.map((d) => (
            <button key={`${d.screenId}-${d.id}`} type="button" onClick={() => open(d.screenId, { id: d.id }, d.label)} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-0.5 text-[13px] text-brand hover:bg-brand-soft">
              <ExternalLink size={11} /> {d.label}
              {d.extra && <span className="text-ink-muted">{d.extra}</span>}
              {d.status && <StatusBadge status={d.status} />}
            </button>
          ))}
        </div>
      )}
    </DocSection>
  );
}

/** Horizontal status stepper (e.g. import PO / shipment statuses). */
export function StatusStepper({ steps, current, cancelled }: { steps: string[]; current?: string; cancelled?: boolean }) {
  const idx = current ? steps.indexOf(current) : -1;
  return (
    <div className="flex flex-wrap items-center gap-y-2">
      {steps.map((s, i) => {
        const done = idx > i;
        const cur = idx === i;
        return (
          <div key={s} className="flex items-center">
            {i > 0 && <span className={cn('h-0.5 w-5 rounded', done || cur ? 'bg-success' : 'bg-line-strong')} />}
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
                cancelled ? 'border-line-strong text-ink-faint line-through' : done ? 'border-success bg-success-soft text-success' : cur ? 'border-brand bg-brand text-white shadow-card' : 'border-line-strong text-ink-muted',
              )}
            >
              <span aria-hidden>{done ? '✓' : cur ? '●' : '○'}</span> {fmt.status(s)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ list screen */
export interface ListConfig<T extends object> {
  tableKey: string;
  url: string;
  title: string;
  formScreen: string;
  /** permission module for create button */
  module: string;
  newLabel?: string;
  noNew?: boolean;
  columns: Column<T>[];
  statuses: string[];
  /** field used for tab titles (default docNo) */
  docNoOf?: (r: T) => string;
  extraFilters?: Record<string, string | number | undefined>;
  extraToolbar?: ReactNode;
  rowActions?: (r: T, open: ReturnType<typeof useOpenScreen>) => RowAction<T>[];
  pdfType?: string;
  /** params passed to the form when creating */
  newParams?: Record<string, unknown>;
  /** extra select filters rendered in toolbar */
  selects?: { key: string; label: string; options: SelectOption[] }[];
  hideDates?: boolean;
  /** status filter sent when no status is chosen (comma list allowed) */
  baseStatus?: string;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  exportName?: string;
  idOf?: (r: T) => number;
}

export function PurchaseList<T extends object>(c: ListConfig<T>) {
  const open = useOpenScreen();
  const can = usePermission();
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sel, setSel] = useState<Record<string, string>>({});
  const idOf = c.idOf ?? ((r: T) => (r as any).id as number);
  const noOf = c.docNoOf ?? ((r: T) => String((r as any).docNo ?? ''));
  const openRow = (r: T) => open(c.formScreen, { id: idOf(r) }, noOf(r));
  const actions = (r: T): RowAction<T>[] => [
    { label: 'Open', icon: ExternalLink, onClick: openRow },
    ...(c.rowActions ? c.rowActions(r, open) : []),
    ...(c.pdfType ? [{ label: 'PDF', icon: FileDown, onClick: (x: T) => fetchPdf(c.pdfType!, idOf(x), false) }] : []),
  ];
  return (
    <DataTable<T>
      tableKey={c.tableKey}
      url={c.url}
      columns={c.columns}
      exportName={c.exportName ?? c.title}
      defaultSort={c.defaultSort ?? { key: 'id', dir: 'desc' }}
      filters={{ status: status || c.baseStatus || undefined, from: from || undefined, to: to || undefined, ...(c.extraFilters ?? {}), ...sel }}
      onRowDoubleClick={openRow}
      rowActions={actions}
      getRowId={(r) => idOf(r)}
      toolbarExtras={
        <>
          <Select className="w-[150px]" value={status} onChange={(e) => setStatus(e.target.value)} options={statusOptions(c.statuses)} placeholder="All statuses" />
          {c.selects?.map((s) => (
            <Select key={s.key} className="w-[130px]" value={sel[s.key] ?? ''} onChange={(e) => setSel({ ...sel, [s.key]: e.target.value })} options={s.options} placeholder={s.label} />
          ))}
          {!c.hideDates && (
            <>
              <DateInput className="w-[120px]" value={from} title="From date" onChange={(e) => setFrom(e.target.value)} />
              <span className="text-xs text-ink-muted">to</span>
              <DateInput className="w-[120px]" value={to} title="To date" onChange={(e) => setTo(e.target.value)} />
            </>
          )}
          {c.extraToolbar}
          {!c.noNew && can(c.module, 'create') && (
            <Button variant="primary" icon={Plus} onClick={() => open(c.formScreen, c.newParams ?? {}, c.newLabel ?? `New ${c.title}`)}>
              {c.newLabel ?? `New ${c.title}`}
            </Button>
          )}
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ re-exports used by the screens */
export { FormProvider, useFormContext, useWatch, Checkbox };
