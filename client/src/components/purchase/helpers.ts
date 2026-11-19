/* eslint-disable @typescript-eslint/no-explicit-any */
import type { UseFormSetValue } from 'react-hook-form';
import type { CurrencyRow, FV, SupplierRow } from './kit';
import type { ProductLookup } from '@/components/doc';
import { num } from '@/lib/calc';

/** Default currency / rate / payment terms / country from the chosen supplier (only fills what the user has not typed). */
export function applySupplierDefaults(
  setValue: UseFormSetValue<FV>,
  getValues: (name: string) => any,
  s: SupplierRow | undefined,
  currencies: CurrencyRow[],
  opts: { country?: boolean } = {},
) {
  if (!s) return;
  const code = s.currencyCode ?? '';
  if (code) {
    setValue('currencyCode', code, { shouldDirty: true });
    setValue('exchangeRate', currencies.find((c) => c.code === code)?.rate ?? 1, { shouldDirty: true });
  }
  if (!getValues('paymentTerms') && s.paymentTermName) setValue('paymentTerms', s.paymentTermName, { shouldDirty: true });
  if (opts.country && s.country) setValue('supplierCountry', s.country, { shouldDirty: true });
}

/** Product pick for purchase grids: cost price as rate, VAT 0 for import / non-taxable suppliers. */
export function pickPurchaseProduct(p: ProductLookup, i: number, form: { setValue: UseFormSetValue<any>; getValues: (n?: any) => any }, opts: { zeroVat?: boolean } = {}) {
  const set = (k: string, v: unknown) => form.setValue(`items.${i}.${k}`, v, { shouldDirty: true, shouldValidate: true });
  set('productId', p.id);
  set('productCode', p.code);
  set('oemNumber', p.oemNumber ?? '');
  set('description', p.name);
  set('unit', p.purchaseUnit ?? p.unit ?? '');
  set('rate', num(p.lastPurchasePrice) || num(p.costPrice));
  set('vatRate', opts.zeroVat ? 0 : num(p.vatRate ?? 5));
  set('product', { id: p.id, code: p.code, name: p.name, oemNumber: p.oemNumber });
}
