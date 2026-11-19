import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, BarChart3, Percent, Scale, TrendingUp, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ScreenDef } from '@/screens/types';
import { Button, Checkbox, Select } from '@/components/ui';
import { ExportCfg, FilterDate, FilterField, Money, RCol, ReportGrid, ReportShell, useApplied, yearStart } from '@/components/finance/common';
import { useOpenScreen } from '@/store/workspace';
import { formScreenOf } from '@/lib/docRoutes';
import { api, apiError } from '@/lib/api';
import { fmt, r2, today } from '@/lib/format';
import { cn } from '@/lib/cn';

const Balanced = ({ ok, text }: { ok: boolean; text?: string }) => (
  <span className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium', ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
    {ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {text ?? (ok ? 'Balanced' : 'Out of balance')}
  </span>
);
const period = (from?: string, to?: string) => `${from ? fmt.date(from) : 'Beginning'} to ${to ? fmt.date(to) : 'date'}`;

/* ============================================================== TRIAL BALANCE */
interface TBRow {
  id: number;
  code: string;
  name: string;
  type: string;
  isGroup: boolean;
  level: number;
  openingDebit: number;
  openingCredit: number;
  debit: number;
  credit: number;
  closingDebit: number;
  closingCredit: number;
}
function TrialBalanceScreen() {
  const open = useOpenScreen();
  const f = useApplied({ asOf: today(), from: '', includeZero: false, level: '0' });
  const a = f.applied;
  const q = useQuery({
    queryKey: ['fin-tb', a.asOf, a.from, a.includeZero],
    queryFn: async () => (await api.get<{ rows: TBRow[]; totals: Record<string, number>; balanced: boolean }>('/ledger/trial-balance', { params: { asOf: a.asOf, from: a.from || undefined, includeZero: a.includeZero ? 1 : undefined } })).data,
  });
  const d = q.data;
  const rows = useMemo(() => (d?.rows ?? []).filter((r) => a.level === '0' || r.level < Number(a.level)), [d, a.level]);
  const hasOpening = !!a.from;
  const columns: RCol<TBRow>[] = [
    { key: 'code', header: 'Code', width: 150, value: (r) => `${'  '.repeat(r.level)}${r.code}`, render: (r) => <span style={{ paddingLeft: r.level * 14 }} className={cn(r.isGroup && 'font-semibold')}>{r.code}</span> },
    { key: 'name', header: 'Account', render: (r) => <span className={cn(r.isGroup && 'font-semibold')}>{r.name}</span> },
    ...(hasOpening ? [
      { key: 'openingDebit', header: 'Opening Dr', type: 'money', blankZero: true, width: 105 } as RCol<TBRow>,
      { key: 'openingCredit', header: 'Opening Cr', type: 'money', blankZero: true, width: 105 } as RCol<TBRow>,
    ] : []),
    { key: 'debit', header: hasOpening ? 'Period Dr' : 'Debit', type: 'money', blankZero: true, width: 110 },
    { key: 'credit', header: hasOpening ? 'Period Cr' : 'Credit', type: 'money', blankZero: true, width: 110 },
    { key: 'closingDebit', header: 'Closing Dr', type: 'money', blankZero: true, width: 110 },
    { key: 'closingCredit', header: 'Closing Cr', type: 'money', blankZero: true, width: 110 },
  ];
  const totals = d ? { debit: d.totals.debit, credit: d.totals.credit, closingDebit: d.totals.closingDebit, closingCredit: d.totals.closingCredit } : undefined;
  const cfg: ExportCfg<TBRow> | null = d ? { title: 'Trial Balance', subtitle: `As of ${fmt.date(a.asOf)}${a.from ? ` (period from ${fmt.date(a.from)})` : ''}`, columns, rows, totals } : null;
  return (
    <ReportShell
      title="Trial Balance"
      cfg={cfg}
      running={q.isFetching}
      error={q.error ? apiError(q.error) : undefined}
      onRun={() => f.run(q.refetch)}
      filters={
        <>
          <FilterDate label="As of" value={f.draft.asOf} onChange={(x) => f.set('asOf', x)} />
          <FilterDate label="Period from (optional)" value={f.draft.from} onChange={(x) => f.set('from', x)} />
          <FilterField label="Level" width={110}>
            <Select value={f.draft.level} onChange={(e) => f.set('level', e.target.value)} options={[{ value: '0', label: 'All levels' }, { value: '1', label: 'Level 1' }, { value: '2', label: 'Up to level 2' }, { value: '3', label: 'Up to level 3' }]} />
          </FilterField>
          <Checkbox className="mb-1" label="Include zero" checked={f.draft.includeZero} onChange={(e) => f.set('includeZero', e.target.checked)} />
        </>
      }
      footer={d && <div className="flex items-center gap-3"><Balanced ok={d.balanced} text={d.balanced ? 'Trial balance is balanced' : 'Trial balance is OUT of balance'} /><span>Debit <Money v={d.totals.debit} /> / Credit <Money v={d.totals.credit} /> - double-click a posting account for its ledger</span></div>}
    >
      {d && <ReportGrid columns={columns} rows={rows} totals={totals} onRowClick={(r) => !r.isGroup && open('general-ledger', { accountId: r.id, to: a.asOf, from: a.from || undefined }, `GL ${r.code}`)} rowClass={(r) => (r.isGroup ? 'bg-surface-2' : undefined)} />}
    </ReportShell>
  );
}

/* ============================================================== P&L and BALANCE SHEET */
interface SLine { id: number; code: string; name: string; isGroup: boolean; level: number; amount: number }
interface SRow {
  kind: 'head' | 'line' | 'total' | 'grand' | 'info';
  id?: number;
  isGroup?: boolean;
  code?: string;
  label: string;
  amount?: number | null;
  level?: number;
}
const stRows = (s: SRow[], title: string, lines: SLine[], total: number, totalLabel: string) => {
  s.push({ kind: 'head', label: title });
  for (const l of lines) s.push({ kind: 'line', id: l.id, isGroup: l.isGroup, code: l.code, label: l.name, amount: l.amount, level: l.level });
  s.push({ kind: 'total', label: totalLabel, amount: total });
};
const stCols = (onGl?: (r: SRow) => void): RCol<SRow>[] => [
  { key: 'code', header: 'Code', width: 100, render: (r) => (r.kind === 'line' ? <span style={{ paddingLeft: (r.level ?? 0) * 12 }}>{r.code}</span> : null), value: (r) => r.code ?? '' },
  { key: 'label', header: 'Particulars', render: (r) => (r.kind === 'head' ? <b className="uppercase text-brand">{r.label}</b> : r.kind === 'line' ? <span style={{ paddingLeft: (r.level ?? 0) * 12 }} className={cn(r.isGroup && 'font-semibold')}>{r.label}</span> : <b>{r.label}</b>) },
  { key: 'amount', header: 'Amount', type: 'money', width: 140, render: (r) => (r.amount === null || r.amount === undefined ? null : <Money v={r.amount} bold={r.kind !== 'line' || r.isGroup} />) },
];
const stRowClass = (r: SRow) => (r.kind === 'head' ? 'bg-brand-soft' : r.kind === 'total' ? 'bg-surface-2' : r.kind === 'grand' ? 'bg-brand-soft text-[13px]' : undefined);

function ProfitLossScreen() {
  const open = useOpenScreen();
  const f = useApplied({ from: yearStart(), to: today(), includeZero: false });
  const a = f.applied;
  const q = useQuery({
    queryKey: ['fin-pl', a],
    queryFn: async () =>
      (await api.get<{ revenue: { total: number; lines: SLine[] }; cogs: { total: number; lines: SLine[] }; grossProfit: number; grossMarginPct: number; expenses: { total: number; lines: SLine[] }; netProfit: number }>('/ledger/profit-loss', { params: { from: a.from || undefined, to: a.to || undefined, includeZero: a.includeZero ? 1 : undefined } })).data,
  });
  const d = q.data;
  const rows = useMemo(() => {
    if (!d) return [];
    const s: SRow[] = [];
    stRows(s, 'Revenue', d.revenue.lines, d.revenue.total, 'Total Revenue');
    stRows(s, 'Cost of Goods Sold', d.cogs.lines, d.cogs.total, 'Total Cost of Goods Sold');
    s.push({ kind: 'grand', label: `Gross Profit (${fmt.num(d.grossMarginPct, 1)}% margin)`, amount: d.grossProfit });
    stRows(s, 'Operating Expenses', d.expenses.lines, d.expenses.total, 'Total Expenses');
    s.push({ kind: 'grand', label: d.netProfit >= 0 ? 'Net Profit' : 'Net Loss', amount: d.netProfit });
    return s;
  }, [d]);
  const cols = stCols();
  const cfg: ExportCfg<SRow> | null = d ? { title: 'Profit & Loss', subtitle: period(a.from, a.to), columns: cols, rows } : null;
  return (
    <ReportShell
      title="Profit & Loss Statement"
      cfg={cfg}
      running={q.isFetching}
      error={q.error ? apiError(q.error) : undefined}
      onRun={() => f.run(q.refetch)}
      filters={
        <>
          <FilterDate label="From" value={f.draft.from} onChange={(x) => f.set('from', x)} />
          <FilterDate label="To" value={f.draft.to} onChange={(x) => f.set('to', x)} />
          <Checkbox className="mb-1" label="Include zero accounts" checked={f.draft.includeZero} onChange={(e) => f.set('includeZero', e.target.checked)} />
        </>
      }
      footer={d && <span>Revenue <Money v={d.revenue.total} /> - COGS <Money v={d.cogs.total} /> - Gross profit <Money v={d.grossProfit} /> - Expenses <Money v={d.expenses.total} /> - <b>Net {d.netProfit >= 0 ? 'profit' : 'loss'} <Money v={d.netProfit} bold /></b></span>}
    >
      {d && <ReportGrid columns={cols} rows={rows} rowClass={stRowClass} onRowClick={(r) => r.kind === 'line' && !r.isGroup && r.id && open('general-ledger', { accountId: r.id, from: a.from, to: a.to }, `GL ${r.code}`)} />}
    </ReportShell>
  );
}

function BalanceSheetScreen() {
  const open = useOpenScreen();
  const f = useApplied({ asOf: today(), includeZero: false });
  const a = f.applied;
  const q = useQuery({
    queryKey: ['fin-bs', a],
    queryFn: async () =>
      (await api.get<{
        assets: { total: number; lines: SLine[] };
        liabilities: { total: number; lines: SLine[] };
        equity: { accountsTotal: number; currentPeriodEarnings: number; total: number; lines: SLine[] };
        totalLiabilitiesAndEquity: number;
        difference: number;
        balanced: boolean;
      }>('/ledger/balance-sheet', { params: { asOf: a.asOf, includeZero: a.includeZero ? 1 : undefined } })).data,
  });
  const d = q.data;
  const rows = useMemo(() => {
    if (!d) return [];
    const s: SRow[] = [];
    stRows(s, 'Assets', d.assets.lines, d.assets.total, 'Total Assets');
    stRows(s, 'Liabilities', d.liabilities.lines, d.liabilities.total, 'Total Liabilities');
    s.push({ kind: 'head', label: 'Equity' });
    for (const l of d.equity.lines) s.push({ kind: 'line', id: l.id, isGroup: l.isGroup, code: l.code, label: l.name, amount: l.amount, level: l.level });
    s.push({ kind: 'line', label: 'Current period earnings (unclosed P&L)', amount: d.equity.currentPeriodEarnings, level: 0 });
    s.push({ kind: 'total', label: 'Total Equity', amount: d.equity.total });
    s.push({ kind: 'grand', label: 'Total Liabilities & Equity', amount: d.totalLiabilitiesAndEquity });
    return s;
  }, [d]);
  const cols = stCols();
  const cfg: ExportCfg<SRow> | null = d ? { title: 'Balance Sheet', subtitle: `As of ${fmt.date(a.asOf)}`, columns: cols, rows } : null;
  return (
    <ReportShell
      title="Balance Sheet"
      cfg={cfg}
      running={q.isFetching}
      error={q.error ? apiError(q.error) : undefined}
      onRun={() => f.run(q.refetch)}
      filters={
        <>
          <FilterDate label="As of" value={f.draft.asOf} onChange={(x) => f.set('asOf', x)} />
          <Checkbox className="mb-1" label="Include zero accounts" checked={f.draft.includeZero} onChange={(e) => f.set('includeZero', e.target.checked)} />
        </>
      }
      footer={d && <div className="flex items-center gap-3"><Balanced ok={d.balanced} text={d.balanced ? 'Assets = Liabilities + Equity' : `Out of balance by ${fmt.money(d.difference)}`} /><span>Assets <Money v={d.assets.total} /> / Liabilities + Equity <Money v={d.totalLiabilitiesAndEquity} /></span></div>}
    >
      {d && <ReportGrid columns={cols} rows={rows} rowClass={stRowClass} onRowClick={(r) => r.kind === 'line' && !r.isGroup && r.id && open('general-ledger', { accountId: r.id, to: a.asOf }, `GL ${r.code}`)} />}
    </ReportShell>
  );
}

/* ============================================================== CASH FLOW */
interface CFSection { key: string; label: string; group: string; inflow: number; outflow: number; net: number }
interface CFRow { kind: 'head' | 'line' | 'total' | 'grand'; label: string; inflow?: number | null; outflow?: number | null; net?: number | null }
function CashFlowScreen() {
  const f = useApplied({ from: yearStart(), to: today() });
  const a = f.applied;
  const q = useQuery({
    queryKey: ['fin-cf', a],
    queryFn: async () =>
      (await api.get<{ openingBalance: number; sections: CFSection[]; totalInflow: number; totalOutflow: number; netChange: number; closingBalance: number; accounts: { id: number; code: string; name: string; inflow: number; outflow: number }[] }>('/ledger/cash-flow', { params: { from: a.from || undefined, to: a.to || undefined } })).data,
  });
  const d = q.data;
  const rows = useMemo(() => {
    if (!d) return [];
    const s: CFRow[] = [{ kind: 'grand', label: 'Opening cash & bank balance', net: d.openingBalance }];
    const groups: [string, string][] = [['OPERATING_RECEIPTS', 'Operating - Receipts'], ['OPERATING_PAYMENTS', 'Operating - Payments'], ['OTHER', 'Other movements']];
    for (const [g, label] of groups) {
      const secs = d.sections.filter((x) => x.group === g);
      if (!secs.length) continue;
      s.push({ kind: 'head', label });
      for (const x of secs) s.push({ kind: 'line', label: x.label, inflow: x.inflow, outflow: x.outflow, net: x.net });
      s.push({ kind: 'total', label: `Total ${label}`, inflow: r2(secs.reduce((t, x) => t + x.inflow, 0)), outflow: r2(secs.reduce((t, x) => t + x.outflow, 0)), net: r2(secs.reduce((t, x) => t + x.net, 0)) });
    }
    s.push({ kind: 'grand', label: 'Net change in cash', inflow: d.totalInflow, outflow: d.totalOutflow, net: d.netChange });
    s.push({ kind: 'grand', label: 'Closing cash & bank balance', net: d.closingBalance });
    s.push({ kind: 'head', label: 'By cash / bank account' });
    for (const x of d.accounts) s.push({ kind: 'line', label: `${x.code} - ${x.name}`, inflow: x.inflow, outflow: x.outflow, net: r2(x.inflow - x.outflow) });
    return s;
  }, [d]);
  const cols: RCol<CFRow>[] = [
    { key: 'label', header: 'Particulars', render: (r) => (r.kind === 'head' ? <b className="uppercase text-brand">{r.label}</b> : r.kind === 'line' ? <span className="pl-4">{r.label}</span> : <b>{r.label}</b>) },
    { key: 'inflow', header: 'Inflow', type: 'money', width: 130, blankZero: true },
    { key: 'outflow', header: 'Outflow', type: 'money', width: 130, blankZero: true },
    { key: 'net', header: 'Net', type: 'money', width: 130 },
  ];
  const cfg: ExportCfg<CFRow> | null = d ? { title: 'Cash Flow Statement', subtitle: `${period(a.from, a.to)} (direct method)`, columns: cols, rows } : null;
  return (
    <ReportShell
      title="Cash Flow Statement (direct method)"
      cfg={cfg}
      running={q.isFetching}
      error={q.error ? apiError(q.error) : undefined}
      onRun={() => f.run(q.refetch)}
      filters={<><FilterDate label="From" value={f.draft.from} onChange={(x) => f.set('from', x)} /><FilterDate label="To" value={f.draft.to} onChange={(x) => f.set('to', x)} /></>}
      footer={d && <span>Opening <Money v={d.openingBalance} /> + net change <Money v={d.netChange} /> = closing <Money v={d.closingBalance} bold /></span>}
    >
      {d && <ReportGrid columns={cols} rows={rows} rowClass={(r) => (r.kind === 'head' ? 'bg-brand-soft' : r.kind === 'total' ? 'bg-surface-2' : r.kind === 'grand' ? 'bg-brand-soft' : undefined)} />}
    </ReportShell>
  );
}

/* ============================================================== VAT */
interface VatSum { taxable: number; vat: number; count: number }
interface VatCat extends VatSum { category: string }
interface VatSide {
  netTaxable: number;
  netVat: number;
  byCategory: VatCat[];
  byCode: { vatCode: string | null; category: string; rate: number; taxable: number; vat: number }[];
  sales?: VatSum;
  purchases?: VatSum;
  creditNotes: VatSum;
  debitNotes: VatSum;
}
interface VatSummary { output: VatSide; input: VatSide; outputVat: number; inputVat: number; netPayable: number }
interface VatTx {
  type: string;
  docType: string;
  docId: number;
  docNo: string;
  date: string;
  party?: { name: string } | null;
  trn?: string | null;
  vatCode: string | null;
  category: string;
  rate: number;
  taxable: number;
  vatAmount: number;
}
interface VRow { kind: 'head' | 'line' | 'sub' | 'total' | 'grand'; label: string; taxable?: number | null; vat?: number | null; count?: number | null }
const PAGE = 200;

function VatReportScreen() {
  const open = useOpenScreen();
  const f = useApplied({ from: yearStart(), to: today(), view: 'summary', type: '', category: '', page: 1 });
  const a = f.applied;
  const sum = useQuery({
    queryKey: ['fin-vat-sum', a.from, a.to],
    queryFn: async () => (await api.get<VatSummary>('/vat/summary', { params: { from: a.from || undefined, to: a.to || undefined } })).data,
  });
  const tx = useQuery({
    queryKey: ['fin-vat-tx', a],
    enabled: a.view === 'transactions',
    queryFn: async () => (await api.get<{ rows: VatTx[]; total: number; totals: { taxable: number; vatAmount: number } }>('/vat/transactions', { params: { from: a.from || undefined, to: a.to || undefined, type: a.type || undefined, category: a.category || undefined, page: a.page, pageSize: PAGE } })).data,
  });
  const s = sum.data;
  const summaryRows = useMemo(() => {
    if (!s) return [];
    const out: VRow[] = [];
    const line = (label: string, v: VatSum) => out.push({ kind: 'line', label, taxable: v.taxable, vat: v.vat, count: v.count });
    out.push({ kind: 'head', label: 'Output VAT (sales)' });
    line('Sales invoices', s.output.sales!);
    line('Less: credit notes', { ...s.output.creditNotes, taxable: -s.output.creditNotes.taxable, vat: -s.output.creditNotes.vat });
    line('Add: debit notes', s.output.debitNotes);
    out.push({ kind: 'total', label: 'Net output VAT', taxable: s.output.netTaxable, vat: s.output.netVat });
    for (const c of s.output.byCategory.filter((x) => x.taxable || x.vat)) out.push({ kind: 'sub', label: `   ${fmt.status(c.category)}`, taxable: c.taxable, vat: c.vat, count: c.count });
    out.push({ kind: 'head', label: 'Input VAT (purchases)' });
    line('Purchase invoices', s.input.purchases!);
    line('Less: credit notes', { ...s.input.creditNotes, taxable: -s.input.creditNotes.taxable, vat: -s.input.creditNotes.vat });
    line('Add: debit notes', s.input.debitNotes);
    out.push({ kind: 'total', label: 'Net input VAT', taxable: s.input.netTaxable, vat: s.input.netVat });
    for (const c of s.input.byCategory.filter((x) => x.taxable || x.vat)) out.push({ kind: 'sub', label: `   ${fmt.status(c.category)}`, taxable: c.taxable, vat: c.vat, count: c.count });
    out.push({ kind: 'head', label: 'By VAT code' });
    for (const c of s.output.byCode) out.push({ kind: 'sub', label: `   Output - ${c.vatCode ?? '(none)'} @ ${fmt.percent(c.rate)} (${fmt.status(c.category)})`, taxable: c.taxable, vat: c.vat });
    for (const c of s.input.byCode) out.push({ kind: 'sub', label: `   Input - ${c.vatCode ?? '(none)'} @ ${fmt.percent(c.rate)} (${fmt.status(c.category)})`, taxable: c.taxable, vat: c.vat });
    out.push({ kind: 'grand', label: s.netPayable >= 0 ? 'NET VAT PAYABLE to authority' : 'NET VAT REFUNDABLE', taxable: null, vat: s.netPayable });
    return out;
  }, [s]);
  const sCols: RCol<VRow>[] = [
    { key: 'label', header: 'Particulars', render: (r) => (r.kind === 'head' ? <b className="uppercase text-brand">{r.label}</b> : r.kind === 'total' || r.kind === 'grand' ? <b>{r.label}</b> : <span className={cn(r.kind === 'sub' && 'text-xs text-ink-muted')}>{r.label}</span>) },
    { key: 'taxable', header: 'Taxable Amount', type: 'money', width: 140 },
    { key: 'vat', header: 'VAT Amount', type: 'money', width: 140 },
    { key: 'count', header: 'Docs', type: 'number', width: 60, value: (r) => r.count ?? '', render: (r) => (r.count ? String(r.count) : '') },
  ];
  const tCols: RCol<VatTx>[] = [
    { key: 'date', header: 'Date', type: 'date', width: 95 },
    { key: 'type', header: 'Type', width: 140, value: (r) => fmt.status(r.type) },
    { key: 'docNo', header: 'Document', width: 130, render: (r) => <button className="text-brand hover:underline" onClick={() => open(formScreenOf(r.docType), { id: r.docId }, r.docNo)}>{r.docNo}</button> },
    { key: 'party', header: 'Party', value: (r) => r.party?.name ?? '' },
    { key: 'trn', header: 'TRN', width: 120 },
    { key: 'vatCode', header: 'VAT Code', width: 80 },
    { key: 'category', header: 'Category', width: 100, value: (r) => fmt.status(r.category) },
    { key: 'rate', header: 'Rate', type: 'percent', width: 60 },
    { key: 'taxable', header: 'Taxable', type: 'money', width: 115 },
    { key: 'vatAmount', header: 'VAT', type: 'money', width: 105 },
  ];
  const isTx = a.view === 'transactions';
  const t = tx.data;
  const pages = Math.max(1, Math.ceil((t?.total ?? 0) / PAGE));
  const cfg: ExportCfg<VRow> | ExportCfg<VatTx> | null = isTx ? (t ? { title: 'VAT Transactions', subtitle: period(a.from, a.to), columns: tCols, rows: t.rows, totals: { taxable: t.totals.taxable, vatAmount: t.totals.vatAmount } } : null) : s ? { title: 'VAT Report', subtitle: period(a.from, a.to), columns: sCols, rows: summaryRows } : null;
  const goPage = (p: number) => { f.setDraft((x) => ({ ...x, page: p })); f.setApplied((x) => ({ ...x, page: p })); };
  return (
    <ReportShell
      title={isTx ? 'VAT Report - Transaction Detail' : 'VAT Report - Summary (VAT 201 style)'}
      cfg={cfg as ExportCfg<never> | null}
      running={isTx ? tx.isFetching : sum.isFetching}
      error={(isTx ? tx.error : sum.error) ? apiError(isTx ? tx.error : sum.error) : undefined}
      onRun={() => { if (f.draft.page !== 1) f.setDraft((x) => ({ ...x, page: 1 })); f.run(() => { void sum.refetch(); if (isTx) void tx.refetch(); }); }}
      filters={
        <>
          <FilterDate label="From" value={f.draft.from} onChange={(x) => f.set('from', x)} />
          <FilterDate label="To" value={f.draft.to} onChange={(x) => f.set('to', x)} />
          <FilterField label="View" width={130}>
            <Select value={f.draft.view} onChange={(e) => f.set('view', e.target.value)} options={[{ value: 'summary', label: 'Summary' }, { value: 'transactions', label: 'Transaction detail' }]} />
          </FilterField>
          {f.draft.view === 'transactions' && (
            <>
              <FilterField label="Type" width={140}>
                <Select value={f.draft.type} onChange={(e) => f.set('type', e.target.value)} options={[{ value: '', label: 'All' }, { value: 'SALES', label: 'Sales' }, { value: 'PURCHASE', label: 'Purchases' }, { value: 'CREDIT_NOTE', label: 'Credit notes' }, { value: 'DEBIT_NOTE', label: 'Debit notes' }]} />
              </FilterField>
              <FilterField label="Category" width={130}>
                <Select value={f.draft.category} onChange={(e) => f.set('category', e.target.value)} options={[{ value: '', label: 'All' }, { value: 'TAXABLE', label: 'Taxable' }, { value: 'ZERO_RATED', label: 'Zero rated' }, { value: 'EXEMPT', label: 'Exempt' }, { value: 'OUT_OF_SCOPE', label: 'Out of scope' }]} />
              </FilterField>
            </>
          )}
        </>
      }
      footer={
        s && (
          <div className="flex items-center gap-4">
            <span>Output VAT <Money v={s.outputVat} bold /></span>
            <span>Input VAT <Money v={s.inputVat} bold /></span>
            <span className={cn('rounded-lg px-2 py-0.5 font-semibold', s.netPayable >= 0 ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success')}>Net {s.netPayable >= 0 ? 'payable' : 'refundable'}: {fmt.money(Math.abs(s.netPayable))}</span>
            {isTx && t && (
              <span className="ml-auto flex items-center gap-2">
                {t.total} rows - page {a.page}/{pages}
                <Button size="sm" disabled={a.page <= 1} onClick={() => goPage(a.page - 1)}>Prev</Button>
                <Button size="sm" disabled={a.page >= pages} onClick={() => goPage(a.page + 1)}>Next</Button>
              </span>
            )}
          </div>
        )
      }
    >
      {isTx ? (t ? <ReportGrid columns={tCols} rows={t.rows} totals={{ taxable: t.totals.taxable, vatAmount: t.totals.vatAmount }} /> : null) : s ? (
        <ReportGrid columns={sCols} rows={summaryRows} rowClass={(r) => (r.kind === 'head' ? 'bg-brand-soft' : r.kind === 'total' ? 'bg-surface-2' : r.kind === 'grand' ? 'bg-warning-soft text-[13px]' : undefined)} />
      ) : null}
    </ReportShell>
  );
}


export default [
  { id: 'trial-balance', title: 'Trial Balance', icon: Scale, component: TrialBalanceScreen, permission: 'ledger' },
  { id: 'profit-loss', title: 'Profit & Loss', icon: TrendingUp, component: ProfitLossScreen, permission: 'ledger' },
  { id: 'balance-sheet', title: 'Balance Sheet', icon: BarChart3, component: BalanceSheetScreen, permission: 'ledger' },
  { id: 'cash-flow', title: 'Cash Flow', icon: Activity, component: CashFlowScreen, permission: 'ledger' },
  { id: 'vat-report', title: 'VAT Report', icon: Percent, component: VatReportScreen, permission: 'vat' },
] satisfies ScreenDef[];
