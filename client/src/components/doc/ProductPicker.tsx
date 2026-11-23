import { useEffect, useRef, useState } from 'react';
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
  label?: string;
}

/**
 * Typeahead product search (code / OEM / alternate / barcode / name). Used by LineItemsGrid and usable standalone.
 * `text` is the text shown when not searching; `onPick` fires with the full lookup row.
 */
export function ProductPicker({
  text, onPick, onClear, warehouseId, disabled, placeholder = 'Code / manufacturer part / name...', inputProps, className,
}: {
  text?: string;
  onPick: (p: ProductLookup) => void;
  onClear?: () => void;
  warehouseId?: number | string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement> & Record<`data-${string}`, string | undefined>;
}) {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const [dq, setDq] = useState('');
  const [hi, setHi] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ['product-lookup', dq, warehouseId ?? null],
    enabled: editing && dq.length >= 1,
    staleTime: 20_000,
    queryFn: async () => (await api.get<ProductLookup[]>('/products/lookup', { params: { q: dq, warehouseId, limit: 15 } })).data,
  });
  const list = Array.isArray(data) ? data : [];
  useEffect(() => setHi(0), [dq]);

  const open = editing && dq.length >= 1;
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
    const width = Math.min(Math.max(r.width, 760), vw - gap * 2);
    const left = Math.max(gap, Math.min(r.left, vw - width - gap));
    const maxHeight = Math.max(120, Math.min(ideal, up ? above : below));
    return up ? { left, bottom: vh - r.top + 2, width, maxHeight } : { left, top: r.bottom + 2, width, maxHeight };
  };

  const pick = (p: ProductLookup) => {
    onPick(p);
    setEditing(false);
    setQ('');
  };

  return (
    <>
      <input
        ref={ref}
        {...inputProps}
        disabled={disabled}
        className={cn('ctl !h-6 !border-transparent bg-transparent hover:!border-app-border', className)}
        value={editing ? q : (text ?? '')}
        placeholder={placeholder}
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
      {open &&
        rect &&
        createPortal(
          <div
            ref={listRef}
            className="fixed z-[300] overflow-auto border border-slate-400 bg-white text-[12px] shadow-lg"
            style={place(rect)}
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="sticky top-0 grid grid-cols-[150px_140px_1fr_70px_70px] gap-2 border-b border-app-border bg-app-head px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">
              <span>Code</span><span>OEM</span><span>Name</span><span className="text-right">On hand</span><span className="text-right">Avail.</span>
            </div>
            {isFetching && list.length === 0 && <div className="px-2 py-1.5 text-slate-500">Searching...</div>}
            {!isFetching && list.length === 0 && <div className="px-2 py-1.5 text-slate-500">No products match &quot;{dq}&quot;</div>}
            {list.map((p, i) => (
              <div
                key={p.id}
                data-idx={i}
                onClick={() => pick(p)}
                onMouseEnter={() => setHi(i)}
                className={cn('grid cursor-pointer grid-cols-[150px_140px_1fr_70px_70px] gap-2 px-2 py-0.5', i === hi && 'bg-brand-light')}
              >
                <span className="truncate font-medium">{p.code}</span>
                <span className="truncate text-slate-600">{p.matchedPartNumber && p.matchedPartNumber !== p.oemNumber ? `${p.matchedPartNumber} *` : (p.oemNumber ?? '')}</span>
                <span className="truncate">{p.name}{p.brand ? <span className="text-slate-400"> · {p.brand}</span> : null}</span>
                <span className="text-right tabular-nums">{fmt.qty(p.onHand)}</span>
                <span className={cn('text-right tabular-nums', (p.available ?? 0) <= 0 && 'text-red-600')}>{fmt.qty(p.available)}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
