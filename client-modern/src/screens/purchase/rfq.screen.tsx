/* eslint-disable @typescript-eslint/no-explicit-any */
/** Purchase Enquiry (RFQ), Supplier Quotation, Comparative Statement. */
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSearch, FileText, GitCompare, Lock, Send, ShoppingCart, Plus, X, XCircle, Trophy, ExternalLink } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column } from '@/components/DataTable';
import { DocAction, DocSection, DocumentFlow, DocumentLayout, HeaderSection, LineItemsGrid, NotesSection, TotalsSection } from '@/components/doc';
import { Button, Field, Select, StatusBadge, Input } from '@/components/ui';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { api, apiError } from '@/lib/api';
import { calcLine, calcTotals, num } from '@/lib/calc';
import { cn } from '@/lib/cn';
import { fmt, today } from '@/lib/format';
import { toast } from '@/store/toast';
import {
  AnyDoc, CurrencyFields, DocFooter, FArea, FDate, FNum, FormProvider, FSelect, FText, idOrNull, isoOf, LinkedDocs, PurchaseList, ReadField, ServerError, StdActions,
  strOrNull, TransitionDef, useAsk, useDocForm, useLookups, PickModal, FV, SupplierSelect,
} from '@/components/purchase/kit';
import { SupplierMulti } from '@/components/purchase/SupplierMulti';
import { NewEnquiryPicker, NewQuotationPicker } from '@/components/purchase/pickers';
import { applySupplierDefaults, pickPurchaseProduct } from '@/components/purchase/helpers';
import { useWatch } from 'react-hook-form';

/* =============================================================== ENQUIRY (RFQ) */
const ENQ_STATUSES = ['DRAFT', 'SENT', 'PARTIALLY_QUOTED', 'QUOTED', 'CLOSED', 'CANCELLED'];
interface EnqRow { id: number; docNo: string; docDate: string; requiredDate?: string; warehouse?: { name: string } | null; itemCount: number; supplierCount: number; respondedCount: number; status: string }

