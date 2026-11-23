import { RevisionHistory } from '@/components/doc/RevisionHistory';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Ban, Banknote, Printer, Receipt, Save, Send, Trash2, Undo2 } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column } from '@/components/DataTable';
import { ApprovalSection, AttachmentsSection, AuditSection, DocAction, DocActionSep, DocumentFlow, DocumentLayout, DocSection, HeaderSection, TotalsSection } from '@/components/doc';
import { Button, Badge, Checkbox, DateInput, EmptyState, Field, Input, NumberInput, Select, Textarea } from '@/components/ui';
import { useDocument } from '@/hooks/useDocument';
import { usePermission } from '@/store/auth';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { toast } from '@/store/toast';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { calcLine, calcTotals, num } from '@/lib/calc';
import { cn } from '@/lib/cn';
import { AnyRec, InfoBanner, makeSalesList, openPdf, useConfirm, usePaymentTerms, useSalesActions } from '@/components/sales/shared';
import { colCustomer, colDate, colDoc, colMoney, colQty, SourcePicker } from '@/components/sales/SourcePicker';

const URL = '/sales-invoices';
const TYPE = 'SALES_INVOICE';

function NewInvoicePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const openScreen = useOpenScreen();
  const created = (d: AnyRec) => {
    toast.success('Sales invoice created');
    openScreen('sales-invoice-form', { id: d.id }, d.docNo);
  };
  return (
    <SourcePicker
      open={open}
      title="New Sales Invoice - select the document to bill"
      hint={
        <>
          Sales invoices are never typed in: they are generated from a <b>posted delivery note</b> or a <b>confirmed proforma invoice</b> (delivered quantity not yet billed).
          Quantities that are already on another invoice cannot be billed twice. Only documents with billable quantity are listed.
        </>
      }
      onClose={onClose}
      tabs={[
        {
          key: 'dn',
          label: 'Delivery notes',
          url: '/delivery-notes',
          params: { status: 'POSTED', invoiced: 'false' },
          empty: 'No posted delivery notes waiting to be invoiced.',
          columns: [colDoc('Delivery No', 'docNo'), colDate(), { header: 'Proforma', render: (r) => r.proforma?.docNo }, colCustomer, colQty('Qty', 'totalQty'), colQty('Invoiced', 'invoicedQty')],
          actionLabel: 'Create Invoice',
          onPick: async (r) => created((await api.post(`/delivery-notes/${r.id}/create-invoice`, {})).data),
        },
        {
          key: 'pf',
          label: 'Confirmed proformas',
          url: '/proforma-invoices/open',
          filter: (r) => num(r.pendingInvoiceQty) > 0,
          empty: 'No confirmed proformas with delivered-but-unbilled quantity.',
          columns: [colDoc('Proforma No', 'docNo'), colDate(), colCustomer, colQty('To invoice', 'pendingInvoiceQty'), colMoney('Total', 'total')],
          actionLabel: 'Create Invoice',
          onPick: async (r) => created((await api.post(`/proforma-invoices/${r.id}/create-invoice`, {})).data),
        },
      ]}
    />
  );
}

