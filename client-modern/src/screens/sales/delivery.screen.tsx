import { RevisionHistory } from '@/components/doc/RevisionHistory';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, FilePlus2, Printer, Save, Send, Trash2, Truck } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column } from '@/components/DataTable';
import { AttachmentsSection, AuditSection, DocAction, DocActionSep, DocumentFlow, DocumentLayout, DocSection, HeaderSection } from '@/components/doc';
import { Button, DateInput, EmptyState, Field, Input, NumberInput, StatusBadge, Textarea } from '@/components/ui';
import { useDocument } from '@/hooks/useDocument';
import { usePermission } from '@/store/auth';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { toast } from '@/store/toast';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { num } from '@/lib/calc';
import { cn } from '@/lib/cn';
import { AnyRec, InfoBanner, makeSalesList, openPdf, useConfirm, useSalesActions } from '@/components/sales/shared';
import { colCustomer, colDate, colDoc, colQty, SourcePicker } from '@/components/sales/SourcePicker';

const URL = '/delivery-notes';
const TYPE = 'DELIVERY_NOTE';

function NewDeliveryPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const openScreen = useOpenScreen();
  const created = (d: AnyRec) => {
    toast.success('Delivery note created');
    openScreen('delivery-note-form', { id: d.id }, d.docNo);
  };
  return (
    <SourcePicker
      open={open}
      title="New Delivery Note - select the source"
      hint="Delivery notes are created from a confirmed proforma invoice. Partial delivery is supported: edit the quantities on the draft."
      onClose={onClose}
      tabs={[
        {
          key: 'pf',
          label: 'Confirmed proformas',
          url: '/proforma-invoices/open',
          filter: (r) => num(r.pendingDeliveryQty) > 0 && ['APPROVED', 'PARTIALLY_DELIVERED'].includes(r.orderStatus),
          empty: 'No confirmed proformas with quantity left to deliver.',
          columns: [colDoc('Proforma No', 'docNo'), colDate(), colCustomer, colQty('Pending Delivery', 'pendingDeliveryQty'), { header: 'Status', render: (r) => <StatusBadge status={r.orderStatus} /> }],
          actionLabel: 'Create Delivery',
          onPick: async (r) => created((await api.post(`/proforma-invoices/${r.id}/create-delivery`, {})).data),
        },
      ]}
    />
  );
}

