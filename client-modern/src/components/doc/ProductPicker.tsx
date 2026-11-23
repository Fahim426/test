import { useFeatures } from '@/hooks/useFeatures';
import { useEffect, useRef, useState } from 'react';
import { Filter, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';

/** Row returned by GET /api/products/lookup?q= */
export interface ProductLookup {
  id: number;
  code: string;
  name: string;
  arabicName?: string | null;
  oemNumber?: string | null;
  barcode?: string | null;
  brand?: string | null;
  unit?: string | null;
  salesUnit?: string | null;
  purchaseUnit?: string | null;
  costPrice?: number;
  averageCost?: number;
  lastPurchasePrice?: number;
  retailPrice?: number;
  wholesalePrice?: number;
  vatRate?: number;
  onHand?: number;
  reserved?: number;
  available?: number;
  matchedPartNumber?: string | null;
  matchedPartBrand?: string | null;
  stockNumber?: string | null;
  lastPurchaseAt?: string | null;
  label?: string;
}

/** Per-field conditions for the line search (all filled boxes must match; same params as GET /products). */
export interface PickFilter { code: string; stockNumber: string; oem: string; altNo: string; brandIds: number[]; make: string; model: string; year: string }
export const NO_FILTER: PickFilter = { code: '', stockNumber: '', oem: '', altNo: '', brandIds: [], make: '', model: '', year: '' };
export const hasFilter = (f: PickFilter) => !!(f.code || f.stockNumber || f.oem || f.altNo || f.brandIds.length || f.make || f.model || f.year);
export const filterParams = (f: PickFilter) => ({
  code: f.code || undefined, stockNumber: f.stockNumber || undefined, oem: f.oem || undefined, altNo: f.altNo || undefined,
  brandIds: f.brandIds.join(',') || undefined, make: f.make || undefined, model: f.model || undefined, year: f.year || undefined,
});

/**
 * Typeahead product search. Several words: each must match some field (code, stock no, OEM, alternative no / brand, barcode,
 * name, brand, vehicle). The filter button adds per-field conditions (Code + OEM + Brand ...). Used by LineItemsGrid and standalone.
 * `text` is the text shown when not searching; `onPick` fires with the full lookup row.
 */
export function ProductPicker({
  text, onPick, onClear, warehouseId, disabled, placeholder = 'Code / OEM / name...', inputProps, className, priceMode = 'sales',
}: {
  text?: string;
  /** which prices the dropdown shows: sales = retail, wholesale + cost; purchase = last purchase + average cost */
  priceMode?: 'sales' | 'purchase';
  onPick: (p: ProductLookup) => void;
  onClear?: () => void;
  warehouseId?: number | string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement> & Record<`data-${string}`, string | undefined>;
}) {
  const features = useFeatures();
  const cols = priceMode === 'sales' ? 'grid-cols-[130px_150px_1fr_72px_72px_72px_72px_62px_62px]' : 'grid-cols-[130px_150px_1fr_80px_80px_62px_62px]';
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const [dq, setDq] = useState('');
  const [hi, setHi] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const [flt, setFlt] = useState<PickFilter>(NO_FILTER);
  const [draft, setDraft] = useState<PickFilter>(NO_FILTER);
  const [fltOpen, setFltOpen] = useState(false);
  const fltOn = hasFilter(flt);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ['product-lookup', dq, warehouseId ?? null, flt],
    enabled: editing && (dq.length >= 1 || fltOn),
    staleTime: 20_000,
    queryFn: async () => (await api.get<ProductLookup[]>('/products/lookup', { params: { q: dq || undefined, warehouseId, limit: fltOn ? 30 : 15, ...filterParams(flt) } })).data,
  });
  const list = Array.isArray(data) ? data : [];
  useEffect(() => setHi(0), [dq]);

  const open = editing && (dq.length >= 1 || fltOn);
  // keep the popup glued to the input while open (page / grid scroll, window resize)
  useEffect(() => {
    if (!open) return;
    const update = () => ref.current && setRect(ref.current.getBoundingClientRect());
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, list.length]);

  // keep the keyboard-highlighted row visible
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  /** Fit the popup in the viewport: open upwards when there is not enough room below, clamp height and left edge. */
  const place = (r: DOMRect): React.CSSProperties => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 8;
    const ideal = 360;
    const below = vh - r.bottom - gap;
    const above = r.top - gap;
    const up = below < Math.min(ideal, 240) && above > below;
    const width = Math.min(Math.max(r.width, priceMode === 'sales' ? 1040 : 900), vw - gap * 2);
    const left = Math.max(gap, Math.min(r.left, vw - width - gap));
    const maxHeight = Math.max(120, Math.min(ideal, up ? above : below));
    return up ? { left, bottom: vh - r.top + 2, width, maxHeight } : { left, top: r.bottom + 2, width, maxHeight };
  };

  const pick = (p: ProductLookup) => {
    onPick(p);
    setEditing(false);
    setQ('');
  };

  const applyFilter = (f: PickFilter) => {
    setFlt(f);
    setFltOpen(false);
    setEditing(true);
    setTimeout(() => ref.current?.focus(), 0);
  };

  return (
    <>
      <div className="relative flex items-center">
      <input
        ref={ref}
        {...inputProps}
        disabled={disabled}
        className={cn('ctl !h-8 !rounded-md !border-transparent !bg-transparent !px-2 !pr-7 !text-[13px] hover:!border-line-strong focus:!border-brand focus:!bg-surface', className)}
        value={editing ? q : (text ?? '')}
        placeholder={fltOn && editing ? 'Filtered - type to narrow...' : placeholder}
        onFocus={(e) => {
          setEditing(true);
          setQ('');
          e.target.select();
        }}
        onBlur={() => setTimeout(() => setEditing(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          if (!e.target.value) onClear?.();
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            setHi((h) => Math.min(h + 1, list.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && list[hi]) {
            e.preventDefault();
            e.stopPropagation();
            pick(list[hi]);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(false);
          }
        }}
      />
      {!disabled && (
        <button
          type="button"
          tabIndex={-1}
          title={fltOn ? 'Search filters (active)' : 'Search by Code / Stock No / Mfr / Alternate / Brand / Vehicle'}
          className={cn('absolute right-1 rounded p-1 text-ink-faint hover:bg-surface-2 hover:text-brand', fltOn && 'text-brand')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setDraft(flt); setFltOpen((x) => !x); if (ref.current) setRect(ref.current.getBoundingClientRect()); }}
        >
          <Filter size={13} fill={fltOn ? 'currentColor' : 'none'} />
        </button>
      )}
      </div>
      {fltOpen && rect && createPortal(<FilterPanel rect={rect} value={draft} onChange={setDraft} onApply={applyFilter} onClose={() => setFltOpen(false)} />, document.body)}
      {open &&
        rect &&
        createPortal(
          <div
            ref={listRef}
            className="fixed z-[300] animate-pop-in overflow-auto rounded-xl border border-line bg-surface text-[13px] shadow-pop"
            style={place(rect)}
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className={`sticky top-0 grid ${cols} gap-2 border-b border-line bg-surface-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted`}>
              <span>Code</span><span>Mfr / Alternate</span><span>Name</span>{priceMode === 'sales' && <><span className="text-right">Retail</span><span className="text-right">Whsale</span></>}<span className="text-right">Avg cost</span><span className="text-right">Last pur.</span><span className="text-right">On hand</span><span className="text-right">Avail.</span>
            </div>
            {isFetching && list.length === 0 && <div className="px-3 py-3 text-ink-muted">Searching...</div>}
            {!isFetching && list.length === 0 && <div className="px-3 py-3 text-ink-muted">No products match &quot;{dq}&quot;</div>}
            {list.map((p, i) => (
              <div
                key={p.id}
                data-idx={i}
                onClick={() => pick(p)}
                onMouseEnter={() => setHi(i)}
                className={cn('grid cursor-pointer gap-2 px-3 py-1.5', cols, i === hi && 'bg-brand-soft')}
              >
                <span className="truncate font-medium">{p.code}</span>
                <span className="truncate text-ink-muted" title={p.stockNumber ? `Stock No ${p.stockNumber}` : undefined}>{p.matchedPartNumber && p.matchedPartNumber !== p.oemNumber ? `${p.matchedPartNumber}${p.matchedPartBrand ? ` (${p.matchedPartBrand})` : ''} *` : (p.oemNumber ?? '')}</span>
                <span className="truncate">{p.name}{p.brand ? <span className="text-ink-faint"> · {p.brand}</span> : null}</span>
                {priceMode === 'sales' && (
                  <>
                    <span className="text-right tabular-nums">{fmt.money(p.retailPrice)}</span>
                    <span className="text-right tabular-nums">{fmt.money(p.wholesalePrice)}</span>
                  </>
                )}
                <span className="text-right tabular-nums text-ink-muted">{fmt.money(p.averageCost)}</span>
                <span className="text-right tabular-nums text-ink-muted">{fmt.money(p.lastPurchasePrice)}</span>
                <span className="text-right tabular-nums">{fmt.qty(p.onHand)}</span>
                <span className={cn('text-right tabular-nums', (p.available ?? 0) <= 0 && 'text-danger')}>{fmt.qty(p.available)}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Per-field search conditions for one line (Code + OEM + Brand ...); all filled boxes must match. */
export function FilterPanel({ rect, value, onChange, onApply, onClose }: { rect: DOMRect; value: PickFilter; onChange: (f: PickFilter) => void; onApply: (f: PickFilter) => void; onClose: () => void }) {
  const features = useFeatures();
  const brands = useQuery({
    queryKey: ['pick-filter-brands'],
    staleTime: 300_000,
    queryFn: async () => (await api.get<{ rows: { id: number; code: string; name: string }[] }>('/brands', { params: { pageSize: 1000 } })).data.rows,
  });
  const set = (k: Exclude<keyof PickFilter, 'brandIds'>, v: string) => onChange({ ...value, [k]: v });
  const width = Math.min(560, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const below = window.innerHeight - rect.bottom > 300;
  const style: React.CSSProperties = below ? { left, top: rect.bottom + 4, width } : { left, bottom: window.innerHeight - rect.top + 4, width };
  const box = (k: Exclude<keyof PickFilter, 'brandIds'>, label: string, ph?: string) => (
    <label className="flex flex-col gap-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
      {label}
      <input className="ctl !h-8 !text-[13px]" placeholder={ph} value={value[k]} onChange={(e) => set(k, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onApply(value); } if (e.key === 'Escape') onClose(); }} />
    </label>
  );
  const name = (id: number) => brands.data?.find((b) => b.id === id)?.name ?? `#${id}`;
  return (
    <>
      <div className="fixed inset-0 z-[299]" onMouseDown={onClose} />
      <div className="fixed z-[300] animate-pop-in rounded-xl border border-line bg-surface p-3 text-[13px] shadow-pop" style={style}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-ink">Search items by - all filled conditions must match</span>
          <button type="button" className="rounded p-1 text-ink-faint hover:bg-surface-2" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {box('code', 'Product code')}
          {box('stockNumber', 'Stock No')}
          {features.partNumbers && box('oem', 'Mfr Part No')}
          {features.partNumbers && box('altNo', 'Alt No / brand')}
          <label className="col-span-2 flex flex-col gap-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Brand (multiple)
            <select className="ctl !h-8 !text-[13px]" value="" onChange={(e) => { const id = Number(e.target.value); if (id && !value.brandIds.includes(id)) onChange({ ...value, brandIds: [...value.brandIds, id] }); }}>
              <option value="">+ Add brand...</option>
              {(brands.data ?? []).filter((b) => !value.brandIds.includes(b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          {features.vehicleCompatibility && box('make', 'Vehicle make', 'Toyota')}
{features.vehicleCompatibility && box('model', 'Model', 'Hilux')}
{features.vehicleCompatibility && box('year', 'Year', '2018')}
</div>
        {value.brandIds.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {value.brandIds.map((id) => (
              <button key={id} type="button" className="rounded-full border border-brand/30 bg-brand-soft px-2 py-0.5 text-xs text-brand-ink" onClick={() => onChange({ ...value, brandIds: value.brandIds.filter((b) => b !== id) })}>
                {name(id)} ×
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button type="button" className="rounded-lg px-3 py-1.5 text-[13px] text-ink-muted hover:bg-surface-2" onClick={() => onApply(NO_FILTER)}>Clear</button>
          <button type="button" className="rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90" onClick={() => onApply(value)}>Apply</button>
        </div>
      </div>
    </>
  );
}
