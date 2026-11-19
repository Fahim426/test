import { RevisionHistory } from '@/components/doc/RevisionHistory';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Ban, Check, ClipboardCheck, FilePlus2, Lock, Printer, Save, Send, ShoppingCart, Trash2, Truck, X } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column } from '@/components/DataTable';
import { ApprovalSection, AttachmentsSection, AuditSection, DocAction, DocActionSep, DocumentFlow, DocumentLayout, DocSection } from '@/components/doc';
import { useDocument } from '@/hooks/useDocument';
import { usePermission } from '@/store/auth';
import { useWorkspace } from '@/store/workspace';
import { toast } from '@/store/toast';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { num } from '@/lib/calc';
import { AnyRec, InfoBanner, makeSalesList, openPdf, pctCell, useConfirm, useCopySource, useDirtyTab, useSalesActions, WarningsBanner } from '@/components/sales/shared';
import { tradeBase, tradeBody, tradeDefaults, tradeValues } from '@/components/sales/trade';
import { TradeFormBody } from '@/components/sales/TradeFormBody';
import { StatusBadge } from '@/components/ui';

const URL = '/sales-orders';
const TYPE = 'SALES_ORDER';

/* ---------------------------------- LIST ---------------------------------- */
const OrdersList = makeSalesList<AnyRec>({
  tableKey: 'sales-orders',
  url: URL,
  exportName: 'Sales Orders',
  formScreen: 'sales-order-form',
  permission: 'sales_order',
  newLabel: 'New Order',
  statuses: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'INVOICED', 'CLOSED', 'CANCELLED'],
  columns: [
    { key: 'docNo', header: 'Order No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'customer.name', header: 'Customer', sortable: false, filter: 'text' },
    { key: 'customerPoNo', header: 'Customer PO', width: 110, sortable: false },
    { key: 'salesman.name', header: 'Salesman', sortable: false, hidden: true },
    { key: 'warehouse.name', header: 'Warehouse', sortable: false, hidden: true },
    { key: 'deliveryDate', header: 'Delivery Date', type: 'date', width: 100, sortable: false, hidden: true },
    { key: 'total', header: 'Total', type: 'money', total: 'sum' },
    { key: 'pickedPct', header: 'Picked', width: 110, sortable: false, cell: (r) => pctCell(r.pickedPct), exportValue: (r) => `${r.pickedPct ?? 0}%` },
    { key: 'deliveredPct', header: 'Delivered', width: 110, sortable: false, cell: (r) => pctCell(r.deliveredPct), exportValue: (r) => `${r.deliveredPct ?? 0}%` },
    { key: 'invoicedPct', header: 'Invoiced', width: 110, sortable: false, cell: (r) => pctCell(r.invoicedPct), exportValue: (r) => `${r.invoicedPct ?? 0}%` },
    { key: 'status', header: 'Status', type: 'status', width: 130 },
  ] as Column<AnyRec>[],
  rowActions: (open) => {
    const make = (action: string, screen: string, okMsg: string) => async (r: AnyRec) => {
      try {
        const d = (await api.post(`${URL}/${r.id}/${action}`, {})).data;
        toast.success(okMsg);
        open(screen, { id: d.id }, d.docNo);
      } catch (e) {
        toast.error(apiError(e));
      }
    };
    const live = (r: AnyRec) => ['APPROVED', 'PARTIALLY_DELIVERED'].includes(r.status);
    return [
      { label: 'Create Picking', icon: ClipboardCheck, onClick: make('create-picking', 'picking-form', 'Picking list created'), hidden: (r) => !live(r) },
      { label: 'Create Delivery', icon: Truck, onClick: make('create-delivery', 'delivery-note-form', 'Delivery note created'), hidden: (r) => !live(r) },
      { label: 'Create Invoice', icon: FilePlus2, onClick: make('create-invoice', 'sales-invoice-form', 'Sales invoice created'), hidden: (r) => !['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED'].includes(r.status) },
      { label: 'PDF', icon: Printer, onClick: (r: AnyRec) => openPdf(TYPE, r.id) },
    ];
  },
});

/* ---------------------------------- FORM ---------------------------------- */
const schema = z.object({
  ...tradeBase,
  customerPoNo: z.string().optional().nullable(),
  deliveryDate: z.string().optional().nullable(),
});

function SummaryTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-[110px] border border-app-border bg-white px-3 py-1.5">
      <div className="text-[10px] font-semibold uppercase text-slate-500">{label}</div>
      <div className="text-[15px] font-bold tabular-nums text-slate-800">{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

function OrderForm({ params, tabId }: ScreenProps) {
  const doc = useDocument<AnyRec>(URL, params.id, { tabId });
  const can = usePermission();
  const ws = useWorkspace();
  const confirm = useConfirm();
  const act = useSalesActions(URL, doc.id, doc.invalidate);
  const copy = useCopySource(URL, params, doc.isNew);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const values = useMemo(() => (doc.data ? tradeValues(doc.data) : copy.data ? tradeValues(copy.data, true) : undefined), [doc.data, copy.data]);
  const form = useForm<any>({ resolver: zodResolver(schema), values, defaultValues: { ...tradeDefaults, currencyCode: 'AED', customerPoNo: '', deliveryDate: '' } });
  useDirtyTab(tabId, form.formState.isDirty);

  const status: string = doc.data?.status ?? '';
  const editable = (doc.isNew || status === 'DRAFT') && can('sales_order', doc.isNew ? 'create' : 'edit');
  const summary = doc.data?.summary as AnyRec | undefined;
  const reservations = (doc.data?.reservations as AnyRec[] | undefined) ?? [];
  const showProgress = !doc.isNew && !['DRAFT', 'PENDING_APPROVAL'].includes(status);

  const saveNow = async (): Promise<boolean> => {
    let ok = false;
    await form.handleSubmit(
      async (v) => {
        try {
          const b = tradeBody(v);
          await doc.save({ ...b, customerPoNo: v.customerPoNo || null, deliveryDate: v.deliveryDate || null, quotationId: doc.data?.quotationId ?? undefined, proformaId: doc.data?.proformaId ?? undefined });
          ok = true;
        } catch {
          /* toasted by useDocument */
        }
      },
      () => toast.warning('Please fix the highlighted fields'),
    )();
    return ok;
  };

  /** submit / approve with server warnings + backorder confirmation */
  const workflow = async (kind: 'submit' | 'approve', allowBackorder = false): Promise<void> => {
    if (kind === 'submit' && form.formState.isDirty && editable && !(await saveNow())) return;
    setBusy(true);
    try {
      const r = (await api.post(`${URL}/${doc.id}/${kind}${allowBackorder ? '?allowBackorder=true' : ''}`, {})).data as AnyRec;
      const w: string[] = r.warnings ?? [];
      setWarnings(w);
      w.forEach((m) => toast.warning(m));
      if (kind === 'approve') toast.success('Order approved - stock reserved');
      else toast.success(r.autoApproved ? 'Order approved automatically - stock reserved' : 'Submitted for approval');
      doc.invalidate();
    } catch (e) {
      const msg = apiError(e);
      if (!allowBackorder && /insufficient available stock/i.test(msg)) {
        const yes = await confirm.ask(
          <div className="space-y-2">
            <div>{msg}</div>
            <div className="font-semibold">Proceed as a backorder? Only the stock that is available now will be reserved; the rest stays pending.</div>
          </div>,
          { title: 'Stock shortage', confirmLabel: 'Allow backorder' },
        );
        if (yes) await workflow(kind, true);
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    const r = await act.post('reject', {}, 'Order rejected - returned to draft');
    if (r) setWarnings([]);
  };

  return (
    <FormProvider {...form}>
      {confirm.node}
      <DocumentLayout
        title="Sales Order"
        icon={ShoppingCart}
        docNo={doc.data?.docNo}
        status={status}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            <DocAction icon={Save} variant="primary" hidden={!editable} loading={doc.saving} onClick={saveNow}>Save</DocAction>
            <DocAction icon={Send} hidden={doc.isNew || status !== 'DRAFT' || !can('sales_order', 'edit')} loading={busy} onClick={() => workflow('submit')}>Submit</DocAction>
            <DocAction icon={Check} variant="primary" hidden={status !== 'PENDING_APPROVAL' || !can('sales_order', 'approve')} loading={busy} onClick={() => workflow("approve")}>Approve Order</DocAction>
            <DocAction icon={X} hidden={status !== 'PENDING_APPROVAL' || !can('sales_order', 'reject')} loading={act.busy === 'reject'} onClick={reject}>Reject Order</DocAction>
            <DocActionSep />
            <DocAction
              icon={ClipboardCheck}
              hidden={!['APPROVED', 'PARTIALLY_DELIVERED'].includes(status) || !can('picking', 'create')}
              loading={act.busy === 'create-picking'}
              onClick={() => act.convert('create-picking', 'picking-form', 'Picking list created')}
            >
              Create Picking
            </DocAction>
            <DocAction
              icon={Truck}
              hidden={!['APPROVED', 'PARTIALLY_DELIVERED'].includes(status) || !can('delivery_note', 'create')}
              loading={act.busy === 'create-delivery'}
              onClick={() => act.convert('create-delivery', 'delivery-note-form', 'Delivery note created')}
            >
              Create Delivery
            </DocAction>
            <DocAction
              icon={FilePlus2}
              hidden={!['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED'].includes(status) || !can('sales_invoice', 'create')}
              loading={act.busy === 'create-invoice'}
              onClick={() => act.convert('create-invoice', 'sales-invoice-form', 'Sales invoice created')}
            >
              Create Invoice
            </DocAction>
            <DocActionSep />
            <DocAction
              icon={Lock}
              hidden={!['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'INVOICED'].includes(status) || !can('sales_order', 'edit')}
              loading={act.busy === 'close'}
              onClick={async () => (await confirm.ask('Close this order? Remaining reservations are released and nothing more can be delivered.', { confirmLabel: 'Close order' })) && act.post('close', {}, 'Order closed')}
            >
              Close
            </DocAction>
            <DocAction
              icon={Ban}
              hidden={!['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(status) || doc.isNew || !can('sales_order', 'cancel')}
              loading={act.busy === 'cancel'}
              onClick={async () => (await confirm.ask('Cancel this order? Its reservations are released.', { danger: true, confirmLabel: 'Cancel order' })) && act.post('cancel', {}, 'Order cancelled')}
            >
              Cancel
            </DocAction>
            <DocAction
              icon={Trash2}
              hidden={doc.isNew || status !== 'DRAFT' || !can('sales_order', 'delete')}
              onClick={async () => {
                if (!(await confirm.ask('Delete this draft order permanently?', { danger: true, confirmLabel: 'Delete' }))) return;
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
            <DocAction icon={Printer} hidden={doc.isNew} onClick={() => openPdf(TYPE, doc.id!)}>PDF / Print</DocAction>
          </>
        }
      >
        <WarningsBanner warnings={warnings} onClose={() => setWarnings([])} />
        {status === 'PENDING_APPROVAL' && <InfoBanner tone="amber">This order is waiting for approval. Stock is reserved when the last approval step is approved.</InfoBanner>}
        {summary && showProgress && (
          <div className="flex flex-wrap gap-2">
            <SummaryTile label="Ordered" value={fmt.qty(summary.orderedQty)} />
            <SummaryTile label="Picked" value={fmt.qty(summary.pickedQty)} sub={`${fmt.num(summary.pickedPct, 0)}%`} />
            <SummaryTile label="Delivered" value={fmt.qty(summary.deliveredQty)} sub={`${fmt.num(summary.deliveredPct, 0)}%`} />
            <SummaryTile label="Invoiced" value={fmt.qty(summary.invoicedQty)} sub={`${fmt.num(summary.invoicedPct, 0)}%`} />
          </div>
        )}
        <TradeFormBody
          tabId={tabId}
          docNo={doc.data?.docNo}
          editable={editable}
          isNew={doc.isNew}
          noLabel="Order Number"
          infoTitle="Order Information"
          showSalesman
          showOrderFields
          showRoundOff
          showTerms
          defaultWarehouse
          shortage={editable || status === 'PENDING_APPROVAL'}
          highlightBackorder={showProgress}
          progress={showProgress}
          errors={form.formState.errors}
          afterGrid={
            showProgress && (doc.data?.items as AnyRec[] | undefined)?.some((i) => i.backorder) ? (
              <div className="mt-2 border border-amber-400 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-900">
                <div className="font-semibold">Backorder</div>
                <ul className="list-disc pl-4">
                  {(doc.data!.items as AnyRec[]).filter((i) => i.backorder).map((i) => (
                    <li key={i.id}>{i.product?.code}: {fmt.qty(i.backorderQty)} not reserved (pending {fmt.qty(i.pending)}, reserved {fmt.qty(i.reserved)})</li>
                  ))}
                </ul>
              </div>
            ) : null
          }
        />

        {!doc.isNew && reservations.length > 0 && (
          <DocSection title="Stock Reservations">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="h-6 text-left">
                  <th className="grid-th">Product</th>
                  <th className="grid-th">Warehouse</th>
                  <th className="grid-th !text-right">Reserved</th>
                  <th className="grid-th !text-right">Fulfilled</th>
                  <th className="grid-th !text-right">Outstanding</th>
                  <th className="grid-th">Status</th>
                  <th className="grid-th">Date</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => (
                  <tr key={r.id} className="h-6 odd:bg-white even:bg-slate-50/60">
                    <td className="grid-td">{r.product?.code} - {r.product?.name}</td>
                    <td className="grid-td">{r.warehouse?.name}</td>
                    <td className="grid-td text-right tabular-nums">{fmt.qty(r.qty)}</td>
                    <td className="grid-td text-right tabular-nums">{fmt.qty(r.fulfilledQty)}</td>
                    <td className="grid-td text-right tabular-nums">{fmt.qty(num(r.qty) - num(r.fulfilledQty))}</td>
                    <td className="grid-td"><StatusBadge status={r.status} /></td>
                    <td className="grid-td">{fmt.date(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DocSection>
        )}

        <ApprovalSection approval={doc.data?.approval} onChanged={doc.refetch} />
        <AttachmentsSection docType={TYPE} docId={doc.id} />
        <DocumentFlow docType={TYPE} docId={doc.id} />
        <AuditSection doc={doc.data} />
      <RevisionHistory entity="SalesOrder" id={doc.id} />
      </DocumentLayout>
    </FormProvider>
  );
}

export default [
  { id: 'sales-orders', title: 'Sales Orders', icon: ShoppingCart, component: OrdersList, permission: 'sales_order' },
  { id: 'sales-order-form', title: 'Sales Order', icon: ShoppingCart, component: OrderForm, multiInstance: true, permission: 'sales_order' },
] satisfies ScreenDef[];
