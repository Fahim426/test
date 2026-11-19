/* Header + grid + totals + notes shared by quotation / proforma / sales order forms. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ReactNode, useEffect } from 'react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { DocSection, HeaderSection, LineItemsGrid, NotesSection, TotalsSection } from '@/components/doc';
import { DateInput, Field, Input, NumberInput, Select } from '@/components/ui';
import { calcTotals } from '@/lib/calc';
import { AnyRec, CustomerPicker, idReg, RowHighlight, scopeOf, ShortagePanel, shortRows, useAvailabilityRefresh, useCurrencies, usePaymentTerms, useSalesmen, useWarehouses } from './shared';
import { applyCustomer, newTradeLine, tradeColumns, useCustomerInfo } from './trade';
import { fmt } from '@/lib/format';

export interface TradeBodyProps {
  tabId: string;
  docNo?: string | null;
  editable: boolean;
  isNew: boolean;
  noLabel: string;
  infoTitle: string;
  showSalesman?: boolean;
  showValidUntil?: boolean;
  showOrderFields?: boolean;
  showRoundOff?: boolean;
  showTerms?: boolean;
  showExchange?: boolean;
  /** pick first active warehouse for new docs */
  defaultWarehouse?: boolean;
  progress?: boolean;
  /** highlight lines whose qty exceeds available to sell */
  shortage?: boolean;
  /** highlight backordered lines (order lifecycle) */
  highlightBackorder?: boolean;
  errors: AnyRec;
  extraHeader?: ReactNode;
  afterGrid?: ReactNode;
}

export function TradeFormBody(p: TradeBodyProps) {
  const form = useFormContext<any>();
  const { register, control } = form;
  const salesmen = useSalesmen();
  const warehouses = useWarehouses();
  const terms = usePaymentTerms();
  const currencies = useCurrencies();
  const customerId = useWatch({ control, name: 'customerId' }) as number | undefined;
  const warehouseId = useWatch({ control, name: 'warehouseId' }) as number | undefined;
  const priceType = useWatch({ control, name: 'priceType' }) as string;
  const items = (useWatch({ control, name: 'items' }) as AnyRec[] | undefined) ?? [];
  const roundOff = useWatch({ control, name: 'roundOff' }) as number;
  const cust = useCustomerInfo(customerId);
  const scope = scopeOf(p.tabId);
  const errors = p.errors;

  useAvailabilityRefresh(form, warehouseId, !!p.shortage);

  // default warehouse = first active one
  useEffect(() => {
    if (p.defaultWarehouse && p.isNew && !form.getValues('warehouseId') && warehouses.data?.length) {
      form.setValue('warehouseId', Math.min(...warehouses.data.map((o) => Number(o.value))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses.data, p.isNew]);

  const totals = calcTotals(items, roundOff);
  const hlRows = p.shortage ? shortRows(items) : p.highlightBackorder ? items.map((l, i) => (l.backorder ? i : -1)).filter((i) => i >= 0) : [];
  const credit = cust.data?.creditLimit ?? 0;

  return (
    <>
      <HeaderSection title={p.infoTitle} columns={4}>
        <Field label={p.noLabel}><Input value={p.docNo ?? '(auto)'} readOnly /></Field>
        <Field label="Customer" required error={errors.customerId?.message} hint={cust.data ? `TRN ${cust.data.trn || '-'}${credit > 0 ? ` | Credit limit ${fmt.money(credit)}` : ''}` : undefined}>
          <Controller
            control={control}
            name="customerId"
            render={({ field }) => (
              <CustomerPicker
                value={field.value}
                invalid={!!errors.customerId}
                disabled={!p.editable}
                onChange={(id, c) => {
                  field.onChange(id);
                  if (p.editable) applyCustomer(form, c);
                }}
              />
            )}
          />
        </Field>
        <Field label="Date" required error={errors.docDate?.message}><DateInput disabled={!p.editable} {...register('docDate')} /></Field>
        {p.showValidUntil && <Field label="Valid Until"><DateInput disabled={!p.editable} {...register('validUntil')} /></Field>}
        {p.showSalesman && (
          <Field label="Salesman"><Select key={salesmen.data?.length ?? 0} options={salesmen.data} placeholder="-" disabled={!p.editable} {...register('salesmanId', idReg)} /></Field>
        )}
        <Field label="Warehouse" hint="Stock columns are for this warehouse">
          <Select key={warehouses.data?.length ?? 0} options={warehouses.data} placeholder={p.defaultWarehouse ? 'Select...' : 'All / not set'} disabled={!p.editable} {...register('warehouseId', idReg)} />
        </Field>
        <Field label="Currency"><Select key={currencies.data?.length ?? 0} options={currencies.data} disabled={!p.editable} {...register('currencyCode')} /></Field>
        <Field label="Payment Terms">
          <Select key={terms.data?.length ?? 0} options={terms.data} placeholder="-" disabled={!p.editable} {...register('paymentTerms')} />
        </Field>
        <Field label="Price List">
          <Select options={[{ value: 'RETAIL', label: 'Retail' }, { value: 'WHOLESALE', label: 'Wholesale' }]} disabled={!p.editable} {...register('priceType')} />
        </Field>
        {p.showOrderFields && (
          <>
            <Field label="Customer PO No"><Input disabled={!p.editable} {...register('customerPoNo')} /></Field>
            <Field label="Delivery Date"><DateInput disabled={!p.editable} {...register('deliveryDate')} /></Field>
          </>
        )}
        {p.extraHeader}
      </HeaderSection>

      <DocSection title="Items">
        <RowHighlight scope={scope} rows={hlRows} color={p.highlightBackorder && !p.shortage ? 'rgb(var(--warning-soft))' : 'rgb(var(--danger-soft))'} />
        <LineItemsGrid
          className={scope}
          readOnly={!p.editable}
          columns={tradeColumns({ progress: p.progress })}
          newLine={newTradeLine}
          warehouseId={warehouseId || undefined}
          priceField={priceType === 'WHOLESALE' ? 'wholesalePrice' : 'retailPrice'}
        />
        {errors.items?.message && <div className="p-1 text-xs text-danger">{errors.items.message}</div>}
        {(errors.items as any)?.root?.message && <div className="p-1 text-xs text-danger">{(errors.items as any).root.message}</div>}
        {p.shortage && <ShortagePanel items={items} />}
        {p.afterGrid}
      </DocSection>

      <TotalsSection
        totals={totals}
        currency={form.getValues('currencyCode') || 'AED'}
        roundOffInput={p.showRoundOff && p.editable ? <NumberInput className="!h-8 w-24" {...register('roundOff', { valueAsNumber: true })} /> : undefined}
      />
      <NotesSection
        fields={[
          { label: 'Remarks', props: { ...register('remarks'), disabled: !p.editable } },
          ...(p.showTerms ? [{ label: 'Terms & Conditions', props: { ...register('terms'), disabled: !p.editable } }] : []),
        ]}
      />
    </>
  );
}
