import { RevisionHistory } from '@/components/doc/RevisionHistory';
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Goods Receipt (GRN): list + form pre-filled from the PO / import shipment (Ordered / Previously Received / Current / Pending). */
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { Anchor, ArrowDownToLine, PackagePlus, Receipt, Send, Undo2, XCircle, Eraser } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column, RowAction } from '@/components/DataTable';
import { useProductInfoColumns, DocAction, DocSection, DocumentLayout, HeaderSection, NotesSection, ProductInfoCells, ProductInfoHeads } from '@/components/doc';
import { Button } from '@/components/ui';
import { useOpenScreen } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { api, apiError, unwrap } from '@/lib/api';
import { num } from '@/lib/calc';
import { cn } from '@/lib/cn';
import { fmt, today } from '@/lib/format';
import { toast } from '@/store/toast';
import {
  AnyDoc, DocFooter, FDate, FormProvider, FSelect, FText, idOrNull, isoOf, LinkedDocs, PurchaseList, ReadField, ServerError, StdActions, strOrNull, TransitionDef, useDocForm,
  useFormContext, useLookups, useRows, useWatch, FV,
} from '@/components/purchase/kit';

interface GrnRow { id: number; docNo: string; docDate: string; supplier?: { name: string }; warehouse?: { name: string }; order?: { id: number; docNo: string; orderType: string } | null; grnType: string; totalQty: number; totalValue: number; invoiceStatus: string; status: string; supplierDeliveryNo?: string }

/* ------------------------------------------------------------------ list */
function GoodsReceiptsScreen() {
  const can = usePermission();
  const cols: Column<GrnRow>[] = [
    { key: 'docNo', header: 'GRN No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'supplier.name', header: 'Supplier' },
    { key: 'order.docNo', header: 'PO No', width: 130, sortable: false },
    { key: 'warehouse.name', header: 'Warehouse' },
    { key: 'grnType', header: 'Type', width: 70 },
    { key: 'supplierDeliveryNo', header: 'Delivery Note', hidden: true },
    { key: 'totalQty', header: 'Qty', type: 'qty', total: 'sum', sortable: false },
    { key: 'totalValue', header: 'Value', type: 'money', total: 'sum', sortable: false },
    { key: 'invoiceStatus', header: 'Invoicing', type: 'status', width: 120, sortable: false },
    { key: 'status', header: 'Status', type: 'status', width: 100 },
  ];
  return (
    <PurchaseList<GrnRow>
      tableKey="goods-receipts" url="/goods-receipts" title="Goods Receipt" formScreen="goods-receipt-form" module="goods_receipt" newLabel="New GRN" columns={cols} statuses={['DRAFT', 'POSTED', 'CANCELLED']} pdfType="GOODS_RECEIPT"
      selects={[{ key: 'grnType', label: 'All types', options: [{ value: 'LOCAL', label: 'Local' }, { value: 'IMPORT', label: 'Import' }] }]}
      rowActions={(r, open): RowAction<GrnRow>[] => [
        {
          label: 'Create Invoice', icon: Receipt, hidden: (x) => x.status !== 'POSTED' || x.invoiceStatus === 'INVOICED' || !can('purchase_invoice', 'create'),
          onClick: async () => {
            try {
              const inv = await unwrap(api.post<AnyDoc>(`/goods-receipts/${r.id}/create-invoice`, {}));
              open('purchase-invoice-form', { id: inv.id }, inv.docNo);
            } catch (e) { toast.error(apiError(e)); }
          },
        },
        { label: 'Create Return', icon: Undo2, hidden: (x) => x.status !== 'POSTED' || !can('purchase_return', 'create'), onClick: () => { open('purchase-return-form', { receiptId: r.id }, 'New Return'); } },
        { label: 'Landed Cost', icon: Anchor, hidden: (x) => x.status !== 'POSTED' || x.grnType !== 'IMPORT' || !can('landed_cost', 'create'), onClick: () => { open('landed-cost-form', { receiptId: r.id }, 'New Landed Cost'); } },
      ]}
    />
  );
}

/* ------------------------------------------------------------------ source picker (new GRN without a PO) */
function SourcePicker({ onPick }: { onPick: (s: { orderId: number; shipmentId?: number }) => void }) {
  const [mode, setMode] = useState<'LOCAL' | 'IMPORT'>('LOCAL');
  const pos = useRows<any>('/purchase-orders/open', { orderType: 'LOCAL' }, mode === 'LOCAL');
  const ships = useRows<any>('/import-shipments', { status: 'ARRIVED,CUSTOMS,CLEARED' }, mode === 'IMPORT');
  const rows = mode === 'LOCAL' ? pos.data ?? [] : ships.data ?? [];
  return (
    <DocSection title="Create goods receipt from..." bodyClassName="p-3">
      <div className="mb-2 flex gap-2">
        <Button variant={mode === 'LOCAL' ? 'primary' : 'default'} onClick={() => setMode('LOCAL')}>Local Purchase Order</Button>
        <Button variant={mode === 'IMPORT' ? 'primary' : 'default'} onClick={() => setMode('IMPORT')}>Import Shipment (arrived)</Button>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left text-xs">
            <th className="px-3 py-2">{mode === 'LOCAL' ? 'PO No' : 'Shipment'}</th><th>{mode === 'IMPORT' ? 'Import PO' : 'Date'}</th><th>Supplier</th>
            <th className="text-right">{mode === 'LOCAL' ? 'Pending Qty' : 'Pending Qty'}</th><th>Status</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id} className="border-b border-line hover:bg-brand-soft">
              <td className="px-3 py-2">{mode === 'LOCAL' ? r.docNo : r.shipmentNo}</td>
              <td>{mode === 'LOCAL' ? fmt.date(r.docDate) : r.order?.docNo}</td>
              <td>{mode === 'LOCAL' ? r.supplier?.name : r.order?.supplier?.name}</td>
              <td className="text-right tabular-nums">{fmt.qty(r.pendingQty)}</td>
              <td>{r.status}</td>
              <td className="text-right"><Button size="sm" variant="primary" disabled={mode === 'IMPORT' && !(r.pendingQty > 0)} onClick={() => onPick(mode === 'LOCAL' ? { orderId: r.id } : { orderId: r.orderId, shipmentId: r.id })}>Receive</Button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-ink-muted">{mode === 'LOCAL' ? 'No approved purchase orders with pending quantity.' : 'No arrived shipments waiting to be received.'}</td></tr>}
        </tbody>
      </table>
    </DocSection>
  );
}

