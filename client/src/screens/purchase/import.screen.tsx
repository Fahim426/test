/* eslint-disable @typescript-eslint/no-explicit-any */
/** Import purchase: Import Request, Supplier Proforma, Goods in Transit grid, Import Shipment form. */
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Container, FileText, Globe, PackagePlus, Send, Ship, XCircle, ExternalLink } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column, DataTable, RowAction, TableParams } from '@/components/DataTable';
import { DocAction, DocSection, DocumentLayout, HeaderSection, LineItemsGrid, NotesSection, TotalsSection } from '@/components/doc';
import { Button, Select } from '@/components/ui';
import { useOpenScreen } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { api, apiError, Paged } from '@/lib/api';
import { calcTotals, num } from '@/lib/calc';
import { cn } from '@/lib/cn';
import { fmt, today } from '@/lib/format';
import { toast } from '@/store/toast';
import {
  AnyDoc, CurrencyFields, DocFooter, FDate, FormProvider, FSelect, FText, idOrNull, INCOTERMS, isoOf, LinkedDocs, PickModal, PurchaseList, ReadField, ServerError, SHIPPING_METHODS,
  StatusStepper, StdActions, strOrNull, TransitionDef, useDocForm, useLookups, useRows, useWatch, FV, SupplierSelect, statusOptions,
} from '@/components/purchase/kit';
import { applySupplierDefaults } from '@/components/purchase/helpers';

/* =============================================================== IMPORT REQUEST */
const IR_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PROFORMA_RECEIVED', 'CONVERTED', 'CANCELLED'];
interface IrRow { id: number; docNo: string; docDate: string; supplier?: { name: string }; warehouse?: { name: string }; itemCount: number; totalQty: number; status: string }