function PurchaseEnquiriesScreen() {
  const cols: Column<EnqRow>[] = [
    { key: 'docNo', header: 'RFQ No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'requiredDate', header: 'Required Date', type: 'date', width: 110 },
    { key: 'warehouse.name', header: 'Warehouse' },
    { key: 'itemCount', header: 'Products', type: 'number', width: 80, sortable: false },
    { key: 'supplierCount', header: 'Suppliers', type: 'number', width: 80, sortable: false },
    { key: 'respondedCount', header: 'Responded', type: 'number', width: 90, sortable: false },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
  ];
  return (
    <PurchaseList<EnqRow> tableKey="purchase-enquiries" url="/purchase-enquiries" title="Purchase Enquiry" formScreen="purchase-enquiry-form" module="purchase_enquiry" columns={cols} statuses={ENQ_STATUSES} newLabel="New Enquiry" picker={(p) => <NewEnquiryPicker {...p} />}
      rowActions={(r, open) => [{ label: 'Comparative Statement', icon: GitCompare, hidden: (x) => x.status === 'DRAFT' || x.status === 'CANCELLED', onClick: () => { open('comparative-statement-form', { id: r.id }, `CS ${r.docNo}`); } }]} />
  );
}

const enqSchema = z.object({
  docDate: z.string().min(1, 'Date required'),
  items: z.array(z.object({ qty: z.number().positive('Qty must be > 0') }).passthrough().refine((i: any) => !!i.productId || !!i.description, { message: 'Each line needs a product or description' })).min(1, 'Add at least one line'),
}).passthrough();

const RESPONSE_OPTS = ['RESPONDED', 'DECLINED', 'PENDING'];

function PurchaseEnquiryForm({ params, tabId }: ScreenProps) {
  const open = useOpenScreen();
  const can = usePermission();
  const lk = useLookups();
  const ctl = useDocForm({
    url: '/purchase-enquiries', params, tabId, schema: enqSchema,
    defaults: { docDate: today(), requiredDate: '', warehouseId: '', remarks: '', supplierIds: [], items: [] },
    toForm: (d) => ({
      ...d, docDate: isoOf(d.docDate), requiredDate: isoOf(d.requiredDate), warehouseId: d.warehouseId ?? '', remarks: d.remarks ?? '',
      supplierIds: (d.suppliers ?? []).map((s: any) => s.supplierId),
      items: (d.items ?? []).map((i: any) => ({ ...i, description: i.description ?? '' })),
    }),
  });
  const { doc, form, status, editable } = ctl;
  const supplierIds = (useWatch({ control: form.control, name: 'supplierIds' }) as number[] | undefined) ?? [];
  const [respModal, setRespModal] = useState<{ supplierId: number; name: string } | null>(null);
  const [addSup, setAddSup] = useState('');
  const payload = (v: FV) => ({
    docDate: v.docDate, requiredDate: v.requiredDate || null, warehouseId: idOrNull(v.warehouseId), remarks: strOrNull(v.remarks), supplierIds: v.supplierIds ?? [],
    items: (v.items as any[]).map((i) => ({ productId: idOrNull(i.productId), description: strOrNull(i.description), qty: i.qty, unit: strOrNull(i.unit) })),
  });
  const onSave = ctl.save(payload);
  const transitions: TransitionDef[] = [
    { action: 'send', label: 'Send to Suppliers', icon: Send, from: ['DRAFT'], perm: 'edit', variant: 'primary', saveFirst: true },
    { action: 'close', label: 'Close', icon: Lock, from: ['SENT', 'PARTIALLY_QUOTED', 'QUOTED'], perm: 'edit', ask: { title: 'Close enquiry', message: 'Close this enquiry?' } },
    { action: 'cancel', label: 'Cancel', icon: XCircle, from: ['DRAFT', 'SENT', 'PARTIALLY_QUOTED', 'QUOTED'], perm: 'cancel', variant: 'danger', ask: { title: 'Cancel enquiry', danger: true, message: 'Cancel this enquiry?' } },
  ];

  const call = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      doc.invalidate();
      doc.refetch();
    } catch (e) {
      toast.error(apiError(e));
    }
  };
  const respond = (supplierId: number, responseStatus: string, notes?: string) =>
    call(() => api.post(`/purchase-enquiries/${doc.id}/suppliers/${supplierId}/response`, { responseStatus, responseNotes: notes || undefined }), 'Response recorded');

  const quotations: any[] = doc.data?.quotations ?? [];
  const enquirySuppliers: any[] = doc.data?.suppliers ?? [];
  const canManage = ['DRAFT', 'SENT', 'PARTIALLY_QUOTED', 'QUOTED'].includes(status ?? '') && !doc.isNew;

  return (
    <FormProvider {...form}>
      <DocumentLayout
        title="Purchase Enquiry (RFQ)" icon={FileSearch} docNo={doc.data?.docNo} status={status} loading={doc.isLoading} error={doc.error}
        actions={
          <StdActions ctl={ctl} module="purchase_enquiry" transitions={transitions} onSave={onSave}
            extra={
              <>
                <DocAction icon={Plus} hidden={!['SENT', 'QUOTED'].includes(status ?? '') || !can('supplier_quotation', 'create')} onClick={() => open('supplier-quotation-form', { enquiryId: doc.id }, 'New Quotation')}>Add Quotation</DocAction>
                <DocAction icon={GitCompare} hidden={doc.isNew || ['DRAFT', 'CANCELLED'].includes(status ?? '') || !can('comparative_statement', 'view')} onClick={() => open('comparative-statement-form', { id: doc.id }, `CS ${doc.data?.docNo ?? ''}`)}>Comparative Statement</DocAction>
              </>
            }
          />
        }
      >
        <ServerError message={ctl.err} />
        <HeaderSection title="Enquiry Information">
          <ReadField label="RFQ Number" value={doc.data?.docNo ?? '(auto)'} />
          <FDate name="docDate" label="Date" required disabled={!editable} />
          <FDate name="requiredDate" label="Required Date" disabled={!editable} />
          <FSelect name="warehouseId" label="Warehouse" options={lk.warehouseOptions} disabled={!editable} />
        </HeaderSection>

        <DocSection title="Products">
          <LineItemsGrid
            readOnly={!editable}
            columns={[
              { key: 'productId', header: 'Product', type: 'product', width: 140 },
              { key: 'oemNumber', header: 'OEM', type: 'readonly', width: 130, compute: (l: any) => l.oemNumber ?? l.product?.oemNumber ?? '' },
              { key: 'description', header: 'Description', type: 'text' },
              { key: 'qty', header: 'Quantity', type: 'qty', width: 100, total: true },
              { key: 'unit', header: 'Unit', type: 'text', width: 70 },
            ]}
            newLine={() => ({ qty: 1, unit: '', description: '' })}
          />
          {(form.formState.errors.items as any)?.message && <div className="p-1 text-xs text-danger">{(form.formState.errors.items as any).message}</div>}
        </DocSection>

        <DocSection title={`Suppliers (${supplierIds.length})`}>
          {editable ? (
            <SupplierMulti suppliers={lk.suppliers} value={supplierIds} onChange={(v) => form.setValue('supplierIds', v, { shouldDirty: true })} />
          ) : (
            <div className="flex flex-col gap-2">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-muted">
                    <th className="py-1.5">Supplier</th><th>Response</th><th>Date</th><th>Notes</th><th>Quotation</th><th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {enquirySuppliers.map((s) => {
                    const qt = quotations.find((x) => x.supplierId === s.supplierId);
                    return (
                      <tr key={s.id} className="border-b border-line">
                        <td className="py-2">{s.supplier?.code} - {s.supplier?.name}</td>
                        <td><StatusBadge status={s.responseStatus} /></td>
                        <td className="text-ink-muted">{fmt.date(s.responseDate)}</td>
                        <td className="text-ink-muted">{s.responseNotes}</td>
                        <td>
                          {qt ? (
                            <button className="text-brand hover:underline" onClick={() => open('supplier-quotation-form', { id: qt.id }, qt.docNo)}>{qt.docNo} ({fmt.money(qt.total)} {qt.currencyCode})</button>
                          ) : (
                            <span className="text-ink-faint">-</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap py-2 text-right">
                          {canManage && can('purchase_enquiry', 'edit') && status !== 'DRAFT' && (
                            <>
                              <Button size="sm" onClick={() => setRespModal({ supplierId: s.supplierId, name: s.supplier?.name ?? '' })}>Record response</Button>{' '}
                              {!qt && can('supplier_quotation', 'create') && (
                                <Button size="sm" variant="primary" onClick={() => open('supplier-quotation-form', { enquiryId: doc.id, supplierId: s.supplierId }, 'New Quotation')}>Enter quotation</Button>
                              )}{' '}
                              {!qt && ['SENT'].includes(status ?? '') && (
                                <Button size="sm" variant="ghost" icon={X} title="Remove supplier" onClick={() => call(() => api.delete(`/purchase-enquiries/${doc.id}/suppliers/${s.supplierId}`))} />
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {canManage && can('purchase_enquiry', 'edit') && (
                <div className="flex items-center gap-2 border-t border-line pt-2">
                  <Select className="w-[280px]" value={addSup} onChange={(e) => setAddSup(e.target.value)} options={lk.supplierOptions.filter((o) => !enquirySuppliers.some((s) => s.supplierId === o.value))} placeholder="Add supplier to enquiry..." />
                  <Button size="sm" icon={Plus} disabled={!addSup} onClick={() => call(() => api.post(`/purchase-enquiries/${doc.id}/suppliers`, { supplierId: Number(addSup) }), 'Supplier added').then(() => setAddSup(''))}>Add supplier</Button>
                </div>
              )}
            </div>
          )}
        </DocSection>

        <NotesSection fields={[{ label: 'Remarks', props: { ...form.register('remarks'), disabled: !editable } }]} />
        {quotations.length > 0 && <LinkedDocs title="Supplier Quotations" docs={quotations.map((q) => ({ screenId: 'supplier-quotation-form', id: q.id, label: q.docNo, status: q.status, extra: `${fmt.money(q.total)} ${q.currencyCode}` }))} />}
        <DocFooter docType="PURCHASE_ENQUIRY" entity="PurchaseEnquiry" doc={doc.data} isNew={doc.isNew} approvalDoc={false} />
      </DocumentLayout>

      <PickModal
        open={!!respModal} title={`Record response - ${respModal?.name ?? ''}`} onClose={() => setRespModal(null)} submitLabel="Save response"
        fields={[
          { name: 'status', label: 'Response', type: 'select', options: RESPONSE_OPTS.map((r) => ({ value: r, label: fmt.status(r) })), value: 'RESPONDED', required: true },
          { name: 'notes', label: 'Notes' },
        ]}
        onSubmit={async (v) => {
          await respond(respModal!.supplierId, v.status, v.notes);
          setRespModal(null);
        }}
      />
    </FormProvider>
  );
}

/* =============================================================== SUPPLIER QUOTATION */
const Q_STATUSES = ['RECEIVED', 'SELECTED', 'PARTIALLY_CONVERTED', 'CONVERTED', 'REJECTED', 'EXPIRED'];
interface QRow { id: number; docNo: string; docDate: string; supplier?: { name: string }; supplierRef?: string; validUntil?: string; currencyCode: string; total: number; baseTotal: number; status: string; expectedDeliveryDate?: string }

function SupplierQuotationsScreen() {
  const cols: Column<QRow>[] = [
    { key: 'docNo', header: 'Quotation No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'supplier.name', header: 'Supplier' },
    { key: 'supplierRef', header: 'Supplier Ref', hidden: true },
    { key: 'validUntil', header: 'Valid Until', type: 'date', width: 100 },
    { key: 'expectedDeliveryDate', header: 'Expected Delivery', type: 'date', width: 120, hidden: true },
    { key: 'currencyCode', header: 'Currency', width: 70 },
    { key: 'total', header: 'Total', type: 'money', total: 'sum' },
    { key: 'baseTotal', header: 'Total (Base)', type: 'money', total: 'sum', sortable: false },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
  ];
  return <PurchaseList<QRow> tableKey="supplier-quotations" url="/supplier-quotations" title="Supplier Quotation" formScreen="supplier-quotation-form" module="supplier_quotation" columns={cols} statuses={Q_STATUSES} newLabel="New Quotation" picker={(p) => <NewQuotationPicker {...p} />} />;
}

const quoteSchema = z.object({
  supplierId: z.coerce.number({ invalid_type_error: 'Supplier required' }).int().positive('Supplier required'),
  docDate: z.string().min(1),
  items: z.array(z.object({ qty: z.number().positive('Qty must be > 0'), rate: z.number().min(0) }).passthrough().refine((i: any) => !!i.productId || !!i.description, { message: 'Each line needs a product or description' })).min(1, 'Add at least one line'),
}).passthrough();

function SupplierQuotationForm({ params, tabId }: ScreenProps) {
  const open = useOpenScreen();
  const lk = useLookups();
  const enquiryId = params.enquiryId as number | undefined;
  const prefill = useQuery({
    queryKey: ['quotation-prefill', enquiryId],
    enabled: !params.id && !!enquiryId,
    queryFn: async () => (await api.get<any>(`/supplier-quotations/prefill/${enquiryId}`)).data,
  });
  const newValues = useMemo<FV | undefined>(() => {
    if (!prefill.data) return undefined;
    const sup = lk.suppliers.find((s) => String(s.id) === String(params.supplierId));
    return {
      docDate: today(), enquiryId: prefill.data.enquiryId, supplierId: params.supplierId ?? '', supplierRef: '', validUntil: '', currencyCode: sup?.currencyCode ?? '', exchangeRate: lk.currencies.find((c) => c.code === sup?.currencyCode)?.rate ?? 1, paymentTerms: sup?.paymentTermName ?? '', deliveryTerms: '', expectedDeliveryDate: '', deliveryDays: null, remarks: '',
      items: (prefill.data.items as any[]).map((i) => ({ productId: i.productId, productCode: i.product?.code, oemNumber: i.product?.oemNumber ?? '', description: i.description ?? '', qty: i.qty, unit: i.unit ?? '', rate: 0, discount: 0, vatRate: num(i.product?.vatRate ?? 5), product: i.product })),
    };
  }, [prefill.data, params.supplierId, lk.suppliers, lk.currencies]);
  const ctl = useDocForm({
    url: '/supplier-quotations', params, tabId, schema: quoteSchema, editableStatuses: ['RECEIVED'], newValues,
    defaults: { docDate: today(), supplierId: '', currencyCode: '', exchangeRate: 1, items: [], enquiryId: enquiryId ?? null, supplierRef: '', paymentTerms: '', deliveryTerms: '', remarks: '' },
    toForm: (d) => ({
      ...d, docDate: isoOf(d.docDate), validUntil: isoOf(d.validUntil), expectedDeliveryDate: isoOf(d.expectedDeliveryDate), supplierId: d.supplierId, exchangeRate: num(d.exchangeRate) || 1,
      supplierRef: d.supplierRef ?? '', paymentTerms: d.paymentTerms ?? '', deliveryTerms: d.deliveryTerms ?? '', remarks: d.remarks ?? '', deliveryDays: d.deliveryDays ?? null,
      items: (d.items ?? []).map((i: any) => ({ ...i, description: i.description ?? '', qty: num(i.qty), rate: num(i.rate), discount: num(i.discount), vatRate: num(i.vatRate), oemNumber: i.product?.oemNumber ?? '' })),
    }),
  });
  const { doc, form, status, editable } = ctl;
  const items = (useWatch({ control: form.control, name: 'items' }) as any[] | undefined) ?? [];
  const totals = calcTotals(items);
  const quoteCurrency = useWatch({ control: form.control, name: 'currencyCode' }) as string | undefined;
  const [poOpen, setPoOpen] = useState(false);
  const enquiryRef = doc.data?.enquiry ?? (enquiryId ? { id: enquiryId, docNo: prefill.data?.enquiryNo } : null);

  const payload = (v: FV) => ({
    ...(doc.isNew && v.enquiryId ? { enquiryId: v.enquiryId } : {}),
    supplierId: Number(v.supplierId), supplierRef: strOrNull(v.supplierRef), docDate: v.docDate, validUntil: v.validUntil || null,
    currencyCode: v.currencyCode || undefined, exchangeRate: v.exchangeRate || undefined, paymentTerms: strOrNull(v.paymentTerms), deliveryTerms: strOrNull(v.deliveryTerms),
    expectedDeliveryDate: v.expectedDeliveryDate || null, deliveryDays: v.deliveryDays === null || v.deliveryDays === '' ? null : Number(v.deliveryDays), remarks: strOrNull(v.remarks),
    items: (v.items as any[]).map((i) => ({ productId: idOrNull(i.productId), description: strOrNull(i.description), qty: i.qty, unit: strOrNull(i.unit), rate: i.rate, discount: i.discount ?? 0, vatRate: i.vatRate })),
  });
  const onSave = ctl.save(payload);
  const transitions: TransitionDef[] = [
    { action: 'reject', label: 'Reject', icon: XCircle, from: ['RECEIVED', 'SELECTED'], perm: 'reject', variant: 'danger', ask: { title: 'Reject quotation', danger: true, message: 'Reject this quotation?' } },
  ];
  const canPo = !doc.isNew && (doc.data?.enquiryId ? ['SELECTED', 'PARTIALLY_CONVERTED'].includes(status ?? '') : ['RECEIVED', 'SELECTED', 'PARTIALLY_CONVERTED'].includes(status ?? ''));
  const createPo = async (v: Record<string, string>) => {
    const po = await ctl.run('create-order', { warehouseId: idOrNull(v.warehouseId) ?? undefined });
    if (po) {
      setPoOpen(false);
      open('purchase-order-form', { id: po.id }, po.docNo);
    }
  };

  return (
    <FormProvider {...form}>
      <DocumentLayout
        title="Supplier Quotation" icon={FileText} docNo={doc.data?.docNo} status={status} loading={doc.isLoading || (!!enquiryId && prefill.isLoading)} error={doc.error}
        actions={
          <StdActions ctl={ctl} module="supplier_quotation" transitions={transitions} onSave={onSave} deleteStatuses={['RECEIVED', 'REJECTED', 'EXPIRED']} pdfType={undefined}
            extra={
              <>
                <DocAction icon={ShoppingCart} variant="primary" hidden={!canPo} onClick={() => setPoOpen(true)}>Create Purchase Order</DocAction>
                <DocAction icon={GitCompare} hidden={!enquiryRef?.id} onClick={() => open('comparative-statement-form', { id: enquiryRef!.id }, `CS ${enquiryRef?.docNo ?? ''}`)}>Comparative Statement</DocAction>
              </>
            }
          />
        }
      >
        <ServerError message={ctl.err} />
        {doc.data?.enquiryId && status === 'RECEIVED' && (
          <div className="rounded-lg border border-warning bg-warning-soft px-3 py-1.5 text-[13px] text-warning">
            Select this quotation in the Comparative Statement before converting it to a Purchase Order.
          </div>
        )}
        <HeaderSection title="Quotation Information">
          <ReadField label="Quotation Number" value={doc.data?.docNo ?? '(auto)'} />
          <SupplierSelect suppliers={lk.suppliers} disabled={!editable} onPicked={(s) => applySupplierDefaults(form.setValue, form.getValues, s, lk.currencies)} />
          <FText name="supplierRef" label="Supplier Quotation Ref" disabled={!editable} />
          <FDate name="docDate" label="Date" required disabled={!editable} />
          <FDate name="validUntil" label="Validity (Valid Until)" disabled={!editable} />
          <CurrencyFields disabled={!editable} currencies={lk.currencies} options={lk.currencyOptions} />
          <FText name="paymentTerms" label="Payment Terms" list="pterms" disabled={!editable} />
          <FText name="deliveryTerms" label="Delivery Terms" disabled={!editable} />
          <FDate name="expectedDeliveryDate" label="Expected Delivery" disabled={!editable} />
          <FNum name="deliveryDays" label="Delivery Time (days)" disabled={!editable} />
          <ReadField label="Enquiry" value={enquiryRef?.id ? <button className="text-brand hover:underline" onClick={() => open('purchase-enquiry-form', { id: enquiryRef.id }, enquiryRef.docNo)}>{enquiryRef.docNo ?? `#${enquiryRef.id}`}</button> : '-'} />
        </HeaderSection>
        <datalist id="pterms">{lk.termNames.map((t) => <option key={t} value={t} />)}</datalist>

        <DocSection title="Items">
          <LineItemsGrid
            readOnly={!editable}
            priceField="lastPurchasePrice"
            onProductPick={(p, i, f) => pickPurchaseProduct(p, i, f)}
            columns={[
              { key: 'productId', header: 'Product', type: 'product', width: 140 },
              { key: 'description', header: 'Description', type: 'text' },
              { key: 'qty', header: 'Qty', type: 'qty', width: 80, total: true },
              { key: 'unit', header: 'Unit', type: 'text', width: 60 },
              { key: 'rate', header: 'Unit Price', type: 'money', width: 100 },
              { key: 'discount', header: 'Discount', type: 'money', width: 90, total: true },
              { key: 'vatRate', header: 'VAT %', type: 'percent', width: 60 },
              { key: 'amount', header: 'Total', type: 'computed', width: 110, total: true, compute: (l) => calcLine(l).amount },
            ]}
            newLine={() => ({ qty: 1, rate: 0, discount: 0, vatRate: 5, unit: '', description: '' })}
          />
          {(form.formState.errors.items as any)?.message && <div className="p-1 text-xs text-danger">{(form.formState.errors.items as any).message}</div>}
        </DocSection>
        <TotalsSection totals={totals} currency={quoteCurrency || undefined} />
        <NotesSection fields={[{ label: 'Remarks', props: { ...form.register('remarks'), disabled: !editable } }]} />
        <DocFooter docType="SUPPLIER_QUOTATION" entity="SupplierQuotation" doc={doc.data} isNew={doc.isNew} approvalDoc={false} />
      </DocumentLayout>
      <PickModal open={poOpen} title="Create Purchase Order from Quotation" onClose={() => setPoOpen(false)} submitLabel="Create PO"
        fields={[{ name: 'warehouseId', label: 'Receiving Warehouse', type: 'select', options: lk.warehouseOptions }]} onSubmit={createPo} />
    </FormProvider>
  );
}

/* =============================================================== COMPARATIVE STATEMENT */
interface CsCell { quotationId: number; supplierId: number; available: boolean; quotedQty?: number; unitPrice?: number; discount?: number; vatRate?: number; vatAmount?: number; lineNet?: number; lineTotal?: number; baseNetUnit?: number; eligible?: boolean; cheapest?: boolean }
interface CsData {
  enquiry: { id: number; docNo: string; docDate: string; status: string; requiredDate?: string; warehouseId?: number | null };
  baseCurrency: string;
  items: { enquiryItemId: number; productId?: number; description?: string; qty: number; unit?: string; product?: { code: string; name: string; oemNumber?: string }; cells: CsCell[] }[];
  quotations: any[];
  selectedQuotationId: number | null;
}

function ComparativeStatementsScreen() {
  const cols: Column<EnqRow>[] = [
    { key: 'docNo', header: 'RFQ No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'requiredDate', header: 'Required Date', type: 'date', width: 110 },
    { key: 'warehouse.name', header: 'Warehouse' },
    { key: 'itemCount', header: 'Products', type: 'number', width: 80, sortable: false },
    { key: 'supplierCount', header: 'Suppliers', type: 'number', width: 80, sortable: false },
    { key: 'respondedCount', header: 'Quotes Received', type: 'number', width: 110, sortable: false },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
  ];
  return (
    <PurchaseList<EnqRow> tableKey="comparative-statements" url="/purchase-enquiries" title="Comparative Statement" formScreen="comparative-statement-form" module="comparative_statement" noNew columns={cols}
      statuses={['SENT', 'QUOTED', 'CLOSED']} baseStatus="SENT,QUOTED,CLOSED" docNoOf={(r) => `CS ${r.docNo}`} />
  );
}

function ComparativeStatementForm({ params, tabId }: ScreenProps) {
  const open = useOpenScreen();
  const ws = useWorkspace();
  const can = usePermission();
  const qc = useQueryClient();
  const lk = useLookups();
  const enquiryId = params.id;
  const { ask, dialog } = useAsk();
  const [poOpen, setPoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['comparative', enquiryId],
    enabled: !!enquiryId,
    queryFn: async () => (await api.get<CsData>(`/comparative-statements/${enquiryId}`)).data,
  });
  const enquiries = useQuery({
    queryKey: ['comparative-pick'],
    enabled: !enquiryId,
    queryFn: async () => (await api.get<{ rows: EnqRow[] }>('/purchase-enquiries', { params: { status: 'SENT,QUOTED,CLOSED', pageSize: 200 } })).data.rows,
  });
  const d = q.data;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['comparative', enquiryId] });
    qc.invalidateQueries({ queryKey: ['table'] });
    qc.invalidateQueries({ queryKey: ['doc-flow'] });
  };

  if (!enquiryId) {
    return (
      <DocumentLayout title="Comparative Statement" icon={GitCompare} loading={enquiries.isLoading}>
        <HeaderSection title="Select Enquiry" columns={3}>
          <Field label="Enquiry (RFQ) with quotations">
            <Select placeholder="Select enquiry..." options={(enquiries.data ?? []).map((e) => ({ value: e.id, label: `${e.docNo} - ${fmt.date(e.docDate)} (${e.respondedCount}/${e.supplierCount} responded)` }))}
              onChange={(e) => {
                const r = enquiries.data?.find((x) => String(x.id) === e.target.value);
                if (r) ws.retarget(tabId, { id: r.id, title: `CS ${r.docNo}` });
              }} />
          </Field>
        </HeaderSection>
      </DocumentLayout>
    );
  }

  const select = async (quotationId: number) => {
    const r = await ask({ title: 'Select supplier', message: 'Select this supplier quotation? All other quotations of this enquiry will be marked rejected.', commentLabel: 'Remarks (optional)', confirmLabel: 'Select' });
    if (!r.ok) return;
    setBusy(true);
    try {
      await api.post(`/comparative-statements/${enquiryId}/select`, { quotationId, remarks: r.text || undefined });
      toast.success('Supplier selected');
      refresh();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  const selectedQ = d?.quotations.find((x) => x.quotationId === d.selectedQuotationId);
  const createPo = async (v: Record<string, string>) => {
    try {
      const po = (await api.post<AnyDoc>(`/supplier-quotations/${d!.selectedQuotationId}/create-order`, { warehouseId: idOrNull(v.warehouseId) ?? undefined })).data;
      toast.success(`Purchase order ${po.docNo} created`);
      setPoOpen(false);
      refresh();
      open('purchase-order-form', { id: po.id }, po.docNo);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const Row = ({ label, cells, strong }: { label: string; cells: (h: any) => React.ReactNode; strong?: boolean }) => (
    <tr className={cn('border-t border-line', strong && 'bg-surface-2 font-semibold')}>
      <td className="sticky left-0 z-10 border-r border-line bg-surface-2 px-3 py-2 text-xs font-semibold text-ink-muted" colSpan={2}>{label}</td>
      {d!.quotations.map((h) => (
        <td key={h.quotationId} className={cn('border-r border-line px-2 py-1 text-right tabular-nums', h.cheapestTotal && 'bg-success-soft', h.quotationId === d!.selectedQuotationId && 'bg-info-soft')}>{cells(h)}</td>
      ))}
    </tr>
  );

  return (
    <DocumentLayout
      title="Comparative Statement" icon={GitCompare} docNo={d?.enquiry.docNo} status={d?.enquiry.status} loading={q.isLoading} error={q.error ? apiError(q.error) : undefined}
      actions={
        <>
          <DocAction icon={Trophy} variant="primary" hidden={!d?.selectedQuotationId || !['SELECTED', 'PARTIALLY_CONVERTED'].includes(selectedQ?.status ?? '') || !can('purchase_order', 'create')} onClick={() => setPoOpen(true)}>Convert to Purchase Order</DocAction>
          <DocAction icon={ExternalLink} hidden={!d} onClick={() => open('purchase-enquiry-form', { id: d!.enquiry.id }, d!.enquiry.docNo)}>Open Enquiry</DocAction>
          <DocAction icon={Plus} hidden={!d || !['SENT', 'QUOTED'].includes(d.enquiry.status) || !can('supplier_quotation', 'create')} onClick={() => open('supplier-quotation-form', { enquiryId: d!.enquiry.id }, 'New Quotation')}>Add Quotation</DocAction>
          <DocAction onClick={refresh}>Refresh</DocAction>
        </>
      }
    >
      {d && (
        <>
          <HeaderSection title="Enquiry" columns={4}>
            <ReadField label="RFQ No" value={d.enquiry.docNo} />
            <ReadField label="Date" value={fmt.date(d.enquiry.docDate)} />
            <ReadField label="Required Date" value={fmt.date(d.enquiry.requiredDate)} />
            <ReadField label="Selected Supplier" value={selectedQ ? `${selectedQ.supplier?.name} (${selectedQ.docNo})` : <span className="text-ink-faint">None selected</span>} />
          </HeaderSection>
          <DocSection title={`Supplier Comparison (${d.quotations.length} quotation${d.quotations.length === 1 ? '' : 's'}) - amounts compared in ${d.baseCurrency}`} bodyClassName="p-0">
            {d.quotations.length === 0 ? (
              <div className="p-4 text-center text-[13px] text-ink-muted">No supplier quotations received yet. Use "Add Quotation" to record supplier prices.</div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-surface-2">
                      <th className="sticky left-0 z-10 w-[230px] min-w-[230px] border-r border-line bg-surface-2 px-3 py-2 text-left">Product</th>
                      <th className="w-[70px] border-r border-line px-3 text-right">Qty</th>
                      {d.quotations.map((h) => (
                        <th key={h.quotationId} className={cn('min-w-[200px] border-r border-line px-2 py-1 text-left align-top', h.quotationId === d.selectedQuotationId && 'bg-info-soft', !h.eligible && 'opacity-60')}>
                          <div className="flex items-start justify-between gap-1">
                            <div>
                              <div className="text-[13px] font-semibold text-ink">{h.supplier?.name ?? `Supplier ${h.supplierId}`}</div>
                              <button className="text-xs font-normal text-brand hover:underline" onClick={() => open('supplier-quotation-form', { id: h.quotationId }, h.docNo)}>{h.docNo}</button>
                              {h.supplierRef && <div className="text-xs font-normal text-ink-muted">Ref: {h.supplierRef}</div>}
                            </div>
                            <StatusBadge status={h.status} />
                          </div>
                          {h.cheapestTotal && <span className="mt-0.5 inline-block rounded-lg bg-success px-1.5 text-xs font-medium text-white">LOWEST TOTAL</span>}
                          {!h.complete && <span className="ml-1 mt-0.5 inline-block rounded-lg bg-warning px-1.5 text-xs font-medium text-white">PARTIAL {h.coveredLines}/{h.coveredLines + h.missingLines}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((it) => (
                      <tr key={it.enquiryItemId} className="border-t border-line">
                        <td className="sticky left-0 z-10 border-r border-line bg-surface px-3 py-2">
                          <div className="font-medium">{it.product?.code ?? ''} <span className="font-normal text-ink-muted">{it.product?.name ?? it.description}</span></div>
                          {it.product?.oemNumber && <div className="text-xs text-ink-muted">OEM {it.product.oemNumber}</div>}
                        </td>
                        <td className="border-r border-line px-3 text-right tabular-nums">{fmt.qty(it.qty)} {it.unit}</td>
                        {it.cells.map((c) => {
                          const h = d.quotations.find((x) => x.quotationId === c.quotationId);
                          return (
                            <td key={c.quotationId} className={cn('border-r border-line px-2 py-1 text-right align-top tabular-nums',
                              c.available && c.cheapest && 'bg-success-soft', !c.available && 'bg-surface-2 text-ink-faint', c.quotationId === d.selectedQuotationId && !c.cheapest && 'bg-info-soft', h && !h.eligible && 'opacity-50')}>
                              {c.available ? (
                                <>
                                  <div className={cn('text-[13px]', c.cheapest ? 'font-bold text-success' : 'font-semibold')}>{fmt.money(c.unitPrice)} <span className="text-xs font-normal text-ink-muted">{h?.currencyCode}</span></div>
                                  <div className="text-xs text-ink-muted">Disc {fmt.money(c.discount)} · VAT {fmt.percent(c.vatRate)}</div>
                                  <div className="text-xs">Line {fmt.money(c.lineTotal)}</div>
                                  {c.cheapest && <div className="text-xs font-semibold text-success">LOWEST</div>}
                                </>
                              ) : (
                                <span>not quoted</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <Row label="Subtotal" cells={(h) => fmt.money(h.subtotal)} />
                    <Row label="Discount" cells={(h) => fmt.money(h.discount)} />
                    <Row label="VAT" cells={(h) => fmt.money(h.vatAmount)} />
                    <Row label="Total Cost" strong cells={(h) => <>{fmt.money(h.total)} {h.currencyCode}</>} />
                    <Row label={`Total Cost (${d.baseCurrency})`} strong cells={(h) => fmt.money(h.baseTotal)} />
                    <Row label="Currency" cells={(h) => <>{h.currencyCode} @ {h.exchangeRate}</>} />
                    <Row label="Payment Terms" cells={(h) => h.paymentTerms ?? '-'} />
                    <Row label="Delivery Terms" cells={(h) => h.deliveryTerms ?? '-'} />
                    <Row label="Delivery Time" cells={(h) => (h.deliveryDays != null ? `${h.deliveryDays} days` : h.expectedDeliveryDate ? fmt.date(h.expectedDeliveryDate) : '-')} />
                    <Row label="Valid Until" cells={(h) => fmt.date(h.validUntil) || '-'} />
                    <tr className="border-t-2 border-line bg-surface-2">
                      <td className="sticky left-0 z-10 bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-muted" colSpan={2}>Select supplier</td>
                      {d.quotations.map((h) => (
                        <td key={h.quotationId} className="border-r border-line px-3 py-1.5 text-center">
                          {h.status === 'CONVERTED' ? (
                            <span className="text-xs font-semibold text-success">Converted to PO</span>
                          ) : h.quotationId === d.selectedQuotationId ? (
                            <span className="text-xs font-semibold text-info">✓ Selected</span>
                          ) : (
                            <Button size="sm" variant="primary" loading={busy}
                              disabled={!h.eligible || !can('comparative_statement', 'approve') || !!d.quotations.find((x) => x.status === 'CONVERTED')} onClick={() => select(h.quotationId)}>
                              Select
                            </Button>
                          )}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </DocSection>
          <div className="flex items-center gap-4 text-xs text-ink-muted">
            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 border border-success bg-success-soft rounded-lg" /> lowest unit price (base currency) per product</span>
            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 border border-info bg-info-soft rounded-lg" /> selected quotation</span>
          </div>
          <DocumentFlow docType="PURCHASE_ENQUIRY" docId={d.enquiry.id} />
        </>
      )}
      <PickModal open={poOpen} title="Convert selected quotation to Purchase Order" onClose={() => setPoOpen(false)} submitLabel="Create PO"
        fields={[{ name: 'warehouseId', label: 'Receiving Warehouse', type: 'select', options: lk.warehouseOptions, value: d?.enquiry.warehouseId ?? '' }]} onSubmit={createPo} />
      {dialog}
    </DocumentLayout>
  );
}

export default [
  { id: 'purchase-enquiries', title: 'Purchase Enquiries', icon: FileSearch, component: PurchaseEnquiriesScreen, permission: 'purchase_enquiry' },
  { id: 'purchase-enquiry-form', title: 'Purchase Enquiry', icon: FileSearch, component: PurchaseEnquiryForm, multiInstance: true, permission: 'purchase_enquiry' },
  { id: 'supplier-quotations', title: 'Supplier Quotations', icon: FileText, component: SupplierQuotationsScreen, permission: 'supplier_quotation' },
  { id: 'supplier-quotation-form', title: 'Supplier Quotation', icon: FileText, component: SupplierQuotationForm, multiInstance: true, permission: 'supplier_quotation' },
  { id: 'comparative-statements', title: 'Comparative Statements', icon: GitCompare, component: ComparativeStatementsScreen, permission: 'comparative_statement' },
  { id: 'comparative-statement-form', title: 'Comparative Statement', icon: GitCompare, component: ComparativeStatementForm, multiInstance: true, permission: 'comparative_statement' },
] satisfies ScreenDef[];