/* ------------------------------------------------------------------ lines table */
function GrnLines({ editable }: { editable: boolean }) {
  const productInfoCount = useProductInfoColumns().length;
  const { register, control, setValue, formState } = useFormContext();
  const items = (useWatch({ control, name: 'items' }) as any[] | undefined) ?? [];
  const tot = items.reduce((a, l) => ({ ordered: a.ordered + num(l.orderedQty), prev: a.prev + num(l.previouslyReceived), cur: a.cur + num(l.qty), pending: a.pending + Math.max(0, num(l.orderedQty) - num(l.previouslyReceived) - num(l.qty)), value: a.value + num(l.qty) * num(l.unitCost) }), { ordered: 0, prev: 0, cur: 0, pending: 0, value: 0 });
  const receiveAll = () => items.forEach((l, i) => setValue(`items.${i}.qty`, l.maxQty !== undefined ? Math.min(num(l.maxQty), Math.max(0, num(l.orderedQty) - num(l.previouslyReceived))) : Math.max(0, num(l.orderedQty) - num(l.previouslyReceived)), { shouldDirty: true }));
  const clearAll = () => items.forEach((_l, i) => setValue(`items.${i}.qty`, 0, { shouldDirty: true }));
  return (
    <DocSection
      title="Items received"
      right={editable ? <div className="flex gap-1"><Button size="sm" icon={ArrowDownToLine} onClick={receiveAll}>Receive all pending</Button><Button size="sm" icon={Eraser} onClick={clearAll}>Clear</Button></div> : undefined}
      bodyClassName="p-0"
    >
      <div className="overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr className="h-9">
              <th className="grid-th w-8 text-center">#</th><th className="grid-th w-[120px]">Product</th><ProductInfoHeads /><th className="grid-th">Description</th>
              <th className="grid-th !text-right">Ordered Qty</th><th className="grid-th !text-right">Previously Received</th><th className="grid-th !text-right bg-brand-soft">Current Receipt</th>
              <th className="grid-th !text-right">Pending Qty</th><th className="grid-th !text-right">Unit Cost</th><th className="grid-th !text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l, i) => {
              const pend = Math.max(0, num(l.orderedQty) - num(l.previouslyReceived) - num(l.qty));
              const over = l.maxQty !== undefined && num(l.qty) > num(l.maxQty) + 0.0005;
              return (
                <tr key={l.orderItemId ?? l.id ?? i} className="h-9 odd:bg-surface even:bg-surface-2">
                  <td className="grid-td text-center text-ink-faint">{i + 1}</td>
                  <td className="grid-td">{l.product?.code}</td>
                  <ProductInfoCells line={l} />
                  <td className="grid-td">{l.product?.name ?? l.description}</td>
                  <td className="grid-td text-right tabular-nums">{fmt.qty(l.orderedQty)}</td>
                  <td className="grid-td text-right tabular-nums">{fmt.qty(l.previouslyReceived)}</td>
                  <td className="grid-td !p-0 bg-brand-soft text-right">
                    {editable ? (
                      <input
                        type="number" step="any" min={0} title={over ? `Maximum receivable: ${l.maxQty}` : undefined}
                        className={cn('ctl !h-8 !rounded-none text-right tabular-nums font-semibold', over && '!border-danger text-danger')}
                        {...register(`items.${i}.qty`, { setValueAs: (v) => (v === '' || v == null ? 0 : Number(v)) })} onFocus={(e) => e.target.select()}
                      />
                    ) : (
                      <span className="block px-2 font-semibold tabular-nums">{fmt.qty(l.qty)}</span>
                    )}
                  </td>
                  <td className={cn('grid-td text-right tabular-nums', pend > 0 ? 'text-warning' : 'text-success')}>{fmt.qty(pend)}</td>
                  <td className="grid-td text-right tabular-nums">{fmt.money(l.unitCost)}</td>
                  <td className="grid-td text-right tabular-nums">{fmt.money(num(l.qty) * num(l.unitCost))}</td>
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={9 + productInfoCount} className="p-4 text-center text-ink-faint">No lines</td></tr>}
          </tbody>
          <tfoot>
            <tr className="h-9 bg-surface-2 font-semibold">
              <td className="border-t-2 border-line bg-surface-2" colSpan={3 + productInfoCount}><span className="px-2">Total</span></td>
              <td className="border-t-2 border-line bg-surface-2 px-3 text-right tabular-nums">{fmt.qty(tot.ordered)}</td>
              <td className="border-t-2 border-line bg-surface-2 px-3 text-right tabular-nums">{fmt.qty(tot.prev)}</td>
              <td className="border-t-2 border-line bg-surface-2 px-3 text-right tabular-nums">{fmt.qty(tot.cur)}</td>
              <td className="border-t-2 border-line bg-surface-2 px-3 text-right tabular-nums">{fmt.qty(tot.pending)}</td>
              <td className="border-t-2 border-line bg-surface-2" />
              <td className="border-t-2 border-line bg-surface-2 px-3 text-right tabular-nums">{fmt.money(tot.value)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {(formState.errors.items as any)?.message && <div className="p-1 text-xs text-danger">{(formState.errors.items as any).message}</div>}
      <div className="border-t border-line bg-surface-2 px-2 py-1 text-xs text-ink-muted">
        Quantities come from the purchase order - only enter what physically arrived. Posting increases inventory and creates the stock transaction automatically.
      </div>
    </DocSection>
  );
}

/* ------------------------------------------------------------------ form */
const schema = z.object({
  docDate: z.string().min(1, 'Date required'),
  warehouseId: z.coerce.number({ invalid_type_error: 'Warehouse required' }).int().positive('Warehouse required'),
  items: z.array(z.object({ qty: z.number().min(0, 'Qty cannot be negative') }).passthrough()).min(1, 'No lines to receive')
    .refine((a) => a.some((i: any) => i.qty > 0), { message: 'Enter the received quantity on at least one line' }),
}).passthrough();

function GoodsReceiptForm({ params, tabId }: ScreenProps) {
  const open = useOpenScreen();
  const can = usePermission();
  const lk = useLookups();
  const [src, setSrc] = useState<{ orderId?: number; shipmentId?: number }>({
    orderId: params.orderId ? Number(params.orderId) : undefined,
    shipmentId: params.shipmentId ? Number(params.shipmentId) : undefined,
  });
  const isNewDoc = params.id === undefined || params.id === '';
  const prefill = useQuery({
    queryKey: ['grn-prefill', src.orderId, src.shipmentId],
    enabled: isNewDoc && !!src.orderId,
    queryFn: async () => (await api.get<any>(`/goods-receipts/prefill/${src.orderId}`, { params: src.shipmentId ? { shipmentId: src.shipmentId } : undefined })).data,
  });
  const newValues = useMemo<FV | undefined>(() => {
    const p = prefill.data;
    if (!p) return undefined;
    return {
      orderId: p.orderId, shipmentId: p.shipmentId, docDate: today(), warehouseId: p.warehouseId ?? '', supplierDeliveryNo: '', remarks: '',
      items: (p.items as any[]).map((i) => ({ orderItemId: i.orderItemId, productId: i.productId, product: i.product, oemNumber: i.oemNumber, description: i.description, orderedQty: i.orderedQty, previouslyReceived: i.previouslyReceived, qty: i.qty, maxQty: i.maxQty, unitCost: i.unitCost })),
    };
  }, [prefill.data]);
  const ctl = useDocForm({
    url: '/goods-receipts', params, tabId, schema, newValues,
    defaults: { docDate: today(), warehouseId: '', supplierDeliveryNo: '', remarks: '', items: [] },
    toForm: (d) => ({
      ...d, docDate: isoOf(d.docDate), warehouseId: d.warehouseId ?? '', supplierDeliveryNo: d.supplierDeliveryNo ?? '', remarks: d.remarks ?? '',
      items: (d.items ?? []).map((i: any) => ({ ...i, orderedQty: num(i.orderedQty), previouslyReceived: num(i.previouslyReceived), qty: num(i.qty), unitCost: num(i.unitCost), invoicedQty: num(i.invoicedQty) })),
    }),
  });
  const { doc, form, status, editable } = ctl;
  const g = doc.data as AnyDoc | undefined;
  const p = prefill.data;
  const supplierId = g?.supplierId ?? p?.supplierId;
  const supplier = g?.supplier ?? lk.suppliers.find((s) => s.id === supplierId);
  const orderNo = g?.order?.docNo ?? p?.orderNo;
  const orderId = g?.orderId ?? p?.orderId;
  const shipmentNo = g?.shipment?.shipmentNo ?? p?.shipmentNo;
  const grnType = g?.grnType ?? p?.orderType;

  const onSave = ctl.save((v) => ({
    ...(doc.isNew ? { orderId: v.orderId, shipmentId: v.shipmentId ?? undefined } : {}),
    docDate: v.docDate, warehouseId: Number(v.warehouseId), supplierDeliveryNo: strOrNull(v.supplierDeliveryNo), remarks: strOrNull(v.remarks),
    items: (v.items as any[]).filter((i) => doc.isNew || i.qty > 0).map((i) => ({ orderItemId: i.orderItemId, qty: i.qty })),
  }));
  const transitions: TransitionDef[] = [
    { action: 'post', label: 'Post GRN', icon: Send, from: ['DRAFT'], perm: 'post', variant: 'primary', saveFirst: true, ask: { title: 'Post goods receipt', message: 'Post this goods receipt? Inventory will increase and the receipt can no longer be edited.', confirmLabel: 'Post' } },
    { action: 'cancel', label: 'Cancel', icon: XCircle, from: ['DRAFT', 'POSTED'], perm: 'cancel', variant: 'danger', ask: { title: 'Cancel goods receipt', danger: true, message: status === 'POSTED' ? 'Cancel this posted receipt? Stock will be reversed (fails if it is invoiced, returned or already sold).' : 'Cancel this draft receipt?' } },
  ];
  const createInvoice = async () => {
    const inv = await ctl.run('create-invoice');
    if (inv) open('purchase-invoice-form', { id: inv.id }, inv.docNo);
  };

  if (doc.isNew && !src.orderId) {
    return (
      <DocumentLayout title="Goods Receipt" icon={PackagePlus} status="DRAFT">
        <SourcePicker onPick={setSrc} />
      <RevisionHistory entity="GoodsReceipt" id={params.id} />
      </DocumentLayout>
    );
  }

  return (
    <FormProvider {...form}>
      <DocumentLayout
        title={grnType === 'IMPORT' ? 'Import Goods Receipt (GRN)' : 'Goods Receipt (GRN)'} icon={PackagePlus} docNo={g?.docNo} status={status ?? (doc.isNew ? 'DRAFT' : undefined)} loading={doc.isLoading || (doc.isNew && prefill.isLoading)} error={doc.error ?? (prefill.error ? apiError(prefill.error) : undefined)}
        actions={
          <StdActions ctl={ctl} module="goods_receipt" transitions={transitions} onSave={onSave} pdfType="GOODS_RECEIPT"
            extra={
              <>
                <DocAction icon={Receipt} hidden={status !== 'POSTED' || !!g?.invoiced || !can('purchase_invoice', 'create')} onClick={createInvoice}>Create Invoice</DocAction>
                <DocAction icon={Undo2} hidden={status !== 'POSTED' || !can('purchase_return', 'create')} onClick={() => open('purchase-return-form', { receiptId: doc.id }, 'New Return')}>Create Return</DocAction>
                <DocAction icon={Anchor} hidden={status !== 'POSTED' || grnType !== 'IMPORT' || !can('landed_cost', 'create')} onClick={() => open('landed-cost-form', { receiptId: doc.id }, 'New Landed Cost')}>Landed Cost</DocAction>
              </>
            }
          />
        }
      >
        <ServerError message={ctl.err} />
        {status === 'POSTED' && <div className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-[13px] text-teal-800">Posted - inventory increased{g?.invoiced ? ' and fully invoiced' : ''}. Total value {fmt.money(g?.totalValue)}.</div>}
        <HeaderSection title="GRN Information">
          <ReadField label="GRN Number" value={g?.docNo ?? '(auto)'} />
          <FDate name="docDate" label="Receipt Date" required disabled={!editable} />
          <ReadField label="Supplier" value={supplier ? `${supplier.code} - ${supplier.name}` : ''} />
          <FSelect name="warehouseId" label="Receiving Warehouse" required options={lk.warehouseOptions} disabled={!editable} />
          <ReadField label="Purchase Order" value={orderId ? <button className="text-brand hover:underline" onClick={() => open(grnType === 'IMPORT' ? 'import-purchase-order-form' : 'purchase-order-form', { id: orderId }, orderNo)}>{orderNo}</button> : ''} />
          <ReadField label="Shipment" value={g?.shipment ? <button className="text-brand hover:underline" onClick={() => open('import-shipment-form', { id: g.shipment.id }, shipmentNo)}>{shipmentNo}</button> : (shipmentNo ?? '-')} />
          <FText name="supplierDeliveryNo" label="Supplier Delivery Note No" disabled={!editable} />
          <ReadField label="Type" value={grnType ?? ''} />
          {g?.shipment && <ReadField label="Container / BL / AWB" value={[g.shipment.containerNo, g.shipment.billOfLading, g.shipment.awb].filter(Boolean).join(' / ') || '-'} />}
        </HeaderSection>

        <GrnLines editable={editable} />
        <NotesSection fields={[{ label: 'Remarks', props: { ...form.register('remarks'), disabled: !editable } }]} />
        {!doc.isNew && (
          <>
            <LinkedDocs title="Purchase Invoices" docs={(g?.invoices ?? []).map((r: any) => ({ screenId: 'purchase-invoice-form', id: r.id, label: r.docNo, status: r.status }))} />
            {grnType === 'IMPORT' && <LinkedDocs title="Landed Costs" docs={(g?.landedCosts ?? []).map((r: any) => ({ screenId: 'landed-cost-form', id: r.id, label: r.docNo, status: r.status, extra: fmt.money(r.totalAdditional) }))} />}
          </>
        )}
        <DocFooter docType="GOODS_RECEIPT" entity="GoodsReceipt" doc={doc.data} isNew={doc.isNew} approvalDoc={false} />
      <RevisionHistory entity="GoodsReceipt" id={params.id} />
      </DocumentLayout>
    </FormProvider>
  );
}

export default [
  { id: 'goods-receipts', title: 'Goods Receipts', icon: PackagePlus, component: GoodsReceiptsScreen, permission: 'goods_receipt' },
  { id: 'goods-receipt-form', title: 'Goods Receipt', icon: PackagePlus, component: GoodsReceiptForm, multiInstance: true, permission: 'goods_receipt' },
] satisfies ScreenDef[];
