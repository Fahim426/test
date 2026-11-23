import { RevisionHistory } from '@/components/doc/RevisionHistory';
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Local Purchase Orders and Import Purchase Orders (list + shared form). */
import { useMemo } from 'react';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { Check, Container, FileText, Lock, PackagePlus, Receipt, Send, Ship, ShoppingCart, XCircle, ArrowRight, Globe } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column, RowAction } from '@/components/DataTable';
import { DocAction, DocSection, DocumentLayout, HeaderSection, LineItemsGrid, LineColumn, NotesSection, TotalsSection } from '@/components/doc';
import { Button, LoadingBlock, NumberInput } from '@/components/ui';
import { useOpenScreen } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { api, apiError, unwrap } from '@/lib/api';
import { calcLine, calcTotals, num } from '@/lib/calc';
import { fmt, today } from '@/lib/format';
import { toast } from '@/store/toast';
import {
  AnyDoc, CurrencyFields, DocFooter, FDate, FormProvider, FSelect, FText, idOrNull, INCOTERMS, isoOf, LinkedDocs, PurchaseList, ReadField, ServerError, SHIPPING_METHODS,
  StatusStepper, StdActions, strOrNull, TransitionDef, useDocForm, useLookups, FV, SupplierSelect, useAsk,
} from '@/components/purchase/kit';
import { applySupplierDefaults, pickPurchaseProduct } from '@/components/purchase/helpers';
import { NewPurchaseOrderPicker } from '@/components/purchase/pickers';
import { useWatch } from 'react-hook-form';

type Kind = 'LOCAL' | 'IMPORT';
const LOCAL_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED', 'CANCELLED'];
export const IMPORT_STEPS = ['DRAFT', 'CONFIRMED', 'PAYMENT_PENDING', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'RECEIVED', 'COMPLETED'];
const IMPORT_STATUSES = [...IMPORT_STEPS, 'PENDING_APPROVAL', 'CANCELLED'];
/** allowed manual status moves (mirrors server TRANSITIONS) */
const IMPORT_NEXT: Record<string, string[]> = {
  CONFIRMED: ['PAYMENT_PENDING', 'IN_TRANSIT'],
  PAYMENT_PENDING: ['CONFIRMED', 'IN_TRANSIT'],
  IN_TRANSIT: ['ARRIVED'],
  ARRIVED: ['CUSTOMS'],
  RECEIVED: ['COMPLETED'],
};

interface PORow { id: number; docNo: string; docDate: string; supplier?: { name: string }; warehouse?: { name: string }; currencyCode: string; total: number; baseTotal: number; status: string; receivedPct: number; orderedQty: number; receivedQty: number; pendingQty: number; expectedDate?: string; supplierCountry?: string; incoterms?: string; portOfLoading?: string; portOfDestination?: string; shippingMethod?: string; advancePaid?: number }

