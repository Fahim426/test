/* eslint-disable @typescript-eslint/no-explicit-any */
/** Landed Cost: list + form with charge rows, allocation method and live allocation preview (old -> new unit cost). */
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { Anchor, Plus, RefreshCw, Send, Trash2, XCircle } from 'lucide-react';
import { Controller, useFieldArray } from 'react-hook-form';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column } from '@/components/DataTable';
import { DocSection, DocumentLayout, HeaderSection, NotesSection } from '@/components/doc';
import { Button } from '@/components/ui';
import { useOpenScreen } from '@/store/workspace';
import { api, apiError } from '@/lib/api';
import { num } from '@/lib/calc';
import { cn } from '@/lib/cn';
import { fmt, r2, today } from '@/lib/format';
import {
  AnyDoc, DocFooter, FDate, FormProvider, FSelect, idOrNull, isoOf, PurchaseList, ReadField, ServerError, StdActions, strOrNull, TransitionDef, useDocForm, useFormContext, useLookups,
  useRows, useWatch,
} from '@/components/purchase/kit';

const CHARGES = ['FREIGHT', 'INSURANCE', 'CUSTOMS_DUTY', 'PORT_CHARGES', 'CLEARING', 'TRANSPORT', 'HANDLING', 'OTHER'];
const CHARGE_OPTIONS = CHARGES.map((c) => ({ value: c, label: c === 'CUSTOMS_DUTY' ? 'Customs Duty' : c === 'PORT_CHARGES' ? 'Port Charges' : c === 'CLEARING' ? 'Clearing Charges' : fmt.status(c) }));
const METHODS = [
  { value: 'QUANTITY', label: 'By Quantity' },
  { value: 'VALUE', label: 'By Value' },
  { value: 'WEIGHT', label: 'By Weight' },
  { value: 'VOLUME', label: 'By Volume' },
];

interface LcRow { id: number; docNo: string; docDate: string; receipt?: { id: number; docNo: string; supplier?: { name: string } } | null; allocationMethod: string; productCost: number; totalAdditional: number; actualLandedCost: number; status: string }

function LandedCostsScreen() {
  const cols: Column<LcRow>[] = [
    { key: 'docNo', header: 'Landed Cost No', width: 140, filter: 'text' },
    { key: 'docDate', header: 'Date', type: 'date', width: 100 },
    { key: 'receipt.docNo', header: 'Import GRN', width: 130, sortable: false },
    { key: 'receipt.supplier.name', header: 'Supplier', sortable: false },
    { key: 'allocationMethod', header: 'Allocation', width: 100, accessor: (r) => fmt.status(r.allocationMethod) },
    { key: 'productCost', header: 'Product Cost', type: 'money', total: 'sum' },
    { key: 'totalAdditional', header: 'Additional Costs', type: 'money', total: 'sum' },
    { key: 'actualLandedCost', header: 'Actual Landed Cost', type: 'money', total: 'sum' },
    { key: 'status', header: 'Status', type: 'status', width: 100 },
  ];
  return (
    <PurchaseList<LcRow> tableKey="landed-costs" url="/landed-costs" title="Landed Cost" formScreen="landed-cost-form" module="landed_cost" columns={cols} statuses={['DRAFT', 'POSTED', 'CANCELLED']} newLabel="New Landed Cost"
      selects={[{ key: 'allocationMethod', label: 'All methods', options: METHODS }]} />
  );
}

