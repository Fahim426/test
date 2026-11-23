import { RevisionHistory } from '@/components/doc/RevisionHistory';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Ban, Check, CheckCircle2, FilePlus2, FileText, Printer, RotateCcw, Save, Send, Trash2, Truck, X } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column } from '@/components/DataTable';
import { ApprovalSection, AttachmentsSection, AuditSection, DocAction, DocActionSep, DocumentFlow, DocumentLayout } from '@/components/doc';
import { Badge, type Tone } from '@/components/ui';
import { num } from '@/lib/calc';
import { fmt } from '@/lib/format';
import { useDocument } from '@/hooks/useDocument';
import { usePermission } from '@/store/auth';
import { useWorkspace } from '@/store/workspace';
import { toast } from '@/store/toast';
import { makeSalesList, openPdf, useConfirm, useCopySource, useDirtyTab, useSalesActions, AnyRec } from '@/components/sales/shared';
import { tradeBase, tradeBody, tradeDefaults, tradeValues } from '@/components/sales/trade';
import { TradeFormBody } from '@/components/sales/TradeFormBody';

/* =============================== QUOTATIONS =============================== */
const QuotationsList = makeSalesList<AnyRec>({
  tableKey: 'sales-quotations',
  url: '/sales-quotations',
  exportName: 'Sales Quotations',
  formScreen: 'sales-quotation-form',
  permission: 'sales_quotation',
  newLabel: 'New Quotation',
  statuses: ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'PARTIALLY_CONVERTED', 'CONVERTED', 'CANCELLED'],
  columns: [
    { key: 'docNo', header: 'Quotation No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'validUntil', header: 'Valid Until', type: 'date', width: 100, sortable: false },
    { key: 'customer.name', header: 'Customer', sortable: false, filter: 'text' },
    { key: 'salesman.name', header: 'Salesman', sortable: false, hidden: true },
    { key: 'warehouse.name', header: 'Warehouse', sortable: false, hidden: true },
    { key: 'currencyCode', header: 'Cur.', width: 50, sortable: false },
    { key: 'subtotal', header: 'Subtotal', type: 'money', sortable: false, hidden: true },
    { key: 'vatAmount', header: 'VAT', type: 'money', sortable: false, hidden: true },
    { key: 'total', header: 'Total', type: 'money', total: 'sum' },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
  ] as Column<AnyRec>[],
  rowActions: () => [
    { label: 'PDF', icon: Printer, onClick: (r) => openPdf('SALES_QUOTATION', r.id) },
  ],
});

const quotationSchema = z.object({ ...tradeBase, validUntil: z.string().optional().nullable() });

