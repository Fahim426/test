import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, Clock, FileText, Hourglass, Receipt, UserCheck, Users, ChevronDown, ChevronRight, ExternalLink, HandCoins, Wallet, FileSearch } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { DataTable, Column } from '@/components/DataTable';
import { Select } from '@/components/ui';
import { Combo, ExportCfg, FilterDate, FilterField, Money, RCol, ReportGrid, ReportShell, sourceTarget, useApplied, useParties, yearStart } from '@/components/finance/common';
import { useOpenScreen } from '@/store/workspace';
import { api, apiError } from '@/lib/api';
import { fmt, today } from '@/lib/format';

type Side = 'CUSTOMER' | 'SUPPLIER';
const base = (s: Side) => (s === 'CUSTOMER' ? '/receivables' : '/payables');
const KIND_LABEL: Record<string, string> = { INVOICE: 'Invoice', RECEIPT: 'Receipt', PAYMENT: 'Payment', CREDIT_NOTE: 'Credit Note', DEBIT_NOTE: 'Debit Note', ADJUSTMENT: 'Adjustment', OTHER: 'Other' };

/* ============================================================== STATEMENT */
interface StEntry {
  date: string;
  entryNo: string;
  journalId: number;
  kind: string;
  reference: string;
  sourceType?: string | null;
  sourceId?: number | null;
  narration?: string | null;
  debit: number;
  credit: number;
  balance: number;
}
interface StResult {
  party: { id: number; code: string; name: string };
  openingBalance: number;
  entries: StEntry[];
  summary: Record<string, { debit: number; credit: number; count: number }>;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}
type StRow = Partial<StEntry> & { _opening?: boolean };

