import { RevisionHistory } from '@/components/doc/RevisionHistory';
import { useEffect, useMemo, useState } from 'react';
import { FormProvider, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Ban, CheckCheck, ClipboardCheck, FolderOpen, ListChecks, Plus, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column, DataTable } from '@/components/DataTable';
import { DocAction, DocActionSep, DocSection, DocumentLayout, HeaderSection, LineItemsGrid, ProductPicker } from '@/components/doc';
import type { ProductLookup } from '@/components/doc';
import { Button, ConfirmDialog, DateInput, Field, IconButton, Input, NumberInput, Select, Textarea } from '@/components/ui';
import { STATUS_OPTIONS, useOptions } from '@/components/inventory/common';
import { useDocument } from '@/hooks/useDocument';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { api, apiError } from '@/lib/api';
import { fmt, today } from '@/lib/format';
import { cn } from '@/lib/cn';
import { toast } from '@/store/toast';

type AdjType = 'OPENING' | 'ADJUSTMENT' | 'COUNT' | 'DAMAGE' | 'SCRAP' | 'WAREHOUSE_RECEIPT';
type Mode = 'ADJUSTMENT' | 'OPENING' | 'COUNT';
const ADJ_TYPES: AdjType[] = ['ADJUSTMENT', 'DAMAGE', 'SCRAP', 'WAREHOUSE_RECEIPT'];

const formOf = (t: string) => (t === 'OPENING' ? 'opening-stock-form' : t === 'COUNT' ? 'stock-count-form' : 'stock-adjustment-form');

/* ------------------------------------ LISTS ------------------------------------ */
interface ARow {
  id: number; adjNo: string; adjType: AdjType; txDate: string; status: string; reason?: string | null;
  warehouse?: { name: string } | null; itemCount: number; totalQtyChange: number; totalValue: number;
}

function AdjustmentList({ mode, tableKey, title, newLabel }: { mode: Mode; tableKey: string; title: string; newLabel: string }) {
  const open = useOpenScreen();
  const can = usePermission();
  const warehouses = useOptions('/warehouses');
  const [adjType, setType] = useState('');
  const [status, setStatus] = useState('');
  const [warehouseId, setWh] = useState('');
  const fixed = mode === 'OPENING' ? 'OPENING' : mode === 'COUNT' ? 'COUNT' : '';
  const columns: Column<ARow>[] = [
    { key: 'adjNo', header: 'Doc No', width: 130 },
    { key: 'txDate', header: 'Date', type: 'date', width: 100, filter: 'date' },
    { key: 'adjType', header: 'Type', width: 140, cell: (r) => fmt.status(r.adjType) },
    { key: 'warehouse.name', header: 'Warehouse', sortable: false },
    { key: 'itemCount', header: 'Lines', type: 'number', width: 60, sortable: false },
    { key: 'totalQtyChange', header: 'Qty Change', type: 'qty', width: 90, sortable: false },
    { key: 'totalValue', header: 'Value', type: 'money', width: 100, sortable: false, total: 'sum' },
    { key: 'reason', header: 'Reason', sortable: false },
    { key: 'status', header: 'Status', type: 'status', width: 100 },
  ];
  const openRow = (r: ARow) => open(formOf(r.adjType), { id: r.id }, r.adjNo);
  return (
    <DataTable<ARow>
      tableKey={tableKey}
      url="/stock-adjustments"
      columns={mode === 'ADJUSTMENT' ? columns : columns.filter((c) => c.key !== 'adjType')}
      exportName={title}
      filters={{ adjType: fixed || adjType, status, warehouseId }}
      defaultSort={{ key: 'id', dir: 'desc' }}
      onRowDoubleClick={openRow}
      rowActions={[{ label: 'Open', onClick: openRow }]}
      toolbarExtras={
        <>
          {can('stock_adjustment', 'create') && (
            <Button variant="primary" icon={Plus} onClick={() => open(formOf(fixed || 'ADJUSTMENT'), {}, newLabel)}>{newLabel}</Button>
          )}
          {mode === 'ADJUSTMENT' && <Select className="w-40" options={STATUS_OPTIONS(['ADJUSTMENT', 'DAMAGE', 'SCRAP', 'WAREHOUSE_RECEIPT', 'OPENING', 'COUNT'])} placeholder="All types" value={adjType} onChange={(e) => setType(e.target.value)} />}
          <Select className="w-32" options={STATUS_OPTIONS(['DRAFT', 'POSTED', 'CANCELLED'])} placeholder="All statuses" value={status} onChange={(e) => setStatus(e.target.value)} />
          <Select className="w-40" options={warehouses.options} placeholder="Any warehouse" value={warehouseId} onChange={(e) => setWh(e.target.value)} />
        </>
      }
    />
  );
}
const AdjustmentsScreen = () => <AdjustmentList mode="ADJUSTMENT" tableKey="stock-adjustments" title="Stock Adjustments" newLabel="New Adjustment" />;
const OpeningStockScreen = () => <AdjustmentList mode="OPENING" tableKey="opening-stock" title="Opening Stock" newLabel="New Opening Stock" />;
const StockCountsScreen = () => <AdjustmentList mode="COUNT" tableKey="stock-counts" title="Stock Counts" newLabel="New Stock Count" />;

