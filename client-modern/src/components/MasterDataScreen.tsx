import { ReactNode, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { api, apiError, apiFieldErrors, Paged } from '@/lib/api';
import { toast } from '@/store/toast';
import { usePermission } from '@/store/auth';
import { fmt } from '@/lib/format';
import { Button, Checkbox, ConfirmDialog, DateInput, Field, Input, Modal, NumberInput, Select, SelectOption, Textarea, Badge } from '@/components/ui';
import { Column, ColumnType, DataTable, RowAction } from './DataTable';

export interface MasterField {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'date' | 'email';
  required?: boolean;
  /** static options */
  options?: SelectOption[];
  /** or load options from an endpoint returning {rows} or an array (value = row.id) */
  optionsUrl?: string;
  /** label for loaded options (default `${code} - ${name}`) */
  optionLabel?: (row: Record<string, unknown>) => string;
  /** query params for optionsUrl (e.g. { isActive: true }) */
  optionsParams?: Record<string, string | number | boolean>;
  /** 'number' (default for optionsUrl) or 'string' select values */
  valueType?: 'number' | 'string';
  min?: number;
  max?: number;
  maxLength?: number;
  step?: number | 'any';
  default?: unknown;
  placeholder?: string;
  hint?: string;
  /** grid span inside the modal (form has 2 columns) */
  span?: 1 | 2;
  /** hide from the list grid */
  hideInList?: boolean;
  listType?: ColumnType;
  /** read the list cell from another path (e.g. 'branch.name') */
  listKey?: string;
  listWidth?: number;
  /** field cannot be changed when editing (e.g. code) */
  readOnlyOnEdit?: boolean;
  /** disable on create too (server generated) */
  hideOnCreate?: boolean;
}

export interface MasterConfig {
  /** persistence key + react-query key */
  tableKey: string;
  title: string;
  /** collection endpoint, e.g. '/brands' */
  url: string;
  /** permission module for create/edit/delete buttons (default 'dimensions') */
  permission?: string;
  fields: MasterField[];
  /** replace the auto-generated list columns */
  columns?: Column<Row>[];
  /** appended list columns (computed values etc.) */
  extraColumns?: Column<Row>[];
  modalWidth?: 'sm' | 'md' | 'lg';
  /** rendered under the form when editing an existing row (e.g. warehouse locations sub-grid) */
  renderExtra?: (row: Row) => ReactNode;
  /** transform form values before POST/PUT */
  toPayload?: (values: Record<string, unknown>, editing: Row | null) => Record<string, unknown>;
  allowDelete?: boolean;
  allowCreate?: boolean;
  /** extra query params for the list */
  listFilters?: Record<string, string | number | boolean | undefined>;
  toolbarExtras?: ReactNode;
  /** additional row actions */
  rowActions?: RowAction<Row>[];
}

type Row = Record<string, unknown> & { id: number };

function useOptions(f: MasterField) {
  return useQuery({
    queryKey: ['master-options', f.optionsUrl, f.optionsParams],
    enabled: !!f.optionsUrl,
    staleTime: 60_000,
    queryFn: async (): Promise<SelectOption[]> => {
      const r = await api.get<Paged<Record<string, unknown>> | Record<string, unknown>[]>(f.optionsUrl!, { params: { pageSize: 500, ...(f.optionsParams ?? {}) } });
      const rows = Array.isArray(r.data) ? r.data : r.data.rows;
      return rows.map((x) => ({
        value: x.id as number,
        label: f.optionLabel ? f.optionLabel(x) : [x.code, x.name].filter(Boolean).join(' - ') || String(x.id),
      }));
    },
  });
}

/** Loads an options-bearing field; returns resolved static/dynamic options. */
function SelectField({ f, error, reg, readOnly }: { f: MasterField; error?: string; reg: ReturnType<ReturnType<typeof useForm>['register']>; readOnly?: boolean }) {
  const q = useOptions(f);
  const opts = f.options ?? q.data ?? [];
  return (
    <Select options={opts} placeholder="" invalid={!!error} disabled={readOnly} {...reg}>
      {q.isLoading ? <option value="">Loading...</option> : null}
    </Select>
  );
}

function buildSchema(fields: MasterField[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    const req = f.required ? `${f.label} is required` : undefined;
    switch (f.type ?? 'text') {
      case 'checkbox':
        shape[f.key] = z.boolean().optional();
        break;
      case 'number': {
        let n = z.number({ invalid_type_error: 'Must be a number', required_error: req });
        if (f.min !== undefined) n = n.min(f.min, `Minimum is ${f.min}`);
        if (f.max !== undefined) n = n.max(f.max, `Maximum is ${f.max}`);
        shape[f.key] = z.preprocess((v) => (v === '' || v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)) ? undefined : Number(v)), f.required ? n : n.optional());
        break;
      }
      case 'select': {
        const base = z.union([z.string(), z.number()]);
        shape[f.key] = z.preprocess((v) => (v === '' || v === null ? undefined : v), f.required ? base.refine((v) => v !== undefined, req) : base.optional());
        break;
      }
      case 'email': {
        const e = z.string().trim().email('Invalid email');
        shape[f.key] = f.required ? e : z.union([e, z.literal('')]).optional();
        break;
      }
      default: {
        let s = z.string().trim();
        if (f.maxLength) s = s.max(f.maxLength);
        shape[f.key] = f.required ? s.min(1, req) : s.optional();
      }
    }
  }
  return z.object(shape);
}