/* ------------------------------------------------------------------ lists */
function PurchaseOrdersScreen() {
  const cols: Column<PORow>[] = [
    { key: 'docNo', header: 'PO No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'supplier.name', header: 'Supplier' },
    { key: 'warehouse.name', header: 'Warehouse' },
    { key: 'currencyCode', header: 'Currency', width: 70, hidden: true },
    { key: 'total', header: 'Amount', type: 'money', total: 'sum' },
    { key: 'status', header: 'Status', type: 'status', width: 130 },
    { key: 'receivedPct', header: 'Received', type: 'percent', width: 80, sortable: false },
    { key: 'expectedDate', header: 'Expected', type: 'date', width: 100, hidden: true },
    { key: 'orderedQty', header: 'Ordered Qty', type: 'qty', hidden: true, sortable: false },
    { key: 'receivedQty', header: 'Received Qty', type: 'qty', hidden: true, sortable: false },
    { key: 'pendingQty', header: 'Pending Qty', type: 'qty', hidden: true, sortable: false },
  ];
  const can = usePermission();
  return (
    <PurchaseList<PORow>
      tableKey="purchase-orders" url="/purchase-orders" title="Purchase Order" formScreen="purchase-order-form" module="purchase_order" newLabel="New PO" columns={cols} statuses={LOCAL_STATUSES} pdfType="PURCHASE_ORDER"
      picker={(p) => <NewPurchaseOrderPicker {...p} />}
      rowActions={(r, open): RowAction<PORow>[] => [
        { label: 'Create GRN', icon: PackagePlus, hidden: (x) => !['APPROVED', 'PARTIALLY_RECEIVED'].includes(x.status) || !can('goods_receipt', 'create'), onClick: () => { open('goods-receipt-form', { orderId: r.id }, 'New GRN'); } },
        {
          label: 'Create Invoice', icon: Receipt, hidden: (x) => !(x.receivedQty > 0) || ['CANCELLED', 'DRAFT'].includes(x.status) || !can('purchase_invoice', 'create'),
          onClick: async () => {
            try {
              const inv = await unwrap(api.post<AnyDoc>(`/purchase-orders/${r.id}/create-invoice`, {}));
              open('purchase-invoice-form', { id: inv.id }, inv.docNo);
            } catch (e) { toast.error(apiError(e)); }
          },
        },
      ]}
    />
  );
}

function ImportOrdersScreen() {
  const open = useOpenScreen();
  const cols: Column<PORow>[] = [
    { key: 'docNo', header: 'Import PO No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'supplier.name', header: 'Supplier' },
    { key: 'supplierCountry', header: 'Country', width: 90 },
    { key: 'incoterms', header: 'Incoterms', width: 80 },
    { key: 'portOfLoading', header: 'Port of Loading', hidden: true },
    { key: 'portOfDestination', header: 'Port of Destination', hidden: true },
    { key: 'shippingMethod', header: 'Shipping', width: 80 },
    { key: 'currencyCode', header: 'Currency', width: 70 },
    { key: 'total', header: 'Amount', type: 'money', total: 'sum' },
    { key: 'baseTotal', header: 'Amount (Base)', type: 'money', hidden: true, sortable: false },
    { key: 'advancePaid', header: 'Advance Paid', type: 'money', sortable: false },
    { key: 'status', header: 'Status', type: 'status', width: 130 },
    { key: 'receivedPct', header: 'Received', type: 'percent', width: 80, sortable: false },
  ];
  const can = usePermission();
  return (
    <PurchaseList<PORow>
      tableKey="import-purchase-orders" url="/import-orders" title="Import PO" formScreen="import-purchase-order-form" module="import_purchase" newLabel="New Import PO" columns={cols} statuses={IMPORT_STATUSES} pdfType="PURCHASE_ORDER"
      extraToolbar={
        <>
          <Button icon={FileText} onClick={() => open('supplier-proformas', {}, 'Supplier Proformas')}>Supplier Proformas</Button>
          <Button icon={Container} onClick={() => open('goods-in-transit', {}, 'Goods in Transit')}>Goods in Transit</Button>
        </>
      }
      rowActions={(r) => [
        { label: 'New Shipment', icon: Ship, hidden: (x) => !['CONFIRMED', 'PAYMENT_PENDING', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS'].includes(x.status) || !can('import_purchase', 'create'), onClick: () => { open('import-shipment-form', { orderId: r.id }, 'New Shipment'); } },
      ]}
    />
  );
}

/* ------------------------------------------------------------------ form */
const schema = z.object({
  supplierId: z.coerce.number({ invalid_type_error: 'Supplier required' }).int().positive('Supplier required'),
  docDate: z.string().min(1, 'Date required'),
  items: z.array(z.object({ productId: z.number({ required_error: 'Product required', invalid_type_error: 'Product required' }), qty: z.number().positive('Qty must be > 0'), rate: z.number().min(0) }).passthrough()).min(1, 'Add at least one line'),
}).passthrough();

const FINAL_IMPORT = ['CANCELLED', 'COMPLETED'];

function OrderForm({ kind, params, tabId }: ScreenProps & { kind: Kind }) {
  const open = useOpenScreen();
  const can = usePermission();
  const lk = useLookups();
  const isImport = kind === 'IMPORT';
  const url = isImport ? '/import-orders' : '/purchase-orders';
  const module = isImport ? 'import_purchase' : 'purchase_order';
  const { ask, dialog } = useAsk();

  const ctl = useDocForm({
    url, params, tabId, schema,
    defaults: {
      docDate: today(), supplierId: '', warehouseId: '', currencyCode: '', exchangeRate: 1, paymentTerms: '', deliveryTerms: '', expectedDate: '', quotationRef: '', remarks: '', terms: '', roundOff: 0,
      supplierCountry: '', incoterms: '', portOfLoading: '', portOfDestination: '', shippingMethod: '', shippingAgent: '', clearingAgent: '', items: [],
    },
    toForm: (d) => ({
      ...d, docDate: isoOf(d.docDate), expectedDate: isoOf(d.expectedDate), supplierId: d.supplierId, warehouseId: d.warehouseId ?? '', exchangeRate: num(d.exchangeRate) || 1, roundOff: num(d.roundOff),
      quotationRef: d.quotationRef ?? '', paymentTerms: d.paymentTerms ?? '', deliveryTerms: d.deliveryTerms ?? '', remarks: d.remarks ?? '', terms: d.terms ?? '',
      supplierCountry: d.supplierCountry ?? '', incoterms: d.incoterms ?? '', portOfLoading: d.portOfLoading ?? '', portOfDestination: d.portOfDestination ?? '',
      shippingMethod: d.shippingMethod ?? '', shippingAgent: d.shippingAgent ?? '', clearingAgent: d.clearingAgent ?? '',
      items: (d.items ?? []).map((i: any) => ({ ...i, qty: num(i.qty), rate: num(i.rate), discount: num(i.discount), vatRate: num(i.vatRate), description: i.description ?? '', oemNumber: i.oemNumber ?? '', receivedQty: num(i.receivedQty), pendingQty: num(i.pendingQty), invoicedQty: num(i.invoicedQty) })),
    }),
  });
  const { doc, form, status, editable } = ctl;
  const items = (useWatch({ control: form.control, name: 'items' }) as any[] | undefined) ?? [];
  const roundOff = num(useWatch({ control: form.control, name: 'roundOff' }));
  const currency = (useWatch({ control: form.control, name: 'currencyCode' }) as string | undefined) || lk.currencies.find((c) => c.isBase)?.code || 'AED';
  const rate = num(useWatch({ control: form.control, name: 'exchangeRate' })) || 1;
  const warehouseId = useWatch({ control: form.control, name: 'warehouseId' }) as string | number | undefined;
  const totals = calcTotals(items, roundOff);
  const o = doc.data as AnyDoc | undefined;
  const orderType = o?.orderType as Kind | undefined;

  const shipments = useQuery({
    queryKey: ['table', 'po-shipments', doc.id],
    enabled: isImport && !!doc.id,
    queryFn: async () => (await api.get<{ rows: any[] }>('/import-shipments', { params: { orderId: doc.id, pageSize: 50 } })).data.rows,
  });

  const payload = (v: FV) => ({
    docDate: v.docDate, supplierId: Number(v.supplierId), quotationRef: strOrNull(v.quotationRef), warehouseId: idOrNull(v.warehouseId),
    currencyCode: v.currencyCode || undefined, exchangeRate: v.exchangeRate || undefined, paymentTerms: strOrNull(v.paymentTerms), deliveryTerms: strOrNull(v.deliveryTerms),
    expectedDate: v.expectedDate || null, remarks: strOrNull(v.remarks), terms: strOrNull(v.terms), roundOff: num(v.roundOff),
    ...(isImport
      ? { supplierCountry: strOrNull(v.supplierCountry), incoterms: strOrNull(v.incoterms), portOfLoading: strOrNull(v.portOfLoading), portOfDestination: strOrNull(v.portOfDestination), shippingMethod: strOrNull(v.shippingMethod), shippingAgent: strOrNull(v.shippingAgent), clearingAgent: strOrNull(v.clearingAgent) }
      : {}),
    items: (v.items as any[]).map((i) => ({ productId: i.productId, oemNumber: strOrNull(i.oemNumber), description: strOrNull(i.description), qty: i.qty, unit: strOrNull(i.unit), rate: i.rate, discount: i.discount ?? 0, vatRate: i.vatRate ?? 0 })),
  });
  const onSave = ctl.save(payload);

  const transitions: TransitionDef[] = [
    { action: 'submit', label: isImport ? 'Confirm Order' : 'Submit', icon: Send, from: ['DRAFT'], perm: 'edit', saveFirst: true },
    { action: 'approve', label: 'Approve', icon: Check, from: ['PENDING_APPROVAL'], perm: 'approve', variant: 'primary', ask: { title: 'Approve order', message: 'Approve this purchase order?', commentLabel: 'Comment (optional)' } },
    { action: 'reject', label: 'Reject', icon: XCircle, from: ['PENDING_APPROVAL'], perm: 'reject', variant: 'danger', ask: { title: 'Reject order', commentLabel: 'Reason', commentRequired: true, danger: true } },
    ...(isImport ? [] : [{ action: 'close', label: 'Close', icon: Lock, from: ['APPROVED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED'], perm: 'edit', ask: { title: 'Close order', message: 'Close this order? Pending quantities will no longer be receivable.' } } as TransitionDef]),
    { action: 'cancel', label: 'Cancel Order', icon: XCircle, from: isImport ? ['DRAFT', 'PENDING_APPROVAL', 'CONFIRMED', 'PAYMENT_PENDING'] : ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'], perm: 'cancel', variant: 'danger', ask: { title: 'Cancel order', commentLabel: 'Reason (optional)', danger: true } },
  ];

  const createInvoice = async () => {
    const inv = await ctl.run('create-invoice');
    if (inv) open('purchase-invoice-form', { id: inv.id }, inv.docNo);
  };
  const setImportStatus = async (to: string) => {
    const r = await ask({ title: 'Update status', message: `Move order to ${fmt.status(to)}?`, confirmLabel: 'Update' });
    if (r.ok) await ctl.run('status', { status: to });
  };
  const receivable = !!status && (isImport ? ['CONFIRMED', 'PAYMENT_PENDING', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS'] : ['APPROVED', 'PARTIALLY_RECEIVED']).includes(status);
  const invoiceable = !doc.isNew && !!status && !['DRAFT', 'CANCELLED', 'PENDING_APPROVAL'].includes(status) && num(o?.receivedQty) > num(o?.invoicedQty);
  const latestShip = shipments.data?.[0];
  const gridCols = useMemo<LineColumn[]>(
    () => [
      { key: 'productId', header: 'Product', type: 'product' as const, width: 130, required: true },
      { key: 'oemNumber', header: 'OEM Number', type: 'readonly' as const, width: 120 },
      { key: 'description', header: 'Description', type: 'text' as const },
      { key: 'qty', header: 'Qty', type: 'qty' as const, width: 80, total: true },
      { key: 'unit', header: 'Unit', type: 'text' as const, width: 60 },
      { key: 'rate', header: `Rate (${currency})`, type: 'money' as const, width: 100 },
      { key: 'discount', header: 'Discount', type: 'money' as const, width: 85 },
      { key: 'vatRate', header: 'VAT %', type: 'percent' as const, width: 60 },
      { key: 'amount', header: 'Amount', type: 'computed' as const, width: 105, total: true, compute: (l: any) => calcLine(l).amount },
      ...(doc.isNew ? [] : [
        { key: 'receivedQty', header: 'Received', type: 'readonly' as const, format: 'qty' as const, width: 75, total: true },
        { key: 'pendingQty', header: 'Pending', type: 'readonly' as const, format: 'qty' as const, width: 75, total: true },
      ]),
    ],
    [currency, doc.isNew],
  );

  return (
    <FormProvider {...form}>
      <DocumentLayout
        title={isImport ? 'Import Purchase Order' : 'Purchase Order'} icon={isImport ? Globe : ShoppingCart} docNo={o?.docNo} status={status} loading={doc.isLoading} error={doc.error}
        actions={
          <StdActions ctl={ctl} module={module} transitions={transitions} onSave={onSave} pdfType="PURCHASE_ORDER"
            extra={
              <>
                {isImport && IMPORT_NEXT[status ?? ''] && can(module, 'edit') &&
                  IMPORT_NEXT[status!].map((s) => <DocAction key={s} icon={ArrowRight} onClick={() => setImportStatus(s)}>Mark {fmt.status(s)}</DocAction>)}
                <DocAction icon={PackagePlus} hidden={isImport || !receivable || !can('goods_receipt', 'create')} onClick={() => open('goods-receipt-form', { orderId: doc.id }, 'New GRN')}>Create GRN</DocAction>
                <DocAction icon={Ship} hidden={!isImport || !receivable || !can('import_purchase', 'create')} onClick={() => open('import-shipment-form', { orderId: doc.id }, 'New Shipment')}>New Shipment</DocAction>
                <DocAction icon={Receipt} hidden={!invoiceable || !can('purchase_invoice', 'create')} onClick={createInvoice}>Create Invoice</DocAction>
              </>
            }
          />
        }
      >
        <ServerError message={ctl.err} />
        {isImport && (
          <div className="border border-line bg-surface px-3 py-2 rounded-card shadow-card">
            <StatusStepper steps={IMPORT_STEPS} current={status === 'PENDING_APPROVAL' ? 'DRAFT' : status} cancelled={status === 'CANCELLED'} />
            {status === 'PENDING_APPROVAL' && <div className="mt-1 text-xs text-warning">Waiting for approval before the order is confirmed.</div>}
            {status === 'CANCELLED' && <div className="mt-1 text-xs text-danger">This order was cancelled.</div>}
          </div>
        )}
        <HeaderSection title={isImport ? 'Import PO Information' : 'PO Information'}>
          <ReadField label={isImport ? 'Import PO Number' : 'PO Number'} value={o?.docNo ?? '(auto)'} />
          <SupplierSelect suppliers={lk.suppliers} disabled={!editable} onPicked={(s) => applySupplierDefaults(form.setValue, form.getValues, s, lk.currencies, { country: isImport })} />
          <FDate name="docDate" label="PO Date" required disabled={!editable} />
          <FText name="quotationRef" label={isImport ? 'Proforma / Quotation Reference' : 'Quotation Reference'} disabled={!editable} />
          <FSelect name="warehouseId" label="Warehouse" options={lk.warehouseOptions} disabled={!editable} />
          <CurrencyFields disabled={!editable} currencies={lk.currencies} options={lk.currencyOptions} />
          <FText name="paymentTerms" label="Payment Terms" list="pterms" disabled={!editable} />
          <FText name="deliveryTerms" label="Delivery Terms" disabled={!editable} />
          <FDate name="expectedDate" label="Expected Delivery Date" disabled={!editable} />
          {isImport && <ReadField label="Advance Paid" value={fmt.money(o?.advancePaid ?? 0)} />}
        </HeaderSection>
        <datalist id="pterms">{lk.termNames.map((t) => <option key={t} value={t} />)}</datalist>
        <datalist id="incoterms">{INCOTERMS.map((t) => <option key={t} value={t} />)}</datalist>

        {isImport && (
          <HeaderSection title="Import Information">
            <FText name="supplierCountry" label="Supplier Country" disabled={!editable} />
            <FText name="incoterms" label="Incoterms" list="incoterms" disabled={!editable} />
            <FText name="portOfLoading" label="Port of Loading" disabled={!editable} />
            <FText name="portOfDestination" label="Port of Destination" disabled={!editable} />
            <FSelect name="shippingMethod" label="Shipping Method" options={SHIPPING_METHODS} disabled={!editable} />
            <FText name="shippingAgent" label="Shipping Agent" disabled={!editable} />
            <FText name="clearingAgent" label="Clearing Agent" disabled={!editable} />
            <ReadField label="Shipment No" value={latestShip?.shipmentNo ?? '-'} />
            <ReadField label="Container Number" value={latestShip?.containerNo ?? '-'} />
            <ReadField label="Bill of Lading / AWB" value={latestShip ? latestShip.billOfLading || latestShip.awb || '-' : '-'} />
            <ReadField label="ETD" value={latestShip?.etd ? fmt.date(latestShip.etd) : '-'} />
            <ReadField label="ETA" value={latestShip?.eta ? fmt.date(latestShip.eta) : '-'} />
          </HeaderSection>
        )}

        <DocSection title="Items">
          <LineItemsGrid
            readOnly={!editable}
            warehouseId={warehouseId as any}
            priceField="costPrice"
            onProductPick={(p, i, f) => pickPurchaseProduct(p, i, f, { zeroVat: isImport })}
            columns={gridCols}
            newLine={() => ({ qty: 1, rate: 0, discount: 0, vatRate: isImport ? 0 : 5, unit: '', description: '', oemNumber: '' })}
          />
          {(form.formState.errors.items as any)?.message && <div className="p-1 text-xs text-danger">{(form.formState.errors.items as any).message}</div>}
        </DocSection>

        <TotalsSection
          totals={totals} currency={currency}
          roundOffInput={<NumberInput className="w-[100px]" disabled={!editable} {...form.register('roundOff', { setValueAs: (v) => (v === '' || v == null ? 0 : Number(v)) })} />}
          extra={[
            ...(rate !== 1 ? [{ label: `Total in base currency @ ${rate}`, value: fmt.money(totals.total * rate) }] : []),
            ...(isImport && !doc.isNew ? [{ label: 'Advance paid', value: fmt.money(o?.advancePaid ?? 0) }] : []),
          ]}
        />
        <NotesSection title="Terms & Conditions / Remarks" fields={[{ label: 'Terms & Conditions', props: { ...form.register('terms'), disabled: !editable } }, { label: 'Remarks', props: { ...form.register('remarks'), disabled: !editable } }]} />

        {isImport && !doc.isNew && (
          <DocSection title="Shipments (Goods in Transit)" right={receivable && can('import_purchase', 'create') ? <Button size="sm" icon={Ship} onClick={() => open('import-shipment-form', { orderId: doc.id }, 'New Shipment')}>New Shipment</Button> : undefined}>
            {(shipments.data ?? []).length === 0 ? (
              <div className="px-1 text-[13px] text-ink-muted">No shipments yet.</div>
            ) : (
              <table className="w-full text-[13px]">
                <thead><tr className="border-b border-line text-left text-xs text-ink-muted"><th className="py-1.5">Shipment</th><th>Container</th><th>BL / AWB</th><th>ETD</th><th>ETA</th><th className="text-right">Qty</th><th className="text-right">Received</th><th>Status</th></tr></thead>
                <tbody>
                  {shipments.data!.map((s) => (
                    <tr key={s.id} className="cursor-pointer border-b border-line hover:bg-brand-soft" onDoubleClick={() => open('import-shipment-form', { id: s.id }, s.shipmentNo)}>
                      <td className="py-1.5 text-brand"><button onClick={() => open('import-shipment-form', { id: s.id }, s.shipmentNo)}>{s.shipmentNo}</button></td>
                      <td>{s.containerNo}</td><td>{s.billOfLading || s.awb}</td><td>{fmt.date(s.etd)}</td><td>{fmt.date(s.eta)}</td>
                      <td className="text-right tabular-nums">{fmt.qty(s.quantity)}</td><td className="text-right tabular-nums">{fmt.qty(s.receivedQty)}</td>
                      <td>{s.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </DocSection>
        )}
        {!doc.isNew && (
          <>
            <LinkedDocs title="Goods Receipts" docs={(o?.receipts ?? []).map((r: any) => ({ screenId: 'goods-receipt-form', id: r.id, label: r.docNo, status: r.status }))} />
            <LinkedDocs title="Purchase Invoices" docs={(o?.invoices ?? []).map((r: any) => ({ screenId: 'purchase-invoice-form', id: r.id, label: r.docNo, status: r.status, extra: fmt.money(r.total) }))} />
          </>
        )}
        <DocFooter docType="PURCHASE_ORDER" entity="PurchaseOrder" doc={doc.data} isNew={doc.isNew} />
      {!isImport && <RevisionHistory entity="PurchaseOrder" id={params.id} />}
      </DocumentLayout>
      {dialog}
      <span className="hidden">{FINAL_IMPORT.length}{orderType}</span>
    </FormProvider>
  );
}

/** purchase-order-form is also the target of document-flow links for import orders: pick the right variant after loading. */
function PurchaseOrderFormScreen(p: ScreenProps) {
  const id = p.params.id;
  const probe = useQuery({
    queryKey: ['doc', '/purchase-orders', id === undefined ? 'new' : String(id)],
    enabled: id !== undefined && id !== '',
    queryFn: async () => (await api.get<AnyDoc>(`/purchase-orders/${id}`)).data,
  });
  if (id !== undefined && id !== '' && probe.isLoading) return <LoadingBlock />;
  const kind: Kind = probe.data?.orderType === 'IMPORT' ? 'IMPORT' : 'LOCAL';
  return <OrderForm key={kind} kind={kind} {...p} />;
}
const ImportPurchaseOrderForm = (p: ScreenProps) => <OrderForm kind="IMPORT" {...p} />;

export default [
  { id: 'purchase-orders', title: 'Purchase Orders', icon: ShoppingCart, component: PurchaseOrdersScreen, permission: 'purchase_order' },
  { id: 'purchase-order-form', title: 'Purchase Order', icon: ShoppingCart, component: PurchaseOrderFormScreen, multiInstance: true, permission: 'purchase_order' },
  { id: 'import-purchase-orders', title: 'Import Purchase Orders', icon: Globe, component: ImportOrdersScreen, permission: 'import_purchase' },
  { id: 'import-purchase-order-form', title: 'Import Purchase Order', icon: Globe, component: ImportPurchaseOrderForm, multiInstance: true, permission: 'import_purchase' },
] satisfies ScreenDef[];
