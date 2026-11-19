/* eslint-disable @typescript-eslint/no-explicit-any */
/** Purchase Return: list + form (from posted invoice or GRN, partial quantities, reasons). */
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, Eraser, Send, Undo2, XCircle } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column } from '@/components/DataTable';
import { DocSection, DocumentLayout, HeaderSection, NotesSection, TotalsSection } from '@/components/doc';
import { Button } from '@/components/ui';
import { useOpenScreen } from '@/store/workspace';
import { api, apiError } from '@/lib/api';
import { num } from '@/lib/calc';
import { cn } from '@/lib/cn';
import { fmt, r2, today } from '@/lib/format';
import {
  AnyDoc, DocFooter, FDate, FormProvider, FSelect, isoOf, PurchaseList, ReadField, ServerError, StdActions, strOrNull, TransitionDef, useDocForm, useFormContext, useLookups, useRows,
  useWatch, FV,
} from '@/components/purchase/kit';

const REASONS = ['DAMAGED', 'WRONG_ITEM', 'EXCESS_QUANTITY', 'QUALITY_ISSUE', 'WARRANTY', 'OTHER'];
const REASON_OPTIONS = REASONS.map((r) => ({ value: r, label: fmt.status(r) }));

interface RetRow { id: number; docNo: string; docDate: string; supplier?: { name: string }; warehouse?: { name: string }; reason: string; subtotal: number; vatAmount: number; total: number; status: string; invoiceId?: number | null; receiptId?: number | null }

function PurchaseReturnsScreen() {
  const cols: Column<RetRow>[] = [
    { key: 'docNo', header: 'Return No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'supplier.name', header: 'Supplier' },
    { key: 'warehouse.name', header: 'Warehouse' },
    { key: 'invoiceId', header: 'Source', width: 80, accessor: (r) => (r.invoiceId ? 'Invoice' : 'GRN'), sortable: false },
    { key: 'reason', header: 'Reason', type: 'status', width: 130 },
    { key: 'subtotal', header: 'Subtotal', type: 'money', hidden: true },
    { key: 'vatAmount', header: 'VAT', type: 'money', hidden: true },
    { key: 'total', header: 'Total (Base)', type: 'money', total: 'sum' },
    { key: 'status', header: 'Status', type: 'status', width: 100 },
  ];
  return (
    <PurchaseList<RetRow> tableKey="purchase-returns" url="/purchase-returns" title="Purchase Return" formScreen="purchase-return-form" module="purchase_return" newLabel="New Return" columns={cols} statuses={['DRAFT', 'POSTED', 'CANCELLED']}
      selects={[{ key: 'reason', label: 'All reasons', options: REASON_OPTIONS }]} />
  );
}

/* ------------------------------------------------------------------ source picker */
function SourcePicker({ onPick }: { onPick: (s: { invoiceId?: number; receiptId?: number }) => void }) {
  const [mode, setMode] = useState<'INV' | 'GRN'>('INV');
  const invs = useRows<any>('/purchase-invoices', { status: 'POSTED,PARTIALLY_PAID,PAID' }, mode === 'INV');
  const grns = useRows<any>('/goods-receipts', { status: 'POSTED' }, mode === 'GRN');
  const rows = mode === 'INV' ? invs.data ?? [] : grns.data ?? [];
  return (
    <DocSection title="Return goods from..." bodyClassName="p-3">
      <div className="mb-2 flex gap-2">
        <Button variant={mode === 'INV' ? 'primary' : 'default'} onClick={() => setMode('INV')}>Purchase Invoice (creates supplier credit note)</Button>
        <Button variant={mode === 'GRN' ? 'primary' : 'default'} onClick={() => setMode('GRN')}>Goods Receipt (not yet invoiced)</Button>
      </div>
      <table className="w-full text-[13px]">
        <thead><tr className="border-b border-line bg-surface-2 text-left text-xs"><th className="px-3 py-2">{mode === 'INV' ? 'Invoice No' : 'GRN No'}</th><th>Date</th><th>Supplier</th><th className="text-right">{mode === 'INV' ? 'Total (Base)' : 'Value'}</th><th>Status</th><th /></tr></thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id} className="border-b border-line hover:bg-brand-soft">
              <td className="px-3 py-2">{r.docNo}{r.supplierInvoiceNo ? <span className="text-ink-muted"> ({r.supplierInvoiceNo})</span> : null}</td><td>{fmt.date(r.docDate)}</td><td>{r.supplier?.name}</td>
              <td className="text-right tabular-nums">{fmt.money(mode === 'INV' ? r.baseTotal : r.totalValue)}</td><td>{r.status}</td>
              <td className="text-right"><Button size="sm" variant="primary" onClick={() => onPick(mode === 'INV' ? { invoiceId: r.id } : { receiptId: r.id })}>Select</Button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-ink-muted">No documents available.</td></tr>}
        </tbody>
      </table>
    </DocSection>
  );
}

