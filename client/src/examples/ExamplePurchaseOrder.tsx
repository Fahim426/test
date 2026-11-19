/**
 * REFERENCE EXAMPLE (not registered - file name does not match *.screen.tsx).
 * Copy into src/screens/purchase/purchaseOrders.screen.tsx and adapt.
 * Shows: list screen (DataTable) + document screen (DocumentLayout, useDocument, RHF+zod, LineItemsGrid, totals,
 * approval, attachments, doc flow), opening documents as workspace tabs.
 */
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Check, FileDown, Plus, Printer, Save, Send, Truck, XCircle } from 'lucide-react';
import { ShoppingCart } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { DataTable, Column } from '@/components/DataTable';
import {
  ApprovalSection, ApprovalRequestLike, AttachmentsSection, AuditSection, DocAction, DocActionSep, DocumentFlow, DocumentLayout, DocSection, HeaderSection,
  LineItemsGrid, NotesSection, TotalsSection,
} from '@/components/doc';
import { Button, DateInput, Field, Input, Select, SelectOption } from '@/components/ui';
import { useDocument } from '@/hooks/useDocument';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { api, Paged, apiError } from '@/lib/api';
import { calcLine, calcTotals } from '@/lib/calc';
import { fmt, today } from '@/lib/format';
import { toast } from '@/store/toast';

interface PORow {
  id: number;
  docNo: string;
  docDate: string;
  supplier?: { name: string };
  warehouse?: { name: string };
  total: number;
  status: string;
  receivedPct?: number;
}

