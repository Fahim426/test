/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, PackageCheck, PackageOpen, Plus, Printer, Save, Trash2, Truck } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column } from '@/components/DataTable';
import { useProductInfoColumns, ProductInfoHeads, ProductInfoCells, AttachmentsSection, AuditSection, DocAction, DocActionSep, DocumentFlow, DocumentLayout, DocSection, HeaderSection } from '@/components/doc';
import { Button, DateInput, EmptyState, Field, Input, NumberInput, Select, StatusBadge, Textarea } from '@/components/ui';
import { useDocument } from '@/hooks/useDocument';
import { usePermission, useAuth } from '@/store/auth';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { toast } from '@/store/toast';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { num } from '@/lib/calc';
import { AnyRec, InfoBanner, makeSalesList, useConfirm, useSalesActions } from '@/components/sales/shared';
import { colCustomer, colDate, colDoc, colQty, colStatus, SourcePicker } from '@/components/sales/SourcePicker';

const URL = '/packing-lists';
const TYPE = 'PACKING_LIST';

function NewPackingPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const openScreen = useOpenScreen();
  return (
    <SourcePicker
      open={open}
      title="New Packing List - select a picking list"
      hint="Packing lists are created from picking lists that have picked quantity which is not yet packed."
      onClose={onClose}
      tabs={[
        {
          key: 'pick',
          label: 'Picking lists',
          url: '/picking-lists',
          params: { status: 'PARTIALLY_PICKED,PICKED' },
          empty: 'No picking list with picked-but-unpacked quantity. Record picking first.',
          columns: [colDoc('Picking No', 'docNo'), colDate(), { header: 'Sales Order', render: (r) => r.salesOrder?.docNo }, { header: 'Customer', render: (r) => r.salesOrder?.customer?.name }, colQty('Picked', 'pickedQty'), colStatus],
          actionLabel: 'Create Packing',
          onPick: async (r) => {
            const d = (await api.post(`/picking-lists/${r.id}/create-packing`, {})).data;
            toast.success('Packing list created');
            openScreen('packing-list-form', { id: d.id }, d.docNo);
          },
        },
      ]}
    />
  );
}

const PackingList = makeSalesList<AnyRec>({
  tableKey: 'packing-lists',
  url: URL,
  exportName: 'Packing Lists',
  formScreen: 'packing-list-form',
  permission: 'packing',
  newLabel: 'New Packing List',
  statuses: ['DRAFT', 'PACKED', 'DELIVERED', 'CANCELLED'],
  picker: (p) => <NewPackingPicker {...p} />,
  columns: [
    { key: 'docNo', header: 'Packing No', width: 130, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'salesOrder.docNo', header: 'Sales Order', width: 130, sortable: false },
    { key: 'customer.name', header: 'Customer', sortable: false, filter: 'text' },
    { key: 'boxes', header: 'Boxes', type: 'number', width: 70, sortable: false, total: 'sum' },
    { key: 'totalWeight', header: 'Weight (kg)', type: 'qty', width: 90, sortable: false, total: 'sum' },
    { key: 'dimensions', header: 'Dimensions', sortable: false },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
  ] as Column<AnyRec>[],
});

interface PackRow {
  key: number;
  productId: number | '';
  boxNo: number;
  qty: number;
  weight: number;
}