function StatementScreen({ side, params }: { side: Side } & Pick<ScreenProps, 'params'>) {
  const open = useOpenScreen();
  const parties = useParties(side);
  const f = useApplied({ partyId: params.partyId ? Number(params.partyId) : (null as number | null), from: (params.from as string) || yearStart(), to: (params.to as string) || today() });
  const a = f.applied;
  const q = useQuery({
    queryKey: ['fin-statement', side, a],
    enabled: !!a.partyId,
    queryFn: async () => (await api.get<StResult>(`${base(side)}/statement/${a.partyId}`, { params: { from: a.from || undefined, to: a.to || undefined } })).data,
  });
  const d = q.data;
  const rows: StRow[] = useMemo(() => (d ? [{ _opening: true, balance: d.openingBalance }, ...d.entries] : []), [d]);
  const drill = (r: StRow) => {
    if (r._opening) return;
    const t = sourceTarget({ ...(r as StEntry), entryType: r.kind });
    if (t) open(t.screen, { id: t.id }, t.title);
  };
  const columns: RCol<StRow>[] = [
    { key: 'date', header: 'Date', type: 'date', width: 95 },
    { key: 'entryNo', header: 'Journal No', width: 120, value: (r) => (r._opening ? 'Opening Balance' : r.entryNo), render: (r) => (r._opening ? <b>Opening Balance</b> : <button className="text-brand hover:underline" onClick={() => drill(r)}>{r.entryNo}</button>) },
    { key: 'kind', header: 'Type', width: 100, value: (r) => (r.kind ? KIND_LABEL[r.kind] ?? r.kind : '') },
    { key: 'reference', header: 'Reference', width: 130 },
    { key: 'narration', header: 'Narration' },
    { key: 'debit', header: 'Debit', type: 'money', blankZero: true, width: 110 },
    { key: 'credit', header: 'Credit', type: 'money', blankZero: true, width: 110 },
    { key: 'balance', header: 'Balance', type: 'money', width: 120 },
  ];
  const title = `${side === 'CUSTOMER' ? 'Customer' : 'Supplier'} Statement`;
  const cfg: ExportCfg<StRow> | null = d
    ? { title: `${title} - ${d.party.code} ${d.party.name}`, subtitle: `${fmt.date(a.from)} to ${fmt.date(a.to)}`, columns, rows, totals: { debit: d.totalDebit, credit: d.totalCredit, balance: d.closingBalance } }
    : null;
  return (
    <ReportShell
      title={d ? `${title} - ${d.party.code} ${d.party.name}` : title}
      cfg={cfg}
      running={q.isFetching && !!a.partyId}
      error={q.error ? apiError(q.error) : undefined}
      onRun={() => (f.draft.partyId ? f.run(q.refetch) : undefined)}
      filters={
        <>
          <FilterField label={side === 'CUSTOMER' ? 'Customer' : 'Supplier'} width={280}>
            <Combo options={(parties.data ?? []).map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` }))} value={f.draft.partyId} onChange={(x) => f.set('partyId', Number(x))} placeholder="Select..." />
          </FilterField>
          <FilterDate label="From" value={f.draft.from} onChange={(x) => f.set('from', x)} />
          <FilterDate label="To" value={f.draft.to} onChange={(x) => f.set('to', x)} />
        </>
      }
      footer={
        d && (
          <div className="flex flex-wrap items-center gap-x-4">
            <span>Opening <Money v={d.openingBalance} bold /></span>
            {Object.entries(d.summary).map(([k, s]) => (
              <span key={k} className="text-ink-muted">{KIND_LABEL[k] ?? k} ({s.count}): Dr {fmt.money(s.debit)} / Cr {fmt.money(s.credit)}</span>
            ))}
            <span className="ml-auto">Closing balance <Money v={d.closingBalance} bold /> {side === 'CUSTOMER' ? '(receivable)' : '(payable)'}</span>
          </div>
        )
      }
    >
      {!a.partyId ? <div className="p-8 text-center text-[13px] text-ink-faint">Select a {side === 'CUSTOMER' ? 'customer' : 'supplier'} and press Run</div> : (
        <ReportGrid columns={columns} rows={rows} totals={d ? { debit: d.totalDebit, credit: d.totalCredit, balance: d.closingBalance } : undefined} onRowClick={drill} rowClass={(r) => (r._opening ? 'bg-surface-2 font-medium' : undefined)} />
      )}
    </ReportShell>
  );
}

/* ============================================================== AGING */
const BUCKETS = ['current', '0-30', '31-60', '61-90', '91-120', '120+'] as const;
const BUCKET_LABEL: Record<string, string> = { current: 'Current', '0-30': '0 - 30', '31-60': '31 - 60', '61-90': '61 - 90', '91-120': '91 - 120', '120+': '120+' };
interface AgingInvoice {
  id: number;
  docNo: string;
  docDate: string;
  dueDate: string | null;
  outstanding: number;
  daysPastDue: number;
  bucket: string;
}
interface AgingRow {
  partyId: number;
  party: { id: number; code: string; name: string } | null;
  outstanding: number;
  unappliedCredit: number;
  unappliedNotes?: number;
  openingBalance: number;
  total: number;
  invoices?: AgingInvoice[];
  [bucket: string]: unknown;
}
type AgRow = Record<string, unknown> & { _party?: AgingRow; _inv?: AgingInvoice };

function AgingScreen({ side }: { side: Side }) {
  const open = useOpenScreen();
  const parties = useParties(side);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const f = useApplied({ asOf: today(), partyId: null as number | null });
  const a = f.applied;
  const q = useQuery({
    queryKey: ['fin-aging', side, a],
    queryFn: async () => (await api.get<{ asOf: string; rows: AgingRow[]; totals: Record<string, number> }>(`${base(side)}/aging`, { params: { asOf: a.asOf, partyId: a.partyId || undefined, detail: 1 } })).data,
  });
  const d = q.data;
  const toggle = (id: number) => setExpanded((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  const buildRows = (all: boolean): AgRow[] => {
    const out: AgRow[] = [];
    for (const r of d?.rows ?? []) {
      out.push({ ...r, _party: r, label: r.party ? `${r.party.code} - ${r.party.name}` : `#${r.partyId}` });
      if (all || expanded.has(r.partyId)) {
        for (const i of r.invoices ?? []) out.push({ _inv: i, label: `   ${i.docNo}  (${fmt.date(i.docDate)}, due ${fmt.date(i.dueDate)}, ${i.daysPastDue > 0 ? i.daysPastDue + ' days past due' : 'not due'})`, [i.bucket]: i.outstanding, outstanding: i.outstanding });
      }
    }
    return out;
  };
  const rows = useMemo(() => buildRows(false), [d, expanded]); // eslint-disable-line react-hooks/exhaustive-deps
  const allRows = useMemo(() => buildRows(true), [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const statementScreen = side === 'CUSTOMER' ? 'customer-statement' : 'supplier-statement';
  const drill = (r: AgRow) => {
    if (r._party) open(statementScreen, { partyId: r._party.partyId }, `${side === 'CUSTOMER' ? 'Customer' : 'Supplier'} Statement`);
    else if (r._inv) open(side === 'CUSTOMER' ? 'sales-invoice-form' : 'purchase-invoice-form', { id: r._inv.id }, r._inv.docNo);
  };
  const columns: RCol<AgRow>[] = [
    {
      key: 'label',
      header: side === 'CUSTOMER' ? 'Customer' : 'Supplier',
      render: (r) =>
        r._party ? (
          <span className="flex items-center gap-1 font-medium">
            <button className="text-ink-muted" onClick={() => toggle(r._party!.partyId)}>{expanded.has(r._party.partyId) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
            {String(r.label)}
          </span>
        ) : (
          <span className="pl-6 text-xs text-ink-muted">{String(r.label).trim()}</span>
        ),
    },
    ...BUCKETS.map((b) => ({ key: b, header: BUCKET_LABEL[b], type: 'money' as const, blankZero: true, width: 100 })),
    { key: 'outstanding', header: 'Outstanding', type: 'money', width: 110 },
    { key: 'unappliedCredit', header: 'Unapplied Credit', type: 'money', blankZero: true, width: 110 },
    { key: 'unappliedNotes', header: 'Unapplied Notes', type: 'money', blankZero: true, width: 110 },
    { key: 'total', header: 'Net Balance', type: 'money', width: 110 },
  ];
  const title = side === 'CUSTOMER' ? 'Accounts Receivable Aging' : 'Accounts Payable Aging';
  const cfg: ExportCfg<AgRow> | null = d ? { title, subtitle: `As of ${fmt.date(a.asOf)} (days past due date)`, columns, rows: allRows, totals: d.totals } : null;
  return (
    <ReportShell
      title={title}
      cfg={cfg}
      running={q.isFetching}
      error={q.error ? apiError(q.error) : undefined}
      onRun={() => f.run(q.refetch)}
      extraActions={d && <button className="text-xs text-brand hover:underline" onClick={() => setExpanded(expanded.size ? new Set() : new Set(d.rows.map((r) => r.partyId)))}>{expanded.size ? 'Collapse all' : 'Expand all'}</button>}
      filters={
        <>
          <FilterDate label="As of" value={f.draft.asOf} onChange={(x) => f.set('asOf', x)} />
          <FilterField label={side === 'CUSTOMER' ? 'Customer' : 'Supplier'} width={260}>
            <Combo allowClear options={(parties.data ?? []).map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` }))} value={f.draft.partyId} onChange={(x) => f.set('partyId', x === null ? null : Number(x))} placeholder="All" />
          </FilterField>
        </>
      }
      footer={d && <span>{d.rows.length} parties - total outstanding <Money v={d.totals.outstanding} bold /> - unapplied credit <Money v={d.totals.unappliedCredit} /> - double-click a party for its statement</span>}
    >
      {d && <ReportGrid columns={columns} rows={rows} totals={d.totals} onRowClick={drill} rowClass={(r) => (r._party ? 'bg-surface-2' : undefined)} />}
    </ReportShell>
  );
}

/* ============================================================== OUTSTANDING / OVERDUE LISTS */
interface DocRow {
  id: number;
  docNo: string;
  docDate: string;
  dueDate: string | null;
  partyId: number;
  party: { id: number; code: string; name: string } | null;
  baseTotal: number;
  settled: number;
  outstanding: number;
  daysPastDue: number;
  status: string;
  currencyCode: string;
}
type LMode = 'outstanding' | 'overdue' | 'due-today';

function OpenDocsScreen({ side, initial }: { side: Side; initial: LMode }) {
  const open = useOpenScreen();
  const [mode, setMode] = useState<LMode>(initial);
  const [total, setTotal] = useState<number | undefined>();
  const isC = side === 'CUSTOMER';
  const columns: Column<DocRow>[] = [
    { key: 'docNo', header: isC ? 'Invoice No' : 'Bill No', width: 130, filter: 'text' },
    { key: 'party.name', header: isC ? 'Customer' : 'Supplier', cell: (r) => r.party?.name ?? '' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'dueDate', header: 'Due Date', type: 'date', width: 100 },
    { key: 'baseTotal', header: 'Amount', type: 'money', width: 105, total: 'sum' },
    { key: 'settled', header: isC ? 'Received' : 'Paid', type: 'money', width: 105, total: 'sum' },
    { key: 'outstanding', header: 'Outstanding', type: 'money', width: 110, total: 'sum' },
    { key: 'daysPastDue', header: 'Days Overdue', type: 'number', width: 90, cell: (r) => (r.daysPastDue > 0 ? <span className="font-medium text-danger">{r.daysPastDue}</span> : <span className="text-ink-faint">{r.daysPastDue === 0 ? 'today' : 'not due'}</span>), exportValue: (r) => r.daysPastDue },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
  ];
  const openInvoice = (r: DocRow) => open(isC ? 'sales-invoice-form' : 'purchase-invoice-form', { id: r.id }, r.docNo);
  const title = isC ? (mode === 'outstanding' ? 'Outstanding Invoices' : mode === 'overdue' ? 'Overdue Invoices' : 'Invoices Due Today') : mode === 'outstanding' ? 'Outstanding Bills' : mode === 'overdue' ? 'Overdue Bills' : 'Bills Due Today';
  return (
    <DataTable<DocRow>
      key={mode}
      tableKey={`${isC ? 'ar' : 'ap'}-${mode}`}
      queryKey={`${isC ? 'ar' : 'ap'}-${mode}`}
      fetcher={async (p) => {
        const r = (await api.get<{ rows: DocRow[]; total: number; page: number; pageSize: number; totalOutstanding: number }>(`${base(side)}/${mode}`, { params: p })).data;
        setTotal(r.totalOutstanding);
        return r;
      }}
      columns={columns}
      exportName={title}
      getRowId={(r) => r.id}
      onRowDoubleClick={openInvoice}
      totals={total !== undefined ? { outstanding: <b>{fmt.money(total)} (all pages)</b> } : undefined}
      rowActions={[
        { label: isC ? 'Open invoice' : 'Open bill', icon: ExternalLink, onClick: openInvoice },
        { label: 'Statement', icon: FileSearch, onClick: (r) => open(isC ? 'customer-statement' : 'supplier-statement', { partyId: r.partyId }, `${r.party?.name ?? ''} Statement`) },
        isC
          ? { label: 'Receive payment', icon: HandCoins, onClick: (r) => open('bank-receipt-form', { partyId: r.partyId, partyType: 'CUSTOMER' }, 'New Bank Receipt') }
          : { label: 'Make payment', icon: Wallet, onClick: (r) => open('bank-payment-form', { partyId: r.partyId, partyType: 'SUPPLIER' }, 'New Bank Payment') },
      ]}
      toolbarExtras={
        <Select className="!w-40" value={mode} onChange={(e) => setMode(e.target.value as LMode)} options={[{ value: 'outstanding', label: 'All outstanding' }, { value: 'overdue', label: 'Overdue' }, { value: 'due-today', label: 'Due today' }]} />
      }
    />
  );
}


export default [
  { id: 'customer-statement', title: 'Customer Statement', icon: Users, component: (p: ScreenProps) => <StatementScreen side="CUSTOMER" params={p.params} />, permission: 'ledger' },
  { id: 'supplier-statement', title: 'Supplier Statement', icon: UserCheck, component: (p: ScreenProps) => <StatementScreen side="SUPPLIER" params={p.params} />, permission: 'ledger' },
  { id: 'ar-aging', title: 'AR Aging', icon: Clock, component: () => <AgingScreen side="CUSTOMER" />, permission: 'ledger' },
  { id: 'ap-aging', title: 'AP Aging', icon: Hourglass, component: () => <AgingScreen side="SUPPLIER" />, permission: 'ledger' },
  { id: 'outstanding-invoices', title: 'Outstanding Invoices', icon: Receipt, component: () => <OpenDocsScreen side="CUSTOMER" initial="outstanding" />, permission: 'ledger' },
  { id: 'overdue-invoices', title: 'Due / Overdue Invoices', icon: AlarmClock, component: () => <OpenDocsScreen side="CUSTOMER" initial="overdue" />, permission: 'ledger' },
  { id: 'outstanding-bills', title: 'Outstanding Bills', icon: FileText, component: () => <OpenDocsScreen side="SUPPLIER" initial="outstanding" />, permission: 'ledger' },
] satisfies ScreenDef[];
