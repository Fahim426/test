import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, ExternalLink, FileMinus, FilePlus, FileText, Plus, Printer, Save } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { DataTable, Column } from '@/components/DataTable';
import { DocAction, DocActionSep, DocSection, DocumentLayout, HeaderSection } from '@/components/doc';
import { Button, Checkbox, ConfirmDialog, DateInput, Field, Input, NumberInput, Select, Textarea } from '@/components/ui';
import { Combo, Money, accLabel, esc, n0, printHtml, useAccounts, useParties } from '@/components/finance/common';
import { useDocument } from '@/hooks/useDocument';
import { useCompany } from '@/hooks/useCompany';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { api, apiError, Paged } from '@/lib/api';
import { fmt, r2, today } from '@/lib/format';
import { toast } from '@/store/toast';

type NType = 'CREDIT' | 'DEBIT';
interface NoteDoc {
  id: number;
  noteNo: string;
  noteType: NType;
  partyType: 'CUSTOMER' | 'SUPPLIER';
  partyId: number;
  noteDate: string;
  refType?: string | null;
  refId?: number | null;
  refNo?: string | null;
  subtotal: number;
  vatAmount: number;
  total: number;
  reason?: string | null;
  status: string;
  party: { id: number; code: string; name: string } | null;
  journalNo?: string | null;
  journalId?: number | null;
  applied: boolean;
  autoCreated: boolean;
}
interface VatCode {
  id: number;
  code: string;
  name: string;
  rate: number;
  category?: string;
  isDefault: boolean;
  isActive: boolean;
}
interface OpenInv {
  docType: string;
  id: number;
  docNo: string;
  docDate: string;
  outstanding: number;
}
const titleOf = (d: NoteDoc) => d.noteNo;