function PackingForm({ params, tabId }: ScreenProps) {
  const productInfoCount = useProductInfoColumns().length;
  const doc = useDocument<AnyRec>(URL, params.id, { tabId });
  const can = usePermission();
  const ws = useWorkspace();
  const confirm = useConfirm();
  const openScreen = useOpenScreen();
  const act = useSalesActions(URL, doc.id, doc.invalidate);
  const [rows, setRows] = useState<PackRow[]>([]);
  const [head, setHead] = useState({ docDate: '', boxes: 1, dimensions: '', totalWeight: 0, remarks: '' });
  const [autoWeight, setAutoWeight] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  void useAuth;

  const status: string = doc.data?.status ?? '';
  const editable = status === 'DRAFT' && can('packing', 'edit');

  // products available on the source picking list (for the product select)
  const pickingId: number | undefined = doc.data?.pickingId ?? doc.data?.picking?.id;
  const pick = useQuery({ queryKey: ['picking-src', pickingId], enabled: !!pickingId, queryFn: async () => (await api.get<AnyRec>(`/picking-lists/${pickingId}`)).data });
  const prodOpts = useMemo(() => {
    const m = new Map<number, string>();
    for (const i of (pick.data?.items as AnyRec[] | undefined) ?? []) m.set(i.productId, `${i.product?.code} - ${i.product?.name}`);
    for (const i of (doc.data?.items as AnyRec[] | undefined) ?? []) if (!m.has(i.productId)) m.set(i.productId, `${i.product?.code} - ${i.product?.name}`);
    return [...m].map(([value, label]) => ({ value, label }));
  }, [pick.data, doc.data]);
  const pickedByProduct = useMemo(() => {
    const m = new Map<number, number>();
    for (const i of (pick.data?.items as AnyRec[] | undefined) ?? []) m.set(i.productId, (m.get(i.productId) ?? 0) + num(i.pickedQty));
    return m;
  }, [pick.data]);

  useEffect(() => {
    if (!doc.data) return;
    setRows(((doc.data.items as AnyRec[]) ?? []).map((i, n) => ({ key: n, productId: i.productId, boxNo: num(i.boxNo) || 1, qty: num(i.qty), weight: num(i.weight) })));
    setHead({ docDate: fmt.isoDate(doc.data.docDate), boxes: num(doc.data.boxes) || 1, dimensions: doc.data.dimensions ?? '', totalWeight: num(doc.data.totalWeight), remarks: doc.data.remarks ?? '' });
    setAutoWeight(true);
  }, [doc.data]);

  const maxBox = Math.max(1, ...rows.map((r) => r.boxNo));
  const sumWeight = rows.reduce((s, r) => s + num(r.weight), 0);
  const boxSummary = useMemo(() => {
    const m = new Map<number, { qty: number; weight: number; lines: number }>();
    for (const r of rows) {
      const b = m.get(r.boxNo) ?? { qty: 0, weight: 0, lines: 0 };
      b.qty += num(r.qty);
      b.weight += num(r.weight);
      b.lines++;
      m.set(r.boxNo, b);
    }
    return [...m].sort((a, b) => a[0] - b[0]);
  }, [rows]);
  const dirty = useMemo(() => {
    if (!doc.data) return false;
    const orig = ((doc.data.items as AnyRec[]) ?? []).map((i) => `${i.productId}|${num(i.boxNo)}|${num(i.qty)}|${num(i.weight)}`).join(';');
    const cur = rows.map((r) => `${r.productId}|${r.boxNo}|${r.qty}|${r.weight}`).join(';');
    return orig !== cur || head.dimensions !== (doc.data.dimensions ?? '') || head.remarks !== (doc.data.remarks ?? '') || head.boxes !== (num(doc.data.boxes) || 1);
  }, [rows, head, doc.data]);

  const upd = (key: number, patch: Partial<PackRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = useMutation({
    mutationFn: async () => {
      if (!rows.length) throw new Error('Add at least one line');
      if (rows.some((r) => !r.productId || r.qty <= 0)) throw new Error('Every line needs a product and a quantity greater than zero');
      return (
        await api.put(`${URL}/${doc.id}`, {
          docDate: head.docDate || undefined,
          boxes: Math.max(head.boxes, maxBox),
          dimensions: head.dimensions || null,
          remarks: head.remarks || null,
          totalWeight: autoWeight ? undefined : head.totalWeight,
          items: rows.map((r) => ({ productId: Number(r.productId), boxNo: r.boxNo, qty: r.qty, weight: r.weight || undefined })),
        })
      ).data;
    },
    onSuccess: () => {
      toast.success('Packing list saved');
      doc.invalidate();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (doc.isNew) {
    return (
      <DocumentLayout title="Packing List" icon={PackageOpen}>
        <EmptyState title="Packing lists are created from a picking list" hint="Open a picked picking list and use Create Packing, or choose one below." action={<Button variant="primary" onClick={() => setPickerOpen(true)}>Select picking list</Button>} />
        <NewPackingPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
      </DocumentLayout>
    );
  }

  const so = doc.data?.salesOrder;
  const pk = doc.data?.picking;
  return (
    <>
      {confirm.node}
      <DocumentLayout
        title="Packing List"
        icon={PackageOpen}
        docNo={doc.data?.docNo}
        status={status}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            <DocAction icon={Save} variant="primary" hidden={!editable} loading={save.isPending} onClick={() => save.mutate()}>Save</DocAction>
            <DocAction icon={PackageCheck} hidden={status !== 'DRAFT' || !can('packing', 'edit')} loading={act.busy === 'pack'} disabled={dirty} onClick={() => act.post('pack', {}, 'Marked as packed')}>Mark Packed</DocAction>
            <DocActionSep />
            <DocAction
              icon={Truck}
              variant="primary"
              hidden={!['DRAFT', 'PACKED'].includes(status) || !can('delivery_note', 'create')}
              loading={act.busy === 'create-delivery'}
              disabled={dirty}
              onClick={() => act.convert('create-delivery', 'delivery-note-form', 'Delivery note created')}
            >
              Create Delivery
            </DocAction>
            <DocActionSep />
            <DocAction
              icon={Ban}
              hidden={!['DRAFT', 'PACKED'].includes(status) || !can('packing', 'cancel')}
              loading={act.busy === 'cancel'}
              onClick={async () => (await confirm.ask('Cancel this packing list?', { danger: true, confirmLabel: 'Cancel packing' })) && act.post('cancel', {}, 'Packing list cancelled')}
            >
              Cancel
            </DocAction>
            <DocAction
              icon={Trash2}
              hidden={status !== 'DRAFT' || !can('packing', 'delete')}
              onClick={async () => {
                if (!(await confirm.ask('Delete this packing list?', { danger: true, confirmLabel: 'Delete' }))) return;
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
        {dirty && editable && <InfoBanner tone="amber">Unsaved changes. Save before marking packed or creating the delivery.</InfoBanner>}
        <HeaderSection title="Packing Information" columns={4}>
          <Field label="Packing Number"><Input value={doc.data?.docNo ?? ''} readOnly /></Field>
          <Field label="Sales Order">
            <button type="button" className="ctl text-left font-semibold text-brand underline" onClick={() => so && openScreen('sales-order-form', { id: so.id }, so.docNo)}>{so?.docNo ?? '-'}</button>
          </Field>
          <Field label="Picking List">
            <button type="button" className="ctl text-left font-semibold text-brand underline" onClick={() => pk && openScreen('picking-form', { id: pk.id }, pk.docNo)}>{pk?.docNo ?? '-'}</button>
          </Field>
          <Field label="Customer"><Input value={doc.data?.customer?.name ?? ''} readOnly /></Field>
          <Field label="Date"><DateInput value={head.docDate} disabled={!editable} onChange={(e) => setHead({ ...head, docDate: e.target.value })} /></Field>
          <Field label="Boxes" hint={`At least ${maxBox} (highest box number used)`}>
            <NumberInput min={maxBox} value={Math.max(head.boxes, maxBox)} disabled={!editable} onChange={(e) => setHead({ ...head, boxes: Number(e.target.value) })} />
          </Field>
          <Field label="Total Weight (kg)" hint={autoWeight ? 'Calculated from lines' : 'Manual'}>
            <NumberInput value={autoWeight ? Math.round(sumWeight * 1000) / 1000 : head.totalWeight} disabled={!editable} onChange={(e) => { setAutoWeight(false); setHead({ ...head, totalWeight: Number(e.target.value) }); }} />
          </Field>
          <Field label="Dimensions (L x W x H)"><Input value={head.dimensions} disabled={!editable} placeholder="e.g. 60x40x40 cm" onChange={(e) => setHead({ ...head, dimensions: e.target.value })} /></Field>
        </HeaderSection>

        <DocSection title="Packed Items" right={editable ? <Button size="sm" icon={Plus} onClick={() => setRows((rs) => [...rs, { key: Math.max(-1, ...rs.map((r) => r.key)) + 1, productId: '', boxNo: maxBox, qty: 1, weight: 0 }])}>Add line</Button> : undefined}>
          <div className="overflow-auto border border-app-border">
            <table className="w-full border-separate border-spacing-0 text-[12px]">
              <thead>
                <tr className="h-7">
                  <th className="grid-th w-8">#</th>
                  <th className="grid-th w-[80px]">Box No</th>
                  <th className="grid-th">Product</th><ProductInfoHeads />
                  <th className="grid-th !text-right w-[90px]">Picked</th>
                  <th className="grid-th !text-right w-[100px]">Qty</th>
                  <th className="grid-th !text-right w-[110px]">Weight (kg)</th>
                  {editable && <th className="grid-th w-10" />}
                </tr>
              </thead>
              <tbody>
                {[...rows].sort((a, b) => a.boxNo - b.boxNo).map((r, n) => (
                  <tr key={r.key} className="h-8 odd:bg-white even:bg-slate-50/60">
                    <td className="grid-td text-center text-slate-400">{n + 1}</td>
                    <td className="grid-td"><NumberInput min={1} value={r.boxNo} disabled={!editable} onChange={(e) => upd(r.key, { boxNo: Math.max(1, Math.round(Number(e.target.value))) })} /></td>
                    <td className="grid-td">
                      <Select value={r.productId} disabled={!editable} options={prodOpts} placeholder="Select product..." onChange={(e) => upd(r.key, { productId: e.target.value ? Number(e.target.value) : '' })} />
                    </td>
                    <ProductInfoCells line={{ product: [...(doc.data?.items ?? []), ...(pick.data?.items ?? [])].find(i => i.productId === Number(r.productId))?.product }} />
                    <td className="grid-td text-right tabular-nums">{r.productId ? fmt.qty(pickedByProduct.get(Number(r.productId)) ?? 0) : ''}</td>
                    <td className="grid-td"><NumberInput min={0} value={r.qty} disabled={!editable} onChange={(e) => upd(r.key, { qty: Number(e.target.value) })} /></td>
                    <td className="grid-td"><NumberInput min={0} value={r.weight} disabled={!editable} onChange={(e) => upd(r.key, { weight: Number(e.target.value) })} /></td>
                    {editable && (
                      <td className="grid-td text-center">
                        <button type="button" className="rounded p-0.5 text-red-500 hover:bg-red-50" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><Trash2 size={13} /></button>
                      </td>
                    )}
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={7 + productInfoCount} className="p-3 text-center text-slate-400">No lines</td></tr>}
              </tbody>
              <tfoot>
                <tr className="h-7">
                  <td colSpan={4 + productInfoCount} className="border-t-2 border-app-border bg-app-head px-2 font-semibold">Total</td>
                  <td className="border-t-2 border-app-border bg-app-head px-2 text-right font-semibold tabular-nums">{fmt.qty(rows.reduce((s, r) => s + num(r.qty), 0))}</td>
                  <td className="border-t-2 border-app-border bg-app-head px-2 text-right font-semibold tabular-nums">{fmt.qty(sumWeight)}</td>
                  {editable && <td className="border-t-2 border-app-border bg-app-head" />}
                </tr>
              </tfoot>
            </table>
          </div>
          {editable && <div className="mt-1 text-[11px] text-slate-500">Packed qty per product cannot exceed the picked qty that is not yet on another packing list.</div>}
        </DocSection>

        <DocSection title="Box Summary">
          <div className="flex flex-wrap gap-2">
            {boxSummary.map(([no, b]) => (
              <div key={no} className="min-w-[130px] border border-app-border bg-white px-3 py-1.5 text-[12px]">
                <div className="font-bold text-brand">Box {no}</div>
                <div>{b.lines} item(s), qty {fmt.qty(b.qty)}</div>
                <div className="text-slate-500">{fmt.qty(b.weight)} kg</div>
              </div>
            ))}
            {!boxSummary.length && <span className="text-[12px] text-slate-400">No boxes</span>}
          </div>
        </DocSection>

        <DocSection title="Notes">
          <Field label="Remarks"><Textarea rows={2} value={head.remarks} disabled={!editable} onChange={(e) => setHead({ ...head, remarks: e.target.value })} /></Field>
          <div className="mt-1 text-[11px] text-slate-500">Status: <StatusBadge status={status} /></div>
        </DocSection>

        <AttachmentsSection docType={TYPE} docId={doc.id} />
        <DocumentFlow docType={TYPE} docId={doc.id} />
        <AuditSection doc={doc.data} />
      </DocumentLayout>
    </>
  );
}

export default [
  { id: 'packing-lists', title: 'Packing Lists', icon: PackageOpen, component: PackingList, permission: 'packing' },
  { id: 'packing-list-form', title: 'Packing List', icon: PackageOpen, component: PackingForm, multiInstance: true, permission: 'packing' },
] satisfies ScreenDef[];