/* ------------------------------------------------------------------ charges grid */
function ChargesGrid({ editable, suppliers }: { editable: boolean; suppliers: { value: number; label: string }[] }) {
  const { control, register, formState } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name: 'charges' });
  const charges = (useWatch({ control, name: 'charges' }) as any[] | undefined) ?? [];
  const total = r2(charges.reduce((s, c) => s + num(c.amount), 0));
  return (
    <DocSection title="Additional charges (base currency)" right={editable ? <Button size="sm" icon={Plus} onClick={() => append({ chargeType: 'FREIGHT', description: '', amount: 0, supplierId: '' })}>Add charge</Button> : undefined} bodyClassName="p-0">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="h-9"><th className="grid-th w-8 text-center">#</th><th className="grid-th w-[180px]">Charge Type</th><th className="grid-th">Description</th><th className="grid-th !text-right w-[140px]">Amount</th><th className="grid-th w-[260px]">Billed by supplier (AP) - blank = accrual</th>{editable && <th className="grid-th w-8" />}</tr>
        </thead>
        <tbody>
          {fields.map((f, i) => {
            const c = charges[i] ?? {};
            return (
              <tr key={f.id} className="h-9 odd:bg-surface even:bg-surface-2">
                <td className="grid-td text-center text-ink-faint">{i + 1}</td>
                <td className="grid-td !p-0">
                  {editable ? <select className="ctl !h-8 !rounded-none" {...register(`charges.${i}.chargeType`)}>{CHARGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <span className="px-2">{CHARGE_OPTIONS.find((o) => o.value === c.chargeType)?.label}</span>}
                </td>
                <td className="grid-td !p-0">{editable ? <input className="ctl !h-8 !rounded-none" {...register(`charges.${i}.description`)} /> : <span className="px-2">{c.description}</span>}</td>
                <td className="grid-td !p-0 text-right">
                  {editable ? <input type="number" step="any" min={0} className="ctl !h-8 !rounded-none text-right tabular-nums" {...register(`charges.${i}.amount`, { setValueAs: (v) => (v === '' || v == null ? 0 : Number(v)) })} onFocus={(e) => e.target.select()} /> : <span className="px-2 tabular-nums">{fmt.money(c.amount)}</span>}
                </td>
                <td className="grid-td !p-0">
                  {editable ? (
                    <Controller name={`charges.${i}.supplierId`} control={control} render={({ field }) => (
                      <select className="ctl !h-8 !rounded-none" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)}><option value="">(accrual - GRNI)</option>{suppliers.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
                    )} />
                  ) : <span className="px-2">{c.supplier?.name ?? '(accrual)'}</span>}
                </td>
                {editable && <td className="grid-td !px-1 text-center"><button type="button" className="rounded-lg p-0.5 text-danger hover:bg-danger-soft" title="Remove" onClick={() => remove(i)}><Trash2 size={12} /></button></td>}
              </tr>
            );
          })}
          {fields.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-ink-faint">No charges. {editable && 'Add freight, insurance, customs duty, port, clearing, transport, handling or other charges.'}</td></tr>}
        </tbody>
        <tfoot>
          <tr className="h-9 bg-surface-2 font-semibold"><td colSpan={3} className="border-t-2 border-line bg-surface-2 px-3">Total additional cost</td><td className="border-t-2 border-line bg-surface-2 px-3 text-right tabular-nums">{fmt.money(total)}</td><td colSpan={2} className="border-t-2 border-line bg-surface-2" /></tr>
        </tfoot>
      </table>
      {(formState.errors.charges as any)?.message && <div className="p-1 text-xs text-danger">{(formState.errors.charges as any).message}</div>}
    </DocSection>
  );
}

/* ------------------------------------------------------------------ form */
const schema = z.object({
  receiptId: z.coerce.number({ invalid_type_error: 'Select the import goods receipt' }).int().positive('Select the import goods receipt'),
  docDate: z.string().min(1, 'Date required'),
  allocationMethod: z.string().min(1),
  charges: z.array(z.object({ amount: z.number().positive('Charge amounts must be > 0') }).passthrough()).min(1, 'Add at least one charge'),
}).passthrough();

