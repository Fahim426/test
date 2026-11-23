import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Clock, FileCheck, FileCode2, FileText, LayoutDashboard, Plug, Plus, RefreshCw,
  Save, ScrollText, Send, Settings as SettingsIcon, Trash2,
} from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column, DataTable } from '@/components/DataTable';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingBlock, Panel, Select, type Tone } from '@/components/ui';
import { usePermission } from '@/store/auth';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { toast } from '@/store/toast';
import { cn } from '@/lib/cn';

const URL = '/einvoice';
type Rec = Record<string, unknown>;

const STATUS_TONE: Record<string, Tone> = { NONE: 'gray', PENDING: 'amber', CLEARED: 'green', FAILED: 'red' };
const EStatus = ({ s }: { s?: unknown }) => {
  const k = String(s ?? 'NONE').toUpperCase();
  return <Badge tone={STATUS_TONE[k] ?? 'gray'}>{k === 'NONE' ? 'Not submitted' : fmt.status(k)}</Badge>;
};

type Tab = 'overview' | 'invoices' | 'queue' | 'xml' | 'logs' | 'settings';
const TABS: Array<{ id: Tab; label: string; icon: typeof FileText }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'invoices', label: 'Invoices', icon: FileText },
  { id: 'queue', label: 'Submission Queue', icon: Send },
  { id: 'xml', label: 'XML Preview', icon: FileCode2 },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

const useInvalidate = () => {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['einvoice'] });
    void qc.invalidateQueries({ queryKey: ['table', 'einvoice-invoices'] });
  };
};

/* ─── Overview ─── */
function Overview({ go }: { go: (t: Tab) => void }) {
  const summary = useQuery({ queryKey: ['einvoice', 'summary'], queryFn: async () => (await api.get<Rec>(`${URL}/summary`)).data, refetchInterval: 20_000 });
  const logs = useQuery({ queryKey: ['einvoice', 'logs', 'recent'], queryFn: async () => (await api.get<Rec[]>(`${URL}/logs`)).data });
  if (summary.isLoading) return <LoadingBlock />;
  if (summary.error) return <ErrorState message={apiError(summary.error)} onRetry={() => summary.refetch()} />;
  const s = summary.data ?? {};
  const prod = s.mode === 'PRODUCTION';
  const tiles = [
    { label: 'Not submitted', value: Number(s.notSubmitted ?? 0), icon: FileText, tone: 'text-ink-muted', tab: 'invoices' as Tab },
    { label: 'In queue', value: Number(s.pending ?? 0), icon: Clock, tone: 'text-warning', tab: 'queue' as Tab },
    { label: 'Cleared', value: Number(s.cleared ?? 0), icon: CheckCircle2, tone: 'text-success', tab: 'queue' as Tab },
    { label: 'Failed', value: Number(s.failed ?? 0), icon: AlertTriangle, tone: 'text-danger', tab: 'queue' as Tab },
    { label: 'Clearance rate', value: `${Number(s.clearanceRate ?? 0)}%`, icon: FileCheck, tone: 'text-brand', tab: 'queue' as Tab },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className={cn('flex items-start gap-3 rounded-card border p-3 text-[13px]', prod ? 'border-success/40 bg-success-soft' : 'border-warning/40 bg-warning-soft')}>
        <AlertTriangle size={18} className={prod ? 'text-success' : 'text-warning'} />
        <div className="text-ink">
          <b>{prod ? 'Production mode' : 'Sandbox mode — no real submissions'}.</b>{' '}
          {prod
            ? s.configured
              ? 'Live submission needs a provider adapter that has not been built yet; submissions will be logged as failed until then.'
              : 'Peppol ID and ASP credentials are incomplete.'
            : 'Invoices are cleared by a built-in mock and have no legal effect. Configure your Peppol ID and Accredited Service Provider in '}
          {!prod && <button className="font-medium text-brand underline" onClick={() => go('settings')}>Settings</button>}
          {!prod && '.'}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        {tiles.map((t) => (
          <button key={t.label} onClick={() => go(t.tab)} className="flex min-w-[160px] flex-1 items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left shadow-card transition hover:border-brand/40">
            <t.icon size={22} className={t.tone} />
            <div>
              <div className="text-[11px] text-ink-muted">{t.label}</div>
              <div className="text-[20px] font-bold tabular-nums text-ink">{String(t.value)}</div>
            </div>
          </button>
        ))}
      </div>
      <Panel title="Recent activity" bodyClassName="p-0">
        <LogTable rows={(logs.data ?? []).slice(0, 8)} loading={logs.isLoading} />
      </Panel>
    </div>
  );
}

