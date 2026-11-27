/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Ban, CheckCheck, ClipboardCheck, Minus, PackageOpen, Plus, Printer, ScanLine, Save, Trash2, Truck } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column } from '@/components/DataTable';
import { useProductInfoColumns, AttachmentsSection, AuditSection, DocAction, DocActionSep, DocumentFlow, DocumentLayout, DocSection, HeaderSection, ProductInfoCells, ProductInfoHeads } from '@/components/doc';
import { Button, EmptyState, Field, Input, StatusBadge } from '@/components/ui';
import { useDocument } from '@/hooks/useDocument';
import { useAuth } from '@/store/auth';
import { usePermission } from '@/store/auth';
import { useWorkspace } from '@/store/workspace';
import { toast } from '@/store/toast';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { num } from '@/lib/calc';
import { cn } from '@/lib/cn';
import { AnyRec, InfoBanner, makeSalesList, pctCell, useConfirm, useSalesActions } from '@/components/sales/shared';
import { colCustomer, colDate, colDoc, colMoney, colStatus, SourcePicker } from '@/components/sales/SourcePicker';
import { useOpenScreen } from '@/store/workspace';

const URL = '/picking-lists';
const TYPE = 'PICKING_LIST';

/* ---------------------------------- LIST ---------------------------------- */
function NewPickingButtonHost({ open, onClose }: { open: boolean; onClose: () => void }) {
  const openScreen = useOpenScreen();
  return (
    <SourcePicker
      open={open}
      title="New Picking List - select a sales order"
      hint="Picking lists are created from approved sales orders with reserved stock. Pick the order to create the list for the quantity that is reserved and not yet picked."
      onClose={onClose}
      tabs={[
        {
          key: 'orders',
          label: 'Sales orders',
          url: '/sales-orders',
          params: { status: 'APPROVED,PARTIALLY_DELIVERED' },
          empty: 'No approved sales orders are waiting to be picked. Approve a sales order first (stock is reserved on approval).',
          columns: [colDoc('Order No', 'docNo'), colDate(), colCustomer, colMoney('Total', 'total'), colStatus],
          actionLabel: 'Create Picking',
          onPick: async (r) => {
            const d = (await api.post(`/sales-orders/${r.id}/create-picking`, {})).data;
            toast.success('Picking list created');
            openScreen('picking-form', { id: d.id }, d.docNo);
          },
        },
      ]}
    />
  );
}