function NoteList({ type }: { type: NType }) {
  const open = useOpenScreen();
  const can = usePermission();
  const formId = type === 'CREDIT' ? 'credit-note-form' : 'debit-note-form';
  const label = type === 'CREDIT' ? 'Credit Note' : 'Debit Note';
  const [cancelRow, setCancelRow] = useState<NoteDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const columns: Column<NoteDoc>[] = [
    { key: 'noteNo', header: `${label} No`, width: 130, filter: 'text' },
    { key: 'noteDate', header: 'Date', type: 'date', width: 100, filter: 'date' },
    { key: 'partyType', header: 'Party Type', width: 90, cell: (r) => fmt.status(r.partyType) },
    { key: 'party.name', header: 'Party', cell: (r) => r.party?.name ?? '' },
    { key: 'refNo', header: 'Against Invoice', width: 130 },
    { key: 'reason', header: 'Reason', sortable: false },
    { key: 'subtotal', header: 'Net', type: 'money', width: 100, total: 'sum' },
    { key: 'vatAmount', header: 'VAT', type: 'money', width: 90, total: 'sum' },
    { key: 'total', header: 'Total', type: 'money', width: 100, total: 'sum' },
    { key: 'applied', header: 'Applied', type: 'boolean', width: 70, sortable: false },
    { key: 'status', header: 'Status', type: 'status', width: 100 },
  ];
  const doCancel = async () => {
    if (!cancelRow) return;
    setBusy(true);
    try {
      await api.post(`/notes/${cancelRow.id}/cancel`, {});
      toast.success(`${cancelRow.noteNo} cancelled`);
      setCancelRow(null);
      setReload((x) => x + 1);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <DataTable
        key={reload}
        tableKey={type === 'CREDIT' ? 'credit-notes' : 'debit-notes'}
        url="/notes"
        queryKey="notes"
        filters={{ noteType: type }}
        columns={columns}
        exportName={`${label}s`}
        defaultSort={{ key: 'id', dir: 'desc' }}
        onRowDoubleClick={(r) => open(formId, { id: r.id }, r.noteNo)}
        rowActions={[
          { label: 'Open', icon: ExternalLink, onClick: (r) => open(formId, { id: r.id }, r.noteNo) },
          { label: 'Cancel', icon: Ban, danger: true, hidden: (r) => r.status !== 'POSTED' || r.autoCreated || !can('notes', 'cancel'), onClick: (r) => setCancelRow(r) },
        ]}
        toolbarExtras={can('notes', 'create') && <Button variant="primary" icon={Plus} onClick={() => open(formId, {}, `New ${label}`)}>New {label}</Button>}
      />
      <ConfirmDialog open={!!cancelRow} danger title={`Cancel ${label}`} confirmLabel="Cancel note" loading={busy} message={<>Cancel <b>{cancelRow?.noteNo}</b>? Its journal is reversed.</>} onConfirm={doCancel} onCancel={() => setCancelRow(null)} />
    </>
  );
}

function NoteForm({ type, tabId, params }: { type: NType } & Pick<ScreenProps, 'tabId' | 'params'>) {
  const ws = useWorkspace();
  const open = useOpenScreen();
  const can = usePermission();
  const company = useCompany();
  const doc = useDocument<NoteDoc>('/notes', params.id, { tabId, titleOf });
  const v = doc.data;
  const ro = !doc.isNew;
  const label = type === 'CREDIT' ? 'Credit Note' : 'Debit Note';

  const [partyType, setPartyType] = useState<'CUSTOMER' | 'SUPPLIER'>('CUSTOMER');
  const [partyId, setPartyId] = useState<number | null>(null);
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [vatCode, setVatCode] = useState('');
  const [accountId, setAccountId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [refId, setRefId] = useState<number | null>(null);
  const [apply, setApply] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const parties = useParties(partyType);
  const accounts = useAccounts();
  const counters = useMemo(() => (accounts.data ?? []).filter((a) => !a.isGroup && a.isActive && !a.isBank && !['AR', 'AP', 'VAT_INPUT', 'VAT_OUTPUT', 'CASH'].includes(a.systemKey ?? '')), [accounts.data]);
  const vats = useQuery({
    queryKey: ['fin-vat-codes'],
    staleTime: 60_000,
    queryFn: async () => (await api.get<Paged<VatCode>>('/vat-codes', { params: { pageSize: 200 } })).data.rows.filter((x) => x.isActive),
  });
  useEffect(() => {
    if (!vatCode && vats.data?.length) setVatCode((vats.data.find((x) => x.isDefault) ?? vats.data[0]).code);
  }, [vats.data, vatCode]);
  const invs = useQuery({
    queryKey: ['fin-open-invoices', partyType, partyId],
    enabled: !ro && !!partyId,
    queryFn: async () => (await api.get<{ rows: OpenInv[] }>('/vouchers/open-invoices', { params: { partyType, partyId } })).data.rows,
  });
  useEffect(() => { setRefId(null); setApply(false); }, [partyId, partyType]);
  useEffect(() => {
    if (!ro) ws.setDirty(tabId, !!(partyId || amount || reason));
  }, [partyId, amount, reason, ro, tabId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rate = n0(vats.data?.find((x) => x.code === vatCode)?.rate);
  const net = r2(n0(amount));
  const vat = r2((net * rate) / 100);
  const total = r2(net + vat);
  const refInv = invs.data?.find((i) => i.id === refId);

  const save = async () => {
    if (!partyId) return toast.warning('Select a party');
    if (net <= 0) return toast.warning('Enter the net amount');
    if (apply && !refId) return toast.warning('Select the invoice to apply to');
    if (apply && refInv && total > refInv.outstanding + 0.004) return toast.warning(`Note total ${fmt.money(total)} exceeds invoice outstanding ${fmt.money(refInv.outstanding)}`);
    try {
      await doc.save({
        noteType: type,
        partyType,
        partyId,
        noteDate: date,
        amount: net,
        vatCode: vatCode || null,
        accountId,
        reason: reason || null,
        refType: refId ? (partyType === 'CUSTOMER' ? 'SALES_INVOICE' : 'PURCHASE_INVOICE') : null,
        refId,
        applyToInvoice: apply,
      });
      ws.setDirty(tabId, false);
    } catch {
      /* toast shown */
    }
  };
  const cancel = async () => {
    try {
      await doc.transition('cancel', {});
      setConfirmCancel(false);
      doc.refetch();
    } catch (e) {
      toast.error(apiError(e));
    }
  };
  const print = () => {
    if (!v) return;
    printHtml(
      v.noteNo,
      `<h1>${esc(company.data?.name ?? '')}</h1><h2>${esc(label)} ${esc(v.noteNo)}</h2>
      <table class="meta"><tr><td>Date</td><td><b>${fmt.date(v.noteDate)}</b></td><td>${v.partyType === 'CUSTOMER' ? 'Customer' : 'Supplier'}</td><td><b>${esc(v.party?.name)}</b></td></tr>
      <tr><td>Against</td><td>${esc(v.refNo)}</td><td>Status</td><td>${esc(fmt.status(v.status))}</td></tr><tr><td>Reason</td><td colspan="3">${esc(v.reason)}</td></tr></table>
      <table style="margin-top:10px;width:300px;margin-left:auto"><tr><td>Net</td><td class="r">${fmt.money(v.subtotal)}</td></tr><tr><td>VAT</td><td class="r">${fmt.money(v.vatAmount)}</td></tr><tr><th>Total</th><th class="r">${fmt.money(v.total)}</th></tr></table>
      <table class="meta" style="margin-top:50px"><tr><td>Prepared by: ____________</td><td>Approved by: ____________</td></tr></table>`,
    );
  };

  const showParty = v?.partyType ?? partyType;
  return (
    <DocumentLayout
      title={label}
      icon={type === 'CREDIT' ? FilePlus : FileMinus}
      docNo={v?.noteNo}
      status={v?.status}
      loading={doc.isLoading}
      error={doc.error}
      actions={
        <>
          <DocAction icon={Save} variant="primary" hidden={!doc.isNew || !can('notes', 'create')} loading={doc.saving} onClick={save}>Post {label}</DocAction>
          <DocAction icon={Ban} variant="danger" hidden={doc.isNew || v?.status !== 'POSTED' || !!v?.autoCreated || !can('notes', 'cancel')} onClick={() => setConfirmCancel(true)}>Cancel Note</DocAction>
          <DocActionSep />
          <DocAction icon={Printer} hidden={doc.isNew} onClick={print}>Print</DocAction>
          <DocAction icon={FileText} hidden={doc.isNew || !v?.journalId} onClick={() => v?.journalId && open('journal-voucher-form', { id: v.journalId }, v.journalNo ?? 'Journal')}>View Journal</DocAction>
        </>
      }
    >
      <HeaderSection title={`${label} Information`}>
        <Field label="Note No"><Input readOnly value={v?.noteNo ?? '(auto)'} /></Field>
        <Field label="Date" required><DateInput disabled={ro} value={v ? fmt.isoDate(v.noteDate) : date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Party Type" required>
          <Select disabled={ro} value={showParty} onChange={(e) => { setPartyType(e.target.value as 'CUSTOMER' | 'SUPPLIER'); setPartyId(null); }} options={[{ value: 'CUSTOMER', label: 'Customer' }, { value: 'SUPPLIER', label: 'Supplier' }]} />
        </Field>
        <Field label={showParty === 'CUSTOMER' ? 'Customer' : 'Supplier'} required>
          {ro ? <Input readOnly value={v?.party?.name ?? ''} /> : (
            <Combo options={(parties.data ?? []).map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` }))} value={partyId} onChange={(x) => setPartyId(Number(x))} placeholder="Select party" />
          )}
        </Field>
        <Field label="Net Amount (excl. VAT)" required><NumberInput disabled={ro} value={v ? v.subtotal : amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="VAT Code" hint={ro ? undefined : `Rate ${fmt.percent(rate)} (from VAT master)`}>
          {ro ? <Input readOnly value={v && v.subtotal ? fmt.percent(r2((v.vatAmount / v.subtotal) * 100)) : ''} /> : (
            <Select value={vatCode} onChange={(e) => setVatCode(e.target.value)} options={(vats.data ?? []).map((x) => ({ value: x.code, label: `${x.code} - ${x.name} (${fmt.percent(x.rate)})` }))} />
          )}
        </Field>
        <Field label="Counter Account" hint="Optional - defaults to Sales / Sales Returns / Inventory">
          {ro ? <Input readOnly value="" /> : <Combo allowClear options={counters.map((a) => ({ value: a.id, label: accLabel(a) }))} value={accountId} onChange={(x) => setAccountId(x === null ? null : Number(x))} placeholder="(default)" />}
        </Field>
        <Field label="Reason"><Input disabled={ro} value={v ? v.reason ?? '' : reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </HeaderSection>

      <DocSection title="Invoice Reference">
        {ro ? (
          <div className="text-[12px]">
            Against invoice: <b>{v?.refNo || '-'}</b>
            {v?.refId && v.refType && (
              <button className="ml-2 text-brand hover:underline" onClick={() => open(v.refType === 'SALES_INVOICE' ? 'sales-invoice-form' : 'purchase-invoice-form', { id: v.refId as number }, v.refNo ?? 'Invoice')}>open</button>
            )}
            {v?.applied && <span className="ml-3 rounded border border-green-300 bg-green-50 px-1.5 text-green-700">Applied - invoice outstanding reduced</span>}
            {v?.autoCreated && <span className="ml-3 rounded border border-amber-300 bg-amber-50 px-1.5 text-amber-800">Created automatically by a return - cancel the return to reverse it</span>}
          </div>
        ) : (
          <div className="grid grid-cols-3 items-end gap-3">
            <Field label="Against Invoice (optional)">
              <Select value={refId ?? ''} onChange={(e) => setRefId(e.target.value ? Number(e.target.value) : null)} placeholder={partyId ? '(none)' : 'Select a party first'}
                options={(invs.data ?? []).map((i) => ({ value: i.id, label: `${i.docNo} - ${fmt.date(i.docDate)} - outstanding ${fmt.money(i.outstanding)}` }))} />
            </Field>
            {type === 'CREDIT' ? (
              <Checkbox label="Apply to invoice (reduce its outstanding)" disabled={!refId} checked={apply} onChange={(e) => setApply(e.target.checked)} />
            ) : <span className="text-[11px] text-slate-500">Debit notes increase the party balance and are not applied to invoices.</span>}
            {apply && refInv && <span className="text-[11px] text-slate-600">Outstanding {fmt.money(refInv.outstanding)} {total > refInv.outstanding + 0.004 && <b className="text-red-600">- note exceeds outstanding</b>}</span>}
          </div>
        )}
      </DocSection>

      <DocSection title="Totals">
        <div className="ml-auto w-[300px] text-[12px]">
          <div className="flex justify-between py-0.5"><span>Net</span><Money v={v ? v.subtotal : net} /></div>
          <div className="flex justify-between py-0.5"><span>VAT</span><Money v={v ? v.vatAmount : vat} /></div>
          <div className="flex justify-between border-t border-app-border pt-1 text-[14px] font-bold text-brand"><span>Total</span><Money v={v ? v.total : total} /></div>
        </div>
      </DocSection>
      {!ro && <DocSection title="Narration"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></DocSection>}
      <ConfirmDialog open={confirmCancel} danger title="Cancel note" confirmLabel="Cancel note" loading={doc.acting} message={<>Cancel <b>{v?.noteNo}</b>? Its journal is reversed{v?.applied ? ' and the invoice outstanding restored' : ''}.</>} onConfirm={cancel} onCancel={() => setConfirmCancel(false)} />
    </DocumentLayout>
  );
}

const mkForm = (type: NType) => (p: ScreenProps) => <NoteForm type={type} tabId={p.tabId} params={p.params} />;

export default [
  { id: 'credit-notes', title: 'Credit Notes', icon: FilePlus, component: () => <NoteList type="CREDIT" />, permission: 'notes' },
  { id: 'debit-notes', title: 'Debit Notes', icon: FileMinus, component: () => <NoteList type="DEBIT" />, permission: 'notes' },
  { id: 'credit-note-form', title: 'Credit Note', icon: FilePlus, component: mkForm('CREDIT'), multiInstance: true, permission: 'notes' },
  { id: 'debit-note-form', title: 'Debit Note', icon: FileMinus, component: mkForm('DEBIT'), multiInstance: true, permission: 'notes' },
] satisfies ScreenDef[];
