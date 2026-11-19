import { RevisionHistory } from '@/components/doc/RevisionHistory';
import { useEffect, useMemo, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { ArrowLeftRight, Ban, Check, PackageCheck, Plus, Save, Send, Truck, XCircle } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column, DataTable } from '@/components/DataTable';
import { DocAction, DocActionSep, DocSection, DocumentLayout, HeaderSection, LineItemsGrid } from '@/components/doc';
import { Button, ConfirmDialog, DateInput, Field, Input, NumberInput, Select, Textarea } from '@/components/ui';
import { Stepper } from '@/components/inventory/Stepper';
import { STATUS_OPTIONS, useOptions } from '@/components/inventory/common';
import { useDocument } from '@/hooks/useDocument';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { apiError } from '@/lib/api';
import { fmt, today } from '@/lib/format';
import { toast } from '@/store/toast';

interface TRow {
  id: number; transferNo: string; txDate: string; status: string; itemCount: number; totalQty: number; receivedQty: number;
  fromWarehouse?: { name: string } | null; toWarehouse?: { name: string } | null; remarks?: string | null;
}

const STATUSES = ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVING', 'COMPLETED', 'REJECTED', 'CANCELLED'];

function StockTransfersScreen() {
  const open = useOpenScreen();
  const can = usePermission();
  const [status, setStatus] = useState('');
  const [warehouseId, setWh] = useState('');
  const warehouses = useOptions('/warehouses');
  const columns: Column<TRow>[] = [
    { key: 'transferNo', header: 'Transfer No', width: 130 },
    { key: 'txDate', header: 'Date', type: 'date', width: 100, filter: 'date' },
    { key: 'fromWarehouse.name', header: 'From', sortable: false },
    { key: 'toWarehouse.name', header: 'To', sortable: false },
    { key: 'itemCount', header: 'Lines', type: 'number', width: 60, sortable: false },
    { key: 'totalQty', header: 'Qty', type: 'qty', width: 80, sortable: false, total: 'sum' },
    { key: 'receivedQty', header: 'Received', type: 'qty', width: 80, sortable: false },
    { key: 'status', header: 'Status', type: 'status', width: 120 },
    { key: 'remarks', header: 'Remarks', sortable: false, hidden: true },
  ];
  return (
    <DataTable<TRow>
      tableKey="stock-transfers"
      url="/stock-transfers"
      columns={columns}
      exportName="Stock Transfers"
      filters={{ status, warehouseId }}
      defaultSort={{ key: 'id', dir: 'desc' }}
      onRowDoubleClick={(r) => open('stock-transfer-form', { id: r.id }, r.transferNo)}
      rowActions={[{ label: 'Open', onClick: (r) => open('stock-transfer-form', { id: r.id }, r.transferNo) }]}
      toolbarExtras={
        <>
          {can('stock_transfer', 'create') && <Button variant="primary" icon={Plus} onClick={() => open('stock-transfer-form', {}, 'New Transfer')}>New Transfer</Button>}
          <Select className="w-36" options={STATUS_OPTIONS(STATUSES)} placeholder="All statuses" value={status} onChange={(e) => setStatus(e.target.value)} />
          <Select className="w-40" options={warehouses.options} placeholder="Any warehouse" value={warehouseId} onChange={(e) => setWh(e.target.value)} />
        </>
      }
    />
  );
}

/* ------------------------------------ FORM ------------------------------------ */
interface TItem { id: number; productId: number; qty: number; receivedQty: number; pendingQty: number; unitCost: number; value: number; product?: { code: string; name: string; oemNumber?: string | null } }
interface TDoc extends Record<string, unknown> {
  id: number; transferNo: string; txDate: string; status: string; fromWarehouseId: number; toWarehouseId: number; remarks?: string | null; items: TItem[];
  fromWarehouse?: { name: string } | null; toWarehouse?: { name: string } | null;
}
interface TForm {
  fromWarehouseId: string; toWarehouseId: string; txDate: string; remarks: string;
  items: { productId?: number; productCode?: string; description?: string; oemNumber?: string; qty: number; receivedQty?: number; pendingQty?: number; unitCost?: number; available?: number; product?: unknown }[];
}
const FLOW = ['Requested', 'Approved', 'Dispatched', 'In Transit', 'Receiving', 'Completed'];
const stageIndex = (s?: string) => ({ REQUESTED: 0, APPROVED: 1, IN_TRANSIT: 3, DISPATCHED: 3, RECEIVING: 4, COMPLETED: 5 } as Record<string, number>)[s ?? ''] ?? 0;

