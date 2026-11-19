import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, FolderOpen, Plus, Printer, RotateCcw, Save, Trash2, ExternalLink } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { DataTable, Column } from '@/components/DataTable';
import { DocAction, DocActionSep, DocSection, DocumentLayout, HeaderSection } from '@/components/doc';
import { Button, DateInput, Field, IconButton, Input, Modal, NumberInput, Select, Textarea } from '@/components/ui';
import { Combo, esc, n0, printHtml, useAccounts, useParties, accLabel, moneyText } from '@/components/finance/common';
import { useDocument } from '@/hooks/useDocument';
import { useCompany } from '@/hooks/useCompany';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { api, apiError } from '@/lib/api';
import { fmt, r2, today } from '@/lib/format';
import { toast } from '@/store/toast';
import { cn } from '@/lib/cn';

interface JLine {
  id: number;
  accountId: number;
  debit: number;
  credit: number;
  description?: string | null;
  partyType?: string | null;
  partyId?: number | null;
  party?: { code: string; name: string } | null;
  account: { id: number; code: string; name: string; type: string };
}
interface JournalDoc {
  id: number;
  entryNo: string;
  entryDate: string;
  entryType: string;
  status: string;
  sourceType?: string | null;
  sourceId?: number | null;
  sourceNo?: string | null;
  narration?: string | null;
  totalDebit: number;
  lines: JLine[];
  createdByUser?: { username: string } | null;
}
const titleOf = (d: JournalDoc) => d.entryNo;

/* ============================================================== LIST */
function JournalList({ opening }: { opening?: boolean }) {
  const open = useOpenScreen();
  const can = usePermission();
  const [entryType, setEntryType] = useState(opening ? 'OPENING' : 'JOURNAL');
  const formId = opening ? 'opening-balance-form' : 'journal-voucher-form';
  const columns: Column<JournalDoc>[] = [
    { key: 'entryNo', header: 'Journal No', width: 130, filter: 'text' },
    { key: 'entryDate', header: 'Date', type: 'date', width: 100, filter: 'date' },
    { key: 'entryType', header: 'Type', width: 110, cell: (r) => fmt.status(r.entryType) },
    { key: 'narration', header: 'Narration', sortable: false },
    { key: 'sourceNo', header: 'Source', width: 120, sortable: false },
    { key: 'totalDebit', header: 'Amount', type: 'money', total: 'sum', width: 110 },
    { key: 'status', header: 'Status', type: 'status', width: 100 },
  ];
  return (
    <DataTable
      tableKey={opening ? 'opening-balances' : 'journal-vouchers'}
      url="/journals"
      queryKey="journals"
      filters={{ entryType: entryType || undefined }}
      columns={columns}
      exportName={opening ? 'Opening Balances' : 'Journal Vouchers'}
      defaultSort={{ key: 'id', dir: 'desc' }}
      onRowDoubleClick={(r) => open(r.entryType === 'OPENING' ? 'opening-balance-form' : 'journal-voucher-form', { id: r.id }, r.entryNo)}
      rowActions={[{ label: 'Open', icon: ExternalLink, onClick: (r) => open(r.entryType === 'OPENING' ? 'opening-balance-form' : 'journal-voucher-form', { id: r.id }, r.entryNo) }]}
      toolbarExtras={
        <>
          {can('journal', 'create') && <Button variant="primary" icon={Plus} onClick={() => open(formId, {}, opening ? 'New Opening Balance' : 'New Journal')}>{opening ? 'New Opening Balance' : 'New Journal'}</Button>}
          {!opening && (
            <Select className="!w-40" value={entryType} onChange={(e) => setEntryType(e.target.value)} options={[{ value: 'JOURNAL', label: 'Manual journals' }, { value: 'OPENING', label: 'Opening balances' }, { value: '', label: 'All entries' }]} />
          )}
        </>
      }
    />
  );
}