function LandedCostForm({ params, tabId }: ScreenProps) {
  const open = useOpenScreen();
  const lk = useLookups();
  const grns = useRows<any>('/goods-receipts', { grnType: 'IMPORT', status: 'POSTED' });
  const ctl = useDocForm({
    url: '/landed-costs', params, tabId, schema,
    defaults: { docDate: today(), receiptId: params.receiptId ? Number(params.receiptId) : '', allocationMethod: 'VALUE', remarks: '', charges: [{ chargeType: 'FREIGHT', description: '', amount: 0, supplierId: '' }] },
    toForm: (d) => ({
      ...d, docDate: isoOf(d.docDate), remarks: d.remarks ?? '',
      charges: (d.charges ?? []).map((c: any) => ({ ...c, description: c.description ?? '', amount: num(c.amount), supplierId: c.supplierId ?? '' })),
    }),
  });
  const { doc, form, status, editable } = ctl;
  const lc = doc.data as AnyDoc | undefined;
  const receiptId = useWatch({ control: form.control, name: 'receiptId' }) as string | number;
  const method = useWatch({ control: form.control, name: 'allocationMethod' }) as string;
  const charges = (useWatch({ control: form.control, name: 'charges' }) as any[] | undefined) ?? [];

  // debounced preview request (draft documents only)
  const previewBody = {
    receiptId: Number(receiptId) || 0, allocationMethod: method,
    charges: charges.filter((c) => num(c.amount) > 0).map((c) => ({ chargeType: c.chargeType, description: strOrNull(c.description), amount: num(c.amount), supplierId: idOrNull(c.supplierId) })),
  };
  const key = JSON.stringify(previewBody);
  const [dKey, setDKey] = useState(key);
  useEffect(() => {
    const t = setTimeout(() => setDKey(key), 500);
    return () => clearTimeout(t);
  }, [key]);
  const ready = editable && previewBody.receiptId > 0 && previewBody.charges.length > 0;
  const preview = useQuery({
    queryKey: ['landed-preview', dKey],
    enabled: ready && dKey === key,
    retry: false,
    queryFn: async () => (await api.post<any>('/landed-costs/preview', JSON.parse(dKey))).data,
  });

  const onSave = ctl.save((v) => ({
    ...(doc.isNew ? { receiptId: Number(v.receiptId) } : {}),
    docDate: v.docDate, allocationMethod: v.allocationMethod, remarks: strOrNull(v.remarks),
    charges: (v.charges as any[]).map((c) => ({ chargeType: c.chargeType, description: strOrNull(c.description), amount: c.amount, supplierId: idOrNull(c.supplierId) })),
  }));
  const transitions: TransitionDef[] = [
    { action: 'post', label: 'Post Landed Cost', icon: Send, from: ['DRAFT'], perm: 'post', variant: 'primary', saveFirst: true, ask: { title: 'Post landed cost', message: 'Post this landed cost? Inventory value and unit costs of the received products will be updated.', confirmLabel: 'Post' } },
    { action: 'cancel', label: 'Cancel', icon: XCircle, from: ['DRAFT', 'POSTED'], perm: 'cancel', variant: 'danger', ask: { title: 'Cancel landed cost', danger: true, message: 'Cancel this landed cost? Posted costs are reversed (inventory revalued back).' } },
  ];

  const g = grns.data?.find((x) => String(x.id) === String(receiptId));
  const receipt = lc?.receipt ?? g;
  const pv = editable ? preview.data : undefined;
  const saved = !editable || !pv ? (lc?.allocations as any[] | undefined) : undefined;
  const lines: any[] = pv?.lines ?? saved ?? [];
  const productCost = pv?.productCost ?? lc?.productCost;
  const totalAdditional = pv?.totalAdditional ?? lc?.totalAdditional ?? r2(charges.reduce((s, c) => s + num(c.amount), 0));
  const actual = pv?.actualLandedCost ?? lc?.actualLandedCost;
  const byType: Record<string, number> = pv?.chargesByType ?? {};
  if (!pv && !lc) for (const c of charges) byType[c.chargeType] = r2((byType[c.chargeType] ?? 0) + num(c.amount));

  return (
    <FormProvider {...form}>
      <DocumentLayout
        title="Landed Cost" icon={Anchor} docNo={lc?.docNo} status={status ?? (doc.isNew ? 'DRAFT' : undefined)} loading={doc.isLoading} error={doc.error}
        actions={<StdActions ctl={ctl} module="landed_cost" transitions={transitions} onSave={onSave} extra={<Button icon={RefreshCw} disabled={!ready} loading={preview.isFetching} onClick={() => preview.refetch()}>Preview Allocation</Button>} />}
      >
        <ServerError message={ctl.err} />
        <HeaderSection title="Landed Cost Information">
          <ReadField label="Landed Cost No" value={lc?.docNo ?? '(auto)'} />
          <FDate name="docDate" label="Date" required disabled={!editable} />
          {doc.isNew ? (
            <FSelect name="receiptId" label="Import Goods Receipt" required placeholder="Select posted import GRN..." options={(grns.data ?? []).map((x: any) => ({ value: x.id, label: `${x.docNo} - ${x.supplier?.name ?? ''} (${fmt.money(x.totalValue)})` }))} />
          ) : (
            <ReadField label="Import Goods Receipt" value={lc?.receipt ? <button className="text-brand hover:underline" onClick={() => open('goods-receipt-form', { id: lc.receipt.id }, lc.receipt.docNo)}>{lc.receipt.docNo}</button> : ''} />
          )}
          <FSelect name="allocationMethod" label="Allocation Method" required options={METHODS} placeholder="Select..." disabled={!editable} />
          <ReadField label="Supplier" value={receipt?.supplier?.name ?? ''} />
          <ReadField label="Warehouse" value={receipt?.warehouse?.name ?? ''} />
          <ReadField label="Product Cost" value={fmt.money(productCost)} />
          <ReadField label="Actual Landed Cost" value={<b>{fmt.money(actual)}</b>} />
        </HeaderSection>

        <ChargesGrid editable={editable} suppliers={lk.supplierOptions} />

        <DocSection title={editable ? 'Allocation Preview' : 'Allocation'} right={preview.isFetching ? <span className="text-xs text-ink-muted">calculating...</span> : undefined} bodyClassName="p-0">
          {preview.isError && editable && <div className="m-2 rounded-lg border border-danger bg-danger-soft px-3 py-1.5 text-[13px] text-danger">{apiError(preview.error)}</div>}
          {!ready && editable && <div className="p-4 text-center text-[13px] text-ink-muted">Select an import goods receipt and enter charges to preview the allocation.</div>}
          {lines.length > 0 && (
            <>
              <div className="flex flex-wrap gap-6 border-b border-line bg-surface-2 px-3 py-1.5 text-[13px]">
                <span>Product cost: <b className="tabular-nums">{fmt.money(productCost)}</b></span>
                <span>Additional costs: <b className="tabular-nums">{fmt.money(totalAdditional)}</b></span>
                <span>Actual landed cost: <b className="tabular-nums text-brand">{fmt.money(actual)}</b></span>
                <span className="text-ink-muted">{Object.entries(byType).map(([k, v]) => `${fmt.status(k)} ${fmt.money(v)}`).join(' · ')}</span>
              </div>
              <div className="overflow-auto">
                <table className="w-full border-separate border-spacing-0 text-[13px]">
                  <thead><tr className="h-9"><th className="grid-th w-8 text-center">#</th><th className="grid-th">Product</th><th className="grid-th !text-right">Qty</th><th className="grid-th !text-right">Product Cost</th><th className="grid-th !text-right">Allocated Cost</th><th className="grid-th !text-right">Old Unit Cost</th><th className="grid-th !text-right bg-brand-soft">New Unit Cost</th><th className="grid-th !text-right">Increase</th></tr></thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const inc = num(l.oldUnitCost) ? ((num(l.newUnitCost) - num(l.oldUnitCost)) / num(l.oldUnitCost)) * 100 : 0;
                      return (
                        <tr key={l.receiptItemId ?? i} className="h-9 odd:bg-surface even:bg-surface-2">
                          <td className="grid-td text-center text-ink-faint">{i + 1}</td><td className="grid-td">{l.product?.code} <span className="text-ink-muted">{l.product?.name}</span></td>
                          <td className="grid-td text-right tabular-nums">{fmt.qty(l.qty)}</td><td className="grid-td text-right tabular-nums">{fmt.money(l.baseCost)}</td><td className="grid-td text-right tabular-nums">{fmt.money(l.allocated)}</td>
                          <td className="grid-td text-right tabular-nums">{fmt.num(l.oldUnitCost, 4)}</td><td className={cn('grid-td bg-brand-soft text-right font-semibold tabular-nums')}>{fmt.num(l.newUnitCost, 4)}</td>
                          <td className="grid-td text-right tabular-nums text-warning">+{fmt.num(inc, 1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DocSection>
        <NotesSection fields={[{ label: 'Remarks', props: { ...form.register('remarks'), disabled: !editable } }]} />
        <DocFooter docType="LANDED_COST" entity="LandedCost" doc={doc.data} isNew={doc.isNew} approvalDoc={false} />
      </DocumentLayout>
    </FormProvider>
  );
}

export default [
  { id: 'landed-costs', title: 'Landed Costs', icon: Anchor, component: LandedCostsScreen, permission: 'landed_cost' },
  { id: 'landed-cost-form', title: 'Landed Cost', icon: Anchor, component: LandedCostForm, multiInstance: true, permission: 'landed_cost' },
] satisfies ScreenDef[];