function StockTransferForm({ params, tabId }: ScreenProps) {
  const ws = useWorkspace();
  const can = usePermission();
  const doc = useDocument<TDoc>('/stock-transfers', params.id, { tabId, titleOf: (d) => d.transferNo });
  const warehouses = useOptions('/warehouses');
  const [recv, setRecv] = useState<Record<number, string>>({});
  const [confirm, setConfirm] = useState<'cancel' | 'reject' | 'dispatch' | null>(null);
  const [reason, setReason] = useState('');

  const values = useMemo<TForm | undefined>(() => {
    const d = doc.data;
    if (!d) return undefined;
    return {
      fromWarehouseId: String(d.fromWarehouseId), toWarehouseId: String(d.toWarehouseId), txDate: String(d.txDate).slice(0, 10), remarks: d.remarks ?? '',
      items: d.items.map((i) => ({ productId: i.productId, productCode: i.product?.code, description: i.product?.name, oemNumber: i.product?.oemNumber ?? '', qty: i.qty, receivedQty: i.receivedQty, pendingQty: i.pendingQty, unitCost: i.unitCost, product: i.product })),
    };
  }, [doc.data]);
  const form = useForm<TForm>({ values, defaultValues: { fromWarehouseId: '', toWarehouseId: '', txDate: today(), remarks: '', items: [] } });
  const { register, handleSubmit, formState, control } = form;
  const fromWh = useWatch({ control, name: 'fromWarehouseId' });
  useEffect(() => ws.setDirty(tabId, formState.isDirty), [formState.isDirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = doc.data?.status;
  const editable = doc.isNew || status === 'REQUESTED';
  const inTransit = status === 'IN_TRANSIT' || status === 'RECEIVING' || status === 'DISPATCHED';
  const halted = status === 'REJECTED' || status === 'CANCELLED' ? fmt.status(status) : undefined;

  const run = async (action: string, body?: unknown) => {
    try {
      await doc.transition(action, body);
      setRecv({});
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const save = handleSubmit(async (v) => {
    if (!v.fromWarehouseId || !v.toWarehouseId) return toast.warning('Select both warehouses');
    if (v.fromWarehouseId === v.toWarehouseId) return toast.warning('Source and destination must differ');
    const items = v.items.filter((i) => i.productId && Number(i.qty) > 0).map((i) => ({ productId: Number(i.productId), qty: Number(i.qty) }));
    if (!items.length) return toast.warning('Add at least one line with quantity');
    try {
      await doc.save({ fromWarehouseId: Number(v.fromWarehouseId), toWarehouseId: Number(v.toWarehouseId), txDate: v.txDate, remarks: v.remarks || null, items });
    } catch {
      /* toast shown */
    }
  });

  const receiveSelected = () => {
    const items = (doc.data?.items ?? [])
      .map((i) => ({ itemId: i.id, receivedQty: Number(recv[i.id] ?? 0) }))
      .filter((x) => x.receivedQty > 0);
    if (!items.length) return toast.warning('Enter received quantities');
    run('receive', { items });
  };

  return (
    <FormProvider {...form}>
      <DocumentLayout
        title="Stock Transfer"
        icon={ArrowLeftRight}
        docNo={doc.data?.transferNo}
        status={status}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            <DocAction icon={Save} variant="primary" hidden={!editable} loading={doc.saving} onClick={save}>{doc.isNew ? 'Create Request' : 'Save'}</DocAction>
            <DocActionSep />
            <DocAction icon={Check} hidden={status !== 'REQUESTED' || !can('stock_transfer', 'approve')} onClick={() => run('approve')}>Approve</DocAction>
            <DocAction icon={XCircle} hidden={status !== 'REQUESTED' || !can('stock_transfer', 'reject')} onClick={() => setConfirm('reject')}>Reject</DocAction>
            <DocAction icon={Truck} variant="primary" hidden={status !== 'APPROVED' || !can('stock_transfer', 'post')} onClick={() => setConfirm('dispatch')}>Dispatch</DocAction>
            <DocAction icon={PackageCheck} variant="primary" hidden={!inTransit || !can('stock_transfer', 'post')} onClick={() => run('receive', { receiveAll: true })}>Receive All</DocAction>
            <DocAction icon={Send} hidden={!inTransit || !can('stock_transfer', 'post')} onClick={receiveSelected}>Receive Entered Qty</DocAction>
            <DocAction icon={Ban} variant="danger" hidden={!['REQUESTED', 'APPROVED'].includes(status ?? '') || !can('stock_transfer', 'cancel')} onClick={() => setConfirm('cancel')}>Cancel</DocAction>
          </>
        }
      >
        {!doc.isNew && <Stepper stages={FLOW} current={stageIndex(status)} halted={halted} />}
        <HeaderSection title="Transfer Information">
          <Field label="Transfer No"><Input readOnly value={doc.data?.transferNo ?? '(auto)'} /></Field>
          <Field label="Date" required><DateInput disabled={!editable} {...register('txDate')} /></Field>
          <Field label="From Warehouse" required><Select options={warehouses.options} placeholder="Select..." disabled={!editable} {...register('fromWarehouseId')} /></Field>
          <Field label="To Warehouse" required><Select options={warehouses.options} placeholder="Select..." disabled={!editable} {...register('toWarehouseId')} /></Field>
          <Field label="Remarks" className="col-span-4"><Textarea rows={2} readOnly={!editable} {...register('remarks')} /></Field>
        </HeaderSection>

        <DocSection title="Items">
          <LineItemsGrid
            readOnly={!editable}
            warehouseId={fromWh || undefined}
            columns={[
              { key: 'productId', header: 'Product', type: 'product', width: 130, required: true },
              { key: 'oemNumber', header: 'OEM', type: 'readonly', width: 120 },
              { key: 'description', header: 'Description', type: 'readonly' },
              { key: 'available', header: 'Available (source)', type: 'readonly', format: 'qty', width: 110 },
              { key: 'qty', header: 'Qty', type: 'qty', width: 90, total: true, min: 0 },
              ...(!doc.isNew ? [
                { key: 'receivedQty', header: 'Received', type: 'readonly' as const, format: 'qty' as const, width: 90 },
                { key: 'pendingQty', header: 'Pending', type: 'readonly' as const, format: 'qty' as const, width: 90 },
                { key: 'unitCost', header: 'Unit Cost', type: 'readonly' as const, format: 'money' as const, width: 90 },
              ] : []),
            ]}
            newLine={() => ({ qty: 1 })}
          />
        </DocSection>

        {inTransit && (
          <DocSection title="Receive Goods (partial receipts allowed)">
            <table className="w-full max-w-[760px] border-collapse text-[12px]">
              <thead><tr className="bg-app-head"><th className="grid-th px-2 text-left">Product</th><th className="grid-th px-2 text-right">Qty</th><th className="grid-th px-2 text-right">Received</th><th className="grid-th px-2 text-right">Pending</th><th className="grid-th w-28 px-2 text-right">Receive now</th></tr></thead>
              <tbody>
                {(doc.data?.items ?? []).map((i) => (
                  <tr key={i.id}>
                    <td className="grid-td px-2">{i.product?.code} - {i.product?.name}</td>
                    <td className="grid-td px-2 text-right">{fmt.qty(i.qty)}</td>
                    <td className="grid-td px-2 text-right">{fmt.qty(i.receivedQty)}</td>
                    <td className="grid-td px-2 text-right">{fmt.qty(i.pendingQty)}</td>
                    <td className="grid-td p-0">
                      <NumberInput className="!h-6" min={0} max={i.pendingQty} disabled={i.pendingQty <= 0} placeholder={String(i.pendingQty)} value={recv[i.id] ?? ''} onChange={(e) => setRecv((s) => ({ ...s, [i.id]: e.target.value }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DocSection>
        )}
      <RevisionHistory entity="StockTransfer" id={doc.id} />
      </DocumentLayout>

      <ConfirmDialog
        open={confirm === 'dispatch'}
        title="Dispatch transfer"
        message="Stock will be deducted from the source warehouse and the transfer moves to In Transit."
        confirmLabel="Dispatch"
        onConfirm={() => { setConfirm(null); run('dispatch'); }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        danger
        title="Cancel transfer"
        message="Cancel this transfer request?"
        confirmLabel="Cancel Transfer"
        onConfirm={() => { setConfirm(null); run('cancel'); }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'reject'}
        danger
        title="Reject transfer"
        message={<div className="space-y-2"><div>Reject this transfer request?</div><Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} /></div>}
        confirmLabel="Reject"
        onConfirm={() => { setConfirm(null); run('reject', { reason: reason || undefined }); }}
        onCancel={() => setConfirm(null)}
      />
    </FormProvider>
  );
}

export default [
  { id: 'stock-transfers', title: 'Stock Transfers', icon: ArrowLeftRight, component: StockTransfersScreen, permission: 'stock_transfer' },
  { id: 'stock-transfer-form', title: 'Stock Transfer', icon: ArrowLeftRight, component: StockTransferForm, multiInstance: true, permission: 'stock_transfer' },
] satisfies ScreenDef[];