function QuotationForm({ params, tabId }: ScreenProps) {
  const URL = '/sales-quotations';
  const doc = useDocument<AnyRec>(URL, params.id, { tabId });
  const can = usePermission();
  const ws = useWorkspace();
  const confirm = useConfirm();
  const act = useSalesActions(URL, doc.id, doc.invalidate);
  const copy = useCopySource(URL, params, doc.isNew);
  const values = useMemo(() => (doc.data ? tradeValues(doc.data) : copy.data ? tradeValues(copy.data, true) : undefined), [doc.data, copy.data]);
  const form = useForm<any>({ resolver: zodResolver(quotationSchema), values, defaultValues: { ...tradeDefaults, currencyCode: 'AED', validUntil: '' } });
  useDirtyTab(tabId, form.formState.isDirty);

  const status: string | undefined = doc.data?.status;
  const editable = (doc.isNew || status === 'DRAFT') && can('sales_quotation', doc.isNew ? 'create' : 'edit');
  const st = status ?? '';

  const save = form.handleSubmit(
    async (v) => {
      try {
        await doc.save({ ...tradeBody(v), validUntil: v.validUntil || null });
      } catch {
        /* toasted */
      }
    },
    () => toast.warning('Please fix the highlighted fields'),
  );

  return (
    <FormProvider {...form}>
      {confirm.node}
      <DocumentLayout
        title="Sales Quotation"
        icon={FileText}
        docNo={doc.data?.docNo}
        status={status}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            <DocAction icon={Save} variant="primary" hidden={!editable} loading={doc.saving} onClick={save}>Save</DocAction>
            <DocAction icon={Send} hidden={doc.isNew || st !== 'DRAFT'} loading={act.busy === 'send'} onClick={() => act.post('send', {}, 'Quotation marked as sent')}>Send</DocAction>
            <DocAction icon={Check} hidden={doc.isNew || st !== 'SENT'} loading={act.busy === 'accept'} onClick={() => act.post('accept', {}, 'Quotation accepted')}>Accept</DocAction>
            <DocAction icon={X} hidden={doc.isNew || !['SENT', 'ACCEPTED'].includes(st)} loading={act.busy === 'reject'} onClick={() => act.post('reject', {}, 'Quotation rejected')}>Reject</DocAction>
            <DocActionSep />
            <DocAction
              icon={FilePlus2}
              variant="primary"
              hidden={doc.isNew || !['DRAFT', 'SENT', 'ACCEPTED', 'PARTIALLY_CONVERTED', 'CONVERTED'].includes(st) || !can('proforma_invoice', 'create')}
              loading={act.busy === 'create-proforma'}
              onClick={() => act.convert('create-proforma', 'proforma-invoice-form', 'Proforma invoice created')}
            >
              Create Proforma
            </DocAction>
            <DocActionSep />
            <DocAction icon={RotateCcw} hidden={doc.isNew || !['REJECTED', 'EXPIRED', 'CANCELLED'].includes(st)} loading={act.busy === 'reopen'} onClick={() => act.post('reopen', {}, 'Quotation reopened as draft')}>Reopen</DocAction>
            <DocAction
              icon={Ban}
              hidden={doc.isNew || !['DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED'].includes(st) || !can('sales_quotation', 'cancel')}
              loading={act.busy === 'cancel'}
              onClick={async () => (await confirm.ask('Cancel this quotation?', { danger: true, confirmLabel: 'Cancel quotation' })) && act.post('cancel', {}, 'Quotation cancelled')}
            >
              Cancel
            </DocAction>
            <DocAction
              icon={Trash2}
              hidden={doc.isNew || st !== 'DRAFT' || !can('sales_quotation', 'delete')}
              onClick={async () => {
                if (!(await confirm.ask('Delete this draft quotation permanently?', { danger: true, confirmLabel: 'Delete' }))) return;
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
            <DocAction icon={Printer} hidden={doc.isNew} onClick={() => openPdf('SALES_QUOTATION', doc.id!)}>PDF / Print</DocAction>
          </>
        }
      >
        <DocumentFlow docType="SALES_QUOTATION" docId={doc.id} />
        <TradeFormBody
          tabId={tabId}
          docNo={doc.data?.docNo}
          editable={editable}
          isNew={doc.isNew}
          noLabel="Quotation Number"
          infoTitle="Quotation Information"
          showSalesman
          showValidUntil
          showRoundOff
          showTerms
          shortage={editable || ['SENT', 'ACCEPTED'].includes(st)}
          errors={form.formState.errors}
        />
        <ApprovalSection approval={doc.data?.approval} onChanged={doc.refetch} />
        <AttachmentsSection docType="SALES_QUOTATION" docId={doc.id} />
        <AuditSection doc={doc.data} />
      <RevisionHistory entity="SalesQuotation" id={doc.id} />
      </DocumentLayout>
    </FormProvider>
  );
}

/* =============================== PROFORMA =============================== */
const ORDER_STATE: Record<string, { label: string; tone: Tone }> = {
  PENDING_APPROVAL: { label: 'Awaiting approval', tone: 'amber' },
  APPROVED: { label: 'Confirmed · stock reserved', tone: 'green' },
  PARTIALLY_DELIVERED: { label: 'Partially delivered', tone: 'blue' },
  DELIVERED: { label: 'Delivered', tone: 'green' },
  INVOICED: { label: 'Invoiced', tone: 'green' },
  CLOSED: { label: 'Closed', tone: 'gray' },
};

/** Delivery / invoicing progress of a confirmed proforma: one slim line. */
function OrderProgress({ order }: { order: AnyRec }) {
  const s = ORDER_STATE[order.status] ?? { label: order.status, tone: 'gray' as Tone };
  const item = (label: string, v: unknown, pct?: unknown) => (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-ink-faint">{label}</span>
      <b className="tabular-nums text-ink">{fmt.qty(v)}</b>
      {pct !== undefined && <span className="text-[11px] text-ink-faint">({num(pct)}%)</span>}
    </span>
  );
  return (
    <section className="flex min-h-[30px] flex-wrap items-center gap-x-5 gap-y-1 rounded-card border border-line bg-surface px-3 py-1.5 text-[12px] shadow-card">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Order</span>
      <Badge tone={s.tone}>{s.label}</Badge>
      {item('Ordered', order.orderedQty)}
      {item('Delivered', order.deliveredQty, order.deliveredPct)}
      {item('Invoiced', order.invoicedQty, order.invoicedPct)}
      {item('To deliver', order.pendingDeliveryQty)}
      {item('Delivered, not invoiced', order.pendingInvoiceQty)}
    </section>
  );
}

const ProformaList = makeSalesList<AnyRec>({
  tableKey: 'proforma-invoices',
  url: '/proforma-invoices',
  exportName: 'Proforma Invoices',
  formScreen: 'proforma-invoice-form',
  permission: 'proforma_invoice',
  newLabel: 'New Proforma',
  statuses: ['DRAFT', 'ISSUED', 'PARTIALLY_CONVERTED', 'CONVERTED', 'INVOICED', 'CANCELLED'],
  columns: [
    { key: 'docNo', header: 'Proforma No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'customer.name', header: 'Customer', sortable: false, filter: 'text' },
    { key: 'warehouse.name', header: 'Warehouse', sortable: false, hidden: true },
    { key: 'currencyCode', header: 'Cur.', width: 50, sortable: false },
    { key: 'paymentTerms', header: 'Payment Terms', sortable: false, hidden: true },
    { key: 'total', header: 'Total', type: 'money', total: 'sum' },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
  ] as Column<AnyRec>[],
});

const proformaSchema = z.object({ ...tradeBase });

function ProformaForm({ params, tabId }: ScreenProps) {
  const URL = '/proforma-invoices';
  const doc = useDocument<AnyRec>(URL, params.id, { tabId });
  const can = usePermission();
  const ws = useWorkspace();
  const confirm = useConfirm();
  const act = useSalesActions(URL, doc.id, doc.invalidate);
  const copy = useCopySource(URL, params, doc.isNew);
  const values = useMemo(() => (doc.data ? tradeValues(doc.data) : copy.data ? tradeValues(copy.data, true) : undefined), [doc.data, copy.data]);
  const form = useForm<any>({ resolver: zodResolver(proformaSchema), values, defaultValues: { ...tradeDefaults, currencyCode: 'AED' } });
  useDirtyTab(tabId, form.formState.isDirty);

  const status: string | undefined = doc.data?.status;
  const st = status ?? '';
  const editable = (doc.isNew || st === 'DRAFT') && can('proforma_invoice', doc.isNew ? 'create' : 'edit');
  /** the (hidden) sales order behind a confirmed proforma */
  const order: AnyRec | null = doc.data?.order ?? null;

  const confirmOrder = async () => {
    if (form.formState.isDirty) return toast.warning('Save the proforma first');
    if (!(await confirm.ask('Confirm this proforma as the customer order? Stock is reserved (after approval, if required) and it can no longer be edited.', { confirmLabel: 'Confirm order' }))) return;
    const r = await act.post<AnyRec>('confirm', {});
    if (!r) return;
    (r.warnings ?? []).forEach((w: string) => toast.warning(w));
    toast.success(r.autoApproved ? 'Order confirmed and stock reserved' : 'Order confirmed and sent for approval');
  };

  const save = form.handleSubmit(
    async (v) => {
      try {
        const b = tradeBody(v);
        await doc.save({ ...b, quotationId: doc.data?.quotationId ?? undefined });
      } catch {
        /* toasted */
      }
    },
    () => toast.warning('Please fix the highlighted fields'),
  );

  return (
    <FormProvider {...form}>
      {confirm.node}
      <DocumentLayout
        title="Proforma Invoice"
        icon={FileText}
        docNo={doc.data?.docNo}
        status={status}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            <DocAction icon={Save} variant="primary" hidden={!editable} loading={doc.saving} onClick={save}>Save</DocAction>
            <DocAction icon={Send} hidden={doc.isNew || st !== 'DRAFT'} loading={act.busy === 'issue'} onClick={() => act.post('issue', {}, 'Proforma issued')}>Issue</DocAction>
            <DocActionSep />
            <DocAction
              icon={CheckCircle2}
              variant="primary"
              hidden={doc.isNew || !['DRAFT', 'ISSUED'].includes(st) || !can('proforma_invoice', 'edit')}
              loading={act.busy === 'confirm'}
              onClick={confirmOrder}
            >
              Confirm Order
            </DocAction>
            <DocAction
              icon={Truck}
              variant="primary"
              hidden={!order || !['APPROVED', 'PARTIALLY_DELIVERED'].includes(order.status) || !can('delivery_note', 'create')}
              loading={act.busy === 'create-delivery'}
              onClick={() => act.convert('create-delivery', 'delivery-note-form', 'Delivery note created')}
            >
              Create Delivery
            </DocAction>
            <DocAction
              icon={FilePlus2}
              hidden={!order || num(order.pendingInvoiceQty) <= 0 || !can('sales_invoice', 'create')}
              loading={act.busy === 'create-invoice'}
              onClick={() => act.convert('create-invoice', 'sales-invoice-form', 'Sales invoice created')}
            >
              Create Invoice
            </DocAction>
            <DocActionSep />
            <DocAction
              icon={Ban}
              hidden={doc.isNew || !['DRAFT', 'ISSUED', 'PARTIALLY_CONVERTED', 'CONVERTED'].includes(st) || (order && num(order.deliveredQty) > 0) || !can('proforma_invoice', 'cancel')}
              loading={act.busy === 'cancel'}
              onClick={async () =>
                (await confirm.ask(order ? 'Cancel this proforma? Its order is cancelled and the reserved stock is released.' : 'Cancel this proforma invoice?', { danger: true, confirmLabel: 'Cancel proforma' })) &&
                act.post('cancel', {}, 'Proforma cancelled')
              }
            >
              Cancel
            </DocAction>
            <DocAction
              icon={Trash2}
              hidden={doc.isNew || st !== 'DRAFT' || !can('proforma_invoice', 'delete')}
              onClick={async () => {
                if (!(await confirm.ask('Delete this draft proforma permanently?', { danger: true, confirmLabel: 'Delete' }))) return;
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
        <DocumentFlow docType="PROFORMA_INVOICE" docId={doc.id} />
        {order && <OrderProgress order={order} />}
        <TradeFormBody
          tabId={tabId}
          docNo={doc.data?.docNo}
          editable={editable}
          isNew={doc.isNew}
          noLabel="Proforma Number"
          infoTitle="Proforma Information"
          shortage={editable || st === 'ISSUED'}
          errors={form.formState.errors}
        />
        <ApprovalSection approval={doc.data?.approval} onChanged={doc.refetch} />
        {order?.approval && <ApprovalSection approval={order.approval} onChanged={doc.refetch} />}
        <AttachmentsSection docType="PROFORMA_INVOICE" docId={doc.id} />
        <AuditSection doc={doc.data} />
      <RevisionHistory entity="ProformaInvoice" id={doc.id} />
      </DocumentLayout>
    </FormProvider>
  );
}

export default [
  { id: 'sales-quotations', title: 'Sales Quotations', icon: FileText, component: QuotationsList, permission: 'sales_quotation' },
  { id: 'sales-quotation-form', title: 'Sales Quotation', icon: FileText, component: QuotationForm, multiInstance: true, permission: 'sales_quotation' },
  { id: 'proforma-invoices', title: 'Proforma Invoices', icon: FileText, component: ProformaList, permission: 'proforma_invoice' },
  { id: 'proforma-invoice-form', title: 'Proforma Invoice', icon: FileText, component: ProformaForm, multiInstance: true, permission: 'proforma_invoice' },
] satisfies ScreenDef[];
