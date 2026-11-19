import { RevisionHistory } from '@/components/doc/RevisionHistory';
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Purchase Invoice: list + form (create from GRN / PO with partial quantities, duplicate-invoicing guards surfaced from the server). */
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Receipt, Send, Undo2, XCircle, FilePlus } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column, RowAction } from '@/components/DataTable';
import { DocAction, DocSection, DocumentLayout, HeaderSection, LineItemsGrid, NotesSection, TotalsSection } from '@/components/doc';
import { Button, DateInput, Field, Input, NumberInput } from '@/components/ui';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { api, apiError } from '@/lib/api';
import { calcLine, calcTotals, num } from '@/lib/calc';
import { fmt, today } from '@/lib/format';
import { toast } from '@/store/toast';
import {
  AnyDoc, DocFooter, FDate, FNum, FormProvider, FText, idOrNull, isoOf, LinkedDocs, PurchaseList, ReadField, ServerError, StdActions, strOrNull, TransitionDef, useDocForm,
  useRows, useWatch, FV,
} from '@/components/purchase/kit';

const STATUSES = ['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'];
interface InvRow { id: number; docNo: string; supplierInvoiceNo?: string; docDate: string; dueDate?: string; supplier?: { name: string }; invoiceType: string; currencyCode: string; total: number; baseTotal: number; paidAmount: number; outstanding: number; status: string }

