import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookText, Calendar, Library, Notebook } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Button, Select } from '@/components/ui';
import {
  Combo, ExportCfg, FilterDate, FilterField, Money, RCol, ReportGrid, ReportShell, accLabel, n0, sourceTarget, useAccounts, useApplied, useParties, yearStart,
} from '@/components/finance/common';
import { useOpenScreen } from '@/store/workspace';
import { api, apiError, Paged } from '@/lib/api';
import { fmt, today } from '@/lib/format';
import { cn } from '@/lib/cn';

/* ============================================================== GENERAL LEDGER */
interface GLEntry {
  id: number;
  date: string;
  entryNo: string;
  journalId: number;
  entryType: string;
  sourceType?: string | null;
  sourceId?: number | null;
  sourceNo?: string | null;
  narration?: string | null;
  status: string;
  debit: number;
  credit: number;
  partner?: { name: string } | null;
  balance: number;
  account: { id: number; code: string; name: string };
}
interface GLResult {
  account: { id: number; code: string; name: string; type: string };
  includesChildren: boolean;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  balanceBasis: 'DEBIT' | 'CREDIT';
  entries: GLEntry[];
}
type GLRow = Partial<GLEntry> & { _kind?: 'opening' | 'entry'; label?: string };

function GeneralLedgerScreen({ params }: ScreenProps) {
  const open = useOpenScreen();
  const accounts = useAccounts();
  const f = useApplied({
    accountId: params.accountId ? Number(params.accountId) : (null as number | null),
    from: (params.from as string) || yearStart(),
    to: (params.to as string) || today(),
    partyType: '' as '' | 'CUSTOMER' | 'SUPPLIER',
    partyId: null as number | null,
  });
  const parties = useParties(f.draft.partyType || undefined);
  const a = f.applied;
  const q = useQuery({
    queryKey: ['fin-gl', a],
    enabled: !!a.accountId,
    queryFn: async () =>
      (await api.get<GLResult>('/ledger/general', { params: { accountId: a.accountId, from: a.from || undefined, to: a.to || undefined, partyType: a.partyType && a.partyId ? a.partyType : undefined, partyId: a.partyId || undefined } })).data,
  });
  const d = q.data;
  const rows: GLRow[] = useMemo(() => (d ? [{ _kind: 'opening', label: 'Opening Balance', balance: d.openingBalance }, ...d.entries.map((e) => ({ ...e, _kind: 'entry' as const }))] : []), [d]);
  const drill = (r: GLRow) => {
    if (r._kind !== 'entry') return;
    const t = sourceTarget(r as GLEntry);
    if (t) open(t.screen, { id: t.id }, t.title);
  };
  const columns: RCol<GLRow>[] = [
    { key: 'date', header: 'Date', type: 'date', width: 95, value: (r) => (r._kind === 'opening' ? '' : r.date) },
    { key: 'entryNo', header: 'Journal No', width: 120, render: (r) => (r._kind === 'opening' ? <b>Opening Balance</b> : <button className="text-brand hover:underline" onClick={() => drill(r)}>{r.entryNo}</button>), value: (r) => (r._kind === 'opening' ? 'Opening Balance' : r.entryNo) },
    ...(d?.includesChildren ? [{ key: 'acc', header: 'Account', value: (r: GLRow) => (r.account ? accLabel(r.account) : '') } as RCol<GLRow>] : []),
    { key: 'entryType', header: 'Type', width: 90, value: (r) => (r.entryType ? fmt.status(r.entryType) : '') },
    { key: 'sourceNo', header: 'Source', width: 120 },
    { key: 'partner', header: 'Party', value: (r) => r.partner?.name ?? '' },
    { key: 'narration', header: 'Narration' },
    { key: 'debit', header: 'Debit', type: 'money', blankZero: true, width: 110 },
    { key: 'credit', header: 'Credit', type: 'money', blankZero: true, width: 110 },
    { key: 'balance', header: `Balance (${d?.balanceBasis === 'CREDIT' ? 'Cr' : 'Dr'})`, type: 'money', width: 120 },
  ];
  const cfg: ExportCfg<GLRow> | null = d
    ? { title: `General Ledger - ${accLabel(d.account)}`, subtitle: `${a.from ? fmt.date(a.from) : 'Beginning'} to ${a.to ? fmt.date(a.to) : 'date'}`, columns, rows, totals: { debit: d.totalDebit, credit: d.totalCredit, balance: d.closingBalance } }
    : null;
  return (
    <ReportShell
      title={d ? `General Ledger - ${accLabel(d.account)}` : 'General Ledger'}
      running={q.isFetching && !!a.accountId}
      error={q.error ? apiError(q.error) : undefined}
      onRun={() => (f.draft.accountId ? f.run(q.refetch) : undefined)}
      cfg={cfg}
      filters={
        <>
          <FilterField label="Account" width={300}>
            <Combo options={(accounts.data ?? []).map((x) => ({ value: x.id, label: accLabel(x) + (x.isGroup ? ' (group)' : '') }))} value={f.draft.accountId} onChange={(x) => f.set('accountId', Number(x))} placeholder="Select account" />
          </FilterField>
          <FilterDate label="From" value={f.draft.from} onChange={(x) => f.set('from', x)} />
          <FilterDate label="To" value={f.draft.to} onChange={(x) => f.set('to', x)} />
          <FilterField label="Party Type" width={100}>
            <Select value={f.draft.partyType} onChange={(e) => { f.set('partyType', e.target.value as '' | 'CUSTOMER' | 'SUPPLIER'); f.set('partyId', null); }} options={[{ value: '', label: 'All' }, { value: 'CUSTOMER', label: 'Customer' }, { value: 'SUPPLIER', label: 'Supplier' }]} />
          </FilterField>
          {f.draft.partyType && (
            <FilterField label="Party" width={220}>
              <Combo allowClear options={(parties.data ?? []).map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` }))} value={f.draft.partyId} onChange={(x) => f.set('partyId', x === null ? null : Number(x))} placeholder="All" />
            </FilterField>
          )}
        </>
      }
      footer={d && <span>Closing balance: <Money v={d.closingBalance} bold /> ({d.balanceBasis === 'CREDIT' ? 'credit' : 'debit'} basis){d.includesChildren && ' - includes child accounts'} - double-click a row to open the source document</span>}
    >
      {!a.accountId ? (
        <div className="p-8 text-center text-[12px] text-slate-400">Select an account and press Run</div>
      ) : (
        <ReportGrid columns={columns} rows={rows} totals={d ? { debit: d.totalDebit, credit: d.totalCredit, balance: d.closingBalance } : undefined} onRowClick={drill} rowClass={(r) => (r._kind === 'opening' ? 'bg-app-head font-medium' : undefined)} />
      )}
    </ReportShell>
  );
}

/* ============================================================== REGISTERS */
type Kind = 'cash-book' | 'bank-book' | 'journal' | 'sales' | 'purchase' | 'receipts' | 'payments';
interface BookEntry {
  date: string;
  entryNo: string;
  entryType: string;
  sourceNo?: string | null;
  account: { id: number; code: string; name: string };
  particulars: string;
  partner?: { name: string } | null;
  narration?: string | null;
  receipt: number;
  payment: number;
  balance: number;
}
interface BookResult {
  accounts: { id: number; code: string; name: string }[];
  openingBalance: number;
  totalReceipts: number;
  totalPayments: number;
  closingBalance: number;
  entries: BookEntry[];
}
type Loose = Record<string, unknown>;
const PAGE = 200;

async function openJournalByNo(open: ReturnType<typeof useOpenScreen>, entryNo: string) {
  try {
    const r = (await api.get<Paged<{ id: number; entryNo: string }>>('/journals', { params: { search: entryNo, pageSize: 5 } })).data.rows.find((x) => x.entryNo === entryNo);
    if (r) open('journal-voucher-form', { id: r.id }, entryNo);
  } catch {
    /* ignore */
  }
}

function RegisterScreen({ kind: initial }: { kind: 'cash-book' | 'bank-book' | 'day-book' }) {
  const open = useOpenScreen();
  const accounts = useAccounts();
  const isBook = initial !== 'day-book';
  const f = useApplied({ kind: (initial === 'day-book' ? 'journal' : initial) as Kind, accountId: null as number | null, from: yearStart(), to: today(), page: 1 });
  const a = f.applied;
  const q = useQuery({
    queryKey: ['fin-register', a],
    queryFn: async () => (await api.get<Loose & BookResult>(`/registers/${a.kind}`, { params: { from: a.from || undefined, to: a.to || undefined, accountId: a.accountId || undefined, page: a.page, pageSize: PAGE, lines: a.kind === 'journal' ? 1 : undefined } })).data,
  });
  const d = q.data;
  const bookAccs = (accounts.data ?? []).filter((x) => !x.isGroup && (initial === 'bank-book' ? x.isBank : x.systemKey === 'CASH' || x.isBank));
  const title = initial === 'day-book' ? `Day Book - ${fmt.status(a.kind)}` : initial === 'bank-book' ? 'Bank Book' : 'Cash Book';
  const sub = `${a.from ? fmt.date(a.from) : 'Beginning'} to ${a.to ? fmt.date(a.to) : 'date'}`;

  let columns: RCol<Loose>[] = [];
  let rows: Loose[] = [];
  let totals: Record<string, unknown> | undefined;
  let footer: React.ReactNode = null;
  let onRow: ((r: Loose) => void) | undefined;
  let rowClass: ((r: Loose) => string | undefined) | undefined;

  if (d && (a.kind === 'cash-book' || a.kind === 'bank-book')) {
    columns = [
      { key: 'date', header: 'Date', type: 'date', width: 95 },
      { key: 'entryNo', header: 'Journal No', width: 120, render: (r) => (r.entryNo === 'Opening Balance' ? <b>Opening Balance</b> : <button className="text-brand hover:underline" onClick={() => openJournalByNo(open, String(r.entryNo))}>{String(r.entryNo)}</button>) },
      ...(d.accounts.length > 1 ? [{ key: 'acc', header: 'Account', value: (r: Loose) => (r.account ? accLabel(r.account as { code: string; name: string }) : '') } as RCol<Loose>] : []),
      { key: 'sourceNo', header: 'Source', width: 120 },
      { key: 'partner', header: 'Party', value: (r) => (r.partner as { name: string } | null)?.name ?? '' },
      { key: 'particulars', header: 'Particulars' },
      { key: 'narration', header: 'Narration' },
      { key: 'receipt', header: 'Receipts (Dr)', type: 'money', blankZero: true, width: 115 },
      { key: 'payment', header: 'Payments (Cr)', type: 'money', blankZero: true, width: 115 },
      { key: 'balance', header: 'Balance', type: 'money', width: 120 },
    ];
    rows = [{ entryNo: 'Opening Balance', balance: d.openingBalance }, ...(d.entries as unknown as Loose[])];
    totals = { receipt: d.totalReceipts, payment: d.totalPayments, balance: d.closingBalance };
    onRow = (r) => r.entryNo !== 'Opening Balance' && void openJournalByNo(open, String(r.entryNo));
    rowClass = (r) => (r.entryNo === 'Opening Balance' ? 'bg-app-head font-medium' : undefined);
    footer = <span>Accounts: {d.accounts.map((x) => x.name).join(', ')} - closing balance <Money v={d.closingBalance} bold /></span>;
  } else if (d && a.kind === 'journal') {
    type J = { id: number; entryNo: string; entryDate: string; entryType: string; sourceNo?: string; narration?: string; totalDebit: number; lines?: { account: { code: string; name: string }; debit: number; credit: number; description?: string }[] };
    columns = [
      { key: 'date', header: 'Date', type: 'date', width: 95 },
      { key: 'no', header: 'Journal No', width: 120, render: (r) => (r._line ? '' : <button className="text-brand hover:underline" onClick={() => open('journal-voucher-form', { id: r._id as number }, String(r.no))}>{String(r.no)}</button>) },
      { key: 'type', header: 'Type', width: 100 },
      { key: 'sourceNo', header: 'Source', width: 120 },
      { key: 'text', header: 'Narration / Account', render: (r) => <span className={cn(r._line ? 'pl-5 text-slate-700' : 'font-medium')}>{String(r.text ?? '')}</span> },
      { key: 'debit', header: 'Debit', type: 'money', blankZero: true, width: 115 },
      { key: 'credit', header: 'Credit', type: 'money', blankZero: true, width: 115 },
    ];
    for (const j of (d.rows as unknown as J[]) ?? []) {
      rows.push({ _id: j.id, date: j.entryDate, no: j.entryNo, type: fmt.status(j.entryType), sourceNo: j.sourceNo, text: j.narration });
      for (const l of j.lines ?? []) rows.push({ _line: true, text: `${accLabel(l.account)}${l.description ? ' - ' + l.description : ''}`, debit: n0(l.debit), credit: n0(l.credit) });
    }
    totals = { debit: (d.totals as { amount: number }).amount, credit: (d.totals as { amount: number }).amount };
    onRow = (r) => !r._line && open('journal-voucher-form', { id: r._id as number }, String(r.no));
    rowClass = (r) => (r._line ? undefined : 'bg-slate-50');
  } else if (d && (a.kind === 'sales' || a.kind === 'purchase')) {
    const sales = a.kind === 'sales';
    columns = [
      { key: 'docNo', header: 'Invoice No', width: 130 },
      { key: 'docDate', header: 'Date', type: 'date', width: 95 },
      { key: 'party', header: sales ? 'Customer' : 'Supplier', value: (r) => (r.party as { name: string } | null)?.name ?? '' },
      { key: 'subtotal', header: 'Subtotal', type: 'money', width: 105 },
      { key: 'discount', header: 'Discount', type: 'money', width: 95 },
      { key: 'vatAmount', header: 'VAT', type: 'money', width: 95 },
      { key: 'total', header: 'Total', type: 'money', width: 110 },
      { key: sales ? 'received' : 'paid', header: sales ? 'Received' : 'Paid', type: 'money', width: 105, value: (r) => r.settled },
      { key: 'outstanding', header: 'Outstanding', type: 'money', width: 110 },
      { key: 'status', header: 'Status', width: 100, value: (r) => fmt.status(String(r.status)) },
    ];
    rows = (d.rows as unknown as Loose[]) ?? [];
    const t = d.totals as Record<string, number>;
    totals = { subtotal: t.subtotal, discount: t.discount, vatAmount: t.vatAmount, total: t.total, [sales ? 'received' : 'paid']: t.settled, outstanding: t.outstanding };
    onRow = (r) => open(sales ? 'sales-invoice-form' : 'purchase-invoice-form', { id: r.id as number }, String(r.docNo));
  } else if (d && (a.kind === 'receipts' || a.kind === 'payments')) {
    const rec = a.kind === 'receipts';
    columns = [
      { key: 'voucherNo', header: 'Voucher No', width: 130 },
      { key: 'voucherDate', header: 'Date', type: 'date', width: 95 },
      { key: 'mode', header: 'Mode', width: 70 },
      { key: 'party', header: rec ? 'Received From' : 'Paid To', value: (r) => (r.party as { name: string } | null)?.name ?? fmt.status(String(r.partyType)) },
      { key: 'account', header: 'Account', value: (r) => accLabel((r.account as { code: string; name: string }) ?? { code: '', name: '' }) },
      { key: 'reference', header: 'Reference' },
      { key: 'narration', header: 'Narration' },
      { key: 'amount', header: 'Amount', type: 'money', width: 115 },
    ];
    rows = (d.rows as unknown as Loose[]) ?? [];
    const t = d.totals as Record<string, number>;
    totals = { amount: t.amount };
    footer = <span>Cash {fmt.money(t.cash)} - Bank {fmt.money(t.bank)}</span>;
    onRow = (r) => open(rec ? 'receipt-voucher-form' : 'payment-voucher-form', { id: r.id as number }, String(r.voucherNo));
  }
  const totalRows = (d as unknown as { total?: number } | undefined)?.total ?? 0;
  const pages = Math.max(1, Math.ceil(totalRows / PAGE));
  const paged = !isBook && !!d;
  const cfg: ExportCfg<Loose> | null = d ? { title, subtitle: sub, columns, rows, totals } : null;

  return (
    <ReportShell
      title={title}
      cfg={cfg}
      running={q.isFetching}
      error={q.error ? apiError(q.error) : undefined}
      onRun={() => { if (f.draft.page !== 1) f.setDraft((x) => ({ ...x, page: 1 })); f.run(q.refetch); }}
      filters={
        <>
          {initial === 'day-book' && (
            <FilterField label="Register" width={140}>
              <Select value={f.draft.kind} onChange={(e) => f.set('kind', e.target.value as Kind)} options={[{ value: 'journal', label: 'Day Book (journals)' }, { value: 'sales', label: 'Sales Register' }, { value: 'purchase', label: 'Purchase Register' }, { value: 'receipts', label: 'Receipts Register' }, { value: 'payments', label: 'Payments Register' }]} />
            </FilterField>
          )}
          {isBook && (
            <FilterField label="Account" width={260}>
              <Combo allowClear options={bookAccs.map((x) => ({ value: x.id, label: accLabel(x) }))} value={f.draft.accountId} onChange={(x) => f.set('accountId', x === null ? null : Number(x))} placeholder={initial === 'bank-book' ? 'All bank accounts' : 'Cash account'} />
            </FilterField>
          )}
          <FilterDate label="From" value={f.draft.from} onChange={(x) => f.set('from', x)} />
          <FilterDate label="To" value={f.draft.to} onChange={(x) => f.set('to', x)} />
        </>
      }
      footer={
        <div className="flex items-center gap-3">
          {footer}
          {paged && (
            <span className="ml-auto flex items-center gap-2">
              {totalRows} records - page {a.page} of {pages}
              <Button size="sm" disabled={a.page <= 1} onClick={() => { f.setDraft((x) => ({ ...x, page: a.page - 1 })); f.setApplied((x) => ({ ...x, page: a.page - 1 })); }}>Prev</Button>
              <Button size="sm" disabled={a.page >= pages} onClick={() => { f.setDraft((x) => ({ ...x, page: a.page + 1 })); f.setApplied((x) => ({ ...x, page: a.page + 1 })); }}>Next</Button>
            </span>
          )}
        </div>
      }
    >
      {d ? <ReportGrid columns={columns} rows={rows} totals={totals} onRowClick={onRow} rowClass={rowClass} /> : null}
    </ReportShell>
  );
}

export default [
  { id: 'general-ledger', title: 'General Ledger', icon: Library, component: GeneralLedgerScreen, permission: 'ledger' },
  { id: 'bank-book', title: 'Bank Book', icon: BookText, component: () => <RegisterScreen kind="bank-book" />, permission: 'ledger' },
  { id: 'cash-book', title: 'Cash Book', icon: Notebook, component: () => <RegisterScreen kind="cash-book" />, permission: 'ledger' },
  { id: 'day-book', title: 'Day Book', icon: Calendar, component: () => <RegisterScreen kind="day-book" />, permission: 'ledger' },
] satisfies ScreenDef[];
