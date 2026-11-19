import { RevisionHistory } from '@/components/doc/RevisionHistory';
import { useEffect, useState } from 'react';
import { useForm, useFieldArray, FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  FileText, Plus, Save, Trash2, Wrench, CalendarClock, AlertTriangle,
  CheckCircle2, Clock, TrendingUp,
} from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column, DataTable } from '@/components/DataTable';
import { DocumentLayout, HeaderSection, DocSection, DocAction } from '@/components/doc';
import { Button, Field, Input, NumberInput, Select, Textarea, LoadingBlock, ErrorState, IconButton, ConfirmDialog } from '@/components/ui';
import { useDocument } from '@/hooks/useDocument';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { toast } from '@/store/toast';
import { useOptions, STATUS_OPTIONS, strOrNull, numOrNull, numOr0 } from '@/components/inventory/common';

const AMC_URL = '/amc';

type AnyRec = Record<string, unknown>;

const STATUSES = ['DRAFT', 'ACTIVE', 'EXPIRED', 'RENEWED', 'CANCELLED'];
const CONTRACT_TYPES: Array<{ value: string; label: string }> = [
  { value: 'COMPREHENSIVE', label: 'Comprehensive' },
  { value: 'LABOUR_ONLY', label: 'Labour Only' },
  { value: 'PARTS_ONLY', label: 'Parts Only' },
];

/* ─── LIST ─── */
const AmcList = ({ tabId: _tabId }: ScreenProps) => {
  const open = useOpenScreen();
  const can = usePermission();
  const [status, setStatus] = useState('');

  const columns: Column<AnyRec>[] = [
    { key: 'contractNo', header: 'Contract No', width: 130 },
    { key: 'customer.name', header: 'Customer', sortable: false },
    { key: 'equipmentDesc', header: 'Equipment / Product', sortable: false, accessor: (r) => r.equipmentDesc || (r.product as AnyRec | undefined)?.name },
    { key: 'serialNo', header: 'Serial No', width: 120, sortable: false },
    {
      key: 'contractType', header: 'Type', width: 120, sortable: false,
      cell: (r) => <span>{CONTRACT_TYPES.find((t) => t.value === r.contractType)?.label ?? String(r.contractType ?? '')}</span>,
    },
    { key: 'startDate', header: 'Start', type: 'date', width: 95 },
    { key: 'endDate', header: 'End', type: 'date', width: 95 },
    { key: 'total', header: 'Value', type: 'money', width: 110, total: 'sum' },
    {
      key: 'visitsDone', header: 'Visits', width: 90, sortable: false,
      cell: (r) => <span className="tabular-nums">{Number(r.visitsDone ?? 0)}/{Number(r.visitsTotal ?? 0)}</span>,
    },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
  ];

  return (
    <DataTable<AnyRec>
      tableKey="amc-contracts"
      queryKey="amc-contracts"
      columns={columns}
      exportName="AMC Contracts"
      searchPlaceholder="Search contract no, customer, equipment..."
      defaultSort={{ key: 'id', dir: 'desc' }}
      filters={{ status: status || undefined }}
      fetcher={async (p) => {
        const params: AnyRec = { page: p.page, pageSize: p.pageSize, sort: p.sort, dir: p.dir };
        if (p.search) params.search = p.search;
        if (p.status) params.status = p.status;
        return (await api.get<never>(AMC_URL, { params })).data;
      }}
      onRowDoubleClick={(r) => open('amc-form', { id: r.id as number }, String(r.contractNo ?? ''))}
      rowActions={[{ label: 'Open', onClick: (r) => open('amc-form', { id: r.id as number }, String(r.contractNo ?? '')) }]}
      toolbarExtras={
        <>
          {can('amc', 'create') && (
            <Button variant="primary" icon={Plus} onClick={() => open('amc-form', {}, 'New Contract')}>New Contract</Button>
          )}
          <Select
            className="w-[150px]"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All statuses"
            options={STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }))}
          />
        </>
      }
    />
  );
};

/* ─── FORM schema ─── */
const visitSchema = z.object({
  id: z.number().optional(),
  visitNo: z.coerce.number().int().min(1),
  scheduledDate: z.string().min(1, 'Required'),
  completedDate: z.string().nullish(),
  visitType: z.enum(['PREVENTIVE', 'CORRECTIVE', 'EMERGENCY']).default('PREVENTIVE'),
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('SCHEDULED'),
  technicianName: z.string().max(200).nullish(),
  findings: z.string().max(2000).nullish(),
  partsUsed: z.string().max(2000).nullish(),
});