function PurchaseInvoicesScreen() {
  const can = usePermission();
  const cols: Column<InvRow>[] = [
    { key: 'docNo', header: 'Invoice No', width: 130, filter: 'text' },
    { key: 'supplierInvoiceNo', header: 'Supplier Inv No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'dueDate', header: 'Due Date', type: 'date', width: 100 },
    { key: 'supplier.name', header: 'Supplier' },
    { key: 'invoiceType', header: 'Type', width: 70 },
    { key: 'currencyCode', header: 'Currency', width: 70, hidden: true },
    { key: 'total', header: 'Total', type: 'money', total: 'sum' },
    { key: 'baseTotal', header: 'Total (Base)', type: 'money', total: 'sum', hidden: true },
    { key: 'paidAmount', header: 'Paid', type: 'money', total: 'sum', sortable: false },
    { key: 'outstanding', header: 'Outstanding', type: 'money', total: 'sum', sortable: false },
    { key: 'status', header: 'Status', type: 'status', width: 120 },
  ];
  return (
    <PurchaseList<InvRow>
      tableKey="purchase-invoices" url="/purchase-invoices" title="Purchase Invoice" formScreen="purchase-invoice-form" module="purchase_invoice" newLabel="New Invoice" columns={cols} statuses={STATUSES} pdfType="PURCHASE_INVOICE"
      selects={[{ key: 'invoiceType', label: 'All types', options: [{ value: 'LOCAL', label: 'Local' }, { value: 'IMPORT', label: 'Import' }] }]}
      rowActions={(r, open): RowAction<InvRow>[] => [
        { label: 'Create Return', icon: Undo2, hidden: (x) => !['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(x.status) || !can('purchase_return', 'create'), onClick: () => { open('purchase-return-form', { invoiceId: r.id }, 'New Return'); } },
      ]}
    />
  );
}

/* ------------------------------------------------------------------ create-from-source panel */
function SourcePanel({ params, onCreated }: { params: ScreenProps['params']; onCreated: (inv: AnyDoc) => void }) {
  const [mode, setMode] = useState<'GRN' | 'PO'>(params.orderId && !params.receiptId ? 'PO' : 'GRN');
  const [sel, setSel] = useState<number | undefined>((params.receiptId ?? params.orderId) ? Number(params.receiptId ?? params.orderId) : undefined);
  const [qtys, setQtys] = useState<Record<number, number>>({});
  const [h, setH] = useState({ supplierInvoiceNo: '', docDate: today(), dueDate: '', remarks: '' });
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const grns = useRows<any>('/goods-receipts/pending-invoice', {}, mode === 'GRN');
  const pos = useRows<any>('/purchase-orders', { orderType: 'ALL', status: 'APPROVED,PARTIALLY_RECEIVED,FULLY_RECEIVED,CLOSED,CONFIRMED,PAYMENT_PENDING,IN_TRANSIT,ARRIVED,CUSTOMS,RECEIVED,COMPLETED' }, mode === 'PO');
  const [lines, setLines] = useState<any[]>([]);

  useEffect(() => {
    if (!sel) return;
    let live = true;
    const id = sel;
    const m = mode;
    setErr(undefined);
    (async () => {
      try {
        const d = (await api.get<any>(m === 'GRN' ? `/goods-receipts/${id}` : `/purchase-orders/${id}`)).data;
        const ls = (d.items as any[])
          .map((i) => (m === 'GRN'
            ? { key: i.id, product: i.product, description: i.description, avail: Math.max(0, num(i.qty) - num(i.invoicedQty)), cost: num(i.unitCost), receiptItemId: i.id }
            : { key: i.id, product: i.product, description: i.description, avail: num(i.uninvoicedQty), cost: num(i.rate), orderItemId: i.id }));
        if (!live) return;
        setLines(ls);
        setQtys(Object.fromEntries(ls.map((l) => [l.key, l.avail])));
      } catch (e) {
        if (live) setErr(apiError(e));
      }
    })();
    return () => { live = false; };
  }, [sel, mode]);

  const create = async () => {
    if (!sel) return;
    const items = lines.filter((l) => num(qtys[l.key]) > 0).map((l) => ({ ...(l.receiptItemId ? { receiptItemId: l.receiptItemId } : { orderItemId: l.orderItemId }), qty: num(qtys[l.key]) }));
    if (!items.length) return setErr('Enter a quantity to invoice on at least one line');
    setBusy(true);
    try {
      const inv = (await api.post<AnyDoc>(mode === 'GRN' ? `/goods-receipts/${sel}/create-invoice` : `/purchase-orders/${sel}/create-invoice`, {
        supplierInvoiceNo: strOrNull(h.supplierInvoiceNo), docDate: h.docDate, dueDate: h.dueDate || null, remarks: strOrNull(h.remarks), items,
      })).data;
      toast.success(`Invoice ${inv.docNo} created`);
      onCreated(inv);
    } catch (e) {
      setErr(apiError(e));
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  const list = mode === 'GRN' ? grns.data ?? [] : (pos.data ?? []).filter((p: any) => num(p.receivedQty) > num(p.invoicedQty));
  return (
    <>
      <ServerError message={err} />
      <DocSection title="Create invoice from received goods" bodyClassName="p-3">
        <div className="mb-2 flex items-center gap-2">
          <Button variant={mode === 'GRN' ? 'primary' : 'default'} onClick={() => { setMode('GRN'); setSel(undefined); setLines([]); }}>From Goods Receipt</Button>
          <Button variant={mode === 'PO' ? 'primary' : 'default'} onClick={() => { setMode('PO'); setSel(undefined); setLines([]); }}>From Purchase Order</Button>
          <span className="text-[11px] text-slate-500">Only received and not-yet-invoiced quantities can be invoiced (duplicate invoicing is blocked).</span>
        </div>
        <table className="w-full text-[12px]">
          <thead><tr className="border-b border-app-border bg-app-head text-left text-[11px]"><th className="px-2 py-1">{mode === 'GRN' ? 'GRN No' : 'PO No'}</th><th>Date</th><th>Supplier</th><th className="text-right">{mode === 'GRN' ? 'Pending Qty' : 'Received Qty'}</th><th className="text-right">{mode === 'GRN' ? 'Pending Value' : 'Invoiced Qty'}</th><th /></tr></thead>
          <tbody>
            {list.map((r: any) => (
              <tr key={r.id} className={`border-b border-slate-100 hover:bg-brand-light/40 ${sel === r.id ? 'bg-brand-light' : ''}`}>
                <td className="px-2 py-1">{r.docNo}</td><td>{fmt.date(r.docDate)}</td><td>{r.supplier?.name}</td>
                <td className="text-right tabular-nums">{fmt.qty(mode === 'GRN' ? r.pendingQty : r.receivedQty)}</td>
                <td className="text-right tabular-nums">{mode === 'GRN' ? fmt.money(r.pendingValue) : fmt.qty(r.invoicedQty)}</td>
                <td className="text-right"><Button size="sm" onClick={() => setSel(r.id)}>Select</Button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-500">Nothing waiting to be invoiced.</td></tr>}
          </tbody>
        </table>
      </DocSection>
      {sel && lines.length > 0 && (
        <DocSection title="Quantities to invoice" bodyClassName="p-3">
          <div className="mb-3 grid grid-cols-4 gap-3">
            <Field label="Supplier Invoice No"><Input value={h.supplierInvoiceNo} onChange={(e) => setH({ ...h, supplierInvoiceNo: e.target.value })} /></Field>
            <Field label="Invoice Date"><DateInput value={h.docDate} onChange={(e) => setH({ ...h, docDate: e.target.value })} /></Field>
            <Field label="Due Date" hint="blank = supplier payment terms"><DateInput value={h.dueDate} onChange={(e) => setH({ ...h, dueDate: e.target.value })} /></Field>
            <Field label="Remarks"><Input value={h.remarks} onChange={(e) => setH({ ...h, remarks: e.target.value })} /></Field>
          </div>
          <table className="mb-2 w-full text-[12px]">
            <thead><tr className="border-b border-app-border bg-app-head text-left text-[11px]"><th className="px-2 py-1">Product</th><th>Description</th><th className="text-right">Available to invoice</th><th className="w-[140px] text-right">Invoice Qty</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className="border-b border-slate-100">
                  <td className="px-2 py-1">{l.product?.code}</td><td>{l.product?.name ?? l.description}</td><td className="text-right tabular-nums">{fmt.qty(l.avail)}</td>
                  <td><NumberInput value={qtys[l.key] ?? 0} min={0} onChange={(e) => setQtys({ ...qtys, [l.key]: Number(e.target.value) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button variant="primary" icon={FilePlus} loading={busy} onClick={create}>Create Invoice Draft</Button>
        </DocSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ form */
const schema = z.object({
  docDate: z.string().min(1, 'Date required'),
  items: z.array(z.object({ qty: z.number().positive('Qty must be > 0'), rate: z.number().min(0) }).passthrough()).min(1, 'Add at least one line'),
}).passthrough();

function PurchaseInvoiceForm({ params, tabId }: ScreenProps) {
  const open = useOpenScreen();
  const ws = useWorkspace();
  const can = usePermission();
  const ctl = useDocForm({
    url: '/purchase-invoices', params, tabId, schema,
    defaults: { docDate: today(), dueDate: '', supplierInvoiceNo: '', remarks: '', roundOff: 0, exchangeRate: 1, items: [] },
    toForm: (d) => ({
      ...d, docDate: isoOf(d.docDate), dueDate: isoOf(d.dueDate), supplierInvoiceNo: d.supplierInvoiceNo ?? '', remarks: d.remarks ?? '', roundOff: num(d.roundOff), exchangeRate: num(d.exchangeRate) || 1,
      items: (d.items ?? []).map((i: any) => ({ ...i, qty: num(i.qty), rate: num(i.rate), discount: num(i.discount), vatRate: num(i.vatRate), description: i.description ?? '' })),
    }),
  });
  const { doc, form, status, editable } = ctl;
  const inv = doc.data as AnyDoc | undefined;
  const items = (useWatch({ control: form.control, name: 'items' }) as any[] | undefined) ?? [];
  const roundOff = num(useWatch({ control: form.control, name: 'roundOff' }));
  const supplierInvoiceNo = useWatch({ control: form.control, name: 'supplierInvoiceNo' }) as string;
  const rate = num(inv?.exchangeRate) || 1;
  const totals = calcTotals(items, roundOff);
  const dup = !!ctl.err && /already entered|duplicate|already invoiced|fully invoiced/i.test(ctl.err);

  const onSave = ctl.save((v) => ({
    supplierInvoiceNo: strOrNull(v.supplierInvoiceNo), docDate: v.docDate, dueDate: v.dueDate || null, remarks: strOrNull(v.remarks), roundOff: num(v.roundOff), exchangeRate: v.exchangeRate || undefined,
    items: (v.items as any[]).map((i) => ({
      orderItemId: idOrNull(i.orderItemId), receiptItemId: idOrNull(i.receiptItemId), productId: idOrNull(i.productId), description: strOrNull(i.description), qty: i.qty, unit: strOrNull(i.unit), rate: i.rate, discount: i.discount ?? 0, vatRate: i.vatRate ?? 0,
    })),
  }));
  const transitions: TransitionDef[] = [
    {
      action: 'post', label: 'Post Invoice', icon: Send, from: ['DRAFT'], perm: 'post', variant: 'primary', saveFirst: true,
      guard: () => (supplierInvoiceNo?.trim() ? undefined : 'Enter the supplier invoice number before posting'),
      ask: { title: 'Post purchase invoice', message: 'Post this invoice? It creates the supplier payable (Dr GRNI/Inventory + Input VAT, Cr Supplier Payable).', confirmLabel: 'Post' },
    },
    { action: 'cancel', label: 'Cancel', icon: XCircle, from: ['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID'], perm: 'cancel', variant: 'danger', ask: { title: 'Cancel invoice', danger: true, message: 'Cancel this invoice? Posted invoices are reversed (not possible when payments or returns exist).' } },
  ];

  if (doc.isNew) {
    return (
      <DocumentLayout title="Purchase Invoice" icon={Receipt} status="DRAFT">
        <SourcePanel params={params} onCreated={(i) => ws.retarget(tabId, { id: i.id, title: i.docNo })} />
      <RevisionHistory entity="PurchaseInvoice" id={params.id} />
      </DocumentLayout>
    );
  }

  return (
    <FormProvider {...form}>
      <DocumentLayout
        title={inv?.invoiceType === 'IMPORT' ? 'Import Purchase Invoice' : 'Purchase Invoice'} icon={Receipt} docNo={inv?.docNo} status={status} loading={doc.isLoading} error={doc.error}
        actions={
          <StdActions ctl={ctl} module="purchase_invoice" transitions={transitions} onSave={onSave} pdfType="PURCHASE_INVOICE"
            extra={<DocAction icon={Undo2} hidden={!['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(status ?? '') || !can('purchase_return', 'create')} onClick={() => open('purchase-return-form', { invoiceId: doc.id }, 'New Return')}>Create Return</DocAction>}
          />
        }
      >
        <ServerError message={ctl.err} />
        <HeaderSection title="Invoice Information">
          <ReadField label="Invoice Number" value={inv?.docNo} />
          <FText name="supplierInvoiceNo" label="Supplier Invoice No" required disabled={!editable} hint={dup ? 'Duplicate - see message above' : 'Required before posting; must be unique per supplier'} className={dup ? '[&_input]:!border-red-500' : ''} />
          <FDate name="docDate" label="Invoice Date" required disabled={!editable} />
          <FDate name="dueDate" label="Due Date" disabled={!editable} />
          <ReadField label="Supplier" value={inv?.supplier ? `${inv.supplier.code} - ${inv.supplier.name}` : ''} />
          <ReadField label="Type" value={inv?.invoiceType} />
          <ReadField label="Currency" value={`${inv?.currencyCode ?? ''}${rate !== 1 ? ` @ ${rate}` : ''}`} />
          {editable && rate !== 1 ? <FNum name="exchangeRate" label="Exchange Rate" /> : <ReadField label="Outstanding" value={fmt.money(inv?.outstanding)} />}
          <ReadField label="Purchase Order" value={inv?.order ? <button className="text-brand hover:underline" onClick={() => open(inv.order.orderType === 'IMPORT' ? 'import-purchase-order-form' : 'purchase-order-form', { id: inv.order.id }, inv.order.docNo)}>{inv.order.docNo}</button> : '-'} />
          <ReadField label="Goods Receipt" value={inv?.receipt ? <button className="text-brand hover:underline" onClick={() => open('goods-receipt-form', { id: inv.receipt.id }, inv.receipt.docNo)}>{inv.receipt.docNo}</button> : '-'} />
        </HeaderSection>

        <DocSection title="Items">
          <LineItemsGrid
            readOnly={!editable}
            columns={[
              { key: 'productId', header: 'Product', type: 'product', width: 130, editable: (l: any) => !l.receiptItemId },
              { key: 'description', header: 'Description', type: 'text' },
              { key: 'qty', header: 'Qty', type: 'qty', width: 80, total: true },
              { key: 'unit', header: 'Unit', type: 'text', width: 60, editable: (l: any) => !l.receiptItemId },
              { key: 'rate', header: 'Rate', type: 'money', width: 100 },
              { key: 'discount', header: 'Discount', type: 'money', width: 85 },
              { key: 'vatRate', header: 'VAT %', type: 'percent', width: 60 },
              { key: 'amount', header: 'Amount', type: 'computed', width: 110, total: true, compute: (l) => calcLine(l).amount },
            ]}
            newLine={() => ({ qty: 1, rate: 0, discount: 0, vatRate: 5, unit: '', description: '' })}
            footerExtra={<span className="text-[10px] text-slate-500">Lines linked to a goods receipt keep their receipt reference; quantity cannot exceed what is received and not yet invoiced.</span>}
          />
          {(form.formState.errors.items as any)?.message && <div className="p-1 text-[11px] text-red-600">{(form.formState.errors.items as any).message}</div>}
        </DocSection>

        <TotalsSection
          totals={totals} currency={inv?.currencyCode}
          roundOffInput={<NumberInput className="w-[100px]" disabled={!editable} {...form.register('roundOff', { setValueAs: (v) => (v === '' || v == null ? 0 : Number(v)) })} />}
          extra={[
            ...(rate !== 1 ? [{ label: `Total in base currency @ ${rate}`, value: fmt.money(inv?.baseTotal ?? totals.total * rate) }] : []),
            ...(['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(status ?? '') ? [{ label: 'Paid / credited', value: fmt.money(inv?.paidAmount) }, { label: 'Outstanding', value: fmt.money(inv?.outstanding) }] : []),
          ]}
        />
        <NotesSection fields={[{ label: 'Remarks', props: { ...form.register('remarks'), disabled: !editable } }]} />
        <LinkedDocs title="Purchase Returns" docs={(inv?.returns ?? []).map((r: any) => ({ screenId: 'purchase-return-form', id: r.id, label: r.docNo, status: r.status, extra: fmt.money(r.total) }))} />
        {(inv?.payments ?? []).length > 0 && (
          <DocSection title="Payments">
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-app-border text-left text-[11px] text-slate-500"><th className="py-0.5">Voucher</th><th>Date</th><th>Mode</th><th className="text-right">Allocated</th></tr></thead>
              <tbody>{inv!.payments.map((p: any) => <tr key={p.id} className="border-b border-slate-100"><td className="py-0.5">{p.voucher?.voucherNo}</td><td>{fmt.date(p.voucher?.voucherDate)}</td><td>{p.voucher?.mode}</td><td className="text-right tabular-nums">{fmt.money(p.amount)}</td></tr>)}</tbody>
            </table>
          </DocSection>
        )}
        <DocFooter docType="PURCHASE_INVOICE" entity="PurchaseInvoice" doc={doc.data} isNew={doc.isNew} approvalDoc={false} />
      <RevisionHistory entity="PurchaseInvoice" id={params.id} />
      </DocumentLayout>
    </FormProvider>
  );
}

export default [
  { id: 'purchase-invoices', title: 'Purchase Invoices', icon: Receipt, component: PurchaseInvoicesScreen, permission: 'purchase_invoice' },
  { id: 'purchase-invoice-form', title: 'Purchase Invoice', icon: Receipt, component: PurchaseInvoiceForm, multiInstance: true, permission: 'purchase_invoice' },
] satisfies ScreenDef[];
