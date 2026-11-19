import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, Banknote, CheckCheck, Eraser, ExternalLink, FileText, HandCoins, Landmark, Plus, Printer, Save, Wallet, Wand2 } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { DataTable, Column } from '@/components/DataTable';
import { DocAction, DocActionSep, DocSection, DocumentLayout, HeaderSection } from '@/components/doc';
import { Button, ConfirmDialog, DateInput, Field, Input, Modal, NumberInput, Select, Textarea } from '@/components/ui';
import { Combo, Money, accLabel, esc, n0, printHtml, useAccounts, useParties } from '@/components/finance/common';
import { useDocument } from '@/hooks/useDocument';
import { useCompany } from '@/hooks/useCompany';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { api, apiError } from '@/lib/api';
import { fmt, r2, today } from '@/lib/format';
import { toast } from '@/store/toast';
import { cn } from '@/lib/cn';

type VType = 'RECEIPT' | 'PAYMENT';
type Mode = 'CASH' | 'BANK';
type PartyType = 'CUSTOMER' | 'SUPPLIER' | 'OTHER';

interface Alloc {
  id?: number;
  docType: string;
  docId: number;
  docNo: string;
  amount: number;
}
interface VoucherDoc {
  id: number;
  voucherNo: string;
  voucherType: VType;
  mode: Mode;
  voucherDate: string;
  partyType: PartyType;
  partyId: number | null;
  accountId: number;
  counterAccountId: number | null;
  amount: number;
  reference?: string | null;
  narration?: string | null;
  status: string;
  allocations: Alloc[];
  party: { id: number; code: string; name: string } | null;
  account: { id: number; code: string; name: string } | null;
  counterAccount: { id: number; code: string; name: string } | null;
  journal: { id: number; entryNo: string; status: string } | null;
  bankCharges: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  isAdvance: boolean;
  advanceAmount: number;
  advanceSettled: number;
  advanceRemaining: number;
  settlements: { id: number; entryNo: string; entryDate: string; sourceNo: string | null; status: string; totalDebit: number }[];
}
interface OpenInvoice {
  docType: string;
  id: number;
  docNo: string;
  supplierInvoiceNo?: string | null;
  docDate: string;
  dueDate: string | null;
  currencyCode: string;
  total: number;
  baseTotal: number;
  settled: number;
  outstanding: number;
  status: string;
}
interface OpenOrder {
  id: number;
  docNo: string;
  docDate: string;
  orderType?: string;
  currencyCode: string;
  total: number;
  baseTotal: number;
  advancePaid: number;
  status: string;
}

const permOf = (t: VType) => (t === 'RECEIPT' ? 'receipts' : 'payments');
const key = (a: { docType: string; id: number }) => `${a.docType}:${a.id}`;

