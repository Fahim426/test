/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Ban, ClipboardCheck, PackageCheck, Save, Send, Trash2, Undo2 } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column } from '@/components/DataTable';
import { AttachmentsSection, AuditSection, DocAction, DocActionSep, DocumentFlow, DocumentLayout, DocSection, HeaderSection } from '@/components/doc';
import { Button, DateInput, EmptyState, Field, Input, NumberInput, Select, StatusBadge, Textarea } from '@/components/ui';
import { useDocument } from '@/hooks/useDocument';
import { usePermission } from '@/store/auth';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { toast } from '@/store/toast';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { num } from '@/lib/calc';
import { cn } from '@/lib/cn';
import { AnyRec, InfoBanner, makeSalesList, useConfirm, useSalesActions, useWarehouses } from '@/components/sales/shared';
import { colCustomer, colDate, colDoc, colMoney, colStatus, SourcePicker } from '@/components/sales/SourcePicker';

const URL = '/sales-returns';
const TYPE = 'SALES_RETURN';

function NewReturnPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const openScreen = useOpenScreen();
  return (
    <SourcePicker
      open={open}
      title="New Sales Return - select the invoice"
      hint="Returns are raised against a posted sales invoice. All returnable quantity is pre-filled; edit the draft to return less."
      onClose={onClose}
      tabs={[
        {
          key: 'inv',
          label: 'Posted invoices',
          url: '/sales-invoices',
          params: { status: 'POSTED,PARTIALLY_PAID,PAID' },
          empty: 'No posted sales invoices found.',
          columns: [colDoc('Invoice No', 'docNo'), colDate(), colCustomer, colMoney('Total', 'total'), colStatus],
          actionLabel: 'Create Return',
          onPick: async (r) => {
            const d = (await api.post(`/sales-invoices/${r.id}/create-return`, {})).data;
            toast.success('Sales return created');
            openScreen('sales-return-form', { id: d.id }, d.docNo);
          },
        },
      ]}
    />
  );
}

const ReturnsList = makeSalesList<AnyRec>({
  tableKey: 'sales-returns',
  url: URL,
  exportName: 'Sales Returns',
  formScreen: 'sales-return-form',
  permission: 'sales_return',
  newLabel: 'New Return',
  statuses: ['DRAFT', 'RECEIVED', 'INSPECTED', 'POSTED', 'CANCELLED'],
  picker: (p) => <NewReturnPicker {...p} />,
  columns: [
    { key: 'docNo', header: 'Return No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'invoice.docNo', header: 'Invoice', width: 130, sortable: false },
    { key: 'customer.name', header: 'Customer', sortable: false, filter: 'text' },
    { key: 'warehouse.name', header: 'Warehouse', sortable: false, hidden: true },
    { key: 'reason', header: 'Reason', sortable: false },
    { key: 'total', header: 'Credit Value', type: 'money', total: 'sum' },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
  ] as Column<AnyRec>[],
});

const STEPS = ['DRAFT', 'RECEIVED', 'INSPECTED', 'POSTED'];
const STEP_LABEL: Record<string, string> = { DRAFT: 'Return Requested', RECEIVED: 'Goods Received', INSPECTED: 'Inspected', POSTED: 'Posted + Credit Note' };

function Stepper({ status }: { status: string }) {
  const cur = STEPS.indexOf(status);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <span className={cn('rounded-full border px-3 py-1 text-xs font-medium', i < cur || status === 'POSTED' ? 'border-success bg-success-soft text-success' : i === cur ? 'border-brand bg-brand text-white shadow-card' : 'border-line bg-surface text-ink-faint')}>
            {i + 1}. {STEP_LABEL[s]}
          </span>
          {i < STEPS.length - 1 && <span className="h-0.5 w-4 rounded bg-line-strong" />}
        </div>
      ))}
      {status === 'CANCELLED' && <span className="ml-2 rounded-full border border-danger bg-danger-soft px-3 py-1 text-xs font-medium text-danger">Cancelled</span>}
    </div>
  );
}

