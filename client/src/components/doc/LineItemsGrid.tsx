import { useCallback, useRef } from 'react';
import { get, useFieldArray, useFormContext, useWatch, UseFormReturn, FieldValues } from 'react-hook-form';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fmt } from '@/lib/format';
import { num } from '@/lib/calc';
import { ProductLookup, ProductPicker } from './ProductPicker';
import type { SelectOption } from '@/components/ui';

export type Line = Record<string, unknown>;

export interface LineColumn {
  /** field name inside a line (e.g. 'qty'). For type 'product' this is the id field (default 'productId'). */
  key: string;
  header: string;
  type?: 'product' | 'text' | 'number' | 'money' | 'qty' | 'percent' | 'select' | 'date' | 'readonly' | 'computed';
  width?: number;
  options?: SelectOption[];
  /** value of a 'computed' column (or display override of 'readonly') */
  compute?: (line: Line, index: number) => number | string | null | undefined;
  /** display format for readonly/computed: money (2dp) | qty | text */
  format?: 'money' | 'qty' | 'text';
  /** per-row editability */
  editable?: (line: Line, index: number) => boolean;
  align?: 'left' | 'right' | 'center';
  /** show the column sum in the footer */
  total?: boolean;
  min?: number;
  required?: boolean;
}

export interface LineItemsGridProps {
  /** field array name in the form (default 'items') */
  name?: string;
  columns: LineColumn[];
  /** blank line factory, e.g. () => ({ productId: undefined, qty: 1, rate: 0, discount: 0, vatRate: 5 }) */
  newLine: () => Line;
  readOnly?: boolean;
  /** warehouse used for the stock columns in the product picker */
  warehouseId?: number | string;
  /** which product price fills `rate` on pick (default costPrice; use retailPrice/wholesalePrice for sales) */
  priceField?: 'costPrice' | 'averageCost' | 'lastPurchasePrice' | 'retailPrice' | 'wholesalePrice';
  /** override the default product -> line mapping */
  onProductPick?: (p: ProductLookup, index: number, form: UseFormReturn<FieldValues>) => void;
  minRows?: number;
  maxHeight?: string;
  className?: string;
  /** extra element in the footer bar (left) */
  footerExtra?: React.ReactNode;
}

const cellCls = 'ctl !h-6 !rounded-none !border-transparent bg-transparent hover:!border-app-border focus:!bg-white';

function show(v: unknown, format?: LineColumn['format'], type?: LineColumn['type']): string {
  if (v === null || v === undefined || v === '') return '';
  const f = format ?? (type === 'money' ? 'money' : type === 'qty' ? 'qty' : 'text');
  return f === 'money' ? fmt.money(v) : f === 'qty' ? fmt.qty(v) : String(v);
}

