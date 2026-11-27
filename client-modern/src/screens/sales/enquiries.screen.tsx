import { RevisionHistory } from '@/components/doc/RevisionHistory';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ClipboardList, FilePlus2, Lock, RotateCcw, Save, Trash2, XCircle } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column } from '@/components/DataTable';
import { AttachmentsSection, AuditSection, DocAction, DocActionSep, DocumentFlow, DocumentLayout, DocSection, HeaderSection, LineItemsGrid, NotesSection } from '@/components/doc';
import { Field, Input, Select } from '@/components/ui';
import { useDocument } from '@/hooks/useDocument';
import { usePermission } from '@/store/auth';
import { useWorkspace } from '@/store/workspace';
import { toast } from '@/store/toast';
import { fmt, today } from '@/lib/format';
import { num } from '@/lib/calc';
import { CustomerPicker, idReg, isoOrNull, makeSalesList, useConfirm, useCopySource, useDirtyTab, useSalesActions, useSalesmen, AnyRec } from '@/components/sales/shared';
import { DateInput } from '@/components/ui';

const URL = '/sales-enquiries';
const TYPE = 'SALES_ENQUIRY';

const EnquiriesList = makeSalesList<AnyRec>({
  tableKey: 'sales-enquiries',
  url: URL,
  exportName: 'Sales Enquiries',
  formScreen: 'sales-enquiry-form',
  permission: 'sales_enquiry',
  newLabel: 'New Enquiry',
  statuses: ['OPEN', 'PARTIALLY_QUOTED', 'QUOTED', 'CLOSED', 'CANCELLED'],
  columns: [
    { key: 'docNo', header: 'Enquiry No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'customer.name', header: 'Customer', sortable: false, filter: 'text' },
    { key: 'salesman.name', header: 'Salesman', sortable: false },
    { key: 'requiredDate', header: 'Required Date', type: 'date', width: 110, sortable: false },
    { key: 'itemCount', header: 'Lines', type: 'number', width: 60, sortable: false },
    { key: 'totalQty', header: 'Total Qty', type: 'qty', width: 80, sortable: false, total: 'sum' },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
    { key: 'remarks', header: 'Remarks', hidden: true, sortable: false },
  ] as Column<AnyRec>[],
});

const lineSchema = z.object({
  productId: z.number().optional().nullable(),
  productCode: z.string().optional(),
  description: z.string().optional(),
  qty: z.number().positive('Qty must be > 0'),
  remarks: z.string().optional(),
});
const schema = z.object({
  customerId: z.number({ required_error: 'Customer is required', invalid_type_error: 'Customer is required' }).int().positive('Customer is required'),
  salesmanId: z.number().optional(),
  docDate: z.string().min(1, 'Date is required'),
  requiredDate: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  items: z.array(lineSchema).min(1, 'Add at least one line'),
});
type FV = z.infer<typeof schema>;

const toValues = (d: AnyRec, copy = false): FV =>
  ({
    customerId: d.customerId,
    salesmanId: d.salesmanId ?? undefined,
    docDate: copy ? today() : fmt.isoDate(d.docDate),
    requiredDate: d.requiredDate ? fmt.isoDate(d.requiredDate) : '',
    remarks: d.remarks ?? '',
    items: (d.items ?? []).map((i: AnyRec) => ({
      productId: i.productId ?? undefined,
      productCode: i.product?.code ?? '',
      product: i.product,
      description: i.description ?? i.product?.name ?? '',
      qty: num(i.qty),
      remarks: i.remarks ?? '',
    })),
  }) as FV;

function EnquiryForm({ params, tabId }: ScreenProps) {
  const doc = useDocument<AnyRec>(URL, params.id, { tabId });
  const can = usePermission();
  const ws = useWorkspace();
  const salesmen = useSalesmen();
  const confirm = useConfirm();
  const act = useSalesActions(URL, doc.id, doc.invalidate);
  const copy = useCopySource(URL, params, doc.isNew);

  const values = useMemo(() => (doc.data ? toValues(doc.data) : copy.data ? toValues(copy.data, true) : undefined), [doc.data, copy.data]);
  const form = useForm<FV>({ resolver: zodResolver(schema), values, defaultValues: { docDate: today(), requiredDate: '', remarks: '', items: [] } as unknown as FV });
  useDirtyTab(tabId, form.formState.isDirty);

  const status: string | undefined = doc.data?.status;
  const hasQuotation = (doc.data?.links?.convertedTo ?? []).length > 0;
  const editable = (doc.isNew || status === 'OPEN') && can('sales_enquiry', doc.isNew ? 'create' : 'edit');
  const errors = form.formState.errors;

  const save = form.handleSubmit(
    async (v) => {
      try {
        await doc.save({
          docDate: v.docDate,
          customerId: v.customerId,
          salesmanId: v.salesmanId ?? null,
          requiredDate: v.requiredDate || null,
          remarks: v.remarks || null,
          items: v.items.map((l) => ({ productId: l.productId || null, description: l.description || null, qty: l.qty, remarks: l.remarks || null })),
        });
      } catch {
        /* toasted by useDocument */
      }
    },
    () => toast.warning('Please fix the highlighted fields'),
  );

  return (
    <FormProvider {...form}>
      {confirm.node}
      <DocumentLayout
        title="Sales Enquiry"
        icon={ClipboardList}
        docNo={doc.data?.docNo}
        status={status}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            <DocAction icon={Save} variant="primary" hidden={!editable} loading={doc.saving} onClick={save}>Save</DocAction>
            <DocAction
              icon={FilePlus2}
              hidden={doc.isNew || !['OPEN', 'QUOTED', 'PARTIALLY_QUOTED'].includes(status ?? '') || !can('sales_quotation', 'create')}
              loading={act.busy === 'create-quotation'}
              onClick={() => act.convert('create-quotation', 'sales-quotation-form', 'Quotation created')}
            >
              Create Quotation
            </DocAction>
            <DocActionSep />
            <DocAction icon={Lock} hidden={doc.isNew || !['OPEN', 'QUOTED', 'PARTIALLY_QUOTED'].includes(status ?? '')} loading={act.busy === 'close'} onClick={() => act.post('close', {}, 'Enquiry closed')}>Close</DocAction>
            <DocAction icon={RotateCcw} hidden={doc.isNew || !['CLOSED', 'CANCELLED'].includes(status ?? '')} loading={act.busy === 'reopen'} onClick={() => act.post('reopen', {}, 'Enquiry reopened')}>Reopen</DocAction>
            <DocAction
              icon={XCircle}
              hidden={doc.isNew || !['OPEN', 'QUOTED', 'PARTIALLY_QUOTED'].includes(status ?? '') || !can('sales_enquiry', 'cancel')}
              loading={act.busy === 'cancel'}
              onClick={async () => (await confirm.ask('Cancel this enquiry?', { danger: true, confirmLabel: 'Cancel enquiry' })) && act.post('cancel', {}, 'Enquiry cancelled')}
            >
              Cancel
            </DocAction>
            <DocAction
              icon={Trash2}
              hidden={doc.isNew || status !== 'OPEN' || hasQuotation || !can('sales_enquiry', 'delete')}
              onClick={async () => {
                if (!(await confirm.ask('Delete this enquiry permanently?', { danger: true, confirmLabel: 'Delete' }))) return;
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
        <DocumentFlow docType={TYPE} docId={doc.id} />
        <HeaderSection title="Enquiry Information">
          <Field label="Enquiry Number"><Input value={doc.data?.docNo ?? '(auto)'} readOnly /></Field>
          <Field label="Customer" required error={errors.customerId?.message}>
            <CustomerPicker
              value={form.watch('customerId')}
              invalid={!!errors.customerId}
              disabled={!editable}
              onChange={(id, c) => {
                form.setValue('customerId', id as number, { shouldDirty: true, shouldValidate: true });
                if (c?.salesmanId && !form.getValues('salesmanId')) form.setValue('salesmanId', c.salesmanId, { shouldDirty: true });
              }}
            />
          </Field>
          <Field label="Date" required error={errors.docDate?.message}><DateInput disabled={!editable} {...form.register('docDate')} /></Field>
          <Field label="Salesman"><Select key={salesmen.data?.length ?? 0} options={salesmen.data} placeholder="-" disabled={!editable} {...form.register('salesmanId', idReg)} /></Field>
          <Field label="Required Date"><DateInput disabled={!editable} {...form.register('requiredDate')} /></Field>
        </HeaderSection>

        <DocSection title="Enquiry Items">
          <LineItemsGrid
            readOnly={!editable}
            columns={[
              { key: 'productId', header: 'Product', type: 'product', width: 140 },
              { key: 'description', header: 'Description', type: 'text' },
              { key: 'qty', header: 'Qty', type: 'qty', width: 90, total: true, required: true },
              { key: 'remarks', header: 'Remarks', type: 'text', width: 240 },
            ]}
            newLine={() => ({ qty: 1, description: '', remarks: '' })}
            priceField="retailPrice"
          />
          {errors.items?.message && <div className="p-1 text-xs text-danger">{errors.items.message}</div>}
          {!editable && !doc.isNew && <div className="p-1 text-xs text-ink-muted">Only OPEN enquiries without a quotation can be edited.</div>}
        </DocSection>

        <NotesSection fields={[{ label: 'Remarks', props: { ...form.register('remarks'), disabled: !editable } }]} />
        <AttachmentsSection docType={TYPE} docId={doc.id} />
        <AuditSection doc={doc.data} />
      <RevisionHistory entity="SalesEnquiry" id={doc.id} />
      </DocumentLayout>
    </FormProvider>
  );
}

export default [
  { id: 'sales-enquiries', title: 'Sales Enquiries', icon: ClipboardList, component: EnquiriesList, permission: 'sales_enquiry' },
  { id: 'sales-enquiry-form', title: 'Sales Enquiry', icon: ClipboardList, component: EnquiryForm, multiInstance: true, permission: 'sales_enquiry' },
] satisfies ScreenDef[];