const defaultsFor = (fields: MasterField[], row: Row | null): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = row ? row[f.key] : f.default;
    switch (f.type ?? 'text') {
      case 'checkbox': out[f.key] = row ? !!v : (f.default ?? (f.key === 'isActive' ? true : false)); break;
      case 'date': out[f.key] = v ? fmt.isoDate(v as string) : ''; break;
      case 'select': out[f.key] = v === null || v === undefined ? '' : String(v); break;
      case 'number': out[f.key] = v === null || v === undefined ? '' : v; break;
      default: out[f.key] = v === null || v === undefined ? '' : v;
    }
  }
  return out;
};

function MasterForm({ cfg, row, onClose }: { cfg: MasterConfig; row: Row | null; onClose: () => void }) {
  const qc = useQueryClient();
  const schema = useMemo(() => buildSchema(cfg.fields), [cfg.fields]);
  const { register, handleSubmit, setError, formState } = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema) as never,
    defaultValues: defaultsFor(cfg.fields, row),
  });
  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const body: Record<string, unknown> = {};
      for (const f of cfg.fields) {
        let v = values[f.key];
        if ((f.type ?? 'text') === 'select') {
          const numeric = (f.valueType ?? (f.optionsUrl ? 'number' : 'string')) === 'number';
          v = v === undefined || v === '' ? (numeric ? null : undefined) : numeric ? Number(v) : String(v);
        }
        if (f.hideOnCreate && !row) continue;
        body[f.key] = v;
      }
      const payload = cfg.toPayload ? cfg.toPayload(body, row) : body;
      return row ? (await api.put(`${cfg.url}/${row.id}`, payload)).data : (await api.post(cfg.url, payload)).data;
    },
    onSuccess: () => {
      toast.success(row ? 'Saved' : 'Created');
      qc.invalidateQueries({ queryKey: ['table', cfg.tableKey] });
      qc.invalidateQueries({ queryKey: ['master-options'] });
      onClose();
    },
    onError: (e) => {
      const fe = apiFieldErrors(e);
      Object.entries(fe).forEach(([k, m]) => setError(k, { message: m }));
      toast.error(apiError(e));
    },
  });
  const err = (k: string) => (formState.errors[k]?.message as string | undefined) ?? undefined;

  return (
    <Modal
      open
      onClose={onClose}
      title={`${row ? 'Edit' : 'New'} ${cfg.title}${row && (row.code || row.name) ? ` - ${String(row.code ?? row.name)}` : ''}`}
      width={cfg.modalWidth ?? 'md'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
        {cfg.fields
          .filter((f) => !(f.hideOnCreate && !row))
          .map((f) => {
            const ro = !!row && f.readOnlyOnEdit;
            const span = f.span === 2 || f.type === 'textarea' ? 'sm:col-span-2' : '';
            const t = f.type ?? 'text';
            let control: ReactNode;
            if (t === 'checkbox') control = <Checkbox label={f.label} {...register(f.key)} />;
            else if (t === 'select') control = <SelectField f={f} error={err(f.key)} reg={register(f.key)} readOnly={ro} />;
            else if (t === 'textarea') control = <Textarea invalid={!!err(f.key)} readOnly={ro} {...register(f.key)} />;
            else if (t === 'number') control = <NumberInput invalid={!!err(f.key)} min={f.min} max={f.max} step={f.step ?? 'any'} readOnly={ro} {...register(f.key)} />;
            else if (t === 'date') control = <DateInput invalid={!!err(f.key)} readOnly={ro} {...register(f.key)} />;
            else control = <Input invalid={!!err(f.key)} placeholder={f.placeholder} readOnly={ro} maxLength={f.maxLength} {...register(f.key)} />;
            return t === 'checkbox' ? (
              <div key={f.key} className={`${span} flex items-end pb-2`}>
                {control}
              </div>
            ) : (
              <Field key={f.key} label={f.label} required={f.required} error={err(f.key)} hint={f.hint} className={span}>
                {control}
              </Field>
            );
          })}
      </form>
      {row && cfg.renderExtra && <div className="mt-5 border-t border-line pt-4">{cfg.renderExtra(row)}</div>}
    </Modal>
  );
}