export function LineItemsGrid({
  name = 'items', columns, newLine, readOnly, warehouseId, priceField = 'costPrice', onProductPick, minRows = 0, maxHeight, className, footerExtra,
}: LineItemsGridProps) {
  const form = useFormContext();
  const { control, register, setValue, formState } = form;
  const { fields, append, remove, insert } = useFieldArray({ control, name });
  const lines = (useWatch({ control, name }) as Line[] | undefined) ?? [];
  const body = useRef<HTMLTableSectionElement>(null);
  const cols = columns;

  const cells = useCallback(
    () => Array.from(body.current?.querySelectorAll<HTMLElement>('[data-r]') ?? []).filter((el) => !(el as HTMLInputElement).disabled && (el as HTMLInputElement).type !== 'hidden'),
    [],
  );
  const focusFirstOfRow = (r: number) => setTimeout(() => cells().find((el) => el.dataset.r === String(r))?.focus(), 30);
  const addLine = () => {
    append(newLine());
    focusFirstOfRow(fields.length);
  };
  const focusNext = (from: HTMLElement) => {
    const all = cells();
    const i = all.indexOf(from);
    const next = all[i + 1];
    if (next) next.focus();
    else addLine();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (readOnly) return;
    const el = e.target as HTMLElement;
    if (!el.dataset.r) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      addLine();
    } else if (e.key === 'Enter' && !e.shiftKey && el.tagName !== 'TEXTAREA') {
      e.preventDefault();
      focusNext(el);
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      const all = cells();
      all[all.indexOf(el) - 1]?.focus();
    } else if (e.key === 'Delete' && e.ctrlKey) {
      e.preventDefault();
      remove(Number(el.dataset.r));
    }
  };

  const defaultPick = (p: ProductLookup, i: number) => {
    const set = (k: string, v: unknown) => setValue(`${name}.${i}.${k}`, v, { shouldDirty: true, shouldValidate: true });
    set('productId', p.id);
    set('productCode', p.code);
    set('oemNumber', p.oemNumber ?? '');
    set('description', p.name);
    set('unit', p.unit ?? p.salesUnit ?? p.purchaseUnit ?? '');
    set('rate', num(p[priceField]));
    if (p.vatRate !== undefined) set('vatRate', p.vatRate);
    set('available', p.available ?? 0);
    set('onHand', p.onHand ?? 0);
    set('reserved', p.reserved ?? 0);
    set('product', { id: p.id, code: p.code, name: p.name, oemNumber: p.oemNumber });
  };

  const colSum = (c: LineColumn) =>
    lines.reduce((s, l, i) => s + num(c.type === 'computed' || c.compute ? c.compute?.(l, i) : l?.[c.key]), 0);
  const hasTotals = cols.some((c) => c.total);
  const showRows = Math.max(fields.length, readOnly ? 0 : minRows);
  void showRows;

  return (
    <div className={cn('border border-app-border bg-white', className)}>
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-separate border-spacing-0 text-[12px]" onKeyDown={onKeyDown}>
          <thead>
            <tr className="h-7">
              <th className="grid-th w-8 text-center">#</th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  style={{ width: c.width, minWidth: c.width }}
                  className={cn('grid-th whitespace-nowrap', (c.align === 'right' || ['number', 'money', 'qty', 'percent', 'computed'].includes(c.type ?? '')) && '!text-right')}
                >
                  {c.header}
                  {c.required && !readOnly && <span className="text-red-500"> *</span>}
                </th>
              ))}
              {!readOnly && <th className="grid-th w-[58px]" />}
            </tr>
          </thead>
          <tbody ref={body}>
            {fields.length === 0 && (
              <tr>
                <td colSpan={cols.length + 2} className="p-4 text-center text-[12px] text-slate-400">
                  No lines. {!readOnly && 'Click "Add line" or press Ctrl+Enter.'}
                </td>
              </tr>
            )}
            {fields.map((f, i) => {
              const line = lines[i] ?? {};
              return (
                <tr key={f.id} className="h-7 odd:bg-white even:bg-slate-50/60 hover:bg-brand-light/50">
                  <td className="grid-td text-center text-slate-400">{i + 1}</td>
                  {cols.map((c) => {
                    const path = `${name}.${i}.${c.key}`;
                    const err = get(formState.errors, path) as { message?: string } | undefined;
                    const editable = !readOnly && (c.editable ? c.editable(line, i) : true);
                    const right = c.align === 'right' || ['number', 'money', 'qty', 'percent', 'computed'].includes(c.type ?? '');
                    const common = { 'data-r': String(i), 'data-c': c.key, title: err?.message } as const;
                    let content: React.ReactNode;
                    switch (c.type) {
                      case 'product': {
                        const lt = (line.productCode as string | undefined) ?? (line.product as { code?: string } | undefined)?.code ?? '';
                        content = readOnly ? (
                          <span className="px-1">{lt}</span>
                        ) : (
                          <ProductPicker
                            text={lt}
                            warehouseId={warehouseId}
                            disabled={!editable}
                            inputProps={{ ...common, 'aria-invalid': !!err }}
                            className={err ? '!border-red-500' : ''}
                            onPick={(p) => {
                              (onProductPick ?? ((pp, ii) => defaultPick(pp, ii)))(p, i, form);
                              setTimeout(() => {
                                const all = cells();
                                const cur = all.find((el) => el.dataset.r === String(i) && el.dataset.c === c.key);
                                if (cur) {
                                  const nxt = all[all.indexOf(cur) + 1];
                                  nxt?.focus();
                                }
                              }, 40);
                            }}
                            onClear={() => setValue(`${name}.${i}.productId`, undefined, { shouldDirty: true })}
                          />
                        );
                        break;
                      }
                      case 'computed':
                      case 'readonly': {
                        const v = c.compute ? c.compute(line, i) : line[c.key];
                        content = <span className={cn('block px-2', right && 'text-right tabular-nums', c.type === 'computed' && 'font-medium')}>{show(v, c.format ?? (c.type === 'computed' ? 'money' : undefined), c.type)}</span>;
                        break;
                      }
                      case 'select':
                        content = readOnly ? (
                          <span className="px-2">{c.options?.find((o) => String(o.value) === String(line[c.key]))?.label ?? String(line[c.key] ?? '')}</span>
                        ) : (
                          <select {...common} disabled={!editable} className={cn(cellCls, err && '!border-red-500')} {...register(path)}>
                            <option value="" />
                            {c.options?.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        );
                        break;
                      case 'number':
                      case 'money':
                      case 'qty':
                      case 'percent':
                        content = !editable ? (
                          <span className="block px-2 text-right tabular-nums">{show(line[c.key], c.format, c.type)}</span>
                        ) : (
                          <input
                            {...common}
                            type="number"
                            step="any"
                            min={c.min}
                            className={cn(cellCls, 'text-right tabular-nums', err && '!border-red-500')}
                            {...register(path, { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? 0 : Number(v)) })}
                            onFocus={(e) => e.target.select()}
                          />
                        );
                        break;
                      case 'date':
                        content = !editable ? (
                          <span className="px-2">{fmt.date(line[c.key] as string)}</span>
                        ) : (
                          <input {...common} type="date" className={cn(cellCls, err && '!border-red-500')} {...register(path)} />
                        );
                        break;
                      default:
                        content = !editable ? (
                          <span className="block px-2">{String(line[c.key] ?? '')}</span>
                        ) : (
                          <input {...common} className={cn(cellCls, err && '!border-red-500')} {...register(path)} onFocus={(e) => e.target.select()} />
                        );
                    }
                    return (
                      <td key={c.key} className={cn('grid-td !p-0 align-middle', right && 'text-right')}>
                        {content}
                      </td>
                    );
                  })}
                  {!readOnly && (
                    <td className="grid-td !px-1 text-center">
                      <button type="button" tabIndex={-1} title="Duplicate line" className="rounded p-0.5 text-slate-500 hover:bg-slate-200" onClick={() => insert(i + 1, { ...(lines[i] ?? {}) })}>
                        <Copy size={12} />
                      </button>
                      <button type="button" tabIndex={-1} title="Remove line (Ctrl+Del)" className="rounded p-0.5 text-red-500 hover:bg-red-50" onClick={() => remove(i)}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {hasTotals && fields.length > 0 && (
            <tfoot>
              <tr className="h-7">
                <td className="sticky bottom-0 border-t-2 border-app-border bg-app-head" />
                {cols.map((c, ci) => (
                  <td key={c.key} className="sticky bottom-0 border-t-2 border-app-border bg-app-head px-2 text-right text-[12px] font-semibold tabular-nums">
                    {c.total ? show(colSum(c), c.format ?? (c.type === 'qty' ? 'qty' : 'money')) : ci === 0 ? <span className="float-left">Total</span> : ''}
                  </td>
                ))}
                {!readOnly && <td className="sticky bottom-0 border-t-2 border-app-border bg-app-head" />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!readOnly && (
        <div className="no-print flex items-center gap-3 border-t border-app-border bg-app-head px-2 py-1">
          <button type="button" onClick={addLine} className="inline-flex h-6 items-center gap-1 rounded border border-app-border bg-white px-2 text-[11px] hover:bg-slate-100">
            <Plus size={12} /> Add line
          </button>
          <span className="text-[10px] text-slate-500">Enter: next cell · Ctrl+Enter: new line · Ctrl+Del: remove line</span>
          <div className="flex-1" />
          {footerExtra}
          <span className="text-[11px] text-slate-600">{fields.length} line(s)</span>
        </div>
      )}
    </div>
  );
}