const schema = z.object({
  customerId: z.coerce.number({ required_error: 'Customer required' }).int().positive('Customer required'),
  productId: z.coerce.number().int().positive().nullish(),
  equipmentDesc: z.string().max(500).nullish(),
  serialNo: z.string().max(200).nullish(),
  contractType: z.enum(['COMPREHENSIVE', 'LABOUR_ONLY', 'PARTS_ONLY']).default('COMPREHENSIVE'),
  startDate: z.string().min(1, 'Start date required'),
  endDate: z.string().min(1, 'End date required'),
  amount: z.coerce.number().min(0).default(0),
  vatRate: z.coerce.number().min(0).max(100).default(5),
  visitCount: z.coerce.number().int().min(0).default(4),
  status: z.enum(['DRAFT', 'ACTIVE', 'EXPIRED', 'RENEWED', 'CANCELLED']).default('DRAFT'),
  salesmanId: z.coerce.number().int().positive().nullish(),
  notes: z.string().max(2000).nullish(),
  visits: z.array(visitSchema).default([]),
}).refine((v) => v.endDate >= v.startDate, { message: 'End date must be on or after start date', path: ['endDate'] });
type FormValues = z.infer<typeof schema>;

function toDate(v: unknown) {
  if (!v) return '';
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/* ─── FORM ─── */
const AmcForm = ({ tabId, params }: ScreenProps) => {
  const id = params?.id as number | undefined;
  const can = usePermission();
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();
  const ws = useWorkspace();

  const doc = useDocument<AnyRec>(AMC_URL, id, {
    tabId,
    titleOf: (d) => String(d.contractNo ?? 'New Contract'),
  });

  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { status: 'DRAFT', contractType: 'COMPREHENSIVE', vatRate: 5, visitCount: 4, visits: [] },
  });
  const { register, handleSubmit, watch, reset, formState: { errors, isDirty } } = methods;
  const visits = useFieldArray({ control: methods.control, name: 'visits' });

  useEffect(() => {
    if (doc.data) {
      const d = doc.data;
      reset({
        customerId: d.customerId as number,
        productId: numOrNull(d.productId),
        equipmentDesc: strOrNull(d.equipmentDesc),
        serialNo: strOrNull(d.serialNo),
        contractType: (d.contractType as FormValues['contractType']) ?? 'COMPREHENSIVE',
        startDate: toDate(d.startDate),
        endDate: toDate(d.endDate),
        amount: numOr0(d.amount),
        vatRate: numOrNull(d.vatRate) ?? 5,
        visitCount: numOrNull(d.visitCount) ?? 4,
        status: (d.status as FormValues['status']) ?? 'DRAFT',
        salesmanId: numOrNull(d.salesmanId),
        notes: strOrNull(d.notes),
        visits: ((d.visits as AnyRec[]) ?? []).map((v) => ({
          id: v.id as number,
          visitNo: Number(v.visitNo),
          scheduledDate: toDate(v.scheduledDate),
          completedDate: toDate(v.completedDate) || null,
          visitType: (v.visitType as FormValues['visits'][number]['visitType']) ?? 'PREVENTIVE',
          status: (v.status as FormValues['visits'][number]['status']) ?? 'SCHEDULED',
          technicianName: strOrNull(v.technicianName),
          findings: strOrNull(v.findings),
          partsUsed: strOrNull(v.partsUsed),
        })),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.data]);

  useEffect(() => { ws.setDirty(tabId, isDirty); }, [isDirty, tabId, ws.setDirty]);

  const amount = numOr0(watch('amount'));
  const vatRate = numOr0(watch('vatRate'));
  const vatAmount = Math.round(amount * vatRate) / 100;
  const total = amount + vatAmount;

  const customerOpts = useOptions('/customers', { isActive: true });
  const productOpts = useOptions('/products', { isActive: true });
  const salesmanOpts = useOptions('/salesmen', { isActive: true });

  const addVisit = () => {
    const nextNo = Math.max(0, ...visits.fields.map((v) => v.visitNo)) + 1;
    const startDate = watch('startDate');
    visits.append({
      visitNo: nextNo,
      scheduledDate: startDate || new Date().toISOString().slice(0, 10),
      completedDate: null,
      visitType: 'PREVENTIVE',
      status: 'SCHEDULED',
      technicianName: null,
      findings: null,
      partsUsed: null,
    });
  };

  const autoSchedule = () => {
    const startStr = watch('startDate'), endStr = watch('endDate');
    const count = numOr0(watch('visitCount'));
    const start = new Date(startStr), end = new Date(endStr);
    if (!startStr || !endStr || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
      toast.warning('Set a valid start and end date first'); return;
    }
    if (!Number.isInteger(count) || count <= 0) { toast.warning('Enter a positive whole number of planned visits'); return; }
    visits.replace(Array.from({ length: count }, (_, i) => ({
      visitNo: i + 1,
      scheduledDate: new Date(start.getTime() + ((end.getTime() - start.getTime()) / count) * (i + 0.5)).toISOString().slice(0, 10),
      completedDate: null, visitType: 'PREVENTIVE' as const, status: 'SCHEDULED' as const,
      technicianName: null, findings: null, partsUsed: null,
    })));
  };

  const onSubmit = async (vals: FormValues) => {
    try {
      await doc.save({ ...vals, startDate: new Date(vals.startDate).toISOString(), endDate: new Date(vals.endDate).toISOString() });
      qc.invalidateQueries({ queryKey: ['amc'] });
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const editable = can('amc', id ? 'edit' : 'create');
  const statusVal = watch('status');

  if (doc.isLoading) return <LoadingBlock />;
  if (doc.error) return <ErrorState message={doc.error} onRetry={() => doc.refetch()} />;

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleSubmit(onSubmit)} className="flex h-full min-h-0 flex-col">
        <DocumentLayout
          icon={Wrench}
          title="AMC Contract"
          docNo={doc.data ? String(doc.data.contractNo ?? '') : undefined}
          status={statusVal}
          loading={doc.isLoading}
          actions={
            <>
              {editable && (
                <DocAction icon={Save} variant="primary" loading={doc.saving} onClick={handleSubmit(onSubmit)}>Save</DocAction>
              )}
              {id && can('amc', 'delete') && (
                <DocAction icon={Trash2} variant="danger" onClick={() => setDeleting(true)}>Delete</DocAction>
              )}
            </>
          }
        >
          {/* ── Header ── */}
          <HeaderSection title="Contract Information" columns={4}>
            <Field label="Customer *" error={errors.customerId?.message}>
              <Select {...register('customerId')} disabled={!editable} options={customerOpts.options} placeholder="Select customer" />
            </Field>
            <Field label="Contract Type">
              <Select {...register('contractType')} disabled={!editable} options={CONTRACT_TYPES} />
            </Field>
            <Field label="Status">
              <Select {...register('status')} disabled={!editable} options={STATUS_OPTIONS(STATUSES)} />
            </Field>
            <Field label="Salesman">
              <Select {...register('salesmanId', { setValueAs: numOrNull })} disabled={!editable} options={salesmanOpts.options} placeholder="— none —" />
            </Field>
          </HeaderSection>

          {/* ── Equipment ── */}
          <DocSection title="Equipment">
            <div className="grid gap-4 p-2 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="Product / Model">
                <Select {...register('productId', { setValueAs: numOrNull })} disabled={!editable} options={productOpts.options} placeholder="— select product —" />
              </Field>
              <Field label="Equipment Description">
                <Input {...register('equipmentDesc')} disabled={!editable} placeholder="e.g. Xerox WorkCentre 7845" />
              </Field>
              <Field label="Serial Number">
                <Input {...register('serialNo')} disabled={!editable} placeholder="Machine serial no." />
              </Field>
              <Field label="Planned Visits / Year">
                <NumberInput {...register('visitCount')} disabled={!editable} />
              </Field>
            </div>
          </DocSection>

          {/* ── Contract Period & Value ── */}
          <DocSection title="Contract Period & Value">
            <div className="grid gap-4 p-2 sm:grid-cols-2 xl:grid-cols-5">
              <Field label="Start Date *" error={errors.startDate?.message}>
                <Input type="date" {...register('startDate')} disabled={!editable} />
              </Field>
              <Field label="End Date *" error={errors.endDate?.message}>
                <Input type="date" {...register('endDate')} disabled={!editable} />
              </Field>
              <Field label="Contract Amount">
                <NumberInput {...register('amount')} disabled={!editable} />
              </Field>
              <Field label="VAT %">
                <NumberInput {...register('vatRate')} disabled={!editable} />
              </Field>
              <div className="flex flex-col gap-0.5 self-end pb-1 pl-1">
                <div className="text-[10px] text-ink-muted">VAT: {fmt.money(vatAmount)}</div>
                <div className="text-[13px] font-bold text-ink">Total: {fmt.money(total)}</div>
              </div>
            </div>
          </DocSection>

          {/* ── Service Visits ── */}
          <DocSection
            title={`Service Visits (${visits.fields.length})`}
            right={
              editable ? (
                <div className="flex gap-1">
                  <Button size="sm" icon={CalendarClock} onClick={autoSchedule} type="button">Auto-schedule</Button>
                  <Button size="sm" icon={Plus} onClick={addVisit} type="button">Add Visit</Button>
                </div>
              ) : undefined
            }
          >
            <div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-[13px]">
              <thead>
                <tr className="border-b border-line bg-brand-light/40 text-left text-[10px] font-semibold uppercase text-ink-muted">
                  <th className="w-8 px-2 py-1">#</th>
                  <th className="px-2 py-1">Scheduled</th>
                  <th className="px-2 py-1">Completed</th>
                  <th className="px-2 py-1">Type</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Technician</th>
                  <th className="px-2 py-1">Findings</th>
                  {editable && <th className="w-7" />}
                </tr>
              </thead>
              <tbody>
                {visits.fields.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-center text-ink-faint">
                      No visits scheduled. Use Auto-schedule or Add Visit.
                    </td>
                  </tr>
                )}
                {visits.fields.map((f, i) => (
                  <tr key={f.id} className="border-b border-line hover:bg-brand-light/20">
                    <td className="px-2 py-0.5 text-ink-muted">{i + 1}</td>
                    <td className="px-1 py-0.5">
                      <Input type="date" {...register(`visits.${i}.scheduledDate`)} disabled={!editable} />
                    </td>
                    <td className="px-1 py-0.5">
                      <Input type="date" {...register(`visits.${i}.completedDate`)} disabled={!editable} />
                    </td>
                    <td className="px-1 py-0.5">
                      <Select {...register(`visits.${i}.visitType`)} disabled={!editable}
                        options={[
                          { value: 'PREVENTIVE', label: 'Preventive' },
                          { value: 'CORRECTIVE', label: 'Corrective' },
                          { value: 'EMERGENCY', label: 'Emergency' },
                        ]}
                      />
                    </td>
                    <td className="px-1 py-0.5">
                      <Select {...register(`visits.${i}.status`)} disabled={!editable}
                        options={[
                          { value: 'SCHEDULED', label: 'Scheduled' },
                          { value: 'IN_PROGRESS', label: 'In Progress' },
                          { value: 'COMPLETED', label: 'Completed' },
                          { value: 'CANCELLED', label: 'Cancelled' },
                        ]}
                      />
                    </td>
                    <td className="px-1 py-0.5">
                      <Input {...register(`visits.${i}.technicianName`)} disabled={!editable} placeholder="Technician" />
                    </td>
                    <td className="px-1 py-0.5">
                      <Input {...register(`visits.${i}.findings`)} disabled={!editable} placeholder="Findings / parts used" />
                    </td>
                    {editable && (
                      <td className="px-1">
                        <IconButton icon={Trash2} variant="danger" label="Remove" onClick={() => visits.remove(i)} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table></div>
          </DocSection>

          {/* ── Notes ── */}
          <DocSection title="Notes">
            <div className="p-2">
              <Textarea {...register('notes')} disabled={!editable} rows={3} placeholder="Internal notes, special terms..." />
            </div>
          </DocSection>
        <RevisionHistory entity="AmcContract" id={doc.id} />
      </DocumentLayout>

        <ConfirmDialog
          open={deleting}
          danger
          title="Delete Contract"
          message="Delete this AMC contract? This cannot be undone."
          confirmLabel="Delete"
          loading={doc.removing}
          onCancel={() => setDeleting(false)}
          onConfirm={async () => { try { await doc.remove(); qc.invalidateQueries({ queryKey: ['amc'] }); ws.setDirty(tabId, false); setDeleting(false); ws.close(tabId); } catch { /* useDocument displays the error */ } }}
        />
      </form>
    </FormProvider>
  );
};

/* ─── REPORT screen ─── */
const AmcReports = (_: ScreenProps) => {
  const summary = useQuery({
    queryKey: ['amc', 'summary'],
    queryFn: async () => (await api.get<AnyRec>(`${AMC_URL}/reports/summary`)).data,
    staleTime: 30_000,
  });
  const expiring = useQuery({
    queryKey: ['amc', 'expiring'],
    queryFn: async () => (await api.get<AnyRec[]>(`${AMC_URL}/reports/expiring`, { params: { days: 60 } })).data,
    staleTime: 30_000,
  });
  const open = useOpenScreen();

  if (summary.isLoading || expiring.isLoading) return <LoadingBlock />;
  if (summary.error || expiring.error) return <ErrorState message={apiError(summary.error || expiring.error)} onRetry={() => { summary.refetch(); expiring.refetch(); }} />;

  const stats = summary.data ?? {};
  const tiles: Array<{ label: string; value: string | number; icon: React.ElementType; color: string }> = [
    { label: 'Total Contracts', value: Number(stats.total ?? 0), icon: FileText, color: 'text-brand' },
    { label: 'Active', value: Number(stats.active ?? 0), icon: CheckCircle2, color: 'text-success' },
    { label: 'Expiring (30d)', value: Number(stats.expiring ?? 0), icon: AlertTriangle, color: 'text-warning' },
    { label: 'Expired', value: Number(stats.expired ?? 0), icon: Clock, color: 'text-danger' },
    { label: 'Active Revenue', value: fmt.money(Number(stats.activeRevenue ?? 0)), icon: TrendingUp, color: 'text-brand' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-auto bg-canvas p-6">
      {/* KPI tiles */}
      <div className="flex flex-wrap gap-3">
        {tiles.map((t) => {
          const Icon = t.icon as React.ComponentType<{ size: number; className: string }>;
          return (
            <div key={t.label} className="flex min-w-[160px] flex-1 items-center gap-3 rounded-card border border-line bg-surface px-4 py-3">
              <Icon size={22} className={t.color} />
              <div>
                <div className="text-[11px] text-ink-muted">{t.label}</div>
                <div className="text-2xl font-bold tabular-nums text-ink">{String(t.value)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Expiring contracts table */}
      <div className="rounded-card border border-line bg-surface">
        <div className="border-b border-line bg-brand-light px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-brand">
          Contracts Expiring in Next 60 Days
        </div>
        {expiring.isLoading ? (
          <LoadingBlock />
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-[10px] font-semibold uppercase text-ink-muted">
                <th className="px-3 py-1.5">Contract No</th>
                <th className="px-3 py-1.5">Customer</th>
                <th className="px-3 py-1.5">Equipment</th>
                <th className="px-3 py-1.5">End Date</th>
                <th className="px-3 py-1.5">Value</th>
                <th className="px-3 py-1.5">Days Left</th>
              </tr>
            </thead>
            <tbody>
              {(expiring.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-ink-faint">
                    No contracts expiring in the next 60 days.
                  </td>
                </tr>
              )}
              {(expiring.data ?? []).map((r) => {
                const daysLeft = Math.ceil((new Date(String(r.endDate)).getTime() - Date.now()) / 86400000);
                const cust = r.customer as AnyRec | undefined;
                return (
                  <tr
                    key={String(r.id)}
                    className="cursor-pointer border-b border-line hover:bg-brand-light/20"
                    onClick={() => open('amc-form', { id: r.id as number }, String(r.contractNo))}
                  >
                    <td className="px-3 py-1 font-medium text-brand">{String(r.contractNo)}</td>
                    <td className="px-3 py-1">{String(cust?.name ?? '—')}</td>
                    <td className="px-3 py-1 text-ink-muted">{String(r.equipmentDesc ?? (r.product as AnyRec | undefined)?.name ?? '—')}</td>
                    <td className="px-3 py-1">{fmt.date(String(r.endDate))}</td>
                    <td className="px-3 py-1 tabular-nums">{fmt.money(Number(r.total))}</td>
                    <td className="px-3 py-1">
                      <span className={`font-semibold ${daysLeft <= 15 ? 'text-danger' : daysLeft <= 30 ? 'text-warning' : 'text-ink'}`}>
                        {daysLeft}d
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default [
  { id: 'amc-contracts', title: 'AMC Contracts', icon: Wrench, component: AmcList, permission: 'amc' },
  { id: 'amc-form', title: 'AMC Contract', icon: FileText, component: AmcForm, permission: 'amc' },
  { id: 'amc-reports', title: 'AMC Reports', icon: TrendingUp, component: AmcReports, permission: 'amc' },
] satisfies ScreenDef[];