const InvoicesList = makeSalesList<AnyRec>({
  tableKey: 'sales-invoices',
  url: URL,
  exportName: 'Sales Invoices',
  formScreen: 'sales-invoice-form',
  permission: 'sales_invoice',
  newLabel: 'New Invoice',
  statuses: ['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'],
  picker: (p) => <NewInvoicePicker {...p} />,
  rowActions: () => [{ label: 'PDF', icon: Printer, onClick: (r) => openPdf(TYPE, r.id) }],
  columns: [
    { key: 'docNo', header: 'Invoice No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'dueDate', header: 'Due Date', type: 'date', width: 100, sortable: false },
    { key: 'customer.name', header: 'Customer', sortable: false, filter: 'text' },
    { key: 'currencyCode', header: 'Cur.', width: 50, sortable: false, hidden: true },
    { key: 'vatAmount', header: 'VAT', type: 'money', sortable: false, hidden: true },
    { key: 'total', header: 'Total', type: 'money', total: 'sum' },
    { key: 'receivedAmount', header: 'Received', type: 'money', sortable: false, total: 'sum' },
    { key: 'outstanding', header: 'Outstanding', type: 'money', sortable: false, total: 'sum' },
    { key: 'overdueDays', header: 'Overdue', width: 80, sortable: false, cell: (r) => (r.overdue ? <Badge tone="red">{r.overdueDays}d</Badge> : null), exportValue: (r) => (r.overdue ? r.overdueDays : '') },
    { key: 'status', header: 'Status', type: 'status', width: 120 },
  ] as Column<AnyRec>[],
});

interface Edit {
  qty: number;
  rate: number;
  discount: number;
  vatRate: number;
}

function InvoiceForm({ params, tabId }: ScreenProps) {
  const doc = useDocument<AnyRec>(URL, params.id, { tabId });
  const can = usePermission();
  const ws = useWorkspace();
  const confirm = useConfirm();
  const openScreen = useOpenScreen();
  const act = useSalesActions(URL, doc.id, doc.invalidate);
  const terms = usePaymentTerms();
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [head, setHead] = useState({ docDate: '', dueDate: '', paymentTerms: '', remarks: '', roundOff: 0, vatExempt: false });
  const [pickerOpen, setPickerOpen] = useState(false);

  const items = (doc.data?.items as AnyRec[] | undefined) ?? [];
  const status: string = doc.data?.status ?? '';
  const editable = status === 'DRAFT' && can('sales_invoice', 'edit');
  const posted = ['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(status);

  useEffect(() => {
    if (!doc.data) return;
    setEdits(Object.fromEntries(items.map((i) => [i.id, { qty: num(i.qty), rate: num(i.rate), discount: num(i.discount), vatRate: num(i.vatRate) }])));
    setHead({ docDate: fmt.isoDate(doc.data.docDate), dueDate: doc.data.dueDate ? fmt.isoDate(doc.data.dueDate) : '', paymentTerms: doc.data.paymentTerms ?? '', remarks: doc.data.remarks ?? '', roundOff: num(doc.data.roundOff), vatExempt: !!doc.data.vatExempt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.data]);

  const upd = (id: number, patch: Partial<Edit>) => setEdits((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  const lines: AnyRec[] = items.map((i) => {
    const l = { ...i, ...(edits[i.id] ?? { qty: num(i.qty), rate: num(i.rate), discount: num(i.discount), vatRate: num(i.vatRate) }) };
    return head.vatExempt ? { ...l, vatRate: 0 } : l;
  });
  /** Exempt VAT: all lines 0%; unticking restores each product's VAT rate (default 5%) */
  const setExempt = (on: boolean) => {
    setHead((h) => ({ ...h, vatExempt: on }));
    if (!on) setEdits((m) => Object.fromEntries(items.map((i) => [i.id, { ...m[i.id], vatRate: num((i.product as AnyRec | undefined)?.vatRate ?? (num(i.vatRate) || 5)) }])));
  };
  const liveTotals = useMemo(() => calcTotals(lines.filter((l) => num(l.qty) > 0), head.roundOff), [lines, head.roundOff]);
  const totals = editable
    ? liveTotals
    : { subtotal: num(doc.data?.subtotal), discount: num(doc.data?.discount), vatAmount: num(doc.data?.vatAmount), roundOff: num(doc.data?.roundOff), total: num(doc.data?.total) };

  const dirty = useMemo(
    () =>
      !!doc.data &&
      (items.some((i) => {
        const e = edits[i.id];
        return e && (e.qty !== num(i.qty) || e.rate !== num(i.rate) || e.discount !== num(i.discount) || e.vatRate !== num(i.vatRate));
      }) ||
        head.docDate !== fmt.isoDate(doc.data.docDate) ||
        head.dueDate !== (doc.data.dueDate ? fmt.isoDate(doc.data.dueDate) : '') ||
        head.paymentTerms !== (doc.data.paymentTerms ?? '') ||
        head.remarks !== (doc.data.remarks ?? '') ||
        head.roundOff !== num(doc.data.roundOff) ||
        head.vatExempt !== !!doc.data.vatExempt),
    [items, edits, head, doc.data],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!lines.some((l) => num(l.qty) > 0)) throw new Error('An invoice must keep at least one line; cancel it instead');
      return (
        await api.put(`${URL}/${doc.id}`, {
          docDate: head.docDate,
          dueDate: head.dueDate || null,
          paymentTerms: head.paymentTerms || null,
          remarks: head.remarks || null,
          roundOff: head.roundOff,
          vatExempt: head.vatExempt,
          items: items.map((i) => ({ id: i.id, ...edits[i.id] })),
        })
      ).data;
    },
    onSuccess: () => {
      toast.success('Invoice saved');
      doc.invalidate();
    },
    onError: (e) => toast.error(e instanceof Error && !('response' in e) ? e.message : apiError(e)),
  });

  if (doc.isNew) {
    return (
      <DocumentLayout title="Tax Invoice" icon={Receipt}>
        <EmptyState
          title="Sales invoices are generated, not typed in"
          hint="Create them from a posted delivery note, a sales order (delivered quantity) or a proforma invoice - this prevents duplicate billing."
          action={<Button variant="primary" onClick={() => setPickerOpen(true)}>Select document to invoice</Button>}
        />
        <NewInvoicePicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
      <RevisionHistory entity="SalesInvoice" id={doc.id} />
      </DocumentLayout>
    );
  }

  const d = doc.data;
  const link = (screen: string, x?: AnyRec | null) => (
    <button type="button" className="ctl text-left font-semibold text-brand underline" onClick={() => x && openScreen(screen, { id: x.id }, x.docNo)}>{x?.docNo ?? '-'}</button>
  );
  const cur = d?.currencyCode ?? 'AED';
  const outstanding = num(d?.outstanding);
  const journals = (d?.journals as AnyRec[] | undefined) ?? [];

  const doPost = async () => {
    const ok = await confirm.ask(
      <div className="space-y-2">
        <div>Post invoice <b>{d?.docNo}</b> for <b>{fmt.money(d?.total)} {cur}</b>?</div>
        <ul className="list-disc pl-4">
          <li>Dr Customer Receivable / Cr Sales / Cr Output VAT</li>
          <li>Dr Cost of Goods Sold / Cr Inventory</li>
          <li>The invoice can no longer be edited.</li>
        </ul>
      </div>,
      { title: 'Post sales invoice', confirmLabel: 'Post invoice' },
    );
    if (ok) await act.post('post', {}, 'Invoice posted');
  };

  return (
    <>
      {confirm.node}
      <DocumentLayout
        title="Tax Invoice"
        icon={Receipt}
        docNo={d?.docNo}
        status={status}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            <DocAction icon={Save} variant="primary" hidden={!editable} loading={save.isPending} onClick={() => save.mutate()}>Save</DocAction>
            <DocAction icon={Send} variant="primary" hidden={status !== 'DRAFT' || !can('sales_invoice', 'post')} loading={act.busy === 'post'} disabled={dirty} onClick={doPost}>Post</DocAction>
            <DocActionSep />
            <DocAction icon={Printer} onClick={() => openPdf(TYPE, doc.id!)}>PDF / Print</DocAction>
            <DocAction
              icon={Banknote}
              hidden={!['POSTED', 'PARTIALLY_PAID'].includes(status) || !can('receipts', 'create')}
              onClick={() => openScreen('bank-receipt-form', { partyType: 'CUSTOMER', partyId: d?.customerId, invoiceId: d?.id }, 'New Receipt')}
            >
              Receive Payment
            </DocAction>
            <DocAction
              icon={Undo2}
              hidden={!posted || !can('sales_return', 'create')}
              loading={act.busy === 'create-return'}
              onClick={() => act.convert('create-return', 'sales-return-form', 'Sales return created')}
            >
              Create Return
            </DocAction>
            <DocActionSep />
            <DocAction
              icon={Ban}
              hidden={!['DRAFT', 'POSTED'].includes(status) || !can('sales_invoice', 'cancel')}
              loading={act.busy === 'cancel'}
              onClick={async () =>
                (await confirm.ask(status === 'POSTED' ? 'Cancel this POSTED invoice? Its journal entries are reversed and the billed quantity is released.' : 'Cancel this draft invoice? The billed quantity is released.', { danger: true, confirmLabel: 'Cancel invoice' })) &&
                act.post('cancel', {}, 'Invoice cancelled')
              }
            >
              Cancel
            </DocAction>
            <DocAction
              icon={Trash2}
              hidden={status !== 'DRAFT' || !can('sales_invoice', 'delete')}
              onClick={async () => {
                if (!(await confirm.ask('Delete this draft invoice? The billed quantity is released.', { danger: true, confirmLabel: 'Delete' }))) return;
                try {
                  await doc.remove();
                  ws.close(tabId);
                } catch {
                  /* toasted */
                }
              }}
            >
              Delete
            </DocAction>
          </>
        }
      >
        <DocumentFlow docType={TYPE} docId={doc.id} />
        {dirty && editable && <InfoBanner tone="amber">Unsaved changes. Save before posting.</InfoBanner>}
        {d?.overdue && <InfoBanner tone="red">Overdue by {d.overdueDays} day(s). Outstanding {fmt.money(outstanding)} AED.</InfoBanner>}
        {status === 'DRAFT' && <InfoBanner tone="blue">Draft invoice: quantities can only be reduced (the released quantity becomes billable again). Posting books the receivable, sales, output VAT and COGS.</InfoBanner>}

        <HeaderSection title="Tax Invoice Information" columns={4}>
          <Field label="Invoice Number"><Input value={d?.docNo ?? ''} readOnly /></Field>
          <Field label="Invoice Date" required><DateInput value={head.docDate} disabled={!editable} onChange={(e) => setHead({ ...head, docDate: e.target.value })} /></Field>
          <Field label="Due Date"><DateInput value={head.dueDate} disabled={!editable} onChange={(e) => setHead({ ...head, dueDate: e.target.value })} /></Field>
          <Field label="VAT">
            <div className="flex h-9 items-center">
              {editable ? (
                <Checkbox label="Exempt VAT (all lines 0%)" checked={head.vatExempt} onChange={(e) => setExempt(e.target.checked)} />
              ) : head.vatExempt ? (
                <Badge tone="amber">VAT exempt</Badge>
              ) : (
                <span className="text-[13px] text-ink-muted">Standard</span>
              )}
            </div>
          </Field>
          <Field label="Payment Terms">
            <Select key={terms.data?.length ?? 0} value={head.paymentTerms} disabled={!editable} options={terms.data} placeholder="-" onChange={(e) => setHead({ ...head, paymentTerms: e.target.value, dueDate: '' })}>
              {head.paymentTerms && !terms.data?.some((t) => t.value === head.paymentTerms) && <option value={head.paymentTerms}>{head.paymentTerms}</option>}
            </Select>
          </Field>
          <Field label="Customer"><Input value={d?.customer ? `${d.customer.code} - ${d.customer.name}` : ''} readOnly /></Field>
          <Field label="Customer TRN"><Input value={d?.trn ?? d?.customer?.trn ?? ''} readOnly /></Field>
          <Field label="Address" className="col-span-2"><Input value={d?.address ?? ''} readOnly /></Field>
          <Field label="Proforma">{link('proforma-invoice-form', d?.proforma)}</Field>
          <Field label="Delivery Note">{link('delivery-note-form', d?.delivery)}</Field>
          <Field label="Customer PO No"><Input value={d?.salesOrder?.customerPoNo ?? ''} readOnly /></Field>
          <Field label="Currency"><Input value={`${cur}${num(d?.exchangeRate) !== 1 ? ` @ ${d?.exchangeRate}` : ''}`} readOnly /></Field>
        </HeaderSection>

        <DocSection title="Invoice Items">
          <div className="overflow-auto border border-line">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="h-9">
                  <th className="grid-th w-8">#</th>
                  <th className="grid-th">Product</th>
                  <th className="grid-th">OEM</th>
                  <th className="grid-th">Description</th>
                  <th className="grid-th !text-right w-[90px]">Qty</th>
                  <th className="grid-th !text-right w-[100px]">Rate</th>
                  <th className="grid-th !text-right w-[90px]">Discount</th>
                  <th className="grid-th !text-right w-[90px]">VAT %</th>
                  <th className="grid-th !text-right">VAT</th>
                  <th className="grid-th !text-right">Total</th>
                  {posted && <th className="grid-th !text-right">Returned</th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, n) => {
                  const c = calcLine(l);
                  const removed = num(l.qty) <= 0;
                  return (
                    <tr key={l.id} className={cn('h-9 odd:bg-surface even:bg-surface-2', removed && 'opacity-40 line-through')}>
                      <td className="grid-td text-center text-ink-faint">{n + 1}</td>
                      <td className="grid-td font-medium">{l.product?.code}</td>
                      <td className="grid-td">{l.oemNumber}</td>
                      <td className="grid-td">{l.description}</td>
                      <td className="grid-td">
                        <NumberInput min={0} max={num(items[n].qty)} value={l.qty} disabled={!editable} onFocus={(e) => e.target.select()} onChange={(e) => upd(l.id, { qty: Math.min(num(items[n].qty), Number(e.target.value)) })} />
                      </td>
                      <td className="grid-td"><NumberInput min={0} value={l.rate} disabled={!editable} onFocus={(e) => e.target.select()} onChange={(e) => upd(l.id, { rate: Number(e.target.value) })} /></td>
                      <td className="grid-td"><NumberInput min={0} value={l.discount} disabled={!editable} onFocus={(e) => e.target.select()} onChange={(e) => upd(l.id, { discount: Number(e.target.value) })} /></td>
                      <td className="grid-td"><NumberInput min={0} value={l.vatRate} disabled={!editable || head.vatExempt} onFocus={(e) => e.target.select()} onChange={(e) => upd(l.id, { vatRate: Number(e.target.value) })} /></td>
                      <td className="grid-td text-right tabular-nums">{fmt.money(editable ? c.vatAmount : l.vatAmount)}</td>
                      <td className="grid-td text-right font-medium tabular-nums">{fmt.money(editable ? c.amount : l.amount)}</td>
                      {posted && <td className="grid-td text-right tabular-nums">{num(l.returnedQty) > 0 ? fmt.qty(l.returnedQty) : ''}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DocSection>

        <TotalsSection
          totals={totals}
          currency={cur}
          roundOffInput={editable ? <NumberInput className="!h-8 w-24" value={head.roundOff} onChange={(e) => setHead({ ...head, roundOff: Number(e.target.value) })} /> : undefined}
          extra={
            posted
              ? [
                  { label: `Total in base currency (AED)`, value: fmt.money(d?.baseTotal) },
                  { label: 'VAT (AED)', value: fmt.money(d?.vatBase) },
                  { label: 'Received / credited (AED)', value: fmt.money(d?.receivedAmount) },
                  { label: 'Outstanding (AED)', value: <b className={outstanding > 0 ? 'text-danger' : 'text-success'}>{fmt.money(outstanding)}</b> },
                ]
              : undefined
          }
        />

        <DocSection title="Notes">
          <Field label="Remarks"><Textarea rows={2} value={head.remarks} disabled={!editable} onChange={(e) => setHead({ ...head, remarks: e.target.value })} /></Field>
        </DocSection>

        {journals.length > 0 && (
          <DocSection title="Accounting Entries">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="h-8"><th className="grid-th">Journal</th><th className="grid-th">Narration</th><th className="grid-th !text-right">Amount</th><th className="grid-th">Status</th></tr>
              </thead>
              <tbody>
                {journals.map((j) => (
                  <tr key={j.id} className="h-8 odd:bg-surface even:bg-surface-2">
                    <td className="grid-td"><button className="font-semibold text-brand underline" onClick={() => openScreen('journal-voucher-form', { id: j.id }, j.entryNo)}>{j.entryNo}</button></td>
                    <td className="grid-td">{j.narration}</td>
                    <td className="grid-td text-right tabular-nums">{fmt.money(j.totalDebit)}</td>
                    <td className="grid-td">{j.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DocSection>
        )}

        <ApprovalSection approval={d?.approval} onChanged={doc.refetch} />
        <AttachmentsSection docType={TYPE} docId={doc.id} />
        <AuditSection doc={d} />
      <RevisionHistory entity="SalesInvoice" id={doc.id} />
      </DocumentLayout>
    </>
  );
}

export default [
  { id: 'sales-invoices', title: 'Sales Invoices', icon: Receipt, component: InvoicesList, permission: 'sales_invoice' },
  { id: 'sales-invoice-form', title: 'Sales Invoice', icon: Receipt, component: InvoiceForm, multiInstance: true, permission: 'sales_invoice' },
] satisfies ScreenDef[];