/**
 * Config-driven master data CRUD: DataTable list + modal form (zod validated), create / edit / delete (confirm) / active toggle.
 * Usage: export default [{ id: 'brands', title: 'Brands', component: () => <MasterDataScreen {...brandsConfig} /> }]
 */
export function MasterDataScreen(cfg: MasterConfig) {
  const can = usePermission();
  const perm = cfg.permission ?? 'dimensions';
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);

  // preload options so list cells can render labels for select fields
  const optionQueries = cfg.fields.filter((f) => f.type === 'select' && f.optionsUrl).map((f) => ({ f, q: useOptions(f) })); // eslint-disable-line react-hooks/rules-of-hooks

  const hasActive = cfg.fields.some((f) => f.key === 'isActive');

  const columns = useMemo<Column<Row>[]>(() => {
    if (cfg.columns) return cfg.columns;
    const cols: Column<Row>[] = cfg.fields
      .filter((f) => !f.hideInList && f.type !== 'textarea')
      .map((f) => {
        const t = f.type ?? 'text';
        const c: Column<Row> = { key: f.listKey ?? f.key, header: f.label, width: f.listWidth, sortable: !f.optionsUrl || !!f.listKey };
        if (t === 'number') c.type = f.listType ?? 'number';
        else if (t === 'date') c.type = 'date';
        else if (t === 'checkbox') {
          c.cell = (r) => (r[f.key] ? <Badge tone="green">{f.key === 'isActive' ? 'Active' : 'Yes'}</Badge> : <Badge>{f.key === 'isActive' ? 'Inactive' : 'No'}</Badge>);
          c.sortable = false;
        } else if (t === 'select') {
          const opts = optionQueries.find((o) => o.f.key === f.key)?.q.data ?? f.options;
          if (!f.listKey) {
            c.cell = (r) => opts?.find((o) => String(o.value) === String(r[f.key]))?.label ?? '';
            c.accessor = (r) => opts?.find((o) => String(o.value) === String(r[f.key]))?.label ?? '';
          } else if (f.options) c.cell = (r) => f.options!.find((o) => String(o.value) === String(r[f.key]))?.label ?? String(r[f.key] ?? '');
        } else if (f.listType) c.type = f.listType;
        return c;
      });
    return [...cols, ...(cfg.extraColumns ?? [])];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.columns, cfg.fields, cfg.extraColumns, ...optionQueries.map((o) => o.q.data)]);

  const toggle = useMutation({
    mutationFn: (r: Row) => api.put(`${cfg.url}/${r.id}`, { isActive: !r.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['table', cfg.tableKey] }),
    onError: (e) => toast.error(apiError(e)),
  });
  const del = useMutation({
    mutationFn: (r: Row) => api.delete(`${cfg.url}/${r.id}`),
    onSuccess: () => {
      toast.success('Deleted');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['table', cfg.tableKey] });
    },
    onError: (e) => {
      toast.error(apiError(e));
      setDeleting(null);
    },
  });

  const actions: RowAction<Row>[] = [
    ...(can(perm, 'edit') ? [{ label: 'Edit', icon: Pencil, onClick: (r: Row) => setEditing(r) }] : []),
    ...(hasActive && can(perm, 'edit') ? [{ label: 'Toggle active', icon: Power, onClick: (r: Row) => toggle.mutate(r) }] : []),
    ...(cfg.rowActions ?? []),
    ...(cfg.allowDelete !== false && can(perm, 'delete') ? [{ label: 'Delete', icon: Trash2, danger: true, onClick: (r: Row) => setDeleting(r) }] : []),
  ];

  return (
    <div className="flex h-full flex-col">
      <DataTable<Row>
        tableKey={cfg.tableKey}
        queryKey={cfg.tableKey}
        url={cfg.url}
        columns={columns}
        filters={cfg.listFilters}
        exportName={cfg.title}
        rowActions={actions}
        onRowDoubleClick={(r) => can(perm, 'edit') && setEditing(r)}
        searchPlaceholder={`Search ${cfg.title.toLowerCase()}...`}
        toolbarExtras={
          <>
            {cfg.allowCreate !== false && can(perm, 'create') && (
              <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
                New
              </Button>
            )}
            {cfg.toolbarExtras}
          </>
        }
      />
      {editing && <MasterForm cfg={cfg} row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        danger
        title={`Delete ${cfg.title}`}
        message={`Delete "${String(deleting?.name ?? deleting?.code ?? deleting?.id ?? '')}"? This cannot be undone.`}
        confirmLabel="Delete"
        loading={del.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting)}
      />
    </div>
  );
}

/** Convenience wrapper used by *.screen.tsx files: `component: masterScreen(config)` */
export const masterScreen = (cfg: MasterConfig) =>
  function MasterScreen() {
    return <MasterDataScreen {...cfg} />;
  };