/* ---------------------------------- LIST ---------------------------------- */
function PurchaseOrdersScreen() {
  const open = useOpenScreen();
  const can = usePermission();
  const columns: Column<PORow>[] = [
    { key: 'docNo', header: 'PO No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100, filter: 'date' },
    { key: 'supplier.name', header: 'Supplier' },
    { key: 'warehouse.name', header: 'Warehouse' },
    { key: 'total', header: 'Amount', type: 'money', total: 'sum' },
    { key: 'status', header: 'Status', type: 'status', filter: { type: 'select', options: [{ value: 'DRAFT', label: 'Draft' }, { value: 'APPROVED', label: 'Approved' }] } },
    { key: 'receivedPct', header: 'Received', type: 'percent' },
  ];
  return (
    <DataTable<PORow>
      tableKey="purchase-orders"
      url="/purchase-orders"
      columns={columns}
      exportName="Purchase Orders"
      onRowDoubleClick={(r) => open('purchase-order-form', { id: r.id }, r.docNo)}
      toolbarExtras={
        can('purchase_order', 'create') && (
          <Button variant="primary" icon={Plus} onClick={() => open('purchase-order-form', {}, 'New PO')}>
            New PO
          </Button>
        )
      }
      rowActions={[{ label: 'Open', onClick: (r) => open('purchase-order-form', { id: r.id }, r.docNo) }]}
    />
  );
}

/* ---------------------------------- FORM ---------------------------------- */
const lineSchema = z.object({
  productId: z.number({ required_error: 'Product required' }),
  productCode: z.string().optional(),
  oemNumber: z.string().optional(),
  description: z.string().optional(),
  unit: z.string().optional(),
  qty: z.number().positive('Qty > 0'),
  rate: z.number().min(0),
  discount: z.number().min(0).default(0),
  vatRate: z.number().min(0).default(5),
});
const schema = z.object({
  supplierId: z.coerce.number({ invalid_type_error: 'Supplier required' }).int().positive('Supplier required'),
  warehouseId: z.coerce.number().int().positive('Warehouse required'),
  docDate: z.string().min(1),
  remarks: z.string().optional(),
  items: z.array(lineSchema).min(1, 'Add at least one line'),
});
type FormValues = z.infer<typeof schema>;

const useOptions = (url: string) =>
  useQuery({
    queryKey: ['opts', url],
    staleTime: 60_000,
    queryFn: async (): Promise<SelectOption[]> =>
      (await api.get<Paged<{ id: number; code: string; name: string }>>(url, { params: { pageSize: 500 } })).data.rows.map((r) => ({ value: r.id, label: `${r.code} - ${r.name}` })),
  });

function PurchaseOrderForm({ params, tabId }: ScreenProps) {
  const ws = useWorkspace();
  const doc = useDocument<Record<string, unknown> & { id: number; docNo?: string; status?: string; items?: unknown[]; approval?: ApprovalRequestLike | null }>('/purchase-orders', params.id, { tabId });
  const suppliers = useOptions('/suppliers');
  const warehouses = useOptions('/warehouses');

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: doc.data ? ({ ...doc.data } as unknown as FormValues) : undefined, // populate when loaded
    defaultValues: { docDate: today(), items: [], remarks: '' } as unknown as FormValues,
  });
  const items = useWatch({ control: form.control, name: 'items' }) ?? [];
  const totals = calcTotals(items);
  const status = doc.data?.status;
  const editable = doc.isNew || status === 'DRAFT';

  const save = form.handleSubmit(
    async (v) => {
      await doc.save(v);
    },
    () => toast.warning('Please fix the highlighted fields'),
  );
  const run = async (action: string) => {
    try {
      await doc.transition(action);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  return (
    <FormProvider {...form}>
      <DocumentLayout
        title="Purchase Order"
        icon={ShoppingCart}
        docNo={doc.data?.docNo}
        status={status}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            <DocAction icon={Save} variant="primary" hidden={!editable} loading={doc.saving} onClick={save}>Save</DocAction>
            <DocAction icon={Send} hidden={doc.isNew || status !== 'DRAFT'} onClick={() => run('submit')}>Submit</DocAction>
            <DocAction icon={Check} hidden={status !== 'PENDING_APPROVAL'} onClick={() => run('approve')}>Approve</DocAction>
            <DocAction icon={XCircle} hidden={doc.isNew || ['CANCELLED', 'CLOSED'].includes(status ?? '')} onClick={() => run('cancel')}>Cancel</DocAction>
            <DocActionSep />
            <DocAction
              icon={Truck}
              hidden={!['APPROVED', 'PARTIALLY_RECEIVED'].includes(status ?? '')}
              onClick={async () => {
                const grn = (await doc.convert('create-goods-receipt')) as { id: number; docNo: string };
                ws.open({ screenId: 'goods-receipt-form', params: { id: grn.id }, title: grn.docNo });
              }}
            >
              Create GRN
            </DocAction>
            <DocAction icon={Printer} hidden={doc.isNew} onClick={() => window.print()}>Print</DocAction>
            <DocAction icon={FileDown} hidden={doc.isNew}>PDF</DocAction>
          </>
        }
      >
        <HeaderSection title="PO Information">
          <Field label="PO Number"><Input value={doc.data?.docNo ?? '(auto)'} readOnly /></Field>
          <Field label="Supplier" required error={form.formState.errors.supplierId?.message}>
            <Select options={suppliers.data} placeholder="Select..." disabled={!editable} {...form.register('supplierId')} />
          </Field>
          <Field label="Date" required><DateInput disabled={!editable} {...form.register('docDate')} /></Field>
          <Field label="Warehouse" required error={form.formState.errors.warehouseId?.message}>
            <Select options={warehouses.data} placeholder="Select..." disabled={!editable} {...form.register('warehouseId')} />
          </Field>
        </HeaderSection>

        <DocSection title="Items">
          <LineItemsGrid
            readOnly={!editable}
            columns={[
              { key: 'productId', header: 'Product', type: 'product', width: 130, required: true },
              { key: 'oemNumber', header: 'OEM', type: 'readonly', width: 120 },
              { key: 'description', header: 'Description', type: 'text' },
              { key: 'qty', header: 'Qty', type: 'qty', width: 80, total: true },
              { key: 'rate', header: 'Rate', type: 'money', width: 90 },
              { key: 'discount', header: 'Discount', type: 'money', width: 80 },
              { key: 'vatRate', header: 'VAT %', type: 'percent', width: 60 },
              { key: 'amount', header: 'Total', type: 'computed', width: 100, total: true, compute: (l) => calcLine(l).amount },
            ]}
            newLine={() => ({ qty: 1, rate: 0, discount: 0, vatRate: 5 })}
            priceField="costPrice"
          />
          {form.formState.errors.items?.message && <div className="p-1 text-[11px] text-red-600">{form.formState.errors.items.message}</div>}
        </DocSection>

        <TotalsSection totals={totals} currency="AED" />
        <NotesSection fields={[{ label: 'Remarks', props: { ...form.register('remarks'), disabled: !editable } }]} />
        <ApprovalSection approval={doc.data?.approval} onChanged={doc.refetch} />
        <AttachmentsSection docType="PURCHASE_ORDER" docId={doc.id} />
        <DocumentFlow docType="PURCHASE_ORDER" docId={doc.id} />
        <AuditSection doc={doc.data} />
      </DocumentLayout>
      <span className="hidden">{fmt.money(0)}</span>
    </FormProvider>
  );
}

export default [
  { id: 'purchase-orders', title: 'Purchase Orders', icon: ShoppingCart, component: PurchaseOrdersScreen, permission: 'purchase_order' },
  { id: 'purchase-order-form', title: 'Purchase Order', icon: ShoppingCart, component: PurchaseOrderForm, multiInstance: true, permission: 'purchase_order' },
] satisfies ScreenDef[];