const DeliveryList = makeSalesList<AnyRec>({
  tableKey: 'delivery-notes',
  url: URL,
  exportName: 'Delivery Notes',
  formScreen: 'delivery-note-form',
  permission: 'delivery_note',
  newLabel: 'New Delivery Note',
  statuses: ['DRAFT', 'POSTED', 'CANCELLED'],
  picker: (p) => <NewDeliveryPicker {...p} />,
  rowActions: () => [{ label: 'PDF', icon: Printer, onClick: (r) => openPdf(TYPE, r.id) }],
  columns: [
    { key: 'docNo', header: 'Delivery No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'proforma.docNo', header: 'Proforma', width: 130, sortable: false },
    { key: 'customer.name', header: 'Customer', sortable: false, filter: 'text' },
    { key: 'warehouse.name', header: 'Warehouse', sortable: false, hidden: true },
    { key: 'driver', header: 'Driver', sortable: false, hidden: true },
    { key: 'vehicleNo', header: 'Vehicle', sortable: false, hidden: true },
    { key: 'totalQty', header: 'Qty', type: 'qty', sortable: false, total: 'sum' },
    { key: 'invoicedQty', header: 'Invoiced Qty', type: 'qty', sortable: false },
    { key: 'invoiced', header: 'Invoiced', type: 'boolean', width: 80, sortable: false },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
  ] as Column<AnyRec>[],
});

function DeliveryForm({ params, tabId }: ScreenProps) {
  const doc = useDocument<AnyRec>(URL, params.id, { tabId });
  const can = usePermission();
  const ws = useWorkspace();
  const confirm = useConfirm();
  const openScreen = useOpenScreen();
  const act = useSalesActions(URL, doc.id, doc.invalidate);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [head, setHead] = useState({ docDate: '', deliveryAddress: '', driver: '', vehicleNo: '', remarks: '' });
  const [pickerOpen, setPickerOpen] = useState(false);

  const items = (doc.data?.items as AnyRec[] | undefined) ?? [];
  const status: string = doc.data?.status ?? '';
  const editable = status === 'DRAFT' && can('delivery_note', 'edit');

  useEffect(() => {
    if (!doc.data) return;
    setQty(Object.fromEntries(items.map((i) => [i.id, num(i.qty)])));
    setHead({ docDate: fmt.isoDate(doc.data.docDate), deliveryAddress: doc.data.deliveryAddress ?? '', driver: doc.data.driver ?? '', vehicleNo: doc.data.vehicleNo ?? '', remarks: doc.data.remarks ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.data]);

  const productIds = [...new Set(items.map((i) => i.productId))].join(',');
  const whId = doc.data?.warehouseId;
  const stock = useQuery({
    queryKey: ['dn-stock', productIds, whId],
    enabled: status === 'DRAFT' && !!productIds,
    queryFn: async () => {
      const d = (await api.get('/sales/availability', { params: { productId: productIds, warehouseId: whId } })).data;
      const arr: AnyRec[] = Array.isArray(d) ? d : [d];
      return new Map(arr.map((a) => [a.productId as number, a]));
    },
  });

  const dirty = useMemo(
    () =>
      !!doc.data &&
      (items.some((i) => num(qty[i.id]) !== num(i.qty)) ||
        head.deliveryAddress !== (doc.data.deliveryAddress ?? '') ||
        head.driver !== (doc.data.driver ?? '') ||
        head.vehicleNo !== (doc.data.vehicleNo ?? '') ||
        head.remarks !== (doc.data.remarks ?? '')),
    [items, qty, head, doc.data],
  );

  const save = useMutation({
    mutationFn: async () => {
      const lines = items.map((i) => ({ orderItemId: i.orderItemId, qty: num(qty[i.id]) })).filter((l) => l.qty > 0);
      if (!lines.length) throw new Error('At least one line needs a quantity greater than zero');
      return (await api.put(`${URL}/${doc.id}`, { docDate: head.docDate || undefined, deliveryAddress: head.deliveryAddress || null, driver: head.driver || null, vehicleNo: head.vehicleNo || null, remarks: head.remarks || null, items: lines })).data;
    },
    onSuccess: () => {
      toast.success('Delivery note saved');
      doc.invalidate();
    },
    onError: (e) => toast.error(e instanceof Error && !('response' in e) ? e.message : apiError(e)),
  });

  const post = async () => {
    const total = items.reduce((s, i) => s + num(qty[i.id]), 0);
    const ok = await confirm.ask(
      <div className="space-y-2">
        <div>Post delivery note <b>{doc.data?.docNo}</b>?</div>
        <ul className="list-disc pl-4">
          <li>Physical stock decreases by <b>{fmt.qty(total)}</b> unit(s) in {doc.data?.warehouse?.name ?? 'the warehouse'} (stock transactions are created).</li>
          <li>The stock reserved for the proforma is used for these units.</li>
          <li>The delivery can no longer be edited (it can be cancelled to reverse the stock movement).</li>
        </ul>
      </div>,
      { title: 'Post delivery - stock decreases', confirmLabel: 'Post delivery' },
    );
    if (ok) await act.post('post', {}, 'Delivery posted - stock decreased');
  };

  if (doc.isNew) {
    return (
      <DocumentLayout title="Delivery Note" icon={Truck}>
        <EmptyState title="Delivery notes are created from a confirmed proforma invoice" hint="Use Create Delivery on the proforma, or choose it below." action={<Button variant="primary" onClick={() => setPickerOpen(true)}>Select source</Button>} />
        <NewDeliveryPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
      <RevisionHistory entity="DeliveryNote" id={doc.id} />
      </DocumentLayout>
    );
  }

  const link = (screen: string, d?: AnyRec | null) => (
    <button type="button" className="ctl text-left font-semibold text-brand underline" onClick={() => d && openScreen(screen, { id: d.id }, d.docNo)}>{d?.docNo ?? '-'}</button>
  );
  const posted = status === 'POSTED';
  return (
    <>
      {confirm.node}
      <DocumentLayout
        title="Delivery Note"
        icon={Truck}
        docNo={doc.data?.docNo}
        status={status}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            <DocAction icon={Save} variant="primary" hidden={!editable} loading={save.isPending} onClick={() => save.mutate()}>Save</DocAction>
            <DocAction icon={Send} variant="primary" hidden={status !== 'DRAFT' || !can('delivery_note', 'post')} loading={act.busy === 'post'} disabled={dirty} onClick={post}>Post Delivery</DocAction>
            <DocAction
              icon={FilePlus2}
              hidden={!posted || !!doc.data?.invoiced || !can('sales_invoice', 'create')}
              loading={act.busy === 'create-invoice'}
              onClick={() => act.convert('create-invoice', 'sales-invoice-form', 'Sales invoice created')}
            >
              Create Invoice
            </DocAction>
            <DocActionSep />
            <DocAction
              icon={Ban}
              hidden={!['DRAFT', 'POSTED'].includes(status) || !can('delivery_note', 'cancel')}
              loading={act.busy === 'cancel'}
              onClick={async () =>
                (await confirm.ask(posted ? 'Cancel this POSTED delivery? Stock is returned to the warehouse and the reservation is re-instated.' : 'Cancel this draft delivery note?', { danger: true, confirmLabel: 'Cancel delivery' })) &&
                act.post('cancel', {}, 'Delivery note cancelled')
              }
            >
              Cancel
            </DocAction>
            <DocAction
              icon={Trash2}
              hidden={status !== 'DRAFT' || !can('delivery_note', 'delete')}
              onClick={async () => {
                if (!(await confirm.ask('Delete this draft delivery note?', { danger: true, confirmLabel: 'Delete' }))) return;
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
            <DocAction icon={Printer} onClick={() => openPdf(TYPE, doc.id!)}>PDF / Print</DocAction>
          </>
        }
      >
        <DocumentFlow docType={TYPE} docId={doc.id} />
        {dirty && editable && <InfoBanner tone="amber">Unsaved changes. Save before posting.</InfoBanner>}
        {status === 'DRAFT' && <InfoBanner tone="blue">Posting this delivery decreases physical stock and consumes the order reservation. Adjust the delivered quantities below for a partial delivery.</InfoBanner>}
        {posted && <InfoBanner tone="green">Delivery posted: stock has been reduced{doc.data?.invoiced ? ' and the goods are fully invoiced.' : '. Not invoiced yet.'}</InfoBanner>}
        <HeaderSection title="Delivery Information" columns={4}>
          <Field label="Delivery Number"><Input value={doc.data?.docNo ?? ''} readOnly /></Field>
          <Field label="Proforma">{link('proforma-invoice-form', doc.data?.proforma)}</Field>
          <Field label="Customer"><Input value={doc.data?.customer?.name ?? ''} readOnly /></Field>
          <Field label="Warehouse"><Input value={doc.data?.warehouse?.name ?? ''} readOnly /></Field>
          <Field label="Date"><DateInput value={head.docDate} disabled={!editable} onChange={(e) => setHead({ ...head, docDate: e.target.value })} /></Field>
          <Field label="Invoiced"><div className="flex h-9 items-center"><StatusBadge status={doc.data?.invoiced ? 'INVOICED' : posted ? 'PENDING' : 'DRAFT'} /></div></Field>
          <Field label="Delivery Address" className="col-span-2"><Input value={head.deliveryAddress} disabled={!editable} onChange={(e) => setHead({ ...head, deliveryAddress: e.target.value })} /></Field>
          <Field label="Driver"><Input value={head.driver} disabled={!editable} onChange={(e) => setHead({ ...head, driver: e.target.value })} /></Field>
          <Field label="Vehicle No"><Input value={head.vehicleNo} disabled={!editable} onChange={(e) => setHead({ ...head, vehicleNo: e.target.value })} /></Field>
        </HeaderSection>

        <DocSection title="Delivery Items">
          <div className="overflow-auto border border-line">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="h-9">
                  <th className="grid-th w-8">#</th>
                  <th className="grid-th">Product</th>
                  <th className="grid-th">OEM</th>
                  <th className="grid-th">Description</th>
                  <th className="grid-th !text-right">Ordered</th>
                  {status === 'DRAFT' && <th className="grid-th !text-right">On hand</th>}
                  <th className="grid-th !text-right w-[110px]">Deliver Qty</th>
                  <th className="grid-th !text-right">Invoiced</th>
                  {posted && <th className="grid-th !text-right">Unit Cost</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((i, n) => {
                  const q = num(qty[i.id]);
                  const onHand = stock.data?.get(i.productId)?.onHand;
                  const short = status === 'DRAFT' && onHand !== undefined && q > num(onHand) + 0.0005;
                  return (
                    <tr key={i.id} className={cn('h-9', short ? 'bg-danger-soft' : 'odd:bg-surface even:bg-surface-2')}>
                      <td className="grid-td text-center text-ink-faint">{n + 1}</td>
                      <td className="grid-td font-medium">{i.product?.code}</td>
                      <td className="grid-td">{i.product?.oemNumber}</td>
                      <td className="grid-td">{i.product?.name}</td>
                      <td className="grid-td text-right tabular-nums">{fmt.qty(i.orderedQty)}</td>
                      {status === 'DRAFT' && <td className={cn('grid-td text-right tabular-nums', short && 'font-bold text-danger')}>{onHand === undefined ? '' : fmt.qty(onHand)}</td>}
                      <td className="grid-td">
                        <NumberInput min={0} value={q} disabled={!editable} onChange={(e) => setQty((m) => ({ ...m, [i.id]: Number(e.target.value) }))} onFocus={(e) => e.target.select()} />
                      </td>
                      <td className="grid-td text-right tabular-nums">{fmt.qty(i.invoicedQty)}</td>
                      {posted && <td className="grid-td text-right tabular-nums">{fmt.money(i.unitCost)}</td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="h-9">
                  <td colSpan={status === 'DRAFT' ? 6 : 5} className="border-t-2 border-line bg-surface-2 px-3 font-semibold">Total</td>
                  <td className="border-t-2 border-line bg-surface-2 px-3 text-right font-semibold tabular-nums">{fmt.qty(items.reduce((s, i) => s + num(qty[i.id]), 0))}</td>
                  <td className="border-t-2 border-line bg-surface-2 px-3 text-right font-semibold tabular-nums">{fmt.qty(items.reduce((s, i) => s + num(i.invoicedQty), 0))}</td>
                  {posted && <td className="border-t-2 border-line bg-surface-2 px-3 text-right font-semibold tabular-nums">{fmt.money(doc.data?.totalCost)}</td>}
                </tr>
              </tfoot>
            </table>
          </div>
          {status === 'DRAFT' && stock.data && items.some((i) => num(qty[i.id]) > num(stock.data!.get(i.productId)?.onHand) + 0.0005) && (
            <div className="mt-1 border border-danger bg-danger-soft px-3 py-2 text-[13px] text-danger rounded-lg">Some lines exceed the stock on hand in this warehouse; posting will be refused until stock is available or the quantity is reduced.</div>
          )}
        </DocSection>

        <DocSection title="Notes">
          <Field label="Remarks"><Textarea rows={2} value={head.remarks} disabled={!editable} onChange={(e) => setHead({ ...head, remarks: e.target.value })} /></Field>
        </DocSection>
        <AttachmentsSection docType={TYPE} docId={doc.id} />
        <AuditSection doc={doc.data} />
      <RevisionHistory entity="DeliveryNote" id={doc.id} />
      </DocumentLayout>
    </>
  );
}

export default [
  { id: 'delivery-notes', title: 'Delivery Notes', icon: Truck, component: DeliveryList, permission: 'delivery_note' },
  { id: 'delivery-note-form', title: 'Delivery Note', icon: Truck, component: DeliveryForm, multiInstance: true, permission: 'delivery_note' },
] satisfies ScreenDef[];
