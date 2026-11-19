/* eslint-disable @typescript-eslint/no-explicit-any */
/** Material Request + Purchase Requisition (list + form each). */
import { useState } from 'react';
import { z } from 'zod';
import { ClipboardList, FileText, Send, Check, XCircle, Lock, FileSearch, ArrowRightCircle } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column } from '@/components/DataTable';
import { DocAction, DocumentLayout, HeaderSection, LineItemsGrid, NotesSection, DocSection } from '@/components/doc';
import { Modal, Button, DateInput, Field } from '@/components/ui';
import { useOpenScreen } from '@/store/workspace';
import { useAuth } from '@/store/auth';
import { fmt, today } from '@/lib/format';
import {
  AnyDoc, DocFooter, FArea, FDate, FormProvider, FSelect, FText, idOrNull, isoOf, LinkedDocs, PRIORITIES, PurchaseList, ReadField, ServerError, StdActions,
  strOrNull, TransitionDef, useDocForm, useLookups, FV,
} from '@/components/purchase/kit';
import { SupplierMulti } from '@/components/purchase/SupplierMulti';

const itemSchema = z
  .object({ qty: z.number({ invalid_type_error: 'Qty required' }).positive('Qty must be > 0') })
  .passthrough()
  .refine((i: any) => !!i.productId || !!(i.description && String(i.description).trim()), { message: 'Each line needs a product or description' });
const schema = z.object({
  docDate: z.string().min(1, 'Date required'),
  items: z.array(itemSchema).min(1, 'Add at least one line'),
}).passthrough();

interface ReqCfg {
  url: string;
  module: string;
  docType: string;
  entity: string;
  title: string;
  icon: typeof FileText;
  isMR: boolean;
}
const MR: ReqCfg = { url: '/material-requests', module: 'material_request', docType: 'MATERIAL_REQUEST', entity: 'MaterialRequest', title: 'Material Request', icon: ClipboardList, isMR: true };
const PR: ReqCfg = { url: '/purchase-requisitions', module: 'purchase_requisition', docType: 'PURCHASE_REQUISITION', entity: 'PurchaseRequisition', title: 'Purchase Requisition', icon: FileText, isMR: false };

const MR_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CLOSED', 'CANCELLED'];
const PR_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED', 'CLOSED', 'CANCELLED'];

/* ------------------------------------------------------------------ lists */
interface ReqRow { id: number; docNo: string; docDate: string; requestedBy?: string; department?: string; priority?: string; itemCount?: number; totalQty?: number; status: string; warehouse?: { name: string } | null }
const reqCols = (isMR: boolean): Column<ReqRow>[] => [
  { key: 'docNo', header: isMR ? 'Request No' : 'PR No', width: 130, filter: 'text' },
  { key: 'docDate', header: 'Date', type: 'date', width: 100 },
  { key: 'requestedBy', header: 'Requested By', filter: 'text' },
  { key: 'department', header: 'Department' },
  { key: 'warehouse.name', header: 'Warehouse' },
  { key: 'priority', header: 'Priority', type: 'status', width: 90 },
  { key: 'itemCount', header: 'Items', type: 'number', width: 60, sortable: false },
  { key: 'totalQty', header: 'Total Qty', type: 'qty', width: 80, sortable: false },
  { key: 'status', header: 'Status', type: 'status', width: 120 },
];
function MaterialRequestsScreen() {
  return <PurchaseList<ReqRow> tableKey="material-requests" url="/material-requests" title="Material Request" formScreen="material-request-form" module="material_request" columns={reqCols(true)} statuses={MR_STATUSES}
    selects={[{ key: 'priority', label: 'All priorities', options: PRIORITIES }]} />;
}
function PurchaseRequisitionsScreen() {
  return <PurchaseList<ReqRow> tableKey="purchase-requisitions" url="/purchase-requisitions" title="Purchase Requisition" formScreen="purchase-requisition-form" module="purchase_requisition" columns={reqCols(false)} statuses={PR_STATUSES}
    selects={[{ key: 'priority', label: 'All priorities', options: PRIORITIES }]} newLabel="New Requisition" />;
}