interface Ln {
  qty: number;
  received: number;
  resalable: number;
  damaged: number;
}

function ReturnForm({ params, tabId }: ScreenProps) {
  const doc = useDocument<AnyRec>(URL, params.id, { tabId });
  const can = usePermission();
  const ws = useWorkspace();
  const confirm = useConfirm();
  const openScreen = useOpenScreen();
  const act = useSalesActions(URL, doc.id, doc.invalidate);
  const warehouses = useWarehouses();
  const [ln, setLn] = useState<Record<number, Ln>>({});
  const [head, setHead] = useState({ docDate: '', warehouseId: '' as number | '', reason: '', remarks: '' });
  const [pickerOpen, setPickerOpen] = useState(false);

  const items = (doc.data?.items as AnyRec[] | undefined) ?? [];
  const status: string = doc.data?.status ?? '';

  useEffect(() => {
    if (!doc.data) return;
    setLn(
      Object.fromEntries(
        items.map((i) => {
          const rcv = num(i.receivedQty);
          const hasInsp = num(i.resalableQty) + num(i.damagedQty) > 0;
          return [i.id, { qty: num(i.qty), received: rcv > 0 || status !== 'DRAFT' ? rcv : num(i.qty), resalable: hasInsp ? num(i.resalableQty) : rcv, damaged: hasInsp ? num(i.damagedQty) : 0 }];
        }),
      ),
    );
    setHead({ docDate: fmt.isoDate(doc.data.docDate), warehouseId: doc.data.warehouseId ?? '', reason: doc.data.reason ?? '', remarks: doc.data.remarks ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.data]);

  const editable = status === 'DRAFT' && can('sales_return', 'edit');
  const inspecting = ['RECEIVED', 'INSPECTED'].includes(status) && can('sales_return', 'edit');
  const set = (id: number, patch: Partial<Ln>) => setLn((m) => ({ ...m, [id]: { ...m[id], ...patch } }));

  const draftDirty = useMemo(
    () =>
      !!doc.data &&
      (items.some((i) => num(ln[i.id]?.qty) !== num(i.qty)) ||
        head.reason !== (doc.data.reason ?? '') ||
        head.remarks !== (doc.data.remarks ?? '') ||
        head.warehouseId !== (doc.data.warehouseId ?? '') ||
        head.docDate !== fmt.isoDate(doc.data.docDate)),
    [items, ln, head, doc.data],
  );

  const save = useMutation({
    mutationFn: async () => {
      const lines = items.map((i) => ({ invoiceItemId: i.invoiceItemId, qty: num(ln[i.id]?.qty) })).filter((l) => l.qty > 0);
      if (!lines.length) throw new Error('Return at least one item (quantity greater than zero)');
      return (await api.put(`${URL}/${doc.id}`, { docDate: head.docDate || undefined, warehouseId: head.warehouseId || undefined, reason: head.reason || null, remarks: head.remarks || null, items: lines })).data;
    },
    onSuccess: () => {
      toast.success('Sales return saved');
      doc.invalidate();
    },
    onError: (e) => toast.error(e instanceof Error && !('response' in e) ? e.message : apiError(e)),
  });

  if (doc.isNew) {
    return (
      <DocumentLayout title="Sales Return" icon={Undo2}>
        <EmptyState title="Sales returns are raised against a posted invoice" hint="Open the invoice and use Create Return, or choose an invoice below." action={<Button variant="primary" onClick={() => setPickerOpen(true)}>Select invoice</Button>} />
        <NewReturnPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
      </DocumentLayout>
    );
  }

  const receive = () =>
    act.post('receive', { items: items.map((i) => ({ id: i.id, receivedQty: num(ln[i.id]?.received) })) }, 'Goods received - now inspect them');
  const inspect = () => {
    for (const i of items) {
      const l = ln[i.id];
      if (Math.abs(num(l?.resalable) + num(l?.damaged) - num(i.receivedQty)) > 0.0005) {
        toast.error(`${i.product?.code}: resalable + damaged must equal the received qty (${fmt.qty(i.receivedQty)})`);
        return;
      }
    }
    return act.post('inspect', { items: items.map((i) => ({ id: i.id, resalableQty: num(ln[i.id]?.resalable), damagedQty: num(ln[i.id]?.damaged) })) }, 'Inspection recorded');
  };
  const post = async () => {
    const resalable = items.reduce((s, i) => s + num(i.resalableQty), 0);
    const damaged = items.reduce((s, i) => s + num(i.damagedQty), 0);
    const ok = await confirm.ask(
      <div className="space-y-2">
        <div>Post sales return <b>{doc.data?.docNo}</b>?</div>
        <ul className="list-disc pl-4">
          <li>Resalable stock returned to inventory: <b>{fmt.qty(resalable)}</b></li>
          <li>Damaged stock received and written off: <b>{fmt.qty(damaged)}</b></li>
          <li>A credit note is created and the invoice outstanding is reduced.</li>
          <li>This cannot be cancelled afterwards.</li>
        </ul>
      </div>,
      { title: 'Post sales return', confirmLabel: 'Post return' },
    );
    if (ok) await act.post('post', {}, 'Return posted - credit note created');
  };

  const inv = doc.data?.invoice;
  const note = doc.data?.creditNote;
  return (
    <>
      {confirm.node}
      <DocumentLayout
        title="Sales Return"
        icon={Undo2}
        docNo={doc.data?.docNo}
        status={status}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            <DocAction icon={Save} variant="primary" hidden={!editable} loading={save.isPending} disabled={!draftDirty} onClick={() => save.mutate()}>Save</DocAction>
            <DocAction icon={PackageCheck} variant="primary" hidden={status !== 'DRAFT' || !can('sales_return', 'edit')} loading={act.busy === 'receive'} disabled={draftDirty} onClick={receive}>Receive Goods</DocAction>
            <DocAction icon={ClipboardCheck} variant="primary" hidden={!inspecting} loading={act.busy === 'inspect'} onClick={inspect}>{status === 'INSPECTED' ? 'Re-inspect' : 'Save Inspection'}</DocAction>
            <DocAction icon={Send} variant="primary" hidden={status !== 'INSPECTED' || !can('sales_return', 'post')} loading={act.busy === 'post'} onClick={post}>Post + Credit Note</DocAction>
            <DocActionSep />
            <DocAction
              icon={Ban}
              hidden={!['DRAFT', 'RECEIVED', 'INSPECTED'].includes(status) || !can('sales_return', 'cancel')}
              loading={act.busy === 'cancel'}
              onClick={async () => (await confirm.ask('Cancel this sales return?', { danger: true, confirmLabel: 'Cancel return' })) && act.post('cancel', {}, 'Return cancelled')}
            >
              Cancel
            </DocAction>
            <DocAction
              icon={Trash2}
              hidden={status !== 'DRAFT' || !can('sales_return', 'delete')}
              onClick={async () => {
                if (!(await confirm.ask('Delete this draft return?', { danger: true, confirmLabel: 'Delete' }))) return;
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
        <Stepper status={status} />
        {status === 'DRAFT' && <InfoBanner tone="blue">Step 1: set the quantity the customer is returning and save. Step 2: when the goods arrive press <b>Receive Goods</b> (adjust the received quantity if different).</InfoBanner>}
        {inspecting && <InfoBanner tone="blue">Step 3: inspect the received goods. For every line split the received quantity into <b>resalable</b> (back to stock) and <b>damaged</b> (written off), then save the inspection.</InfoBanner>}
        {status === 'POSTED' && note && (
          <InfoBanner tone="green">
            Credit note <button className="font-bold underline" onClick={() => openScreen('credit-note-form', { id: note.id }, note.noteNo)}>{note.noteNo}</button> posted for <b>{fmt.money(note.total)} AED</b> (net {fmt.money(note.subtotal)} + VAT {fmt.money(note.vatAmount)}).
          </InfoBanner>
        )}

        <HeaderSection title="Return Information" columns={4}>
          <Field label="Return Number"><Input value={doc.data?.docNo ?? ''} readOnly /></Field>
          <Field label="Invoice">
            <button type="button" className="ctl text-left font-semibold text-brand underline" onClick={() => inv && openScreen('sales-invoice-form', { id: inv.id }, inv.docNo)}>{inv?.docNo ?? '-'} {inv && <StatusBadge status={inv.status} />}</button>
          </Field>
          <Field label="Customer"><Input value={doc.data?.customer?.name ?? ''} readOnly /></Field>
          <Field label="Date"><DateInput value={head.docDate} disabled={!editable} onChange={(e) => setHead({ ...head, docDate: e.target.value })} /></Field>
          <Field label="Return Warehouse">
            <Select key={warehouses.data?.length ?? 0} value={head.warehouseId} options={warehouses.data} disabled={!editable} onChange={(e) => setHead({ ...head, warehouseId: e.target.value ? Number(e.target.value) : '' })} />
          </Field>
          <Field label="Reason" className="col-span-2"><Input value={head.reason} disabled={!editable} onChange={(e) => setHead({ ...head, reason: e.target.value })} placeholder="Wrong part, defective, excess..." /></Field>
          <Field label="Received On"><Input value={fmt.date(doc.data?.receivedDate)} readOnly /></Field>
        </HeaderSection>

        <DocSection title="Return Items">
          <div className="overflow-auto border border-line">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="h-9">
                  <th className="grid-th w-8">#</th>
                  <th className="grid-th">Product</th>
                  <th className="grid-th">OEM</th>
                  <th className="grid-th !text-right">Invoiced</th>
                  <th className="grid-th !text-right w-[100px]">Return Qty</th>
                  <th className="grid-th !text-right w-[100px]">Received</th>
                  <th className="grid-th !text-right w-[100px]">Resalable</th>
                  <th className="grid-th !text-right w-[100px]">Damaged</th>
                  <th className="grid-th !text-right">Rate</th>
                  <th className="grid-th !text-right">VAT</th>
                  <th className="grid-th !text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, n) => {
                  const l = ln[i.id] ?? { qty: num(i.qty), received: 0, resalable: 0, damaged: 0 };
                  const inspBad = inspecting && Math.abs(l.resalable + l.damaged - num(i.receivedQty)) > 0.0005;
                  return (
                    <tr key={i.id} className={cn('h-9 odd:bg-surface even:bg-surface-2', inspBad && '!bg-danger-soft')}>
                      <td className="grid-td text-center text-ink-faint">{n + 1}</td>
                      <td className="grid-td font-medium">{i.product?.code}</td>
                      <td className="grid-td">{i.product?.oemNumber}</td>
                      <td className="grid-td text-right tabular-nums">{fmt.qty(i.invoicedQty)}</td>
                      <td className="grid-td"><NumberInput min={0} max={num(i.invoicedQty)} value={l.qty} disabled={!editable} onFocus={(e) => e.target.select()} onChange={(e) => set(i.id, { qty: Number(e.target.value) })} /></td>
                      <td className="grid-td">
                        {status === 'DRAFT' ? (
                          <NumberInput min={0} max={l.qty} value={l.received} disabled={!can('sales_return', 'edit')} onFocus={(e) => e.target.select()} onChange={(e) => set(i.id, { received: Math.min(l.qty, Number(e.target.value)) })} />
                        ) : (
                          <span className="block px-2 text-right tabular-nums">{fmt.qty(i.receivedQty)}</span>
                        )}
                      </td>
                      <td className="grid-td">
                        {inspecting ? (
                          <NumberInput min={0} max={num(i.receivedQty)} value={l.resalable} onFocus={(e) => e.target.select()} onChange={(e) => { const v = Math.min(num(i.receivedQty), Number(e.target.value)); set(i.id, { resalable: v, damaged: Math.round((num(i.receivedQty) - v) * 1000) / 1000 }); }} />
                        ) : (
                          <span className="block px-2 text-right tabular-nums">{status === 'POSTED' ? fmt.qty(i.resalableQty) : ''}</span>
                        )}
                      </td>
                      <td className="grid-td">
                        {inspecting ? (
                          <NumberInput min={0} max={num(i.receivedQty)} value={l.damaged} onFocus={(e) => e.target.select()} onChange={(e) => { const v = Math.min(num(i.receivedQty), Number(e.target.value)); set(i.id, { damaged: v, resalable: Math.round((num(i.receivedQty) - v) * 1000) / 1000 }); }} />
                        ) : (
                          <span className={cn('block px-2 text-right tabular-nums', num(i.damagedQty) > 0 && 'font-semibold text-danger')}>{status === 'POSTED' ? fmt.qty(i.damagedQty) : ''}</span>
                        )}
                      </td>
                      <td className="grid-td text-right tabular-nums">{fmt.money(i.rate)}</td>
                      <td className="grid-td text-right tabular-nums">{fmt.money(i.vatAmount)}</td>
                      <td className="grid-td text-right font-medium tabular-nums">{fmt.money(i.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="h-9">
                  <td colSpan={4} className="border-t-2 border-line bg-surface-2 px-3 font-semibold">Total</td>
                  <td className="border-t-2 border-line bg-surface-2 px-3 text-right font-semibold tabular-nums">{fmt.qty(items.reduce((s, i) => s + num(ln[i.id]?.qty), 0))}</td>
                  <td className="border-t-2 border-line bg-surface-2 px-3 text-right font-semibold tabular-nums">{fmt.qty(items.reduce((s, i) => s + (status === 'DRAFT' ? num(ln[i.id]?.received) : num(i.receivedQty)), 0))}</td>
                  <td className="border-t-2 border-line bg-surface-2 px-3 text-right font-semibold tabular-nums">{fmt.qty(items.reduce((s, i) => s + (inspecting ? num(ln[i.id]?.resalable) : num(i.resalableQty)), 0))}</td>
                  <td className="border-t-2 border-line bg-surface-2 px-3 text-right font-semibold tabular-nums">{fmt.qty(items.reduce((s, i) => s + (inspecting ? num(ln[i.id]?.damaged) : num(i.damagedQty)), 0))}</td>
                  <td className="border-t-2 border-line bg-surface-2" />
                  <td className="border-t-2 border-line bg-surface-2 px-3 text-right font-semibold tabular-nums">{fmt.money(doc.data?.vatAmount)}</td>
                  <td className="border-t-2 border-line bg-surface-2 px-3 text-right font-bold tabular-nums text-brand">{fmt.money(doc.data?.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="mt-1 text-xs text-ink-muted">Credit amounts follow the original invoice price (net + VAT) for the quantity returned and are finalised on the received quantity when the return is posted.</div>
        </DocSection>

        <DocSection title="Notes">
          <Field label="Remarks"><Textarea rows={2} value={head.remarks} disabled={!editable} onChange={(e) => setHead({ ...head, remarks: e.target.value })} /></Field>
        </DocSection>
        <AttachmentsSection docType={TYPE} docId={doc.id} />
        <AuditSection doc={doc.data} />
      </DocumentLayout>
    </>
  );
}

export default [
  { id: 'sales-returns', title: 'Sales Returns', icon: Undo2, component: ReturnsList, permission: 'sales_return' },
  { id: 'sales-return-form', title: 'Sales Return', icon: Undo2, component: ReturnForm, multiInstance: true, permission: 'sales_return' },
] satisfies ScreenDef[];