/* ============================================================== VIEW (posted journal) */
function JournalView({ doc, refetch }: { doc: JournalDoc; refetch: () => void }) {
  const open = useOpenScreen();
  const can = usePermission();
  const company = useCompany();
  const qc = useQueryClient();
  const [revOpen, setRevOpen] = useState(false);
  const [revDate, setRevDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const isReversal = (doc.narration ?? '').startsWith('Reversal of ');
  const reversible = doc.status === 'POSTED' && ['JOURNAL', 'OPENING'].includes(doc.entryType) && doc.sourceType !== 'ADVANCE_SETTLEMENT' && !isReversal;
  const dr = r2(doc.lines.reduce((s, l) => s + n0(l.debit), 0));
  const cr = r2(doc.lines.reduce((s, l) => s + n0(l.credit), 0));
  const reverse = async () => {
    setBusy(true);
    try {
      const res = (await api.post<{ reversal: JournalDoc }>(`/journals/${doc.id}/reverse`, { date: revDate })).data;
      toast.success(`Reversed by ${res.reversal.entryNo}`);
      setRevOpen(false);
      qc.invalidateQueries({ queryKey: ['table'] });
      qc.invalidateQueries({ queryKey: ['doc', '/journals'] });
      refetch();
      open('journal-voucher-form', { id: res.reversal.id }, res.reversal.entryNo);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  const print = () =>
    printHtml(
      doc.entryNo,
      `<h1>${esc(company.data?.name ?? '')}</h1><h2>Journal Voucher ${esc(doc.entryNo)}</h2>
       <div>Date: ${fmt.date(doc.entryDate)} &nbsp; Status: ${esc(fmt.status(doc.status))}</div><div>Narration: ${esc(doc.narration)}</div>
       <table style="margin-top:8px"><thead><tr><th>Account</th><th>Party</th><th>Description</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead><tbody>
       ${doc.lines.map((l) => `<tr><td>${esc(accLabel(l.account))}</td><td>${esc(l.party?.name)}</td><td>${esc(l.description)}</td><td class="r">${n0(l.debit) ? fmt.money(l.debit) : ''}</td><td class="r">${n0(l.credit) ? fmt.money(l.credit) : ''}</td></tr>`).join('')}
       <tr><th colspan="3" class="r">Total</th><th class="r">${fmt.money(dr)}</th><th class="r">${fmt.money(cr)}</th></tr></tbody></table>
       <table class="meta" style="margin-top:50px"><tr><td>Prepared by: ____________</td><td>Approved by: ____________</td></tr></table>`,
    );
  return (
    <>
      <DocActionsBar>
        <DocAction icon={RotateCcw} variant="danger" hidden={!reversible || !can('journal', 'cancel')} onClick={() => setRevOpen(true)}>Reverse Journal</DocAction>
        <DocAction icon={Printer} onClick={print}>Print</DocAction>
      </DocActionsBar>
      <HeaderSection title="Journal Information">
        <Field label="Journal No"><Input readOnly value={doc.entryNo} /></Field>
        <Field label="Date"><Input readOnly value={fmt.date(doc.entryDate)} /></Field>
        <Field label="Type"><Input readOnly value={fmt.status(doc.entryType)} /></Field>
        <Field label="Source"><Input readOnly value={[fmt.status(doc.sourceType), doc.sourceNo].filter(Boolean).join(' - ')} /></Field>
        <Field label="Narration"><Input readOnly value={doc.narration ?? ''} /></Field>
        <Field label="Created By"><Input readOnly value={doc.createdByUser?.username ?? ''} /></Field>
      </HeaderSection>
      <DocSection title="Lines" bodyClassName="p-0">
        <table className="w-full border-collapse">
          <thead><tr className="h-6"><th className="grid-th">Account</th><th className="grid-th">Party</th><th className="grid-th">Description</th><th className="grid-th w-32 text-right">Debit</th><th className="grid-th w-32 text-right">Credit</th></tr></thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.id} className="h-6">
                <td className="grid-td"><button className="text-brand hover:underline" onClick={() => open('general-ledger', { accountId: l.accountId }, `GL ${l.account.code}`)}>{accLabel(l.account)}</button></td>
                <td className="grid-td">{l.party?.name ?? ''}</td>
                <td className="grid-td">{l.description}</td>
                <td className="grid-td text-right tabular-nums">{n0(l.debit) ? fmt.money(l.debit) : ''}</td>
                <td className="grid-td text-right tabular-nums">{n0(l.credit) ? fmt.money(l.credit) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="h-6 bg-app-head font-semibold"><td colSpan={3} className="px-2 text-right text-[12px]">Total</td><td className="px-2 text-right text-[12px] tabular-nums">{fmt.money(dr)}</td><td className="px-2 text-right text-[12px] tabular-nums">{fmt.money(cr)}</td></tr></tfoot>
        </table>
      </DocSection>
      <Modal open={revOpen} title={`Reverse ${doc.entryNo}`} onClose={() => setRevOpen(false)} width="sm" footer={<><Button onClick={() => setRevOpen(false)}>Cancel</Button><Button variant="danger" loading={busy} onClick={reverse}>Reverse</Button></>}>
        <Field label="Reversal date"><DateInput value={revDate} onChange={(e) => setRevDate(e.target.value)} /></Field>
        <p className="mt-2 text-[12px] text-slate-600">A new journal with debit/credit swapped is posted and this journal is marked Reversed.</p>
      </Modal>
    </>
  );
}
/** in-body action bar (DocumentLayout `actions` only takes one slot, views render their own) */
function DocActionsBar({ children }: { children: React.ReactNode }) {
  return <div className="no-print flex flex-wrap items-center gap-1.5">{children}</div>;
}

/* ============================================================== JOURNAL FORM */
interface EditLine {
  k: number;
  accountId: number | null;
  partyType: '' | 'CUSTOMER' | 'SUPPLIER';
  partyId: number | null;
  description: string;
  debit: string;
  credit: string;
}
let seq = 1;
const blank = (): EditLine => ({ k: seq++, accountId: null, partyType: '', partyId: null, description: '', debit: '', credit: '' });

function JournalForm({ tabId, params }: ScreenProps) {
  const ws = useWorkspace();
  const can = usePermission();
  const doc = useDocument<JournalDoc>('/journals', params.id, { tabId, titleOf });
  const accounts = useAccounts();
  const customers = useParties('CUSTOMER');
  const suppliers = useParties('SUPPLIER');
  const [date, setDate] = useState(today());
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<EditLine[]>(() => [blank(), blank()]);
  const postable = useMemo(() => (accounts.data ?? []).filter((a) => !a.isGroup && a.isActive), [accounts.data]);
  const accOpts = useMemo(() => postable.map((a) => ({ value: a.id, label: accLabel(a) })), [postable]);
  const byId = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a])), [accounts.data]);

  const dr = r2(lines.reduce((s, l) => s + n0(l.debit), 0));
  const cr = r2(lines.reduce((s, l) => s + n0(l.credit), 0));
  const diff = r2(dr - cr);
  const balanced = Math.abs(diff) < 0.005 && dr > 0;

  useEffect(() => {
    if (doc.isNew) ws.setDirty(tabId, dr > 0 || cr > 0 || !!narration);
  }, [dr, cr, narration]); // eslint-disable-line react-hooks/exhaustive-deps

  const upd = (k: number, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.k === k ? { ...l, ...patch } : l)));
  const setAccount = (k: number, id: number) => {
    const a = byId.get(id);
    const patch: Partial<EditLine> = { accountId: id };
    if (a?.systemKey === 'AR') patch.partyType = 'CUSTOMER';
    else if (a?.systemKey === 'AP') patch.partyType = 'SUPPLIER';
    upd(k, patch);
  };

  const save = async () => {
    const used = lines.filter((l) => l.accountId || n0(l.debit) || n0(l.credit));
    if (used.length < 2) return toast.warning('A journal needs at least two lines');
    for (const l of used) {
      if (!l.accountId) return toast.warning('Every line needs an account');
      if (!n0(l.debit) && !n0(l.credit)) return toast.warning('Every line needs a debit or a credit amount');
      const a = byId.get(l.accountId);
      if (a?.systemKey === 'AR' && (l.partyType !== 'CUSTOMER' || !l.partyId)) return toast.warning('Accounts Receivable lines require a customer');
      if (a?.systemKey === 'AP' && (l.partyType !== 'SUPPLIER' || !l.partyId)) return toast.warning('Accounts Payable lines require a supplier');
    }
    if (!balanced) return toast.warning('Journal is not balanced');
    try {
      await doc.save({
        date,
        narration: narration || null,
        lines: used.map((l) => ({
          accountId: l.accountId,
          debit: n0(l.debit) || undefined,
          credit: n0(l.credit) || undefined,
          partyType: l.partyType && l.partyId ? l.partyType : null,
          partyId: l.partyType && l.partyId ? l.partyId : null,
          description: l.description || null,
        })),
      });
      ws.setDirty(tabId, false);
    } catch {
      /* toast shown */
    }
  };

  if (!doc.isNew) {
    return (
      <DocumentLayout title="Journal Voucher" icon={FileSpreadsheet} docNo={doc.data?.entryNo} status={doc.data?.status} loading={doc.isLoading} error={doc.error}>
        {doc.data && <JournalView doc={doc.data} refetch={doc.refetch} />}
      </DocumentLayout>
    );
  }
  return (
    <DocumentLayout
      title="Journal Voucher"
      icon={FileSpreadsheet}
      actions={
        <>
          <DocAction icon={Save} variant="primary" hidden={!can('journal', 'create')} loading={doc.saving} disabled={!balanced} onClick={save}>Post Journal</DocAction>
          <DocActionSep />
          <DocAction icon={Plus} onClick={() => setLines((l) => [...l, blank()])}>Add Line</DocAction>
        </>
      }
    >
      <HeaderSection title="Journal Information" columns={3}>
        <Field label="Journal No"><Input readOnly value="(auto)" /></Field>
        <Field label="Date" required><DateInput value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Narration"><Input value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
      </HeaderSection>
      <DocSection title="Lines" bodyClassName="p-0">
        <table className="w-full border-collapse">
          <thead>
            <tr className="h-6">
              <th className="grid-th w-8">#</th><th className="grid-th w-[300px]">Account</th><th className="grid-th w-24">Party Type</th><th className="grid-th w-[220px]">Party</th>
              <th className="grid-th">Description</th><th className="grid-th w-32 text-right">Debit</th><th className="grid-th w-32 text-right">Credit</th><th className="grid-th w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.k} className="h-7">
                <td className="grid-td text-center text-slate-400">{i + 1}</td>
                <td className="grid-td p-0.5"><Combo options={accOpts} value={l.accountId} onChange={(x) => setAccount(l.k, Number(x))} placeholder="Account..." /></td>
                <td className="grid-td p-0.5">
                  <Select value={l.partyType} onChange={(e) => upd(l.k, { partyType: e.target.value as EditLine['partyType'], partyId: null })} options={[{ value: '', label: '-' }, { value: 'CUSTOMER', label: 'Customer' }, { value: 'SUPPLIER', label: 'Supplier' }]} />
                </td>
                <td className="grid-td p-0.5">
                  {l.partyType ? (
                    <Combo allowClear options={((l.partyType === 'CUSTOMER' ? customers.data : suppliers.data) ?? []).map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` }))} value={l.partyId} onChange={(x) => upd(l.k, { partyId: x === null ? null : Number(x) })} placeholder="Party..." />
                  ) : null}
                </td>
                <td className="grid-td p-0.5"><Input value={l.description} onChange={(e) => upd(l.k, { description: e.target.value })} /></td>
                <td className="grid-td p-0.5"><NumberInput value={l.debit} onChange={(e) => upd(l.k, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></td>
                <td className="grid-td p-0.5"><NumberInput value={l.credit} onChange={(e) => upd(l.k, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></td>
                <td className="grid-td p-0 text-center"><IconButton icon={Trash2} variant="danger" label="Remove line" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.k !== l.k))} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="h-7 bg-app-head font-semibold">
              <td colSpan={5} className="px-2 text-right text-[12px]">
                <span className={cn('mr-3 rounded px-2 py-0.5', balanced ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                  {balanced ? 'Balanced' : `Difference ${moneyText(diff)}`}
                </span>
                Total
              </td>
              <td className="px-2 text-right text-[12px] tabular-nums">{fmt.money(dr)}</td>
              <td className="px-2 text-right text-[12px] tabular-nums">{fmt.money(cr)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </DocSection>
    </DocumentLayout>
  );
}

/* ============================================================== OPENING BALANCE FORM */
const BLOCKED = new Set(['AR', 'AP', 'INVENTORY', 'OPENING_EQUITY']);
function OpeningBalanceForm({ tabId, params }: ScreenProps) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const can = usePermission();
  const doc = useDocument<JournalDoc>('/journals', params.id, { tabId, titleOf });
  const accounts = useAccounts();
  const [date, setDate] = useState(today());
  const [narration, setNarration] = useState('Opening balances');
  const [lines, setLines] = useState<EditLine[]>(() => [blank(), blank(), blank()]);
  const [saving, setSaving] = useState(false);
  const opts = useMemo(() => (accounts.data ?? []).filter((a) => !a.isGroup && a.isActive && !(a.systemKey && BLOCKED.has(a.systemKey))).map((a) => ({ value: a.id, label: accLabel(a) })), [accounts.data]);
  const dr = r2(lines.reduce((s, l) => s + n0(l.debit), 0));
  const cr = r2(lines.reduce((s, l) => s + n0(l.credit), 0));
  const diff = r2(dr - cr);
  const upd = (k: number, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.k === k ? { ...l, ...patch } : l)));
  useEffect(() => {
    if (doc.isNew) ws.setDirty(tabId, dr > 0 || cr > 0);
  }, [dr, cr]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const used = lines.filter((l) => l.accountId || n0(l.debit) || n0(l.credit));
    if (!used.length) return toast.warning('Add at least one account line');
    for (const l of used) {
      if (!l.accountId) return toast.warning('Every line needs an account');
      if (!n0(l.debit) && !n0(l.credit)) return toast.warning('Every line needs a debit or credit amount');
    }
    setSaving(true);
    try {
      const j = (await api.post<JournalDoc>('/journals/opening-balance', {
        date,
        narration: narration || null,
        lines: used.map((l) => ({ accountId: l.accountId, debit: n0(l.debit) || undefined, credit: n0(l.credit) || undefined, description: l.description || null })),
      })).data;
      toast.success(`Opening balance ${j.entryNo} posted`);
      qc.invalidateQueries({ queryKey: ['table'] });
      ws.setDirty(tabId, false);
      ws.retarget(tabId, { id: j.id, title: j.entryNo });
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!doc.isNew) {
    return (
      <DocumentLayout title="Opening Balance" icon={FolderOpen} docNo={doc.data?.entryNo} status={doc.data?.status} loading={doc.isLoading} error={doc.error}>
        {doc.data && <JournalView doc={doc.data} refetch={doc.refetch} />}
      </DocumentLayout>
    );
  }
  return (
    <DocumentLayout
      title="Opening Balance"
      icon={FolderOpen}
      actions={
        <>
          <DocAction icon={Save} variant="primary" hidden={!can('journal', 'create')} loading={saving} onClick={save}>Post Opening Balances</DocAction>
          <DocActionSep />
          <DocAction icon={Plus} onClick={() => setLines((l) => [...l, blank()])}>Add Line</DocAction>
        </>
      }
    >
      <HeaderSection title="Opening Balance Information" columns={3}>
        <Field label="Date" required><DateInput value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Narration"><Input value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
      </HeaderSection>
      <div className="rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] text-blue-800">
        Enter balances of non-subledger accounts (bank, cash, fixed assets, loans, capital...). The difference is posted automatically to Opening Balance Equity.
        Customer / supplier opening balances are entered on the party master; opening stock via a Stock Adjustment of type Opening.
      </div>
      <DocSection title="Account Balances" bodyClassName="p-0">
        <table className="w-full border-collapse">
          <thead><tr className="h-6"><th className="grid-th w-8">#</th><th className="grid-th w-[340px]">Account</th><th className="grid-th">Description</th><th className="grid-th w-32 text-right">Debit</th><th className="grid-th w-32 text-right">Credit</th><th className="grid-th w-8" /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.k} className="h-7">
                <td className="grid-td text-center text-slate-400">{i + 1}</td>
                <td className="grid-td p-0.5"><Combo options={opts} value={l.accountId} onChange={(x) => upd(l.k, { accountId: Number(x) })} placeholder="Account..." /></td>
                <td className="grid-td p-0.5"><Input value={l.description} onChange={(e) => upd(l.k, { description: e.target.value })} /></td>
                <td className="grid-td p-0.5"><NumberInput value={l.debit} onChange={(e) => upd(l.k, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></td>
                <td className="grid-td p-0.5"><NumberInput value={l.credit} onChange={(e) => upd(l.k, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></td>
                <td className="grid-td p-0 text-center"><IconButton icon={Trash2} variant="danger" label="Remove" disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((x) => x.k !== l.k))} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="h-6 bg-app-head font-semibold"><td colSpan={3} className="px-2 text-right text-[12px]">Total</td><td className="px-2 text-right text-[12px] tabular-nums">{fmt.money(dr)}</td><td className="px-2 text-right text-[12px] tabular-nums">{fmt.money(cr)}</td><td /></tr>
            <tr className="h-6"><td colSpan={3} className="px-2 text-right text-[12px] text-slate-600">Opening Balance Equity (auto)</td><td className="px-2 text-right text-[12px] tabular-nums">{diff < 0 ? fmt.money(-diff) : ''}</td><td className="px-2 text-right text-[12px] tabular-nums">{diff > 0 ? fmt.money(diff) : ''}</td><td /></tr>
          </tfoot>
        </table>
      </DocSection>
      <DocSection title="Notes"><Textarea rows={2} value={narration} onChange={(e) => setNarration(e.target.value)} /></DocSection>
    </DocumentLayout>
  );
}

export default [
  { id: 'journal-vouchers', title: 'Journal Vouchers', icon: FileSpreadsheet, component: () => <JournalList />, permission: 'journal' },
  { id: 'journal-voucher-form', title: 'Journal Voucher', icon: FileSpreadsheet, component: JournalForm, multiInstance: true, permission: 'journal' },
  { id: 'opening-balances', title: 'Opening Balances', icon: FolderOpen, component: () => <JournalList opening />, permission: 'journal' },
  { id: 'opening-balance-form', title: 'Opening Balance', icon: FolderOpen, component: OpeningBalanceForm, multiInstance: true, permission: 'journal' },
] satisfies ScreenDef[];