/* ============================================================== LIST */
function VoucherList({ type, mode, formId, label }: { type: VType; mode: Mode; formId: string; label: string }) {
  const open = useOpenScreen();
  const can = usePermission();
  const [cancelRow, setCancelRow] = useState<{ id: number; voucherNo: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const perm = permOf(type);

  const columns: Column<VoucherDoc & { allocationCount: number }>[] = [
    { key: 'voucherNo', header: `${label} No`, width: 130, filter: 'text' },
    { key: 'voucherDate', header: 'Date', type: 'date', width: 100, filter: 'date' },
    { key: 'party.name', header: type === 'RECEIPT' ? 'Received From' : 'Paid To', cell: (r) => r.party?.name ?? <span className="text-slate-400">{fmt.status(r.partyType)}</span> },
    { key: 'partyType', header: 'Party Type', width: 90, cell: (r) => fmt.status(r.partyType), hidden: true },
    { key: 'account.name', header: mode === 'BANK' ? 'Bank Account' : 'Cash Account', cell: (r) => r.account?.name ?? '' },
    { key: 'reference', header: 'Reference', width: 130 },
    { key: 'amount', header: 'Amount', type: 'money', total: 'sum', width: 110 },
    { key: 'allocatedAmount', header: 'Allocated', type: 'money', width: 100 },
    { key: 'unallocated', header: 'On Account', type: 'money', width: 100, sortable: false, accessor: (r) => r2(n0(r.amount) - n0(r.allocatedAmount)) },
    { key: 'isAdvance', header: 'Advance', type: 'boolean', width: 70, sortable: false, hidden: type === 'RECEIPT' },
    { key: 'status', header: 'Status', type: 'status', width: 100, filter: { type: 'select', options: [{ value: 'POSTED', label: 'Posted' }, { value: 'CANCELLED', label: 'Cancelled' }] } },
  ];
  const doCancel = async () => {
    if (!cancelRow) return;
    setBusy(true);
    try {
      await api.post(`/vouchers/${cancelRow.id}/cancel`, {});
      toast.success(`${cancelRow.voucherNo} cancelled (journal reversed)`);
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
        tableKey={formId.replace('-form', 's')}
        url={type === 'RECEIPT' ? '/receipts' : '/payments'}
        queryKey={type === 'RECEIPT' ? 'receipts' : 'payments'}
        filters={{ mode }}
        columns={columns}
        exportName={`${mode === 'BANK' ? 'Bank' : 'Cash'} ${label}s`}
        defaultSort={{ key: 'id', dir: 'desc' }}
        onRowDoubleClick={(r) => open(formId, { id: r.id }, r.voucherNo)}
        rowActions={[
          { label: 'Open', icon: ExternalLink, onClick: (r) => open(formId, { id: r.id }, r.voucherNo) },
          { label: 'Cancel (reverse)', icon: Ban, danger: true, hidden: (r) => r.status !== 'POSTED' || !can(perm, 'cancel'), onClick: (r) => setCancelRow({ id: r.id, voucherNo: r.voucherNo }) },
        ]}
        toolbarExtras={
          can(perm, 'create') && (
            <Button variant="primary" icon={Plus} onClick={() => open(formId, {}, `New ${mode === 'BANK' ? 'Bank' : 'Cash'} ${label}`)}>
              New {label}
            </Button>
          )
        }
      />
      <ConfirmDialog
        open={!!cancelRow}
        danger
        title="Cancel voucher"
        confirmLabel="Cancel voucher"
        loading={busy}
        message={<>Cancel <b>{cancelRow?.voucherNo}</b>? Its journal will be reversed and allocated invoices re-opened.</>}
        onConfirm={doCancel}
        onCancel={() => setCancelRow(null)}
      />
    </>
  );
}

/* ============================================================== FORM */
function VoucherForm({ type, fixedMode, tabId, params }: { type: VType; fixedMode?: Mode } & Pick<ScreenProps, 'tabId' | 'params'>) {
  const ws = useWorkspace();
  const open = useOpenScreen();
  const can = usePermission();
  const company = useCompany();
  const doc = useDocument<VoucherDoc>('/vouchers', params.id, { tabId });
  const v = doc.data;
  const isNew = doc.isNew;
  const ro = !isNew;
  const isReceipt = type === 'RECEIPT';
  const perm = permOf(type);

  const [mode, setMode] = useState<Mode>(fixedMode ?? ((params.mode as Mode) || 'BANK'));
  const [date, setDate] = useState(today());
  const [partyType, setPartyType] = useState<PartyType>((params.partyType as PartyType) || (isReceipt ? 'CUSTOMER' : 'SUPPLIER'));
  const [partyId, setPartyId] = useState<number | null>(params.partyId ? Number(params.partyId) : null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [counterId, setCounterId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [charges, setCharges] = useState('');
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({}); // invoices
  const [adv, setAdv] = useState<Record<string, string>>({}); // PO advances
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);

  const accounts = useAccounts();
  const parties = useParties(partyType);
  const cashBank = useMemo(() => (accounts.data ?? []).filter((a) => !a.isGroup && a.isActive && (mode === 'BANK' ? a.isBank : a.systemKey === 'CASH')), [accounts.data, mode]);
  const counters = useMemo(() => (accounts.data ?? []).filter((a) => !a.isGroup && a.isActive && !a.isBank && a.systemKey !== 'CASH'), [accounts.data]);

  useEffect(() => {
    if (ro) return;
    if (!cashBank.some((a) => a.id === accountId)) setAccountId(cashBank[0]?.id ?? null);
  }, [cashBank, accountId, ro]);
  useEffect(() => {
    if (!ro) ws.setDirty(tabId, !!(partyId || amount || reference || narration));
  }, [partyId, amount, reference, narration, ro, tabId]); // eslint-disable-line react-hooks/exhaustive-deps

  const allocatable = !ro && ((isReceipt && partyType === 'CUSTOMER') || (!isReceipt && partyType === 'SUPPLIER'));
  const openInv = useQuery({
    queryKey: ['fin-open-invoices', partyType, partyId],
    enabled: allocatable && !!partyId,
    queryFn: async () => (await api.get<{ rows: OpenInvoice[]; totalOutstanding: number }>('/vouchers/open-invoices', { params: { partyType, partyId } })).data,
  });
  const openOrders = useQuery({
    queryKey: ['fin-open-orders', partyId],
    enabled: allocatable && !isReceipt && !!partyId,
    queryFn: async () => (await api.get<{ rows: OpenOrder[] }>('/vouchers/open-orders', { params: { supplierId: partyId } })).data.rows,
  });
  const invoices = openInv.data?.rows ?? [];
  const orders = openOrders.data ?? [];

  // changing party clears allocations
  useEffect(() => { setAlloc({}); setAdv({}); }, [partyId, partyType]);

  const amt = n0(amount);
  const invTotal = r2(Object.values(alloc).reduce((s, x) => s + n0(x), 0));
  const advTotal = r2(Object.values(adv).reduce((s, x) => s + n0(x), 0));
  const allocTotal = r2(invTotal + advTotal);
  const bc = n0(charges);

  const autoAllocate = () => {
    let left = r2(amt - advTotal);
    const next: Record<string, string> = {};
    for (const i of [...invoices].sort((a, b) => new Date(a.docDate).getTime() - new Date(b.docDate).getTime())) {
      if (left <= 0.004) break;
      const x = Math.min(left, i.outstanding);
      next[key(i)] = String(r2(x));
      left = r2(left - x);
    }
    setAlloc(next);
    if (left > 0.004) toast.info(`${fmt.money(left)} remains unallocated (on account)`);
  };

  const save = async () => {
    if (partyType !== 'OTHER' && !partyId) return toast.warning('Select a party');
    if (partyType === 'OTHER' && !counterId) return toast.warning('Select the other account');
    if (!accountId) return toast.warning(`Select a ${mode === 'BANK' ? 'bank' : 'cash'} account`);
    if (amt <= 0) return toast.warning('Amount must be greater than zero');
    if (allocTotal > amt + 0.004) return toast.warning(`Allocations (${fmt.money(allocTotal)}) exceed the amount (${fmt.money(amt)})`);
    for (const i of invoices) if (n0(alloc[key(i)]) > i.outstanding + 0.004) return toast.warning(`${i.docNo}: allocation exceeds outstanding ${fmt.money(i.outstanding)}`);
    const allocations = [
      ...invoices.filter((i) => n0(alloc[key(i)]) > 0).map((i) => ({ docType: i.docType, docId: i.id, amount: r2(n0(alloc[key(i)])) })),
      ...orders.filter((o) => n0(adv[`PO:${o.id}`]) > 0).map((o) => ({ docType: 'PURCHASE_ORDER', docId: o.id, amount: r2(n0(adv[`PO:${o.id}`])) })),
    ];
    const body = {
      voucherType: type,
      mode,
      voucherDate: date,
      partyType,
      ...(partyType === 'OTHER' ? { counterAccountId: counterId } : { partyId }),
      accountId,
      amount: r2(amt),
      bankCharges: r2(bc),
      reference: reference || null,
      narration: narration || null,
      allocations,
    };
    try {
      await doc.save(body);
      ws.setDirty(tabId, false);
    } catch {
      /* toast shown by useDocument */
    }
  };
  const act = async (a: string) => {
    try {
      await doc.transition(a, {});
      doc.refetch();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const printVoucher = () => {
    if (!v) return;
    const co = company.data;
    const rows = v.allocations.map((a) => `<tr><td>${esc(a.docType.replace('_', ' '))}</td><td>${esc(a.docNo)}</td><td class="r">${fmt.money(a.amount)}</td></tr>`).join('');
    printHtml(
      v.voucherNo,
      `<table class="meta"><tr><td><h1>${esc(co?.name ?? 'Company')}</h1><div>${co?.trn ? 'TRN: ' + esc(co.trn) : ''}</div></td><td class="r"><h1>${isReceipt ? 'RECEIPT' : 'PAYMENT'} VOUCHER</h1><div>${esc(v.voucherNo)}</div></td></tr></table><hr/>
      <table class="meta"><tr><td>Date</td><td><b>${fmt.date(v.voucherDate)}</b></td><td>Mode</td><td><b>${esc(fmt.status(v.mode))}</b></td></tr>
      <tr><td>${isReceipt ? 'Received from' : 'Paid to'}</td><td><b>${esc(v.party?.name ?? v.counterAccount?.name ?? fmt.status(v.partyType))}</b></td><td>${v.mode === 'BANK' ? 'Bank' : 'Cash'} account</td><td><b>${esc(v.account ? accLabel(v.account) : '')}</b></td></tr>
      <tr><td>Reference</td><td>${esc(v.reference)}</td><td>Status</td><td>${esc(fmt.status(v.status))}</td></tr></table>
      <h2 style="margin-top:12px">Amount: ${fmt.money(v.amount)} ${esc(company.data?.baseCurrency ?? '')}</h2>
      ${v.bankCharges ? `<div>Bank charges: ${fmt.money(v.bankCharges)}</div>` : ''}
      ${rows ? `<table style="margin-top:8px"><thead><tr><th>Document</th><th>No</th><th class="r">Allocated</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
      ${v.unallocatedAmount > 0.004 ? `<div style="margin-top:4px">On account: ${fmt.money(v.unallocatedAmount)}</div>` : ''}
      <p style="margin-top:8px">Narration: ${esc(v.narration)}</p>
      <table class="meta" style="margin-top:50px"><tr><td>Prepared by: ____________</td><td>Approved by: ____________</td><td>${isReceipt ? 'Received' : 'Received'} by: ____________</td></tr></table>`,
    );
  };

  const cancelled = v?.status === 'CANCELLED';
  const title = `${mode === 'BANK' ? 'Bank' : 'Cash'} ${isReceipt ? 'Receipt' : 'Payment'}`;
  const showMode = v?.mode ?? mode;
  const advanceMode = !isReceipt && partyType === 'SUPPLIER';
  const viewPartyName = v ? v.party?.name ?? v.counterAccount?.name ?? fmt.status(v.partyType) : '';

  return (
    <DocumentLayout
      title={v ? `${showMode === 'BANK' ? 'Bank' : 'Cash'} ${isReceipt ? 'Receipt' : 'Payment'}` : title}
      icon={isReceipt ? HandCoins : Wallet}
      docNo={v?.voucherNo}
      status={v?.status}
      loading={doc.isLoading}
      error={doc.error}
      actions={
        <>
          <DocAction icon={Save} variant="primary" hidden={!isNew || !can(perm, 'create')} loading={doc.saving} onClick={save}>Post Voucher</DocAction>
          <DocAction icon={Ban} variant="danger" hidden={isNew || cancelled || !can(perm, 'cancel')} onClick={() => setConfirmCancel(true)}>Cancel Voucher</DocAction>
          <DocAction icon={CheckCheck} hidden={isNew || cancelled || !v?.isAdvance || (v?.advanceRemaining ?? 0) <= 0.004 || !can('payments', 'post')} onClick={() => setSettleOpen(true)}>Settle Advance</DocAction>
          <DocActionSep />
          <DocAction icon={Printer} hidden={isNew} onClick={printVoucher}>Print Voucher</DocAction>
          <DocAction icon={FileText} hidden={isNew || !v?.journal} onClick={() => v?.journal && open('journal-voucher-form', { id: v.journal.id }, v.journal.entryNo)}>View Journal</DocAction>
        </>
      }
    >
      <HeaderSection title={`${isReceipt ? 'Receipt' : 'Payment'} Information`}>
        <Field label="Voucher No"><Input readOnly value={v?.voucherNo ?? '(auto)'} /></Field>
        <Field label="Date" required><DateInput disabled={ro} value={v ? fmt.isoDate(v.voucherDate) : date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Mode">
          <Select disabled={ro || !!fixedMode} value={showMode} onChange={(e) => setMode(e.target.value as Mode)} options={[{ value: 'BANK', label: 'Bank' }, { value: 'CASH', label: 'Cash' }]} />
        </Field>
        <Field label={showMode === 'BANK' ? 'Bank Account' : 'Cash Account'} required>
          {ro ? (
            <Input readOnly value={v?.account ? accLabel(v.account) : ''} />
          ) : (
            <Combo options={cashBank.map((a) => ({ value: a.id, label: accLabel(a) }))} value={accountId} onChange={(x) => setAccountId(Number(x))} placeholder="Select account" />
          )}
        </Field>
        <Field label={isReceipt ? 'Received From' : 'Paid To'} required>
          <Select disabled={ro} value={v?.partyType ?? partyType} onChange={(e) => { setPartyType(e.target.value as PartyType); setPartyId(null); }}
            options={[{ value: 'CUSTOMER', label: 'Customer' }, { value: 'SUPPLIER', label: 'Supplier' }, { value: 'OTHER', label: 'Other (account)' }]} />
        </Field>
        {partyType === 'OTHER' || v?.partyType === 'OTHER' ? (
          <Field label="Other Account" required>
            {ro ? <Input readOnly value={v?.counterAccount ? accLabel(v.counterAccount) : ''} /> : (
              <Combo options={counters.map((a) => ({ value: a.id, label: accLabel(a) }))} value={counterId} onChange={(x) => setCounterId(Number(x))} placeholder="Select account" />
            )}
          </Field>
        ) : (
          <Field label={partyType === 'CUSTOMER' ? 'Customer' : 'Supplier'} required>
            {ro ? <Input readOnly value={viewPartyName} /> : (
              <Combo options={(parties.data ?? []).map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` }))} value={partyId} onChange={(x) => setPartyId(Number(x))} placeholder={`Select ${partyType === 'CUSTOMER' ? 'customer' : 'supplier'}`} />
            )}
          </Field>
        )}
        <Field label="Amount" required><NumberInput disabled={ro} value={v ? v.amount : amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Bank Charges" hint={isReceipt ? 'Deducted from the bank deposit' : 'Added to the bank withdrawal'}>
          <NumberInput disabled={ro} value={v ? v.bankCharges : charges} onChange={(e) => setCharges(e.target.value)} />
        </Field>
        <Field label="Reference / Cheque No"><Input disabled={ro} value={v ? v.reference ?? '' : reference} onChange={(e) => setReference(e.target.value)} /></Field>
      </HeaderSection>

      {/* -------- allocation (new voucher) */}
      {allocatable && partyId && (
        <DocSection
          title={isReceipt ? 'Open Invoices - Allocation' : 'Open Purchase Invoices - Allocation'}
          right={
            <div className="flex gap-1">
              <Button size="sm" icon={Wand2} onClick={autoAllocate} disabled={amt <= 0 || !invoices.length}>Auto-allocate (FIFO)</Button>
              <Button size="sm" icon={Eraser} onClick={() => setAlloc({})}>Clear</Button>
            </div>
          }
          bodyClassName="p-0"
        >
          <table className="w-full border-collapse">
            <thead>
              <tr className="h-6">
                <th className="grid-th">Invoice No</th>
                {!isReceipt && <th className="grid-th">Supplier Inv</th>}
                <th className="grid-th w-24">Date</th>
                <th className="grid-th w-24">Due Date</th>
                <th className="grid-th w-28 text-right">Invoice Total</th>
                <th className="grid-th w-28 text-right">Outstanding</th>
                <th className="grid-th w-36 text-right">Allocate</th>
                <th className="grid-th w-28 text-right">Balance After</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => {
                const a = n0(alloc[key(i)]);
                const overdue = i.dueDate && new Date(i.dueDate) < new Date(new Date().toDateString());
                return (
                  <tr key={key(i)} className="h-6">
                    <td className="grid-td">
                      <button className="text-brand hover:underline" onClick={() => open(i.docType === 'SALES_INVOICE' ? 'sales-invoice-form' : 'purchase-invoice-form', { id: i.id }, i.docNo)}>{i.docNo}</button>
                    </td>
                    {!isReceipt && <td className="grid-td">{i.supplierInvoiceNo}</td>}
                    <td className="grid-td">{fmt.date(i.docDate)}</td>
                    <td className={cn('grid-td', overdue && 'font-medium text-red-600')}>{fmt.date(i.dueDate)}</td>
                    <td className="grid-td text-right tabular-nums">{fmt.money(i.baseTotal)}</td>
                    <td className="grid-td text-right tabular-nums">{fmt.money(i.outstanding)}</td>
                    <td className="grid-td p-0">
                      <div className="flex items-center">
                        <button className="px-1 text-[10px] text-brand hover:underline" title="Allocate full outstanding" onClick={() => setAlloc((s) => ({ ...s, [key(i)]: String(i.outstanding) }))}>full</button>
                        <NumberInput className={cn('!h-6 border-0', a > i.outstanding + 0.004 && 'bg-red-50 text-red-600')} value={alloc[key(i)] ?? ''} onChange={(e) => setAlloc((s) => ({ ...s, [key(i)]: e.target.value }))} />
                      </div>
                    </td>
                    <td className="grid-td text-right tabular-nums">{fmt.money(r2(i.outstanding - a))}</td>
                  </tr>
                );
              })}
              {!invoices.length && <tr><td colSpan={8} className="p-4 text-center text-[12px] text-slate-400">{openInv.isLoading ? 'Loading...' : 'No open invoices for this party - the full amount will be posted on account'}</td></tr>}
            </tbody>
            {invoices.length > 0 && (
              <tfoot>
                <tr className="h-6 bg-app-head font-semibold">
                  <td className="px-2 text-[12px]" colSpan={isReceipt ? 4 : 5}>Total</td>
                  <td className="px-2 text-right text-[12px] tabular-nums" colSpan={2}>{fmt.money(openInv.data?.totalOutstanding)}</td>
                  <td className="px-2 text-right text-[12px] tabular-nums">{fmt.money(invTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </DocSection>
      )}

      {/* -------- advance / LC against PO */}
      {allocatable && advanceMode && partyId && orders.length > 0 && (
        <DocSection title="Advance / LC Payment against Purchase Order" bodyClassName="p-0">
          <table className="w-full border-collapse">
            <thead>
              <tr className="h-6">
                <th className="grid-th">PO No</th><th className="grid-th w-24">Date</th><th className="grid-th w-24">Type</th><th className="grid-th w-16">Curr</th>
                <th className="grid-th w-28 text-right">PO Value (Base)</th><th className="grid-th w-28 text-right">Advance Paid</th><th className="grid-th w-36 text-right">Pay as Advance</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="h-6">
                  <td className="grid-td"><button className="text-brand hover:underline" onClick={() => open(o.orderType === 'IMPORT' ? 'import-purchase-order-form' : 'purchase-order-form', { id: o.id }, o.docNo)}>{o.docNo}</button></td>
                  <td className="grid-td">{fmt.date(o.docDate)}</td>
                  <td className="grid-td">{fmt.status(o.orderType)}</td>
                  <td className="grid-td">{o.currencyCode}</td>
                  <td className="grid-td text-right tabular-nums">{fmt.money(o.baseTotal)}</td>
                  <td className="grid-td text-right tabular-nums">{fmt.money(o.advancePaid)}</td>
                  <td className="grid-td p-0"><NumberInput className="!h-6 border-0" value={adv[`PO:${o.id}`] ?? ''} onChange={(e) => setAdv((s) => ({ ...s, [`PO:${o.id}`]: e.target.value }))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-app-border px-2 py-1 text-[11px] text-slate-500">
            Amounts paid here are booked to Advance to Suppliers and can be settled against purchase invoices later (Settle Advance).
          </div>
        </DocSection>
      )}

      {/* -------- existing voucher allocations */}
      {ro && v && (v.allocations.length > 0 || v.isAdvance) && (
        <DocSection title="Allocations" bodyClassName="p-0">
          <table className="w-full border-collapse">
            <thead><tr className="h-6"><th className="grid-th w-40">Document</th><th className="grid-th">No</th><th className="grid-th w-36 text-right">Allocated</th></tr></thead>
            <tbody>
              {v.allocations.map((a) => (
                <tr key={a.id ?? `${a.docType}${a.docId}`} className="h-6">
                  <td className="grid-td">{a.docType === 'PURCHASE_ORDER' ? 'Purchase Order (advance)' : fmt.status(a.docType)}</td>
                  <td className="grid-td">
                    <button className="text-brand hover:underline" onClick={() => open(a.docType === 'SALES_INVOICE' ? 'sales-invoice-form' : a.docType === 'PURCHASE_INVOICE' ? 'purchase-invoice-form' : 'purchase-order-form', { id: a.docId }, a.docNo)}>{a.docNo}</button>
                  </td>
                  <td className="grid-td text-right tabular-nums">{fmt.money(a.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.isAdvance && (
            <div className="border-t border-app-border p-2 text-[12px]">
              Advance <b>{fmt.money(v.advanceAmount)}</b> - settled <b>{fmt.money(v.advanceSettled)}</b> - remaining <b>{fmt.money(v.advanceRemaining)}</b>
              {v.settlements.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-[11px] text-slate-600">
                  {v.settlements.map((s) => (
                    <li key={s.id}>{s.entryNo} - {fmt.date(s.entryDate)} - {s.sourceNo} - {fmt.money(s.totalDebit)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </DocSection>
      )}

      <DocSection title="Summary & Narration" bodyClassName="grid grid-cols-2 gap-4 p-3">
        <Field label="Narration"><Textarea disabled={ro} rows={4} value={v ? v.narration ?? '' : narration} onChange={(e) => setNarration(e.target.value)} /></Field>
        <div className="ml-auto w-[320px] text-[12px]">
          {(() => {
            const a = v ? v.amount : amt;
            const al = v ? v.allocatedAmount : allocTotal;
            const un = r2(a - al);
            const b = v ? v.bankCharges : bc;
            return (
              <>
                <SumRow l="Voucher Amount" v={<Money v={a} />} />
                <SumRow l="Allocated to documents" v={<Money v={al} />} />
                <SumRow l={isReceipt ? 'Unallocated (on account / advance from customer)' : 'Unallocated (on account)'} v={<Money v={un} />} warn={un > 0.004} />
                <SumRow l="Bank charges" v={<Money v={b} />} />
                <SumRow l={`Net ${isReceipt ? 'deposited' : 'withdrawn'}`} v={<Money v={isReceipt ? a - b : a + b} bold />} bold />
              </>
            );
          })()}
        </div>
      </DocSection>

      <ConfirmDialog
        open={confirmCancel}
        danger
        title="Cancel voucher"
        confirmLabel="Cancel voucher"
        loading={doc.acting}
        message={<>Cancel <b>{v?.voucherNo}</b>? The journal is reversed and allocated invoices are re-opened.</>}
        onConfirm={async () => { await act('cancel'); setConfirmCancel(false); }}
        onCancel={() => setConfirmCancel(false)}
      />
      {v && <SettleAdvanceModal open={settleOpen} voucher={v} onClose={() => setSettleOpen(false)} onDone={() => { setSettleOpen(false); doc.refetch(); doc.invalidate(); }} />}
    </DocumentLayout>
  );
}

function SumRow({ l, v, bold, warn }: { l: string; v: React.ReactNode; bold?: boolean; warn?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-0.5', bold && 'border-t border-app-border pt-1 text-[13px] font-semibold', warn && 'text-amber-700')}>
      <span>{l}</span>
      <span>{v}</span>
    </div>
  );
}

function SettleAdvanceModal({ open, voucher, onClose, onDone }: { open: boolean; voucher: VoucherDoc; onClose: () => void; onDone: () => void }) {
  const [invId, setInvId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const inv = useQuery({
    queryKey: ['fin-open-invoices', 'SUPPLIER', voucher.partyId],
    enabled: open && !!voucher.partyId,
    queryFn: async () => (await api.get<{ rows: OpenInvoice[] }>('/vouchers/open-invoices', { params: { partyType: 'SUPPLIER', partyId: voucher.partyId } })).data.rows,
  });
  const rows = inv.data ?? [];
  const sel = rows.find((r) => r.id === invId);
  useEffect(() => {
    if (sel) setAmount(String(Math.min(voucher.advanceRemaining, sel.outstanding)));
  }, [invId]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    if (!invId) return toast.warning('Select a purchase invoice');
    if (n0(amount) <= 0) return toast.warning('Enter an amount');
    setBusy(true);
    try {
      await api.post(`/vouchers/${voucher.id}/settle-advance`, { purchaseInvoiceId: invId, amount: r2(n0(amount)), date });
      toast.success('Advance settled');
      onDone();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} title={`Settle advance ${voucher.voucherNo}`} onClose={onClose} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" loading={busy} onClick={submit}>Settle</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 text-[12px]">Unsettled advance: <b>{fmt.money(voucher.advanceRemaining)}</b></div>
        <Field label="Purchase Invoice" required className="col-span-2">
          <Select value={invId ?? ''} onChange={(e) => setInvId(e.target.value ? Number(e.target.value) : null)} placeholder="Select invoice"
            options={rows.map((r) => ({ value: r.id, label: `${r.docNo} - outstanding ${fmt.money(r.outstanding)}` }))} />
        </Field>
        <Field label="Amount" required><NumberInput value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Date"><DateInput value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/** generic receipt/payment-voucher-form: render the voucher in its own bank/cash form */
const mk = (type: VType, fixedMode?: Mode) =>
  function Form(p: ScreenProps) {
    return <VoucherForm type={type} fixedMode={fixedMode} tabId={p.tabId} params={p.params} />;
  };

export default [
  { id: 'bank-receipts', title: 'Bank Receipts', icon: Landmark, component: () => <VoucherList type="RECEIPT" mode="BANK" formId="bank-receipt-form" label="Receipt" />, permission: 'receipts' },
  { id: 'cash-receipts', title: 'Cash Receipts', icon: HandCoins, component: () => <VoucherList type="RECEIPT" mode="CASH" formId="cash-receipt-form" label="Receipt" />, permission: 'receipts' },
  { id: 'bank-payments', title: 'Bank Payments', icon: Banknote, component: () => <VoucherList type="PAYMENT" mode="BANK" formId="bank-payment-form" label="Payment" />, permission: 'payments' },
  { id: 'cash-payments', title: 'Cash Payments', icon: Wallet, component: () => <VoucherList type="PAYMENT" mode="CASH" formId="cash-payment-form" label="Payment" />, permission: 'payments' },
  { id: 'bank-receipt-form', title: 'Bank Receipt', icon: Landmark, component: mk('RECEIPT', 'BANK'), multiInstance: true, permission: 'receipts' },
  { id: 'cash-receipt-form', title: 'Cash Receipt', icon: HandCoins, component: mk('RECEIPT', 'CASH'), multiInstance: true, permission: 'receipts' },
  { id: 'bank-payment-form', title: 'Bank Payment', icon: Banknote, component: mk('PAYMENT', 'BANK'), multiInstance: true, permission: 'payments' },
  { id: 'cash-payment-form', title: 'Cash Payment', icon: Wallet, component: mk('PAYMENT', 'CASH'), multiInstance: true, permission: 'payments' },
  { id: 'receipt-voucher-form', title: 'Receipt Voucher', icon: HandCoins, component: mk('RECEIPT'), multiInstance: true, permission: 'receipts' },
  { id: 'payment-voucher-form', title: 'Payment Voucher', icon: Wallet, component: mk('PAYMENT'), multiInstance: true, permission: 'payments' },
] satisfies ScreenDef[];