/* ─── Invoices ─── */
function Invoices({ onPreview }: { onPreview: (id: number) => void }) {
  const can = usePermission();
  const invalidate = useInvalidate();
  const [st, setSt] = useState('');
  const queue = useMutation({
    mutationFn: async (ids: number[]) => (await api.post<{ queued: number; skipped: Array<{ docNo?: string; reason: string }> }>(`${URL}/queue`, { invoiceIds: ids })).data,
    onSuccess: (r) => {
      if (r.queued) toast.success(`${r.queued} invoice(s) added to the queue`);
      if (r.skipped.length) toast.warning(r.skipped.slice(0, 3).map((x) => `${x.docNo ?? ''} ${x.reason}`).join(' · '));
      invalidate();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const columns: Column<Rec>[] = [
    { key: 'docNo', header: 'Invoice No', width: 140 },
    { key: 'docDate', header: 'Date', type: 'date', width: 105 },
    { key: 'customerName', header: 'Customer', sortable: false },
    { key: 'total', header: 'Total', type: 'money', width: 120, total: 'sum' },
    { key: 'currencyCode', header: 'Cur', width: 60, sortable: false },
    { key: 'einvStatus', header: 'E-Invoice', width: 130, sortable: false, cell: (r) => <EStatus s={r.einvStatus} /> },
    { key: 'einvUuid', header: 'UUID', width: 250, sortable: false, cell: (r) => <span className="font-mono text-[11px] text-ink-muted">{String(r.einvUuid ?? '')}</span> },
  ];
  return (
    <DataTable<Rec>
      tableKey="einvoice-invoices"
      queryKey="einvoice-invoices"
      columns={columns}
      exportName="E-Invoice Invoices"
      searchPlaceholder="Search invoice no..."
      filters={{ einvStatus: st || undefined }}
      fetcher={async (p) => {
        const params: Rec = { page: p.page, pageSize: p.pageSize };
        if (p.search) params.search = p.search;
        if (p.einvStatus) params.einvStatus = p.einvStatus;
        return (await api.get<never>(`${URL}/invoices`, { params })).data;
      }}
      getRowId={(r) => r.id as number}
      bulkActions={can('einvoice', 'create') ? [{ label: 'Add to queue', icon: Plus, onClick: (rows, clear) => { queue.mutate(rows.map((r) => r.id as number)); clear(); } }] : undefined}
      rowActions={[
        { label: 'Preview XML', icon: FileCode2, onClick: (r) => onPreview(r.id as number) },
        { label: 'Add to queue', icon: Plus, hidden: () => !can('einvoice', 'create'), disabled: (r) => r.einvStatus === 'PENDING' || r.einvStatus === 'CLEARED', onClick: (r) => queue.mutate([r.id as number]) },
      ]}
      toolbarExtras={
        <Select
          className="w-[170px]"
          value={st}
          onChange={(e) => setSt(e.target.value)}
          placeholder="All statuses"
          options={[{ value: 'NONE', label: 'Not submitted' }, { value: 'PENDING', label: 'Pending' }, { value: 'CLEARED', label: 'Cleared' }, { value: 'FAILED', label: 'Failed' }]}
        />
      }
    />
  );
}

/* ─── Queue ─── */
function Queue({ onPreview }: { onPreview: (id: number) => void }) {
  const can = usePermission();
  const invalidate = useInvalidate();
  const [del, setDel] = useState<Rec | null>(null);
  const q = useQuery({ queryKey: ['einvoice', 'queue'], queryFn: async () => (await api.get<Rec[]>(`${URL}/queue`)).data });
  const one = useMutation({
    mutationFn: async (id: number) => (await api.post<{ uuid: string }>(`${URL}/submit/${id}`)).data,
    onSuccess: (r) => { toast.success(`Cleared — UUID ${r.uuid}`); invalidate(); },
    onError: (e) => { toast.error(apiError(e)); invalidate(); },
  });
  const all = useMutation({
    mutationFn: async () => (await api.post<{ processed: number; cleared: number; failed: number }>(`${URL}/submit-all`)).data,
    onSuccess: (r) => { toast.info(`Processed ${r.processed}: ${r.cleared} cleared, ${r.failed} failed`); invalidate(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`${URL}/queue/${id}`)).data,
    onSuccess: () => { toast.success('Removed from queue'); setDel(null); invalidate(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.status === 'PENDING').length;
  return (
    <Panel
      title={`Submission queue (${rows.length})`}
      bodyClassName="p-0"
      right={
        <div className="flex gap-2">
          <Button size="sm" icon={RefreshCw} onClick={() => q.refetch()}>Refresh</Button>
          {can('einvoice', 'post') && (
            <Button size="sm" variant="primary" icon={Send} loading={all.isPending} disabled={!pending} onClick={() => all.mutate()}>
              Submit all pending ({pending})
            </Button>
          )}
        </div>
      }
    >
      {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorState message={apiError(q.error)} /> : !rows.length ? (
        <EmptyState title="Queue is empty" hint="Add posted invoices from the Invoices tab." />
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase text-ink-muted">
                <th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Status</th><th className="px-3 py-2">Tries</th><th className="px-3 py-2">Last attempt</th>
                <th className="px-3 py-2">UUID / Error</th><th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)} className="border-b border-line hover:bg-surface-2">
                  <td className="px-3 py-1.5 font-medium text-brand">{String(r.docNo)}</td>
                  <td className="px-3 py-1.5">{String(r.customerName ?? '')}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt.money(r.total, String(r.currencyCode ?? ''))}</td>
                  <td className="px-3 py-1.5"><EStatus s={r.status} /></td>
                  <td className="px-3 py-1.5 tabular-nums">{String(r.attempts)}</td>
                  <td className="px-3 py-1.5 text-ink-muted">{r.lastAttempt ? fmt.date(String(r.lastAttempt)) : '—'}</td>
                  <td className="max-w-[320px] truncate px-3 py-1.5 font-mono text-[11px] text-ink-muted" title={String(r.lastError ?? r.aspUuid ?? '')}>
                    {r.status === 'FAILED' ? <span className="text-danger">{String(r.lastError ?? '')}</span> : String(r.aspUuid ?? '')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <Button size="sm" variant="ghost" icon={FileCode2} onClick={() => onPreview(r.invoiceId as number)}>XML</Button>
                    {can('einvoice', 'post') && r.status !== 'CLEARED' && (
                      <Button size="sm" icon={Send} loading={one.isPending && one.variables === r.id} onClick={() => one.mutate(r.id as number)}>
                        {r.status === 'FAILED' ? 'Retry' : 'Submit'}
                      </Button>
                    )}
                    {can('einvoice', 'delete') && r.status !== 'CLEARED' && (
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDel(r)} aria-label="Remove" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={!!del}
        danger
        title="Remove from queue"
        message={<>Remove <b>{String(del?.docNo ?? '')}</b> from the e-invoice queue?</>}
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => del && remove.mutate(del.id as number)}
        onCancel={() => setDel(null)}
      />
    </Panel>
  );
}

/* ─── XML preview ─── */
function XmlPreview({ invoiceId, setInvoiceId }: { invoiceId: number | null; setInvoiceId: (id: number | null) => void }) {
  const [docNo, setDocNo] = useState('');
  const x = useQuery({
    queryKey: ['einvoice', 'xml', invoiceId],
    enabled: invoiceId != null,
    queryFn: async () => (await api.get<Rec>(`${URL}/invoice/${invoiceId}/xml`)).data,
  });
  const find = async () => {
    try {
      const r = (await api.get<{ rows: Rec[] }>(`${URL}/invoices`, { params: { search: docNo.trim(), pageSize: 1 } })).data;
      if (!r.rows.length) return toast.warning('No posted invoice found with that number');
      setInvoiceId(r.rows[0].id as number);
    } catch (e) { toast.error(apiError(e)); }
  };
  const d = x.data;
  const errors = (d?.errors as string[] | undefined) ?? [];
  const warnings = (d?.warnings as string[] | undefined) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Invoice number" className="w-[240px]">
            <Input value={docNo} onChange={(e) => setDocNo(e.target.value)} placeholder="e.g. INV-2026-00001" onKeyDown={(e) => e.key === 'Enter' && void find()} />
          </Field>
          <Button icon={FileCode2} onClick={() => void find()} disabled={!docNo.trim()}>Generate</Button>
          {d && (
            <Button
              onClick={() => { void navigator.clipboard.writeText(String(d.xml)); toast.success('XML copied'); }}
            >Copy XML</Button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">Preview and pre-check only. Nothing is submitted from this tab.</p>
      </Panel>
      {invoiceId == null ? (
        <EmptyState title="No invoice selected" hint="Enter an invoice number, or use Preview XML from the Invoices or Queue tab." />
      ) : x.isLoading ? <LoadingBlock /> : x.error ? <ErrorState message={apiError(x.error)} /> : d && (
        <>
          <div className={cn('rounded-card border p-3 text-[13px]', errors.length ? 'border-danger/40 bg-danger-soft' : 'border-success/40 bg-success-soft')}>
            <b>{String(d.docNo)}</b> — {errors.length ? 'validation errors found' : 'passes validation'} ({String(d.mode).toLowerCase()} rules)
            {errors.map((e) => <div key={e} className="mt-1 text-danger">✕ {e}</div>)}
            {warnings.map((w) => <div key={w} className="mt-1 text-warning">⚠ {w}</div>)}
          </div>
          <pre className="max-h-[520px] overflow-auto rounded-card border border-line bg-surface-2 p-3 font-mono text-[11.5px] leading-5 text-ink">{String(d.xml)}</pre>
        </>
      )}
    </div>
  );
}

/* ─── Logs ─── */
function LogTable({ rows, loading }: { rows: Rec[]; loading?: boolean }) {
  if (loading) return <LoadingBlock />;
  if (!rows.length) return <EmptyState title="No activity yet" />;
  const tone: Record<string, Tone> = { INFO: 'blue', WARN: 'amber', ERROR: 'red' };
  return (
    <div className="overflow-auto">
      <table className="w-full text-[12.5px]">
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.id)} className="border-b border-line">
              <td className="whitespace-nowrap px-3 py-1.5 text-ink-muted">{fmt.date(String(r.createdAt))} {new Date(String(r.createdAt)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
              <td className="px-3 py-1.5"><Badge tone={tone[String(r.level)] ?? 'gray'}>{String(r.level)}</Badge></td>
              <td className="px-3 py-1.5">{String(r.message)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Logs() {
  const [level, setLevel] = useState('');
  const q = useQuery({ queryKey: ['einvoice', 'logs', level], queryFn: async () => (await api.get<Rec[]>(`${URL}/logs`, { params: { level: level || undefined } })).data });
  return (
    <Panel
      title="Activity log (latest 200)"
      bodyClassName="p-0"
      right={
        <div className="flex gap-2">
          <Select className="w-[130px]" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="All levels" options={['INFO', 'WARN', 'ERROR'].map((v) => ({ value: v, label: v }))} />
          <Button size="sm" icon={RefreshCw} onClick={() => q.refetch()}>Refresh</Button>
        </div>
      }
    >
      <LogTable rows={q.data ?? []} loading={q.isLoading} />
    </Panel>
  );
}

/* ─── Settings ─── */
function Settings() {
  const can = usePermission();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['einvoice', 'settings'], queryFn: async () => (await api.get<Rec>(`${URL}/settings`)).data });
  const [f, setF] = useState({ mode: 'SANDBOX', peppolId: '', aspName: '', baseUrl: '', clientId: '', clientSecret: '' });
  useEffect(() => {
    if (q.data) setF({ mode: String(q.data.mode), peppolId: String(q.data.peppolId ?? ''), aspName: String(q.data.aspName ?? ''), baseUrl: String(q.data.baseUrl ?? ''), clientId: String(q.data.clientId ?? ''), clientSecret: '' });
  }, [q.data]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: async () => (await api.put(`${URL}/settings`, f)).data,
    onSuccess: () => { toast.success('E-invoice settings saved'); void qc.invalidateQueries({ queryKey: ['einvoice'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const test = useMutation({
    mutationFn: async () => (await api.post<{ message: string }>(`${URL}/test`)).data,
    onSuccess: (r) => toast.success(r.message),
    onError: (e) => toast.error(apiError(e)),
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorState message={apiError(q.error)} onRetry={() => q.refetch()} />;
  const ro = !can('einvoice', 'edit');
  return (
    <Panel title="Peppol & ASP connection">
      <p className="mb-3 max-w-[720px] text-[12.5px] text-ink-muted">
        In <b>Sandbox</b> mode invoices are cleared by a built-in mock. <b>Production</b> needs your Peppol ID and your Accredited Service Provider's API details.
        The client secret is stored on the server and is never shown again after saving.
      </p>
      <div className="grid max-w-[720px] grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Mode">
          <Select value={f.mode} onChange={set('mode')} disabled={ro} options={[{ value: 'SANDBOX', label: 'Sandbox (mock, no real submissions)' }, { value: 'PRODUCTION', label: 'Production' }]} />
        </Field>
        <Field label="Peppol ID" hint="scheme:identifier as registered with your ASP, e.g. 0235:1234567890">
          <Input value={f.peppolId} onChange={set('peppolId')} disabled={ro} autoComplete="off" placeholder="0235:1234567890" />
        </Field>
        <Field label="ASP provider name"><Input value={f.aspName} onChange={set('aspName')} disabled={ro} autoComplete="off" /></Field>
        <Field label="API base URL" hint="Must start with https://">
          <Input value={f.baseUrl} onChange={set('baseUrl')} disabled={ro} autoComplete="off" placeholder="https://your-asp-provider.com/api/v1" />
        </Field>
        <Field label="Client ID"><Input value={f.clientId} onChange={set('clientId')} disabled={ro} autoComplete="off" /></Field>
        <Field label="Client secret" hint={q.data?.hasClientSecret ? 'A secret is saved. Leave blank to keep it.' : 'Never shown after save.'}>
          <Input type="password" value={f.clientSecret} onChange={set('clientSecret')} disabled={ro} autoComplete="new-password" />
        </Field>
      </div>
      {!ro && (
        <div className="mt-4 flex gap-2">
          <Button variant="primary" icon={Save} loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button>
          <Button icon={Plug} loading={test.isPending} onClick={() => test.mutate()}>Test connection</Button>
        </div>
      )}
    </Panel>
  );
}

/* ─── Screen ─── */
function EInvoiceScreen(_: ScreenProps) {
  const [tab, setTab] = useState<Tab>('overview');
  const [xmlId, setXmlId] = useState<number | null>(null);
  const preview = (id: number) => { setXmlId(id); setTab('xml'); };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3">
      <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2 text-[13px] font-medium transition',
              tab === t.id ? 'border-brand text-brand' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview go={setTab} />}
      {tab === 'invoices' && <Invoices onPreview={preview} />}
      {tab === 'queue' && <Queue onPreview={preview} />}
      {tab === 'xml' && <XmlPreview invoiceId={xmlId} setInvoiceId={setXmlId} />}
      {tab === 'logs' && <Logs />}
      {tab === 'settings' && <Settings />}
    </div>
  );
}

export default [
  { id: 'einvoice', title: 'E-Invoice', icon: FileCheck, component: EInvoiceScreen, permission: 'einvoice' },
] satisfies ScreenDef[];