const PickingsList_ = makeSalesList<AnyRec>({
  tableKey: 'pickings',
  url: URL,
  exportName: 'Picking Lists',
  formScreen: 'picking-form',
  permission: 'picking',
  newLabel: 'New Picking',
  noCustomer: true, // picking lists carry no customer column on the server
  statuses: ['OPEN', 'PARTIALLY_PICKED', 'PICKED', 'CANCELLED'],
  picker: (p) => <NewPickingButtonHost {...p} />,
  columns: [
    { key: 'docNo', header: 'Picking No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'salesOrder.docNo', header: 'Sales Order', width: 130, sortable: false },
    { key: 'salesOrder.customer.name', header: 'Customer', sortable: false },
    { key: 'warehouse.name', header: 'Warehouse', sortable: false },
    { key: 'pickedBy', header: 'Picked By', sortable: false },
    { key: 'orderedQty', header: 'Ordered', type: 'qty', sortable: false, total: 'sum' },
    { key: 'pickedQty', header: 'Picked', type: 'qty', sortable: false, total: 'sum' },
    { key: 'pendingQty', header: 'Pending', type: 'qty', sortable: false, total: 'sum' },
    { key: 'pct', header: 'Progress', width: 110, sortable: false, cell: (r) => pctCell(num(r.orderedQty) > 0 ? (num(r.pickedQty) / num(r.orderedQty)) * 100 : 0), noExport: true },
    { key: 'status', header: 'Status', type: 'status', width: 130 },
  ] as Column<AnyRec>[],
});

const PickingsList = PickingsList_;

/* ---------------------------------- FORM ---------------------------------- */
function PickingForm({ params, tabId }: ScreenProps) {
  const productInfoCount = useProductInfoColumns().length;
  const doc = useDocument<AnyRec>(URL, params.id, { tabId });
  const can = usePermission();
  const user = useAuth((s) => s.user);
  const ws = useWorkspace();
  const confirm = useConfirm();
  const act = useSalesActions(URL, doc.id, doc.invalidate);
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [pickedBy, setPickedBy] = useState('');
  const [remarks, setRemarks] = useState('');
  const [scan, setScan] = useState('');
  const [sortLoc, setSortLoc] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const openScreen = useOpenScreen();

  const items = (doc.data?.items as AnyRec[] | undefined) ?? [];
  useEffect(() => {
    if (!doc.data) return;
    setPicked(Object.fromEntries(items.map((i) => [i.id, num(i.pickedQty)])));
    setPickedBy(doc.data.pickedBy ?? user?.fullName ?? '');
    setRemarks(doc.data.remarks ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.data]);

  const status: string = doc.data?.status ?? '';
  const editable = ['OPEN', 'PARTIALLY_PICKED', 'PICKED'].includes(status) && can('picking', 'edit');
  const dirty = items.some((i) => num(picked[i.id]) !== num(i.pickedQty)) || (doc.data && pickedBy !== (doc.data.pickedBy ?? user?.fullName ?? ''));
  const totals = useMemo(() => {
    const ordered = items.reduce((s, i) => s + num(i.orderedQty), 0);
    const pk = items.reduce((s, i) => s + num(picked[i.id] ?? i.pickedQty), 0);
    return { ordered, picked: pk, pending: ordered - pk };
  }, [items, picked]);
  const loc = (i: AnyRec) => [i.rack, i.shelf, i.bin].map((x) => x ?? '~').join('-');
  const sorted = useMemo(() => (sortLoc ? [...items].sort((a, b) => loc(a).localeCompare(loc(b))) : items), [items, sortLoc]);

  const setQty = (i: AnyRec, v: number) => setPicked((p) => ({ ...p, [i.id]: Math.max(0, Math.min(num(i.orderedQty), Math.round(v * 1000) / 1000)) }));

  const savePick = useMutation({
    mutationFn: async () =>
      (await api.put(`${URL}/${doc.id}/pick`, { pickedBy: pickedBy || undefined, remarks: remarks || undefined, items: items.map((i) => ({ id: i.id, pickedQty: num(picked[i.id]) })) })).data,
    onSuccess: () => {
      toast.success('Picking saved');
      doc.invalidate();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const onScan = () => {
    const code = scan.trim().toLowerCase();
    if (!code) return;
    const hit = items.find((i) => [i.product?.code, i.product?.oemNumber, i.product?.barcode].some((x) => x && String(x).toLowerCase() === code));
    if (!hit) {
      toast.warning(`"${scan}" is not on this picking list`);
    } else if (num(picked[hit.id]) >= num(hit.orderedQty)) {
      toast.warning(`${hit.product?.code} is already fully picked`);
    } else {
      setQty(hit, num(picked[hit.id]) + 1);
    }
    setScan('');
  };

  if (doc.isNew) {
    return (
      <DocumentLayout title="Picking List" icon={ClipboardCheck} loading={false}>
        <EmptyState
          title="Picking lists are created from a sales order"
          hint="Open an approved sales order and use Create Picking, or choose one below."
          action={<Button variant="primary" onClick={() => setPickerOpen(true)}>Select sales order</Button>}
        />
        <NewPickingButtonHost open={pickerOpen} onClose={() => setPickerOpen(false)} />
      </DocumentLayout>
    );
  }

  const so = doc.data?.salesOrder;
  return (
    <>
      {confirm.node}
      <DocumentLayout
        title="Picking List"
        icon={ClipboardCheck}
        docNo={doc.data?.docNo}
        status={status}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            <DocAction icon={Save} variant="primary" hidden={!editable} loading={savePick.isPending} disabled={!dirty} onClick={() => savePick.mutate()}>Save Picking</DocAction>
            <DocAction
              icon={CheckCheck}
              hidden={!editable}
              onClick={() => setPicked(Object.fromEntries(items.map((i) => [i.id, num(i.orderedQty)])))}
            >
              Pick All
            </DocAction>
            <DocActionSep />
            <DocAction
              icon={PackageOpen}
              hidden={!['PARTIALLY_PICKED', 'PICKED'].includes(status) || !can('packing', 'create')}
              loading={act.busy === 'create-packing'}
              disabled={!!dirty}
              onClick={() => act.convert('create-packing', 'packing-list-form', 'Packing list created')}
            >
              Create Packing
            </DocAction>
            <DocAction
              icon={Truck}
              hidden={!['PARTIALLY_PICKED', 'PICKED'].includes(status) || !can('delivery_note', 'create')}
              loading={act.busy === 'create-delivery'}
              disabled={!!dirty}
              onClick={() => act.convert('create-delivery', 'delivery-note-form', 'Delivery note created')}
            >
              Create Delivery
            </DocAction>
            <DocActionSep />
            <DocAction
              icon={Ban}
              hidden={!['OPEN', 'PARTIALLY_PICKED', 'PICKED'].includes(status) || !can('picking', 'cancel')}
              loading={act.busy === 'cancel'}
              onClick={async () => (await confirm.ask('Cancel this picking list? Picked quantities are returned to the order.', { danger: true, confirmLabel: 'Cancel picking' })) && act.post('cancel', {}, 'Picking cancelled')}
            >
              Cancel
            </DocAction>
            <DocAction
              icon={Trash2}
              hidden={status !== 'OPEN' || !can('picking', 'delete')}
              onClick={async () => {
                if (!(await confirm.ask('Delete this picking list?', { danger: true, confirmLabel: 'Delete' }))) return;
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
            <DocAction icon={Printer} onClick={() => window.print()}>Print</DocAction>
          </>
        }
      >
        <DocumentFlow docType={TYPE} docId={doc.id} />
        {dirty && editable && <InfoBanner tone="amber">You have unsaved picked quantities. Press <b>Save Picking</b> to record them.</InfoBanner>}
        <HeaderSection title="Picking Information" columns={4}>
          <Field label="Picking Number"><Input value={doc.data?.docNo ?? ''} readOnly /></Field>
          <Field label="Sales Order">
            <button type="button" className="ctl text-left font-semibold text-brand underline" onClick={() => so && openScreen('sales-order-form', { id: so.id }, so.docNo)}>
              {so?.docNo ?? '-'} {so && <StatusBadge status={so.status} />}
            </button>
          </Field>
          <Field label="Customer"><Input value={so?.customer?.name ?? ''} readOnly /></Field>
          <Field label="Warehouse"><Input value={doc.data?.warehouse?.name ?? ''} readOnly /></Field>
          <Field label="Date"><Input value={fmt.date(doc.data?.docDate)} readOnly /></Field>
          <Field label="Delivery Date"><Input value={fmt.date(so?.deliveryDate)} readOnly /></Field>
          <Field label="Picked By"><Input value={pickedBy} disabled={!editable} onChange={(e) => setPickedBy(e.target.value)} /></Field>
          <Field label="Remarks"><Input value={remarks} disabled={!editable} onChange={(e) => setRemarks(e.target.value)} /></Field>
        </HeaderSection>

        <DocSection
          title="Items to Pick"
          right={
            <div className="flex items-center gap-3 text-[13px]">
              <label className="inline-flex items-center gap-1"><input type="checkbox" checked={sortLoc} onChange={(e) => setSortLoc(e.target.checked)} /> Sort by rack / shelf / bin</label>
              <span className="font-semibold">Picked {fmt.qty(totals.picked)} / {fmt.qty(totals.ordered)}</span>
            </div>
          }
        >
          {editable && (
            <div className="mb-2 flex items-center gap-2">
              <ScanLine size={18} className="text-brand" />
              <input
                className="ctl !h-9 w-[320px] !text-[14px]"
                placeholder="Scan / type product code, OEM or barcode then Enter (+1)"
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onScan())}
              />
            </div>
          )}
          <div className="overflow-auto border border-line">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="h-8">
                  <th className="grid-th">Product</th>
                  <ProductInfoHeads />
                  <th className="grid-th">Description</th>
                  <th className="grid-th text-center">Rack</th>
                  <th className="grid-th text-center">Shelf</th>
                  <th className="grid-th text-center">Bin</th>
                  <th className="grid-th !text-right">Ordered</th>
                  <th className="grid-th !text-right">Reserved</th>
                  <th className="grid-th !text-center w-[250px]">Picked</th>
                  <th className="grid-th !text-right">Pending</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((i) => {
                  const pk = num(picked[i.id]);
                  const ord = num(i.orderedQty);
                  const pend = ord - pk;
                  const done = pend <= 0.0005;
                  return (
                    <tr key={i.id} className={cn('h-14', done ? 'bg-success-soft' : pk > 0 ? 'bg-warning-soft' : 'bg-surface')}>
                      <td className="grid-td text-[14px] font-bold">{i.product?.code}</td>
                      <ProductInfoCells line={i} />
                      <td className="grid-td">{i.product?.name}</td>
                      <td className="grid-td text-center text-[15px] font-bold">{i.rack ?? '-'}</td>
                      <td className="grid-td text-center text-[15px] font-bold">{i.shelf ?? '-'}</td>
                      <td className="grid-td text-center text-[15px] font-bold">{i.bin ?? '-'}</td>
                      <td className="grid-td text-right text-[15px] tabular-nums">{fmt.qty(ord)}</td>
                      <td className="grid-td text-right tabular-nums">{fmt.qty(i.reservedQty)}</td>
                      <td className="grid-td">
                        <div className="flex items-center justify-center gap-1">
                          {editable && (
                            <button type="button" className="h-10 w-10 rounded-lg border border-line bg-surface hover:bg-surface-2" onClick={() => setQty(i, pk - 1)} aria-label="minus one">
                              <Minus size={16} className="mx-auto" />
                            </button>
                          )}
                          <input
                            type="number"
                            min={0}
                            max={ord}
                            step="any"
                            disabled={!editable}
                            value={Number.isFinite(pk) ? pk : 0}
                            onChange={(e) => setQty(i, Number(e.target.value))}
                            onFocus={(e) => e.target.select()}
                            className="ctl !h-10 w-[84px] !text-center !text-[18px] font-bold tabular-nums"
                          />
                          {editable && (
                            <>
                              <button type="button" className="h-10 w-10 rounded-lg border border-line bg-surface hover:bg-surface-2" onClick={() => setQty(i, pk + 1)} aria-label="plus one">
                                <Plus size={16} className="mx-auto" />
                              </button>
                              <button type="button" className="h-10 rounded-lg border border-success bg-success px-2 text-[13px] font-semibold text-white hover:bg-success" onClick={() => setQty(i, ord)}>
                                Full
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                      <td className={cn('grid-td text-right text-[15px] font-bold tabular-nums', done ? 'text-success' : 'text-danger')}>{fmt.qty(pend)}</td>
                    </tr>
                  );
                })}
                {!items.length && <tr><td colSpan={9 + productInfoCount} className="p-4 text-center text-ink-faint">No lines</td></tr>}
              </tbody>
              <tfoot>
                <tr className="h-8">
                  <td colSpan={5 + productInfoCount} className="border-t-2 border-line bg-surface-2 px-3 font-semibold">Total</td>
                  <td className="border-t-2 border-line bg-surface-2 px-3 text-right font-semibold tabular-nums">{fmt.qty(totals.ordered)}</td>
                  <td className="border-t-2 border-line bg-surface-2" />
                  <td className="border-t-2 border-line bg-surface-2 px-3 text-center font-semibold tabular-nums">{fmt.qty(totals.picked)}</td>
                  <td className="border-t-2 border-line bg-surface-2 px-3 text-right font-semibold tabular-nums">{fmt.qty(totals.pending)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="mt-1 text-xs text-ink-muted">Partial picking is allowed: save what has been picked so far and continue later. Picked quantity can never exceed the quantity on the list or the reserved stock.</div>
        </DocSection>

        <AttachmentsSection docType={TYPE} docId={doc.id} />
        <AuditSection doc={doc.data} />
      </DocumentLayout>
    </>
  );
}

export default [
  { id: 'pickings', title: 'Picking Lists', icon: ClipboardCheck, component: PickingsList, permission: 'picking' },
  { id: 'picking-form', title: 'Picking List', icon: ClipboardCheck, component: PickingForm, multiInstance: true, permission: 'picking' },
] satisfies ScreenDef[];