/* ------------------------------------------------------------------ lines */
function ReturnLines({ editable, showInvoiced }: { editable: boolean; showInvoiced: boolean }) {
  const { register, control, setValue, formState } = useFormContext();
  const items = (useWatch({ control, name: 'items' }) as any[] | undefined) ?? [];
  const all = () => items.forEach((l, i) => l.maxQty !== undefined && setValue(`items.${i}.qty`, num(l.maxQty), { shouldDirty: true }));
  const none = () => items.forEach((_l, i) => setValue(`items.${i}.qty`, 0, { shouldDirty: true }));
  const hasMax = items.some((l) => l.maxQty !== undefined);
  return (
    <DocSection title="Items to return (partial quantities allowed)" right={editable && hasMax ? <div className="flex gap-1"><Button size="sm" icon={ArrowDownToLine} onClick={all}>Return full qty</Button><Button size="sm" icon={Eraser} onClick={none}>Clear</Button></div> : undefined} bodyClassName="p-0">
      <div className="overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr className="h-9">
              <th className="grid-th w-8 text-center">#</th><th className="grid-th">Product</th><th className="grid-th">Description</th><th className="grid-th">GRN</th>
              {hasMax && <th className="grid-th !text-right">Received</th>}{hasMax && showInvoiced && <th className="grid-th !text-right">Invoiced</th>}{hasMax && <th className="grid-th !text-right">Max Returnable</th>}
              <th className="grid-th !text-right bg-brand-soft">Return Qty</th><th className="grid-th !text-right">Rate</th><th className="grid-th !text-right">VAT %</th><th className="grid-th !text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l, i) => {
              const over = l.maxQty !== undefined && num(l.qty) > num(l.maxQty) + 0.0005;
              const net = num(l.qty) * num(l.rate);
              return (
                <tr key={l.receiptItemId ?? i} className="h-9 odd:bg-surface even:bg-surface-2">
                  <td className="grid-td text-center text-ink-faint">{i + 1}</td>
                  <td className="grid-td">{l.product?.code}</td><td className="grid-td">{l.product?.name ?? l.description}</td><td className="grid-td">{l.receiptNo}</td>
                  {hasMax && <td className="grid-td text-right tabular-nums">{fmt.qty(l.qtyReceived)}</td>}
                  {hasMax && showInvoiced && <td className="grid-td text-right tabular-nums">{fmt.qty(l.invoicedQty)}</td>}
                  {hasMax && <td className="grid-td text-right tabular-nums">{fmt.qty(l.maxQty)}</td>}
                  <td className="grid-td !p-0 bg-brand-soft text-right">
                    {editable ? (
                      <input type="number" step="any" min={0} className={cn('ctl !h-8 !rounded-none text-right font-semibold tabular-nums', over && '!border-danger text-danger')} title={over ? `Maximum returnable: ${l.maxQty}` : undefined}
                        {...register(`items.${i}.qty`, { setValueAs: (v) => (v === '' || v == null ? 0 : Number(v)) })} onFocus={(e) => e.target.select()} />
                    ) : <span className="block px-2 font-semibold tabular-nums">{fmt.qty(l.qty)}</span>}
                  </td>
                  <td className="grid-td text-right tabular-nums">{fmt.money(l.rate)}</td><td className="grid-td text-right tabular-nums">{fmt.percent(l.vatRate)}</td>
                  <td className="grid-td text-right tabular-nums">{fmt.money(r2(net + (net * num(l.vatRate)) / 100))}</td>
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={11} className="p-4 text-center text-ink-faint">No lines</td></tr>}
          </tbody>
        </table>
      </div>
      {(formState.errors.items as any)?.message && <div className="p-1 text-xs text-danger">{(formState.errors.items as any).message}</div>}
    </DocSection>
  );
}