/* ------------------------------------------------------------------ form */
function RequestForm({ cfg, params, tabId }: ScreenProps & { cfg: ReqCfg }) {
  const open = useOpenScreen();
  const user = useAuth((s) => s.user);
  const lk = useLookups();
  const [enqOpen, setEnqOpen] = useState(false);
  const [enqSuppliers, setEnqSuppliers] = useState<number[]>([]);
  const [enqDate, setEnqDate] = useState('');
  const ctl = useDocForm({
    url: cfg.url, params, tabId, schema,
    defaults: { docDate: today(), priority: 'MEDIUM', requestedBy: user?.fullName ?? '', department: '', businessUnitId: '', warehouseId: '', requiredDate: '', remarks: '', items: [] },
    toForm: (d) => ({
      ...d, docDate: isoOf(d.docDate), requiredDate: isoOf(d.requiredDate), businessUnitId: d.businessUnitId ?? '', warehouseId: d.warehouseId ?? '',
      department: d.department ?? '', requestedBy: d.requestedBy ?? '', remarks: d.remarks ?? '',
      items: (d.items ?? []).map((i: any) => ({ ...i, requiredDate: isoOf(i.requiredDate), remarks: i.remarks ?? '', description: i.description ?? '' })),
    }),
  });
  const { doc, form, status, editable } = ctl;

  const payload = (v: FV) => ({
    docDate: v.docDate,
    requestedBy: strOrNull(v.requestedBy),
    department: strOrNull(v.department),
    ...(cfg.isMR ? { businessUnitId: idOrNull(v.businessUnitId), requiredDate: v.requiredDate || null } : {}),
    warehouseId: idOrNull(v.warehouseId),
    priority: v.priority || 'MEDIUM',
    remarks: strOrNull(v.remarks),
    items: (v.items as any[]).map((i) => ({
      productId: idOrNull(i.productId), ...(cfg.isMR ? { oemNumber: strOrNull(i.oemNumber) } : {}), description: strOrNull(i.description), qty: i.qty, unit: strOrNull(i.unit), requiredDate: i.requiredDate || null, remarks: strOrNull(i.remarks),
    })),
  });
  const onSave = ctl.save(payload);

  const transitions: TransitionDef[] = [
    { action: 'submit', label: 'Submit', icon: Send, from: ['DRAFT'], perm: 'edit', saveFirst: true },
    { action: 'approve', label: 'Approve', icon: Check, from: ['SUBMITTED'], perm: 'approve', variant: 'primary', ask: { title: 'Approve', message: `Approve this ${cfg.title.toLowerCase()}?`, commentLabel: 'Comment (optional)' } },
    { action: 'reject', label: 'Reject', icon: XCircle, from: ['SUBMITTED'], perm: 'reject', variant: 'danger', ask: { title: 'Reject', commentLabel: 'Reason', commentRequired: true, danger: true } },
    { action: 'close', label: 'Close', icon: Lock, from: cfg.isMR ? ['APPROVED'] : ['APPROVED', 'CONVERTED'], perm: 'edit', ask: { title: 'Close', message: 'Close this document?' } },
    { action: 'cancel', label: 'Cancel', icon: XCircle, from: ['DRAFT', 'SUBMITTED', 'APPROVED'], perm: 'cancel', variant: 'danger', ask: { title: 'Cancel document', commentLabel: 'Reason (optional)', danger: true } },
  ];

  const createRequisition = async () => {
    const r = await ctl.run('create-requisition');
    if (r) open('purchase-requisition-form', { id: r.id }, r.docNo);
  };
  const createEnquiry = async () => {
    const r = await ctl.run('create-enquiry', { supplierIds: enqSuppliers, requiredDate: enqDate || undefined });
    if (r) {
      setEnqOpen(false);
      open('purchase-enquiry-form', { id: r.id }, r.docNo);
    }
  };

  return (
    <FormProvider {...form}>
      <DocumentLayout
        title={cfg.title} icon={cfg.icon} docNo={doc.data?.docNo} status={status} loading={doc.isLoading} error={doc.error}
        actions={
          <StdActions ctl={ctl} module={cfg.module} transitions={transitions} onSave={onSave}
            extra={
              <>
                {cfg.isMR && <DocAction icon={ArrowRightCircle} hidden={status !== 'APPROVED'} onClick={createRequisition}>Create Requisition</DocAction>}
                {!cfg.isMR && <DocAction icon={FileSearch} hidden={status !== 'APPROVED'} onClick={() => setEnqOpen(true)}>Create Enquiry (RFQ)</DocAction>}
              </>
            }
          />
        }
      >
        <ServerError message={ctl.err} />
        <HeaderSection title={`${cfg.isMR ? 'Request' : 'Requisition'} Information`}>
          <ReadField label={cfg.isMR ? 'Request No' : 'PR No'} value={doc.data?.docNo ?? '(auto)'} />
          <FDate name="docDate" label="Date" required disabled={!editable} />
          <FText name="requestedBy" label="Requested By" disabled={!editable} />
          <FText name="department" label="Department" disabled={!editable} />
          {cfg.isMR && <FSelect name="businessUnitId" label="Business Unit" options={lk.buOptions} disabled={!editable} />}
          <FSelect name="warehouseId" label="Warehouse" options={lk.warehouseOptions} disabled={!editable} />
          {cfg.isMR && <FDate name="requiredDate" label="Required Date" disabled={!editable} />}
          <FSelect name="priority" label="Priority" options={PRIORITIES} placeholder="Medium" disabled={!editable} />
        </HeaderSection>

        <DocSection title="Items">
          <LineItemsGrid
            readOnly={!editable}
            priceField="costPrice"
            columns={[
              { key: 'productId', header: 'Product', type: 'product', width: 140 },
              ...(cfg.isMR ? [{ key: 'oemNumber', header: 'OEM Number', type: 'readonly' as const, width: 130 }] : []),
              { key: 'description', header: 'Description', type: 'text' },
              { key: 'qty', header: cfg.isMR ? 'Requested Qty' : 'Quantity', type: 'qty', width: 100, total: true },
              { key: 'unit', header: 'Unit', type: 'text', width: 70 },
              { key: 'requiredDate', header: 'Required Date', type: 'date', width: 120 },
              { key: 'remarks', header: 'Remarks', type: 'text', width: 180 },
            ]}
            newLine={() => ({ qty: 1, unit: '', description: '', requiredDate: '', remarks: '' })}
          />
          {(form.formState.errors.items as any)?.message && <div className="p-1 text-xs text-danger">{(form.formState.errors.items as any).message}</div>}
        </DocSection>

        <NotesSection fields={[{ label: 'Remarks', props: { ...form.register('remarks'), disabled: !editable } }]} />
        {cfg.isMR && (doc.data as AnyDoc | undefined)?.requisitions?.length > 0 && (
          <LinkedDocs title="Purchase Requisitions" docs={(doc.data!.requisitions as any[]).map((r) => ({ screenId: 'purchase-requisition-form', id: r.id, label: r.docNo, status: r.status }))} />
        )}
        {!cfg.isMR && (doc.data as AnyDoc | undefined)?.enquiries?.length > 0 && (
          <LinkedDocs title="Purchase Enquiries" docs={(doc.data!.enquiries as any[]).map((r) => ({ screenId: 'purchase-enquiry-form', id: r.id, label: r.docNo, status: r.status }))} />
        )}
        <DocFooter docType={cfg.docType} entity={cfg.entity} doc={doc.data} isNew={doc.isNew} approvalDoc={false} />
      </DocumentLayout>

      <Modal open={enqOpen} title="Create Purchase Enquiry (RFQ)" width="lg" onClose={() => setEnqOpen(false)}
        footer={<><Button onClick={() => setEnqOpen(false)}>Cancel</Button><Button variant="primary" icon={FileSearch} onClick={createEnquiry}>Create Enquiry</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Required Date" className="max-w-[200px]"><DateInput value={enqDate} onChange={(e) => setEnqDate(e.target.value)} /></Field>
          <Field label="Suppliers to invite (can be changed on the enquiry)">
            <SupplierMulti suppliers={lk.suppliers} value={enqSuppliers} onChange={setEnqSuppliers} />
          </Field>
          <div className="text-xs text-ink-muted">Items, quantities and warehouse are copied from {doc.data?.docNo}. Requisition becomes CONVERTED.</div>
        </div>
      </Modal>
      <span className="hidden">{fmt.qty(0)}</span>
    </FormProvider>
  );
}

const MaterialRequestForm = (p: ScreenProps) => <RequestForm cfg={MR} {...p} />;
const PurchaseRequisitionForm = (p: ScreenProps) => <RequestForm cfg={PR} {...p} />;

export default [
  { id: 'material-requests', title: 'Material Requests', icon: ClipboardList, component: MaterialRequestsScreen, permission: 'material_request' },
  { id: 'material-request-form', title: 'Material Request', icon: ClipboardList, component: MaterialRequestForm, multiInstance: true, permission: 'material_request' },
  { id: 'purchase-requisitions', title: 'Purchase Requisitions', icon: FileText, component: PurchaseRequisitionsScreen, permission: 'purchase_requisition' },
  { id: 'purchase-requisition-form', title: 'Purchase Requisition', icon: FileText, component: PurchaseRequisitionForm, multiInstance: true, permission: 'purchase_requisition' },
] satisfies ScreenDef[];
