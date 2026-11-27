import { useCallback, useMemo, useRef } from 'react';
import { get, useFieldArray, useFormContext, useWatch, UseFormReturn, FieldValues } from 'react-hook-form';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fmt } from '@/lib/format';
import { num } from '@/lib/calc';
import { ProductLookup, ProductPicker } from './ProductPicker';
import { useProductInfoColumns, productInfoOf } from './ProductInfo';
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
  /** readonly text columns: cut long values to the column width (full value on hover) */
  truncate?: boolean;
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
  /** Stock No / OEM No / Alt No / Brand / Vehicle columns after the Product column (default: shown) */
  productInfo?: boolean;
}

const cellCls = 'ctl !h-8 !rounded-md !border-transparent !bg-transparent !px-2 !text-[13px] hover:!border-line-strong focus:!border-brand focus:!bg-surface';

function show(v: unknown, format?: LineColumn['format'], type?: LineColumn['type']): string {
  if (v === null || v === undefined || v === '') return '';
  const f = format ?? (type === 'money' ? 'money' : type === 'qty' ? 'qty' : 'text');
  return f === 'money' ? fmt.money(v) : f === 'qty' ? fmt.qty(v) : String(v);
}

export function LineItemsGrid({
  name = 'items', columns, newLine, readOnly, warehouseId, priceField = 'costPrice', onProductPick, minRows = 0, maxHeight, className, footerExtra, productInfo = true,
}: LineItemsGridProps) {
  const form = useFormContext();
  const { control, register, setValue, formState } = form;
  const { fields, append, remove, insert } = useFieldArray({ control, name });
  const lines = (useWatch({ control, name }) as Line[] | undefined) ?? [];
  const body = useRef<HTMLTableSectionElement>(null);
  // item details after the Product column; skipped where the form already has its own column with that key
  const infoColumns = useProductInfoColumns();
  const cols = useMemo(() => {
    if (!productInfo) return columns;
    const at = columns.findIndex((c) => c.type === 'product');
    if (at < 0) return columns;
    const info: LineColumn[] = infoColumns.filter((c) => !columns.some((x) => x.key === c.key)).map((c) => ({
      key: `__${c.key}`,
      header: c.header,
      type: 'readonly' as const,
      width: c.w,
      truncate: true,
      compute: (l: Line) => (productInfoOf(l)[c.key] as string | null | undefined) ?? '',
    }));
    return [...columns.slice(0, at + 1), ...info, ...columns.slice(at + 1)].filter(c => c.key !== 'oemNumber' || infoColumns.some(i => i.key === 'oemNumber'));
  }, [columns, productInfo, infoColumns]);

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
    <div className={cn('overflow-hidden rounded-card border border-line bg-surface shadow-card', className)}>
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-separate border-spacing-0 text-[13px]" onKeyDown={onKeyDown}>
          <thead>
            <tr className="h-10">
              <th className="grid-th w-10 text-center">#</th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  style={{ width: c.width, minWidth: c.width }}
                  className={cn('grid-th whitespace-nowrap', (c.align === 'right' || ['number', 'money', 'qty', 'percent', 'computed'].includes(c.type ?? '')) && '!text-right')}
                >
                  {c.header}
                  {c.required && !readOnly && <span className="text-danger"> *</span>}
                </th>
              ))}
              {!readOnly && <th className="grid-th w-[58px]" />}
            </tr>
          </thead>
          <tbody ref={body}>
            {fields.length === 0 && (
              <tr>
                <td colSpan={cols.length + 2} className="p-8 text-center text-[13px] text-ink-faint">
                  No lines. {!readOnly && 'Click "Add line" or press Ctrl+Enter.'}
                </td>
              </tr>
            )}
            {fields.map((f, i) => {
              const line = lines[i] ?? {};
              return (
                <tr key={f.id} className="h-11 transition-colors even:bg-surface-2/50 hover:bg-brand-soft/40">
                  <td className="grid-td text-center text-xs text-ink-faint">{i + 1}</td>
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
                            priceMode={priceField === 'retailPrice' || priceField === 'wholesalePrice' ? 'sales' : 'purchase'}
                            disabled={!editable}
                            inputProps={{ ...common, 'aria-invalid': !!err }}
                            className={err ? '!border-danger' : ''}
                            onPick={(p) => {
                              (onProductPick ?? ((pp, ii) => defaultPick(pp, ii)))(p, i, form);
                              // item details shown beside the product (also for forms with their own pick handler)
                              setValue(`${name}.${i}.pinfo`, { stockNumber: p.stockNumber, oemNumber: p.oemNumber, altNo: p.altNo, brandName: p.brand, vehicle: p.vehicle });
                              setTimeout(() => {
                                const all = cells();
                                const cur = all.find((el) => el.dataset.r === String(i) && el.dataset.c === c.key);
                                if (cur) {
                                  const nxt = all[all.indexOf(cur) + 1];
                                  nxt?.focus();
                                }
                              }, 40);
                            }}
                            onClear={() => {
                              setValue(`${name}.${i}.productId`, undefined, { shouldDirty: true });
                              setValue(`${name}.${i}.pinfo`, {});
                              setValue(`${name}.${i}.product`, undefined);
                            }}
                          />
                        );
                        break;
                      }
                      case 'computed':
                      case 'readonly': {
                        const v = c.compute ? c.compute(line, i) : line[c.key];
                        const txt = show(v, c.format ?? (c.type === 'computed' ? 'money' : undefined), c.type);
                        content = (
                          <span className={cn('block px-2', right && 'text-right tabular-nums', c.type === 'computed' && 'font-medium', c.truncate && 'truncate')} style={c.truncate && c.width ? { maxWidth: c.width + 40 } : undefined} title={c.truncate && txt ? txt : undefined}>
                            {txt}
                          </span>
                        );
                        break;
                      }
                      case 'select':
                        content = readOnly ? (
                          <span className="px-2">{c.options?.find((o) => String(o.value) === String(line[c.key]))?.label ?? String(line[c.key] ?? '')}</span>
                        ) : (
                          <select {...common} disabled={!editable} className={cn(cellCls, err && '!border-danger')} {...register(path)}>
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
                            className={cn(cellCls, 'text-right tabular-nums', err && '!border-danger')}
                            {...register(path, { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? 0 : Number(v)) })}
                            onFocus={(e) => e.target.select()}
                          />
                        );
                        break;
                      case 'date':
                        content = !editable ? (
                          <span className="px-2">{fmt.date(line[c.key] as string)}</span>
                        ) : (
                          <input {...common} type="date" className={cn(cellCls, err && '!border-danger')} {...register(path)} />
                        );
                        break;
                      default:
                        content = !editable ? (
                          <span className="block px-2">{String(line[c.key] ?? '')}</span>
                        ) : (
                          <input {...common} className={cn(cellCls, err && '!border-danger')} {...register(path)} onFocus={(e) => e.target.select()} />
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
                      <button type="button" tabIndex={-1} title="Duplicate line" className="rounded-md p-1 text-ink-faint transition hover:bg-surface-3 hover:text-ink" onClick={() => insert(i + 1, { ...(lines[i] ?? {}) })}>
                        <Copy size={14} />
                      </button>
                      <button type="button" tabIndex={-1} title="Remove line (Ctrl+Del)" className="rounded-md p-1 text-ink-faint transition hover:bg-danger-soft hover:text-danger" onClick={() => remove(i)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {hasTotals && fields.length > 0 && (
            <tfoot>
              <tr className="h-10">
                <td className="sticky bottom-0 border-t border-line-strong bg-surface-2" />
                {cols.map((c, ci) => (
                  <td key={c.key} className="sticky bottom-0 border-t border-line-strong bg-surface-2 px-3 text-right text-[13px] font-semibold tabular-nums">
                    {c.total ? show(colSum(c), c.format ?? (c.type === 'qty' ? 'qty' : 'money')) : ci === 0 ? <span className="float-left">Total</span> : ''}
                  </td>
                ))}
                {!readOnly && <td className="sticky bottom-0 border-t border-line-strong bg-surface-2" />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!readOnly && (
        <div className="no-print flex flex-wrap items-center gap-3 border-t border-line bg-surface-2/60 px-3 py-2">
          <button type="button" onClick={addLine} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-brand/40 bg-brand-soft/50 px-3 text-xs font-medium text-brand-ink transition hover:border-brand hover:bg-brand-soft">
            <Plus size={14} /> Add line
          </button>
          <span className="hidden text-[11px] text-ink-faint md:inline">Enter: next cell · Ctrl+Enter: new line · Ctrl+Del: remove line</span>
          <div className="flex-1" />
          {footerExtra}
          <span className="text-xs text-ink-muted">{fields.length} line(s)</span>
        </div>
      )}
    </div>
  );
}