/* ------------------------------------------------------------------ form */
const schema = z.object({
  docDate: z.string().min(1, 'Date required'),
  reason: z.string().min(1, 'Reason required'),
  items: z.array(z.object({ qty: z.number().min(0) }).passthrough()).min(1, 'No lines')
    .refine((a) => a.some((i: any) => i.qty > 0), { message: 'Enter a return quantity on at least one line' })
    .refine((a) => a.every((i: any) => i.maxQty === undefined || i.qty <= i.maxQty + 0.0005), { message: 'A return quantity exceeds the maximum returnable quantity' }),
}).passthrough();

function PurchaseReturnForm({ params, tabId }: ScreenProps) {
  const open = useOpenScreen();
  const lk = useLookups();
  const [src, setSrc] = useState<{ invoiceId?: number; receiptId?: number }>({
    invoiceId: params.invoiceId ? Number(params.invoiceId) : undefined,
    receiptId: params.receiptId ? Number(params.receiptId) : undefined,
  });
  const isNewDoc = params.id === undefined || params.id === '';
  const hasSrc = !!(src.invoiceId || src.receiptId);
  const prefill = useQuery({
    queryKey: ['return-prefill', src.invoiceId, src.receiptId],
    enabled: isNewDoc && hasSrc,
    queryFn: async () => (await api.get<any>('/purchase-returns/prefill', { params: src.invoiceId ? { invoiceId: src.invoiceId } : { receiptId: src.receiptId } })).data,
  });
  const newValues = useMemo<FV | undefined>(() => {
    const p = prefill.data;
    if (!p) return undefined;
    return { invoiceId: p.invoiceId, receiptId: p.receiptId, docDate: today(), reason: 'DAMAGED', remarks: '', items: (p.items as any[]).map((i) => ({ ...i, qty: 0 })) };
  }, [prefill.data]);
  const ctl = useDocForm({
    url: '/purchase-returns', params, tabId, schema, newValues,
    defaults: { docDate: today(), reason: 'DAMAGED', remarks: '', items: [] },
    toForm: (d) => ({ ...d, docDate: isoOf(d.docDate), remarks: d.remarks ?? '', items: (d.items ?? []).map((i: any) => ({ ...i, qty: num(i.qty), rate: num(i.rate), vatRate: num(i.vatRate) })) }),
  });
  const { doc, form, status, editable } = ctl;
  const r = doc.data as AnyDoc | undefined;
  const items = (useWatch({ control: form.control, name: 'items' }) as any[] | undefined) ?? [];
  const supplierId = r?.supplierId ?? prefill.data?.supplierId;
  const supplier = r?.supplier ?? lk.suppliers.find((s) => s.id === supplierId);
  const sub = r2(items.reduce((s, l) => s + num(l.qty) * num(l.rate), 0));
  const vat = r2(items.reduce((s, l) => s + (num(l.qty) * num(l.rate) * num(l.vatRate)) / 100, 0));
  const invoiceBased = !!(r?.invoiceId ?? src.invoiceId);

  const onSave = ctl.save((v) => ({
    ...(doc.isNew ? { invoiceId: v.invoiceId ?? undefined, receiptId: v.invoiceId ? undefined : v.receiptId ?? undefined } : {}),
    docDate: v.docDate, reason: v.reason, remarks: strOrNull(v.remarks),
    items: (v.items as any[]).filter((i) => i.qty > 0).map((i) => ({ receiptItemId: i.receiptItemId ?? undefined, invoiceItemId: i.invoiceItemId ?? undefined, qty: i.qty })),
  }));
  const transitions: TransitionDef[] = [
    { action: 'post', label: 'Post Return', icon: Send, from: ['DRAFT'], perm: 'post', variant: 'primary', saveFirst: true, ask: { title: 'Post purchase return', message: `Post this return? Stock will be reduced${invoiceBased ? ' and a supplier credit note created' : ''}.`, confirmLabel: 'Post' } },
    { action: 'cancel', label: 'Cancel', icon: XCircle, from: ['DRAFT', 'POSTED'], perm: 'cancel', variant: 'danger', ask: { title: 'Cancel return', danger: true, message: 'Cancel this return? Posted returns restore the stock and reverse the credit note.' } },
  ];

  if (doc.isNew && !hasSrc) {
    return (
      <DocumentLayout title="Purchase Return" icon={Undo2} status="DRAFT">
        <SourcePicker onPick={setSrc} />
      </DocumentLayout>
    );
  }
  return (
    <FormProvider {...form}>
      <DocumentLayout
        title="Purchase Return" icon={Undo2} docNo={r?.docNo} status={status ?? (doc.isNew ? 'DRAFT' : undefined)} loading={doc.isLoading || (doc.isNew && prefill.isLoading)} error={doc.error ?? (prefill.error ? apiError(prefill.error) : undefined)}
        actions={<StdActions ctl={ctl} module="purchase_return" transitions={transitions} onSave={onSave} />}
      >
        <ServerError message={ctl.err} />
        {status === 'POSTED' && <div className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-[13px] text-teal-800">Posted - stock reduced{r?.creditNote ? `; supplier credit note ${r.creditNote.noteNo} for ${fmt.money(r.creditNote.total)}` : ' (goods not yet invoiced: GRNI reversed)'}.</div>}
        <HeaderSection title="Return Information">
          <ReadField label="Return Number" value={r?.docNo ?? '(auto)'} />
          <FDate name="docDate" label="Return Date" required disabled={!editable} />
          <ReadField label="Supplier" value={supplier ? `${supplier.code} - ${supplier.name}` : ''} />
          <FSelect name="reason" label="Return Reason" required options={REASON_OPTIONS} placeholder="Select reason" disabled={!editable} />
          <ReadField label="Purchase Invoice" value={r?.invoice ? <button className="text-brand hover:underline" onClick={() => open('purchase-invoice-form', { id: r.invoice.id }, r.invoice.docNo)}>{r.invoice.docNo}</button> : (src.invoiceId ? `#${src.invoiceId}` : '-')} />
          <ReadField label="Goods Receipt" value={r?.receipt ? <button className="text-brand hover:underline" onClick={() => open('goods-receipt-form', { id: r.receipt.id }, r.receipt.docNo)}>{r.receipt.docNo}</button> : (src.receiptId ? `#${src.receiptId}` : '-')} />
          <ReadField label="Warehouse" value={r?.warehouse?.name ?? ''} />
          <ReadField label="Credit Note" value={r?.creditNote ? r.creditNote.noteNo : '-'} />
        </HeaderSection>
        <ReturnLines editable={editable} showInvoiced={invoiceBased} />
        <TotalsSection totals={{ subtotal: sub, discount: 0, vatAmount: vat, roundOff: 0, total: r2(sub + vat) }} currency="Base" />
        <NotesSection fields={[{ label: 'Remarks', props: { ...form.register('remarks'), disabled: !editable } }]} />
        <DocFooter docType="PURCHASE_RETURN" entity="PurchaseReturn" doc={doc.data} isNew={doc.isNew} approvalDoc={false} />
      </DocumentLayout>
    </FormProvider>
  );
}

export default [
  { id: 'purchase-returns', title: 'Purchase Returns', icon: Undo2, component: PurchaseReturnsScreen, permission: 'purchase_return' },
  { id: 'purchase-return-form', title: 'Purchase Return', icon: Undo2, component: PurchaseReturnForm, multiInstance: true, permission: 'purchase_return' },
] satisfies ScreenDef[];
