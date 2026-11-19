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
  useEffect(() => {
    if (open && ref.current) setRect(ref.current.getBoundingClientRect());
  }, [open, list.length]);

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
            className="fixed z-[300] max-h-[260px] overflow-auto border border-slate-400 bg-white text-[12px] shadow-lg"
            style={{ left: rect.left, top: rect.bottom + 1, minWidth: Math.max(rect.width, 560) }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="sticky top-0 grid grid-cols-[110px_130px_1fr_70px_70px] gap-2 border-b border-app-border bg-app-head px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">
              <span>Code</span><span>Mfr Part</span><span>Name</span><span className="text-right">On hand</span><span className="text-right">Avail.</span>
            </div>
            {isFetching && list.length === 0 && <div className="px-2 py-1.5 text-slate-500">Searching...</div>}
            {!isFetching && list.length === 0 && <div className="px-2 py-1.5 text-slate-500">No products match &quot;{dq}&quot;</div>}
            {list.map((p, i) => (
              <div
                key={p.id}
                onClick={() => pick(p)}
                onMouseEnter={() => setHi(i)}
                className={cn('grid cursor-pointer grid-cols-[110px_130px_1fr_70px_70px] gap-2 px-2 py-0.5', i === hi && 'bg-brand-light')}
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