/* ------------------------------------ FORM ------------------------------------ */
interface AItem {
  id?: number; productId: number; systemQty: number; countedQty: number; qtyChange: number; unitCost: number; value: number;
  product?: { code: string; name: string; oemNumber?: string | null; rack?: string | null; shelf?: string | null; bin?: string | null };
}
interface ADoc extends Record<string, unknown> {
  id: number; adjNo: string; adjType: AdjType; txDate: string; status: string; warehouseId: number; reason?: string | null; remarks?: string | null; items: AItem[];
  journal?: { id: number; entryNo?: string; docNo?: string } | null;
}
interface FItem {
  productId?: number; productCode?: string; oemNumber?: string; description?: string; location?: string; product?: unknown;
  systemQty?: number | null; countedQty?: string; qtyChange?: number; unitCost?: number; available?: number;
}
interface AForm { adjType: AdjType; txDate: string; warehouseId: string; reason: string; remarks: string; items: FItem[] }

const loc = (p?: AItem['product']) => [p?.rack, p?.shelf, p?.bin].filter(Boolean).join('/');

function AdjustmentForm({ params, tabId, mode }: ScreenProps & { mode: Mode }) {
  const ws = useWorkspace();
  const can = usePermission();
  const doc = useDocument<ADoc>('/stock-adjustments', params.id, { tabId, titleOf: (d) => d.adjNo });
  const warehouses = useOptions('/warehouses');
  const brands = useOptions('/brands');
  const cats = useOptions('/categories');
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | 'post' | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState({ brandId: '', categoryId: '', search: '', includeZero: false });

  const initialType: AdjType = mode === 'OPENING' ? 'OPENING' : mode === 'COUNT' ? 'COUNT' : 'ADJUSTMENT';
  const values = useMemo<AForm | undefined>(() => {
    const d = doc.data;
    if (!d) return undefined;
    const neg = d.adjType === 'DAMAGE' || d.adjType === 'SCRAP';
    return {
      adjType: d.adjType, txDate: String(d.txDate).slice(0, 10), warehouseId: String(d.warehouseId), reason: d.reason ?? '', remarks: d.remarks ?? '',
      items: d.items.map((i) => ({
        productId: i.productId, productCode: i.product?.code, description: i.product?.name, oemNumber: i.product?.oemNumber ?? '', location: loc(i.product), product: i.product,
        systemQty: i.systemQty, countedQty: d.adjType === 'COUNT' ? String(i.countedQty) : '', qtyChange: neg ? Math.abs(i.qtyChange) : i.qtyChange, unitCost: i.unitCost,
      })),
    };
  }, [doc.data]);
  const form = useForm<AForm>({ values, defaultValues: { adjType: initialType, txDate: today(), warehouseId: '', reason: '', remarks: '', items: [] } });
  const { register, control, handleSubmit, formState, setValue, getValues } = form;
  const adjType = (useWatch({ control, name: 'adjType' }) ?? initialType) as AdjType;
  const warehouseId = useWatch({ control, name: 'warehouseId' });
  const items = (useWatch({ control, name: 'items' }) ?? []) as FItem[];
  const arr = useFieldArray({ control, name: 'items' });
  useEffect(() => ws.setDirty(tabId, formState.isDirty), [formState.isDirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCount = adjType === 'COUNT';
  const status = doc.data?.status;
  const editable = doc.isNew || status === 'DRAFT';
  const titleOf = isCount ? 'Stock Count' : adjType === 'OPENING' ? 'Opening Stock' : 'Stock Adjustment';

  const sign = adjType === 'DAMAGE' || adjType === 'SCRAP' ? -1 : 1;
  const valueOf = (i: FItem) => (isCount ? (Number(i.countedQty) - Number(i.systemQty ?? 0)) * Number(i.unitCost ?? 0) : sign * Number(i.qtyChange ?? 0) * Number(i.unitCost ?? 0));
  const countedLines = items.filter((i) => i.countedQty !== '' && i.countedQty !== undefined);
  const totalValue = items.reduce((s, i) => s + (isCount && (i.countedQty === '' || i.countedQty === undefined) ? 0 : valueOf(i)), 0);

  const buildBody = (v: AForm) => {
    const base = { adjType: v.adjType, txDate: v.txDate, warehouseId: Number(v.warehouseId), reason: v.reason || null, remarks: v.remarks || null };
    if (v.adjType === 'COUNT') {
      return {
        ...base,
        items: v.items
          .filter((i) => i.productId && i.countedQty !== '' && i.countedQty !== undefined)
          .map((i) => ({ productId: Number(i.productId), countedQty: Number(i.countedQty), ...(i.systemQty !== null && i.systemQty !== undefined ? { systemQty: Number(i.systemQty) } : {}), unitCost: Number(i.unitCost ?? 0) || undefined })),
      };
    }
    return {
      ...base,
      items: v.items.filter((i) => i.productId && Number(i.qtyChange)).map((i) => ({ productId: Number(i.productId), qtyChange: Number(i.qtyChange), unitCost: Number(i.unitCost ?? 0) || undefined })),
    };
  };
  const validate = (v: AForm): string | null => {
    if (!v.warehouseId) return 'Select a warehouse';
    const b = buildBody(v);
    if (!b.items.length) return isCount ? 'Enter counted quantities for at least one line' : 'Add at least one line with a quantity';
    return null;
  };

  const save = handleSubmit(async (v) => {
    const e = validate(v);
    if (e) return toast.warning(e);
    try {
      await doc.save(buildBody(v));
    } catch {
      /* toast shown */
    }
  });
  const saveAndPost = handleSubmit(async (v) => {
    const e = validate(v);
    if (e) return toast.warning(e);
    setBusy(true);
    try {
      const saved = (await doc.save(buildBody(v))) as ADoc;
      await api.post(`/stock-adjustments/${saved.id}/post`, {});
      toast.success('Posted');
      doc.invalidate();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  });
  const run = async (action: string) => {
    try {
      await doc.transition(action);
    } catch (e) {
      toast.error(apiError(e));
    }
  };
  const del = async () => {
    try {
      await doc.remove();
      ws.close(tabId);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const loadSheet = async () => {
    if (!warehouseId) return toast.warning('Select a warehouse first');
    try {
      const r = (await api.get<{ items: (Omit<AItem, 'countedQty'> & { countedQty: number | null })[] }>('/stock-adjustments/count-sheet', {
        params: { warehouseId, brandId: sheet.brandId || undefined, categoryId: sheet.categoryId || undefined, search: sheet.search || undefined, includeZero: sheet.includeZero ? '1' : undefined },
      })).data;
      setValue(
        'items',
        r.items.map((i) => ({ productId: i.productId, productCode: i.product?.code, description: i.product?.name, oemNumber: i.product?.oemNumber ?? '', location: loc(i.product), product: i.product, systemQty: i.systemQty, countedQty: '', unitCost: i.unitCost })),
        { shouldDirty: true },
      );
      toast.info(`${r.items.length} products loaded`);
    } catch (e) {
      toast.error(apiError(e));
    }
  };
  const fillAll = () => items.forEach((_, i) => setValue(`items.${i}.countedQty`, String(items[i].systemQty ?? 0), { shouldDirty: true }));
  const addCountProduct = (p: ProductLookup) => {
    if (items.some((i) => i.productId === p.id)) return toast.warning('Product already in the sheet');
    arr.append({ productId: p.id, productCode: p.code, description: p.name, oemNumber: p.oemNumber ?? '', location: '', systemQty: null, countedQty: '', unitCost: p.averageCost || p.costPrice || 0 });
  };

  const pickLine = (p: ProductLookup, i: number) => {
    const set = (k: string, v: unknown) => setValue(`items.${i}.${k}` as `items.${number}.qtyChange`, v as never, { shouldDirty: true });
    set('productId', p.id);
    set('productCode', p.code);
    set('oemNumber', p.oemNumber ?? '');
    set('description', p.name);
    set('product', { code: p.code, name: p.name, oemNumber: p.oemNumber });
    set('available', p.onHand ?? 0);
    set('unitCost', p.averageCost || p.costPrice || 0);
  };

  const typeOptions = mode === 'ADJUSTMENT' ? STATUS_OPTIONS(ADJ_TYPES.includes(adjType) ? ADJ_TYPES : [...ADJ_TYPES, adjType]) : STATUS_OPTIONS([initialType]);
  const th = 'grid-th px-2 whitespace-nowrap';
  const tdn = 'grid-td px-2 text-right tabular-nums';

  return (
    <FormProvider {...form}>
      <DocumentLayout
        title={titleOf}
        icon={isCount ? ClipboardCheck : adjType === 'OPENING' ? FolderOpen : SlidersHorizontal}
        docNo={doc.data?.adjNo}
        status={status}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            <DocAction icon={Save} variant="primary" hidden={!editable || !can('stock_adjustment', doc.isNew ? 'create' : 'edit')} loading={doc.saving} onClick={save}>Save Draft</DocAction>
            <DocAction icon={CheckCheck} hidden={!editable || !can('stock_adjustment', 'post')} loading={busy} onClick={doc.isNew ? saveAndPost : () => setConfirm('post')}>{doc.isNew ? 'Save & Post' : 'Post'}</DocAction>
            <DocActionSep />
            <DocAction icon={Ban} hidden={status !== 'DRAFT' || !can('stock_adjustment', 'cancel')} onClick={() => setConfirm('cancel')}>Cancel</DocAction>
            <DocAction icon={Trash2} variant="danger" hidden={status !== 'DRAFT' || !can('stock_adjustment', 'delete')} onClick={() => setConfirm('delete')}>Delete</DocAction>
          </>
        }
      >
        <HeaderSection title={`${titleOf} Information`}>
          <Field label="Document No"><Input readOnly value={doc.data?.adjNo ?? '(auto)'} /></Field>
          <Field label="Type"><Select options={typeOptions} disabled={!doc.isNew || mode !== 'ADJUSTMENT'} {...register('adjType')} /></Field>
          <Field label="Date" required><DateInput disabled={!editable} {...register('txDate')} /></Field>
          <Field label="Warehouse" required><Select options={warehouses.options} placeholder="Select..." disabled={!editable || (isCount && items.length > 0 && !doc.isNew)} {...register('warehouseId')} /></Field>
          <Field label="Reason" className="col-span-2"><Input readOnly={!editable} {...register('reason')} /></Field>
          <Field label="Remarks" className="col-span-2"><Textarea rows={1} readOnly={!editable} {...register('remarks')} /></Field>
        </HeaderSection>

        {isCount ? (
          <DocSection
            title="Count Sheet"
            right={<span className="text-xs text-ink-muted">{countedLines.length}/{items.length} counted · variance value <b className={cn(totalValue < 0 && 'text-danger')}>{fmt.money(totalValue)}</b></span>}
          >
            {editable && (
              <div className="mb-2 flex flex-wrap items-end gap-2">
                <Field label="Brand"><Select className="w-32" options={brands.options} placeholder="All" value={sheet.brandId} onChange={(e) => setSheet((s) => ({ ...s, brandId: e.target.value }))} /></Field>
                <Field label="Category"><Select className="w-36" options={cats.options} placeholder="All" value={sheet.categoryId} onChange={(e) => setSheet((s) => ({ ...s, categoryId: e.target.value }))} /></Field>
                <Field label="Search"><Input className="w-36" value={sheet.search} onChange={(e) => setSheet((s) => ({ ...s, search: e.target.value }))} /></Field>
                <label className="mb-1 flex items-center gap-1 text-[13px]"><input type="checkbox" checked={sheet.includeZero} onChange={(e) => setSheet((s) => ({ ...s, includeZero: e.target.checked }))} /> Include zero stock</label>
                <Button icon={ListChecks} onClick={loadSheet}>Load Count Sheet</Button>
                <Button onClick={fillAll} disabled={!items.length}>Fill counted = system</Button>
                <Field label="Add product"><div className="w-56 border border-line bg-surface rounded-lg"><ProductPicker onPick={addCountProduct} /></div></Field>
              </div>
            )}
            <div className="max-h-[480px] overflow-auto border border-line">
              <table className="w-full border-collapse text-[13px]">
                <thead className="sticky top-0 bg-surface-2">
                  <tr><th className={`${th} text-left`}>Code</th><th className={`${th} text-left`}>OEM</th><th className={`${th} text-left`}>Description</th><th className={`${th} text-left`}>Location</th><th className={`${th} text-right`}>System Qty</th><th className={`${th} w-28 text-right`}>Counted Qty</th><th className={`${th} text-right`}>Variance</th><th className={`${th} text-right`}>Unit Cost</th><th className={`${th} text-right`}>Variance Value</th><th className="grid-th w-8" /></tr>
                </thead>
                <tbody>
                  {arr.fields.length === 0 && <tr><td colSpan={10} className="p-6 text-center text-ink-faint">Select a warehouse and click &quot;Load Count Sheet&quot;</td></tr>}
                  {arr.fields.map((f, i) => {
                    const it = items[i] ?? {};
                    const counted = it.countedQty !== '' && it.countedQty !== undefined;
                    const variance = counted ? Number(it.countedQty) - Number(it.systemQty ?? 0) : null;
                    return (
                      <tr key={f.id} className={cn('h-9 hover:bg-brand-soft', variance !== null && variance !== 0 && 'bg-warning-soft')}>
                        <td className="grid-td px-2 font-medium">{it.productCode}</td>
                        <td className="grid-td px-2">{it.oemNumber}</td>
                        <td className="grid-td px-2">{it.description}</td>
                        <td className="grid-td px-2">{it.location}</td>
                        <td className={tdn}>{it.systemQty === null || it.systemQty === undefined ? '-' : fmt.qty(it.systemQty)}</td>
                        <td className="grid-td p-0"><NumberInput className="!h-8" min={0} readOnly={!editable} {...register(`items.${i}.countedQty`)} /></td>
                        <td className={cn(tdn, variance !== null && variance < 0 && 'text-danger', variance !== null && variance > 0 && 'text-success')}>{variance === null ? '' : (variance > 0 ? '+' : '') + fmt.qty(variance)}</td>
                        <td className={tdn}>{fmt.money(it.unitCost)}</td>
                        <td className={tdn}>{variance === null ? '' : fmt.money(variance * Number(it.unitCost ?? 0))}</td>
                        <td className="grid-td text-center">{editable && <IconButton icon={Trash2} label="Remove" variant="danger" onClick={() => arr.remove(i)} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-1 text-xs text-ink-faint">Only lines with a counted quantity are saved; lines left blank are ignored.</div>
          </DocSection>
        ) : (
          <DocSection title="Items" right={<span className="text-xs text-ink-muted">Total value <b>{fmt.money(totalValue)}</b></span>}>
            <LineItemsGrid
              readOnly={!editable}
              warehouseId={warehouseId || undefined}
              onProductPick={(p, i) => pickLine(p, i)}
              columns={[
                { key: 'productId', header: 'Product', type: 'product', width: 130, required: true },
                { key: 'oemNumber', header: 'OEM', type: 'readonly', width: 120 },
                { key: 'description', header: 'Description', type: 'readonly' },
                { key: 'available', header: 'Current Stock', type: 'readonly', format: 'qty', width: 100 },
                {
                  key: 'qtyChange',
                  header: adjType === 'ADJUSTMENT' ? 'Qty (+/-)' : adjType === 'DAMAGE' || adjType === 'SCRAP' ? 'Qty to remove' : 'Qty',
                  type: 'qty', width: 100, total: true,
                },
                { key: 'unitCost', header: 'Unit Cost', type: 'money', width: 100 },
                { key: 'value', header: 'Value', type: 'computed', format: 'money', width: 110, total: true, compute: (l) => sign * Number(l.qtyChange ?? 0) * Number(l.unitCost ?? 0) },
              ]}
              newLine={() => ({ qtyChange: 1, unitCost: 0 })}
            />
            <div className="mt-1 text-xs text-ink-faint">
              {adjType === 'ADJUSTMENT' && 'Positive quantities add stock, negative quantities remove it. Leave unit cost 0 to use the current average cost.'}
              {(adjType === 'DAMAGE' || adjType === 'SCRAP') && 'Enter the quantity damaged / scrapped; it is deducted from stock at average cost.'}
              {adjType === 'OPENING' && 'Opening quantities must be positive; the value is booked against opening equity.'}
              {adjType === 'WAREHOUSE_RECEIPT' && 'Quantities must be positive. Leave unit cost 0 to use the current average cost.'}
            </div>
          </DocSection>
        )}
        {doc.data?.journal && <div className="text-xs text-ink-muted">Journal posted: {doc.data.journal.entryNo ?? doc.data.journal.docNo ?? doc.data.journal.id}</div>}
      <RevisionHistory entity="StockAdjustment" id={doc.id} />
      </DocumentLayout>

      <ConfirmDialog open={confirm === 'post'} title="Post document" message="Posting updates stock and creates the accounting entry. A posted document cannot be edited." confirmLabel="Post" onConfirm={() => { setConfirm(null); run('post'); }} onCancel={() => setConfirm(null)} />
      <ConfirmDialog open={confirm === 'cancel'} danger title="Cancel document" message="Cancel this draft?" confirmLabel="Cancel Document" onConfirm={() => { setConfirm(null); run('cancel'); }} onCancel={() => setConfirm(null)} />
      <ConfirmDialog open={confirm === 'delete'} danger title="Delete draft" message="Delete this draft permanently?" confirmLabel="Delete" onConfirm={() => { setConfirm(null); del(); }} onCancel={() => setConfirm(null)} />
      <span className="hidden">{getValues('adjType')}</span>
    </FormProvider>
  );
}

const AdjForm = (p: ScreenProps) => <AdjustmentForm {...p} mode="ADJUSTMENT" />;
const OpeningForm = (p: ScreenProps) => <AdjustmentForm {...p} mode="OPENING" />;
const CountForm = (p: ScreenProps) => <AdjustmentForm {...p} mode="COUNT" />;

export default [
  { id: 'stock-adjustments', title: 'Stock Adjustments', icon: SlidersHorizontal, component: AdjustmentsScreen, permission: 'stock_adjustment' },
  { id: 'stock-adjustment-form', title: 'Stock Adjustment', icon: SlidersHorizontal, component: AdjForm, multiInstance: true, permission: 'stock_adjustment' },
  { id: 'opening-stock', title: 'Opening Stock', icon: FolderOpen, component: OpeningStockScreen, permission: 'stock_adjustment' },
  { id: 'opening-stock-form', title: 'Opening Stock', icon: FolderOpen, component: OpeningForm, multiInstance: true, permission: 'stock_adjustment' },
  { id: 'stock-counts', title: 'Stock Counts', icon: ClipboardCheck, component: StockCountsScreen, permission: 'stock_adjustment' },
  { id: 'stock-count-form', title: 'Stock Count', icon: ClipboardCheck, component: CountForm, multiInstance: true, permission: 'stock_adjustment' },
] satisfies ScreenDef[];
