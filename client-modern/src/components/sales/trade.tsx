/* Shared pieces of the quotation / proforma / sales-order forms. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { UseFormReturn } from 'react-hook-form';
import type { LineColumn } from '@/components/doc';
import { api } from '@/lib/api';
import { calcLine } from '@/lib/calc';
import { fmt, today } from '@/lib/format';
import { num } from '@/lib/calc';
import { AnyRec, ats, CustomerLite, isoOrNull, toBodyLine, toLine } from './shared';

export const tradeLine = z.object({
  productId: z.number({ required_error: 'Product required', invalid_type_error: 'Product required' }),
  productCode: z.string().optional(),
  oemNumber: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  qty: z.number().positive('Qty must be > 0'),
  rate: z.number().min(0),
  discount: z.number().min(0),
  vatRate: z.number().min(0),
});

export const tradeBase = {
  customerId: z.number({ required_error: 'Customer is required', invalid_type_error: 'Customer is required' }).int().positive('Customer is required'),
  salesmanId: z.number().optional(),
  warehouseId: z.number().optional(),
  docDate: z.string().min(1, 'Date is required'),
  currencyCode: z.string().optional(),
  paymentTerms: z.string().optional().nullable(),
  priceType: z.enum(['RETAIL', 'WHOLESALE']),
  roundOff: z.number(),
  remarks: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  items: z.array(tradeLine).min(1, 'Add at least one line'),
};

export const tradeDefaults = { docDate: today(), priceType: 'RETAIL', roundOff: 0, remarks: '', terms: '', items: [] as AnyRec[] };

export function tradeValues(d: AnyRec, copy = false): AnyRec {
  return {
    customerId: d.customerId,
    salesmanId: d.salesmanId ?? undefined,
    warehouseId: d.warehouseId ?? undefined,
    docDate: copy ? today() : fmt.isoDate(d.docDate),
    validUntil: d.validUntil ? fmt.isoDate(d.validUntil) : '',
    deliveryDate: d.deliveryDate ? fmt.isoDate(d.deliveryDate) : '',
    customerPoNo: d.customerPoNo ?? '',
    currencyCode: d.currencyCode ?? 'AED',
    paymentTerms: d.paymentTerms ?? '',
    priceType: d.priceType ?? 'RETAIL',
    roundOff: num(d.roundOff),
    remarks: d.remarks ?? '',
    terms: d.terms ?? '',
    items: (d.items ?? []).map(toLine),
  };
}

export function tradeBody(v: AnyRec): AnyRec {
  return {
    docDate: v.docDate,
    customerId: v.customerId,
    salesmanId: v.salesmanId ?? null,
    warehouseId: v.warehouseId ?? null,
    currencyCode: v.currencyCode || undefined,
    paymentTerms: v.paymentTerms || null,
    priceType: v.priceType,
    roundOff: num(v.roundOff),
    remarks: v.remarks || null,
    terms: v.terms || null,
    items: (v.items as AnyRec[]).map(toBodyLine),
  };
}
export { isoOrNull };

/** What to do when a customer is picked on a draft document */
export function applyCustomer(form: UseFormReturn<any>, c: CustomerLite | undefined) {
  if (!c) return;
  const set = (k: string, v: unknown) => form.setValue(k, v, { shouldDirty: true });
  if (c.currencyCode) set('currencyCode', c.currencyCode);
  if (c.paymentTermName) set('paymentTerms', c.paymentTermName);
  if (c.salesmanId && !form.getValues('salesmanId')) set('salesmanId', c.salesmanId);
}

/** TRN / credit-limit strip for the selected customer */
export function useCustomerInfo(id?: number | null) {
  return useQuery({
    queryKey: ['customer-lite', id],
    enabled: !!id,
    staleTime: 60_000,
    queryFn: async () => (await api.get<CustomerLite>(`/customers/${id}`)).data,
  });
}

export interface GridOpts {
  /** show per-line order progress columns (reserved/picked/delivered/invoiced/pending) */
  progress?: boolean;
  /** hide the stock columns (e.g. for documents where they make no sense) */
  noStock?: boolean;
}

export function tradeColumns(o: GridOpts = {}): LineColumn[] {
  const cols: LineColumn[] = [
    { key: 'productId', header: 'Product', type: 'product', width: 120, required: true },
    { key: 'oemNumber', header: 'Mfr Part No', type: 'readonly', width: 110 },
    { key: 'description', header: 'Description', type: 'text', width: 200 },
  ];
  if (!o.noStock) {
    cols.push(
      { key: 'onHand', header: 'Avail. Stock', type: 'readonly', format: 'qty', align: 'right', width: 74 },
      { key: 'reserved', header: 'Reserved', type: 'readonly', format: 'qty', align: 'right', width: 66 },
      { key: 'ats', header: 'Avail. to Sell', type: 'computed', format: 'qty', width: 76, compute: (l) => ats(l) },
    );
  }
  cols.push(
    { key: 'qty', header: 'Qty', type: 'qty', width: 74, total: true, required: true },
    { key: 'rate', header: 'Rate', type: 'money', width: 84 },
    { key: 'discount', header: 'Discount', type: 'money', width: 76, total: true },
    { key: 'vatRate', header: 'VAT %', type: 'percent', width: 56 },
    { key: 'amount', header: 'Total', type: 'computed', width: 96, total: true, compute: (l) => calcLine(l).amount },
  );
  if (o.progress) {
    cols.push(
      { key: 'soReserved', header: 'Reserved (SO)', type: 'readonly', format: 'qty', align: 'right', width: 80 },
      { key: 'picked', header: 'Picked', type: 'readonly', format: 'qty', align: 'right', width: 62 },
      { key: 'delivered', header: 'Delivered', type: 'readonly', format: 'qty', align: 'right', width: 68 },
      { key: 'invoiced', header: 'Invoiced', type: 'readonly', format: 'qty', align: 'right', width: 66 },
      { key: 'pending', header: 'Pending', type: 'readonly', format: 'qty', align: 'right', width: 66 },
    );
  }
  return cols;
}

export const newTradeLine = () => ({ qty: 1, rate: 0, discount: 0, vatRate: 5, onHand: 0, reserved: 0, description: '' });