function ImportRequestsScreen() {
  const open = useOpenScreen();
  const cols: Column<IrRow>[] = [
    { key: 'docNo', header: 'Request No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'supplier.name', header: 'Supplier' },
    { key: 'warehouse.name', header: 'Warehouse' },
    { key: 'itemCount', header: 'Items', type: 'number', width: 60, sortable: false },
    { key: 'totalQty', header: 'Total Qty', type: 'qty', width: 90, sortable: false },
    { key: 'status', header: 'Status', type: 'status', width: 140 },
  ];
  return (
    <PurchaseList<IrRow> tableKey="import-requests" url="/import-requests" title="Import Request" formScreen="import-request-form" module="import_purchase" columns={cols} statuses={IR_STATUSES}
      extraToolbar={<Button icon={FileText} onClick={() => open('supplier-proformas', {}, 'Supplier Proformas')}>Supplier Proformas</Button>}
      rowActions={(r) => [{ label: 'Record Proforma', icon: FileText, hidden: (x) => !['APPROVED', 'PROFORMA_RECEIVED'].includes(x.status), onClick: () => { open('supplier-proforma-form', { importRequestId: r.id }, 'New Proforma'); } }]} />
  );
}

const irSchema = z.object({
  docDate: z.string().min(1, 'Date required'),
  items: z.array(z.object({ qty: z.number().positive('Qty must be > 0') }).passthrough().refine((i: any) => !!i.productId || !!i.description, { message: 'Each line needs a product or description' })).min(1, 'Add at least one line'),
}).passthrough();

function ImportRequestForm({ params, tabId }: ScreenProps) {
  const open = useOpenScreen();
  const can = usePermission();
  const lk = useLookups();
  const ctl = useDocForm({
    url: '/import-requests', params, tabId, schema: irSchema,
    defaults: { docDate: today(), supplierId: '', warehouseId: '', remarks: '', items: [] },
    toForm: (d) => ({ ...d, docDate: isoOf(d.docDate), supplierId: d.supplierId ?? '', warehouseId: d.warehouseId ?? '', remarks: d.remarks ?? '', items: (d.items ?? []).map((i: any) => ({ ...i, description: i.description ?? '', qty: num(i.qty) })) }),
  });
  const { doc, form, status, editable } = ctl;
  const onSave = ctl.save((v) => ({
    docDate: v.docDate, supplierId: idOrNull(v.supplierId), warehouseId: idOrNull(v.warehouseId), remarks: strOrNull(v.remarks),
    items: (v.items as any[]).map((i) => ({ productId: idOrNull(i.productId), description: strOrNull(i.description), qty: i.qty, unit: strOrNull(i.unit) })),
  }));
  const transitions: TransitionDef[] = [
    { action: 'submit', label: 'Submit', icon: Send, from: ['DRAFT'], perm: 'edit', saveFirst: true },
    { action: 'approve', label: 'Approve', icon: Check, from: ['SUBMITTED'], perm: 'approve', variant: 'primary', ask: { title: 'Approve', message: 'Approve this import request?' } },
    { action: 'reject', label: 'Reject', icon: XCircle, from: ['SUBMITTED'], perm: 'reject', variant: 'danger', ask: { title: 'Reject', commentLabel: 'Reason', commentRequired: true, danger: true } },
    { action: 'cancel', label: 'Cancel', icon: XCircle, from: ['DRAFT', 'SUBMITTED', 'APPROVED', 'PROFORMA_RECEIVED'], perm: 'cancel', variant: 'danger', ask: { title: 'Cancel request', danger: true, message: 'Cancel this import request?' } },
  ];
  return (
    <FormProvider {...form}>
      <DocumentLayout
        title="Import Request" icon={Globe} docNo={doc.data?.docNo} status={status} loading={doc.isLoading} error={doc.error}
        actions={
          <StdActions ctl={ctl} module="import_purchase" transitions={transitions} onSave={onSave}
            extra={<DocAction icon={FileText} hidden={!['APPROVED', 'PROFORMA_RECEIVED'].includes(status ?? '') || !can('import_purchase', 'create')} onClick={() => open('supplier-proforma-form', { importRequestId: doc.id }, 'New Proforma')}>Record Supplier Proforma</DocAction>}
          />
        }
      >
        <ServerError message={ctl.err} />
        <HeaderSection title="Import Request Information">
          <ReadField label="Request Number" value={doc.data?.docNo ?? '(auto)'} />
          <FDate name="docDate" label="Date" required disabled={!editable} />
          <FSelect name="supplierId" label="Preferred Supplier" options={lk.supplierOptions} disabled={!editable} />
          <FSelect name="warehouseId" label="Warehouse" options={lk.warehouseOptions} disabled={!editable} />
        </HeaderSection>
        <DocSection title="Items">
          <LineItemsGrid
            readOnly={!editable}
            columns={[
              { key: 'productId', header: 'Product', type: 'product', width: 140 },
              { key: 'oemNumber', header: 'OEM', type: 'readonly', width: 130, compute: (l: any) => l.product?.oemNumber ?? l.oemNumber ?? '' },
              { key: 'description', header: 'Description', type: 'text' },
              { key: 'qty', header: 'Quantity', type: 'qty', width: 100, total: true },
              { key: 'unit', header: 'Unit', type: 'text', width: 70 },
            ]}
            newLine={() => ({ qty: 1, unit: '', description: '' })}
          />
          {(form.formState.errors.items as any)?.message && <div className="p-1 text-[11px] text-red-600">{(form.formState.errors.items as any).message}</div>}
        </DocSection>
        <NotesSection fields={[{ label: 'Remarks', props: { ...form.register('remarks'), disabled: !editable } }]} />
        <LinkedDocs title="Supplier Proformas" docs={(doc.data?.proformas ?? []).map((p: any) => ({ screenId: 'supplier-proforma-form', id: p.id, label: p.docNo, status: p.status, extra: `${p.supplier?.name ?? ''} ${fmt.money(p.total)} ${p.currencyCode}` }))} />
        <DocFooter docType="IMPORT_REQUEST" entity="ImportRequest" doc={doc.data} isNew={doc.isNew} approvalDoc={false} />
      </DocumentLayout>
    </FormProvider>
  );
}

/* =============================================================== SUPPLIER PROFORMA */
interface SpRow { id: number; docNo: string; docDate: string; supplier?: { name: string }; supplierRef?: string; currencyCode: string; total: number; baseTotal: number; incoterms?: string; status: string }
function SupplierProformasScreen() {
  const cols: Column<SpRow>[] = [
    { key: 'docNo', header: 'Proforma No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'supplier.name', header: 'Supplier' },
    { key: 'supplierRef', header: 'Supplier Ref', hidden: true },
    { key: 'incoterms', header: 'Incoterms', width: 80 },
    { key: 'currencyCode', header: 'Currency', width: 70 },
    { key: 'total', header: 'Total', type: 'money', total: 'sum' },
    { key: 'baseTotal', header: 'Total (Base)', type: 'money', total: 'sum', sortable: false },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
  ];
  return <PurchaseList<SpRow> tableKey="supplier-proformas" url="/supplier-proformas" title="Supplier Proforma" formScreen="supplier-proforma-form" module="import_purchase" columns={cols} statuses={['RECEIVED', 'CONVERTED', 'CANCELLED']} newLabel="New Proforma" />;
}

const spSchema = z.object({
  supplierId: z.coerce.number({ invalid_type_error: 'Supplier required' }).int().positive('Supplier required'),
  docDate: z.string().min(1),
  items: z.array(z.object({ qty: z.number().positive('Qty must be > 0'), rate: z.number().min(0) }).passthrough().refine((i: any) => !!i.productId || !!i.description, { message: 'Each line needs a product or description' })).min(1, 'Add at least one line'),
}).passthrough();

function SupplierProformaForm({ params, tabId }: ScreenProps) {
  const open = useOpenScreen();
  const lk = useLookups();
  const requestId = params.importRequestId as number | undefined;
  const [poOpen, setPoOpen] = useState(false);
  const req = useQuery({ queryKey: ['proforma-prefill', requestId], enabled: !params.id && !!requestId, queryFn: async () => (await api.get<any>(`/import-requests/${requestId}`)).data });
  const newValues = useMemo<FV | undefined>(() => {
    const r = req.data;
    if (!r) return undefined;
    const sup = lk.suppliers.find((s) => s.id === r.supplierId);
    return {
      importRequestId: r.id, supplierId: r.supplierId ?? '', supplierRef: '', docDate: today(), currencyCode: sup?.currencyCode ?? '', exchangeRate: lk.currencies.find((c) => c.code === sup?.currencyCode)?.rate ?? 1, incoterms: '', remarks: '',
      items: (r.items as any[]).map((i) => ({ productId: i.productId, product: i.product, oemNumber: i.product?.oemNumber ?? '', description: i.description ?? '', qty: num(i.qty), unit: i.unit ?? '', rate: 0 })),
    };
  }, [req.data, lk.suppliers, lk.currencies]);
  const ctl = useDocForm({
    url: '/supplier-proformas', params, tabId, schema: spSchema, editableStatuses: ['RECEIVED'], newValues,
    defaults: { docDate: today(), supplierId: '', supplierRef: '', currencyCode: '', exchangeRate: 1, incoterms: '', remarks: '', items: [], importRequestId: requestId ?? null },
    toForm: (d) => ({ ...d, docDate: isoOf(d.docDate), supplierRef: d.supplierRef ?? '', incoterms: d.incoterms ?? '', remarks: d.remarks ?? '', exchangeRate: num(d.exchangeRate) || 1, items: (d.items ?? []).map((i: any) => ({ ...i, description: i.description ?? '', qty: num(i.qty), rate: num(i.rate) })) }),
  });
  const { doc, form, status, editable } = ctl;
  const sp = doc.data as AnyDoc | undefined;
  const items = (useWatch({ control: form.control, name: 'items' }) as any[] | undefined) ?? [];
  const currency = (useWatch({ control: form.control, name: 'currencyCode' }) as string | undefined) || 'AED';
  const totals = calcTotals(items.map((i) => ({ qty: i.qty, rate: i.rate, discount: 0, vatRate: 0 })));
  const supplierId = useWatch({ control: form.control, name: 'supplierId' }) as string | number;
  const sup = lk.suppliers.find((s) => String(s.id) === String(supplierId));

  const onSave = ctl.save((v) => ({
    ...(doc.isNew && v.importRequestId ? { importRequestId: v.importRequestId } : {}),
    supplierId: Number(v.supplierId), supplierRef: strOrNull(v.supplierRef), docDate: v.docDate, currencyCode: v.currencyCode || undefined, exchangeRate: v.exchangeRate || undefined, incoterms: strOrNull(v.incoterms), remarks: strOrNull(v.remarks),
    items: (v.items as any[]).map((i) => ({ productId: idOrNull(i.productId), description: strOrNull(i.description), qty: i.qty, unit: strOrNull(i.unit), rate: i.rate })),
  }));
  const transitions: TransitionDef[] = [
    { action: 'cancel', label: 'Cancel', icon: XCircle, from: ['RECEIVED'], perm: 'cancel', variant: 'danger', ask: { title: 'Cancel proforma', danger: true, message: 'Cancel this proforma invoice?' } },
  ];
  const createPo = async (v: Record<string, string>) => {
    const po = await ctl.run('create-order', {
      warehouseId: idOrNull(v.warehouseId) ?? undefined, expectedDate: v.expectedDate || undefined, supplierCountry: strOrNull(v.supplierCountry) ?? undefined, incoterms: strOrNull(v.incoterms) ?? undefined,
      portOfLoading: strOrNull(v.portOfLoading) ?? undefined, portOfDestination: strOrNull(v.portOfDestination) ?? undefined, shippingMethod: strOrNull(v.shippingMethod) ?? undefined,
      shippingAgent: strOrNull(v.shippingAgent) ?? undefined, clearingAgent: strOrNull(v.clearingAgent) ?? undefined, paymentTerms: strOrNull(v.paymentTerms) ?? undefined,
    });
    if (po) {
      setPoOpen(false);
      open('import-purchase-order-form', { id: po.id }, po.docNo);
    }
  };

  return (
    <FormProvider {...form}>
      <DocumentLayout
        title="Supplier Proforma Invoice" icon={FileText} docNo={sp?.docNo} status={status} loading={doc.isLoading || (!!requestId && req.isLoading)} error={doc.error}
        actions={
          <StdActions ctl={ctl} module="import_purchase" transitions={transitions} onSave={onSave} deleteStatuses={['RECEIVED', 'CANCELLED']}
            extra={<DocAction icon={Globe} variant="primary" hidden={status !== 'RECEIVED'} onClick={() => setPoOpen(true)}>Create Import PO</DocAction>}
          />
        }
      >
        <ServerError message={ctl.err} />
        <HeaderSection title="Proforma Information">
          <ReadField label="Proforma Number" value={sp?.docNo ?? '(auto)'} />
          <SupplierSelect suppliers={lk.suppliers} disabled={!editable} onPicked={(s) => applySupplierDefaults(form.setValue, form.getValues, s, lk.currencies)} />
          <FText name="supplierRef" label="Supplier Proforma Ref" disabled={!editable} />
          <FDate name="docDate" label="Date" required disabled={!editable} />
          <CurrencyFields disabled={!editable} currencies={lk.currencies} options={lk.currencyOptions} />
          <FText name="incoterms" label="Incoterms" list="incoterms" disabled={!editable} />
          <ReadField label="Import Request" value={(sp?.importRequestId ?? requestId) ? <button className="text-brand hover:underline" onClick={() => open('import-request-form', { id: sp?.importRequestId ?? requestId }, 'Import Request')}>#{sp?.importRequestId ?? requestId}</button> : '-'} />
        </HeaderSection>
        <datalist id="incoterms">{INCOTERMS.map((t) => <option key={t} value={t} />)}</datalist>
        <DocSection title="Items">
          <LineItemsGrid
            readOnly={!editable}
            priceField="lastPurchasePrice"
            columns={[
              { key: 'productId', header: 'Product', type: 'product', width: 140 },
              { key: 'oemNumber', header: 'OEM', type: 'readonly', width: 120, compute: (l: any) => l.product?.oemNumber ?? l.oemNumber ?? '' },
              { key: 'description', header: 'Description', type: 'text' },
              { key: 'qty', header: 'Qty', type: 'qty', width: 90, total: true },
              { key: 'unit', header: 'Unit', type: 'text', width: 60 },
              { key: 'rate', header: `Unit Price (${currency})`, type: 'money', width: 120 },
              { key: 'amount', header: 'Amount', type: 'computed', width: 120, total: true, compute: (l: any) => num(l.qty) * num(l.rate) },
            ]}
            newLine={() => ({ qty: 1, rate: 0, unit: '', description: '' })}
          />
          {(form.formState.errors.items as any)?.message && <div className="p-1 text-[11px] text-red-600">{(form.formState.errors.items as any).message}</div>}
        </DocSection>
        <TotalsSection totals={totals} currency={currency} />
        <NotesSection fields={[{ label: 'Remarks', props: { ...form.register('remarks'), disabled: !editable } }]} />
        <DocFooter docType="SUPPLIER_PROFORMA" entity="SupplierProforma" doc={doc.data} isNew={doc.isNew} approvalDoc={false} />
      </DocumentLayout>
      <PickModal
        open={poOpen} title="Create Import Purchase Order from Proforma" width="lg" onClose={() => setPoOpen(false)} submitLabel="Create Import PO" onSubmit={createPo}
        fields={[
          { name: 'warehouseId', label: 'Receiving Warehouse', type: 'select', options: lk.warehouseOptions },
          { name: 'expectedDate', label: 'Expected Delivery', type: 'date' },
          { name: 'supplierCountry', label: 'Supplier Country', value: sup?.country ?? '' },
          { name: 'incoterms', label: 'Incoterms', value: sp?.incoterms ?? '' },
          { name: 'portOfLoading', label: 'Port of Loading' },
          { name: 'portOfDestination', label: 'Port of Destination' },
          { name: 'shippingMethod', label: 'Shipping Method', type: 'select', options: SHIPPING_METHODS },
          { name: 'paymentTerms', label: 'Payment Terms', value: sup?.paymentTermName ?? '' },
          { name: 'shippingAgent', label: 'Shipping Agent' },
          { name: 'clearingAgent', label: 'Clearing Agent' },
        ]}
      />
    </FormProvider>
  );
}

/* =============================================================== GOODS IN TRANSIT */
interface GitRow {
  kind: 'SHIPMENT' | 'ORDER'; orderId: number; orderNo: string; orderStatus?: string; supplierId: number; supplier?: { name: string }; shipmentId: number | null; shipmentNo: string | null; containerNo: string | null; blAwb: string | null;
  etd: string | null; eta: string | null; expectedArrival: string | null; status: string; quantity: number; receivedQty: number; pendingQty: number; daysToArrival: number | null; delayed: boolean; shippingAgent?: string;
}
const SHIP_NEXT: Record<string, { to: string; label: string }[]> = {
  BOOKED: [{ to: 'IN_TRANSIT', label: 'Mark In Transit' }],
  IN_TRANSIT: [{ to: 'ARRIVED', label: 'Mark Arrived' }],
  ARRIVED: [{ to: 'CUSTOMS', label: 'Mark In Customs' }, { to: 'CLEARED', label: 'Mark Cleared' }],
  CUSTOMS: [{ to: 'CLEARED', label: 'Mark Cleared' }],
};
const GIT_STATUSES = ['NOT_SHIPPED', 'BOOKED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED', 'RECEIVED'];

function GoodsInTransitScreen() {
  const open = useOpenScreen();
  const can = usePermission();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');

  const fetcher = async (p: TableParams): Promise<Paged<GitRow>> => {
    const res = (await api.get<{ rows: GitRow[] }>('/goods-in-transit', { params: status === 'RECEIVED' ? { status: 'RECEIVED' } : {} })).data.rows;
    let rows = res.filter((r) => !status || status === 'RECEIVED' || r.status === status);
    const s = String(p.search ?? '').toLowerCase();
    if (s) rows = rows.filter((r) => [r.orderNo, r.shipmentNo, r.containerNo, r.blAwb, r.supplier?.name, r.status].some((v) => String(v ?? '').toLowerCase().includes(s)));
    if (p.sort) {
      const k = String(p.sort);
      const dir = p.dir === 'asc' ? 1 : -1;
      const get = (r: any) => (k === 'supplier.name' ? r.supplier?.name : r[k]);
      rows = [...rows].sort((a, b) => ((get(a) ?? '') > (get(b) ?? '') ? 1 : (get(a) ?? '') < (get(b) ?? '') ? -1 : 0) * dir);
    }
    const page = Number(p.page) || 1;
    const size = Number(p.pageSize) || 50;
    return { rows: rows.slice((page - 1) * size, page * size), total: rows.length, page, pageSize: size };
  };
  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn();
      if (msg) toast.success(msg);
      qc.invalidateQueries({ queryKey: ['table'] });
      qc.invalidateQueries({ queryKey: ['doc'] });
    } catch (e) {
      toast.error(apiError(e));
    }
  };
  const cols: Column<GitRow>[] = [
    { key: 'orderNo', header: 'Import PO', width: 130, filter: 'text', cell: (r) => <button className="text-brand hover:underline" onClick={() => open('import-purchase-order-form', { id: r.orderId }, r.orderNo)}>{r.orderNo}</button> },
    { key: 'supplier.name', header: 'Supplier' },
    { key: 'shipmentNo', header: 'Shipment', width: 120, cell: (r) => (r.shipmentNo ? <button className="text-brand hover:underline" onClick={() => open('import-shipment-form', { id: r.shipmentId! }, r.shipmentNo!)}>{r.shipmentNo}</button> : <span className="text-slate-400">not shipped</span>) },
    { key: 'containerNo', header: 'Container', width: 110 },
    { key: 'blAwb', header: 'BL / AWB', width: 110 },
    { key: 'etd', header: 'ETD', type: 'date', width: 95 },
    { key: 'eta', header: 'ETA', width: 95, cell: (r) => <span className={cn(r.delayed && 'font-semibold text-red-600')} title={r.delayed ? 'Delayed' : undefined}>{fmt.date(r.eta)}</span> },
    { key: 'status', header: 'Current Status', type: 'status', width: 120 },
    { key: 'expectedArrival', header: 'Expected Arrival', type: 'date', width: 110 },
    { key: 'daysToArrival', header: 'Days to Arrival', width: 90, align: 'right', cell: (r) => (r.daysToArrival == null ? '' : <span className={cn(r.daysToArrival < 0 && 'font-semibold text-red-600')}>{r.daysToArrival < 0 ? `${-r.daysToArrival} late` : r.daysToArrival}</span>) },
    { key: 'quantity', header: 'Product Qty', type: 'qty', total: 'sum' },
    { key: 'receivedQty', header: 'Received Qty', type: 'qty', total: 'sum' },
    { key: 'pendingQty', header: 'Pending Qty', type: 'qty', total: 'sum' },
    { key: 'shippingAgent', header: 'Shipping Agent', hidden: true },
  ];
  const actions = (r: GitRow): RowAction<GitRow>[] => [
    { label: 'Open Import PO', icon: ExternalLink, onClick: () => { open('import-purchase-order-form', { id: r.orderId }, r.orderNo); } },
    { label: 'Open Shipment', icon: Ship, hidden: (x) => !x.shipmentId, onClick: () => { open('import-shipment-form', { id: r.shipmentId! }, r.shipmentNo ?? 'Shipment'); } },
    { label: 'New Shipment', icon: Ship, hidden: (x) => x.kind !== 'ORDER' || !can('import_purchase', 'create'), onClick: () => { open('import-shipment-form', { orderId: r.orderId }, 'New Shipment'); } },
    ...(SHIP_NEXT[r.status] ?? []).map((n): RowAction<GitRow> => ({
      label: n.label, icon: ArrowRight, hidden: () => !r.shipmentId || !can('import_purchase', 'edit'),
      onClick: () => { void act(() => api.post(`/import-shipments/${r.shipmentId}/status`, { status: n.to }), `Shipment ${fmt.status(n.to)}`); },
    })),
    { label: 'Receive (Import GRN)', icon: PackagePlus, hidden: (x) => !x.shipmentId || !['ARRIVED', 'CUSTOMS', 'CLEARED'].includes(x.status) || !(x.pendingQty > 0) || !can('goods_receipt', 'create'), onClick: () => { open('goods-receipt-form', { orderId: r.orderId, shipmentId: r.shipmentId! }, 'New GRN'); } },
  ];
  return (
    <DataTable<GitRow>
      tableKey="goods-in-transit" queryKey="goods-in-transit" fetcher={fetcher} columns={cols} filters={{ status }} exportName="Goods in Transit" rowActions={actions}
      getRowId={(r) => `${r.kind}-${r.orderId}-${r.shipmentId ?? 0}`}
      defaultPageSize={50}
      onRowDoubleClick={(r) => (r.shipmentId ? open('import-shipment-form', { id: r.shipmentId }, r.shipmentNo ?? 'Shipment') : open('import-purchase-order-form', { id: r.orderId }, r.orderNo))}
      toolbarExtras={
        <>
          <Select className="w-[150px]" value={status} onChange={(e) => setStatus(e.target.value)} options={statusOptions(GIT_STATUSES)} placeholder="All statuses" />
          {can('import_purchase', 'create') && <Button variant="primary" icon={Ship} onClick={() => open('import-shipment-form', {}, 'New Shipment')}>New Shipment</Button>}
        </>
      }
    />
  );
}

/* =============================================================== IMPORT SHIPMENT */
const SHIP_STEPS = ['BOOKED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED', 'RECEIVED'];
const shipSchema = z.object({
  items: z.array(z.object({ qty: z.number().min(0) }).passthrough()).min(1, 'No lines to ship').refine((a) => a.some((i: any) => i.qty > 0), { message: 'Enter a quantity on at least one line' })
    .refine((a) => a.every((i: any) => i.maxQty === undefined || i.qty <= i.maxQty + 0.0005), { message: 'A quantity exceeds what is still unshipped on the order' }),
}).passthrough();

function ImportShipmentForm({ params, tabId }: ScreenProps) {
  const open = useOpenScreen();
  const can = usePermission();
  const [orderId, setOrderId] = useState<number | undefined>(params.orderId ? Number(params.orderId) : undefined);
  const isNewDoc = params.id === undefined || params.id === '';
  const git = useRows<GitRow & { items: any[] }>('/goods-in-transit', {}, isNewDoc);
  const orderRow = (git.data ?? []).find((r) => r.kind === 'ORDER' && r.orderId === orderId);
  const newValues = useMemo<FV | undefined>(() => {
    if (!orderRow) return undefined;
    return {
      orderId: orderRow.orderId, containerNo: '', billOfLading: '', awb: '', etd: '', eta: '', actualArrival: '', shippingAgent: orderRow.shippingAgent ?? '', clearingAgent: '', remarks: '',
      items: orderRow.items.map((i: any) => ({ orderItemId: i.orderItemId, productId: i.productId, product: i.product, qty: i.qty, maxQty: i.qty, receivedQty: 0 })),
    };
  }, [orderRow]);
  const ctl = useDocForm({
    url: '/import-shipments', params, tabId, schema: shipSchema, newValues, editableStatuses: ['BOOKED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED'],
    titleOf: (d) => d.shipmentNo,
    defaults: { containerNo: '', billOfLading: '', awb: '', etd: '', eta: '', actualArrival: '', shippingAgent: '', clearingAgent: '', remarks: '', items: [] },
    toForm: (d) => ({
      ...d, containerNo: d.containerNo ?? '', billOfLading: d.billOfLading ?? '', awb: d.awb ?? '', etd: isoOf(d.etd), eta: isoOf(d.eta), actualArrival: isoOf(d.actualArrival), shippingAgent: d.shippingAgent ?? '', clearingAgent: d.clearingAgent ?? '', remarks: d.remarks ?? '',
      items: (d.items ?? []).map((i: any) => ({ ...i, qty: num(i.qty), receivedQty: num(i.receivedQty), pendingQty: num(i.pendingQty) })),
    }),
  });
  const { doc, form, status, editable } = ctl;
  const s = doc.data as AnyDoc | undefined;
  const itemsEditable = doc.isNew || status === 'BOOKED';
  const order = s?.order ?? (orderRow ? { id: orderRow.orderId, docNo: orderRow.orderNo, supplier: orderRow.supplier, status: orderRow.orderStatus } : undefined);
  const items = (useWatch({ control: form.control, name: 'items' }) as any[] | undefined) ?? [];

  const onSave = ctl.save((v) => ({
    ...(doc.isNew ? { orderId: v.orderId } : {}),
    containerNo: strOrNull(v.containerNo), billOfLading: strOrNull(v.billOfLading), awb: strOrNull(v.awb), etd: v.etd || null, eta: v.eta || null, actualArrival: v.actualArrival || null,
    shippingAgent: strOrNull(v.shippingAgent), clearingAgent: strOrNull(v.clearingAgent), remarks: strOrNull(v.remarks),
    ...(itemsEditable ? { items: (v.items as any[]).filter((i) => i.qty > 0).map((i) => ({ orderItemId: i.orderItemId, qty: i.qty })) } : {}),
  }));
  const next = SHIP_NEXT[status ?? ''] ?? [];
  const setStatus = async (to: string) => {
    if (form.formState.isDirty && editable) {
      const ok = await onSave();
      if (!ok) return;
    }
    await ctl.run('status', { status: to, actualArrival: to === 'ARRIVED' ? (form.getValues('actualArrival') || today()) : undefined });
  };
  const pending = num(s?.items?.reduce((a: number, i: any) => a + num(i.pendingQty), 0));

  if (doc.isNew && !orderId) {
    const orders = (git.data ?? []).filter((r) => r.kind === 'ORDER');
    return (
      <DocumentLayout title="Import Shipment" icon={Ship} status="BOOKED" loading={git.isLoading}>
        <DocSection title="Select Import Purchase Order to ship" bodyClassName="p-3">
          <table className="w-full text-[12px]">
            <thead><tr className="border-b border-app-border bg-app-head text-left text-[11px]"><th className="px-2 py-1">Import PO</th><th>Supplier</th><th>PO Status</th><th className="text-right">Qty not yet shipped</th><th /></tr></thead>
            <tbody>
              {orders.map((r) => <tr key={r.orderId} className="border-b border-slate-100 hover:bg-brand-light/40"><td className="px-2 py-1">{r.orderNo}</td><td>{r.supplier?.name}</td><td>{r.orderStatus}</td><td className="text-right tabular-nums">{fmt.qty(r.quantity)}</td><td className="text-right"><Button size="sm" variant="primary" onClick={() => setOrderId(r.orderId)}>Select</Button></td></tr>)}
              {orders.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-500">No confirmed import orders with unshipped quantity.</td></tr>}
            </tbody>
          </table>
        </DocSection>
      </DocumentLayout>
    );
  }
  if (doc.isNew && git.data && !orderRow) {
    return (
      <DocumentLayout title="Import Shipment" icon={Ship}>
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">Nothing left to ship on this order (all quantity is already on a shipment).</div>
      </DocumentLayout>
    );
  }

  return (
    <FormProvider {...form}>
      <DocumentLayout
        title="Import Shipment" icon={Ship} docNo={s?.shipmentNo} status={status ?? 'BOOKED'} loading={doc.isLoading || (doc.isNew && git.isLoading)} error={doc.error}
        actions={
          <StdActions ctl={ctl} module="import_purchase" onSave={onSave} deleteStatuses={['BOOKED']}
            extra={
              <>
                {can('import_purchase', 'edit') && next.map((n) => <DocAction key={n.to} icon={ArrowRight} variant="primary" disabled={doc.acting} onClick={() => setStatus(n.to)}>{n.label}</DocAction>)}
                <DocAction icon={PackagePlus} hidden={!['ARRIVED', 'CUSTOMS', 'CLEARED'].includes(status ?? '') || pending <= 0 || !can('goods_receipt', 'create')} onClick={() => open('goods-receipt-form', { orderId: s?.orderId, shipmentId: doc.id }, 'New GRN')}>Create Import GRN</DocAction>
              </>
            }
          />
        }
      >
        <ServerError message={ctl.err} />
        <div className="border border-app-border bg-white px-3 py-2"><StatusStepper steps={SHIP_STEPS} current={status ?? 'BOOKED'} /></div>
        <HeaderSection title="Shipment Information">
          <ReadField label="Shipment Number" value={s?.shipmentNo ?? '(auto)'} />
          <ReadField label="Import PO" value={order ? <button className="text-brand hover:underline" onClick={() => open('import-purchase-order-form', { id: order.id }, order.docNo)}>{order.docNo}</button> : ''} />
          <ReadField label="Supplier" value={order?.supplier?.name ?? ''} />
          <ReadField label="Warehouse" value={order?.warehouse?.name ?? ''} />
          <FText name="containerNo" label="Container Number" disabled={!editable} />
          <FText name="billOfLading" label="Bill of Lading" disabled={!editable} />
          <FText name="awb" label="AWB" disabled={!editable} />
          <FText name="shippingAgent" label="Shipping Agent" disabled={!editable} />
          <FDate name="etd" label="ETD" disabled={!editable} />
          <FDate name="eta" label="ETA" disabled={!editable} />
          <FDate name="actualArrival" label="Actual Arrival" disabled={!editable} />
          <FText name="clearingAgent" label="Clearing Agent" disabled={!editable} />
        </HeaderSection>
        <DocSection title="Shipment lines" bodyClassName="p-0">
          <table className="w-full border-separate border-spacing-0 text-[12px]">
            <thead><tr className="h-7"><th className="grid-th w-8 text-center">#</th><th className="grid-th">Product</th><th className="grid-th">Description</th><th className="grid-th !text-right">Ship Qty</th><th className="grid-th !text-right">Received</th><th className="grid-th !text-right">Pending</th></tr></thead>
            <tbody>
              {items.map((l, i) => (
                <tr key={l.orderItemId ?? i} className="odd:bg-white even:bg-slate-50/60">
                  <td className="grid-td text-center text-slate-400">{i + 1}</td><td className="grid-td">{l.product?.code}</td><td className="grid-td">{l.product?.name ?? l.description}</td>
                  <td className="grid-td !p-0 text-right">
                    {itemsEditable ? <input type="number" step="any" min={0} className="ctl !h-6 !rounded-none text-right tabular-nums" {...form.register(`items.${i}.qty`, { setValueAs: (v) => (v === '' || v == null ? 0 : Number(v)) })} onFocus={(e) => e.target.select()} /> : <span className="block px-2 tabular-nums">{fmt.qty(l.qty)}</span>}
                  </td>
                  <td className="grid-td text-right tabular-nums">{fmt.qty(l.receivedQty)}</td><td className="grid-td text-right tabular-nums">{fmt.qty(Math.max(0, num(l.qty) - num(l.receivedQty)))}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">No lines</td></tr>}
            </tbody>
          </table>
          {(form.formState.errors.items as any)?.message && <div className="p-1 text-[11px] text-red-600">{(form.formState.errors.items as any).message}</div>}
        </DocSection>
        <NotesSection fields={[{ label: 'Remarks', props: { ...form.register('remarks'), disabled: !editable } }]} />
        <LinkedDocs title="Import Goods Receipts" docs={(s?.receipts ?? []).map((r: any) => ({ screenId: 'goods-receipt-form', id: r.id, label: r.docNo, status: r.status }))} />
        <DocFooter docType="IMPORT_SHIPMENT" entity="ImportShipment" doc={doc.data} isNew={doc.isNew} approvalDoc={false} />
      </DocumentLayout>
    </FormProvider>
  );
}

export default [
  { id: 'import-requests', title: 'Import Requests', icon: Globe, component: ImportRequestsScreen, permission: 'import_purchase' },
  { id: 'import-request-form', title: 'Import Request', icon: Globe, component: ImportRequestForm, multiInstance: true, permission: 'import_purchase' },
  { id: 'supplier-proformas', title: 'Supplier Proformas', icon: FileText, component: SupplierProformasScreen, permission: 'import_purchase' },
  { id: 'supplier-proforma-form', title: 'Supplier Proforma', icon: FileText, component: SupplierProformaForm, multiInstance: true, permission: 'import_purchase' },
  { id: 'goods-in-transit', title: 'Goods in Transit', icon: Container, component: GoodsInTransitScreen, permission: 'import_purchase' },
  { id: 'import-shipment-form', title: 'Import Shipment', icon: Ship, component: ImportShipmentForm, multiInstance: true, permission: 'import_purchase' },
] satisfies ScreenDef[];
