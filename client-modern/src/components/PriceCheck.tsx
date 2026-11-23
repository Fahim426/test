import { useFeatures } from '@/hooks/useFeatures';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Filter, Search, Tag, X } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useOpenScreen } from '@/store/workspace';
import { FilterPanel, filterParams, hasFilter, NO_FILTER, type PickFilter, type ProductLookup } from '@/components/doc/ProductPicker';

/**
 * Quick item price check (dashboard): type words (each must match code, stock no, OEM, alternative no / brand, name,
 * brand or vehicle) and/or use the filter button (Code + OEM + Brand ...). Shows prices, cost and stock; click a row for
 * the full Part Lookup.
 */
export function PriceCheck() {
  const features = useFeatures();
  const open = useOpenScreen();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [flt, setFlt] = useState<PickFilter>(NO_FILTER);
  const [draft, setDraft] = useState<PickFilter>(NO_FILTER);
  const [fltOpen, setFltOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const fltOn = hasFilter(flt);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const res = useQuery({
    queryKey: ['price-check', dq, flt],
    enabled: dq.length >= 2 || fltOn,
    staleTime: 20_000,
    queryFn: async () => (await api.get<ProductLookup[]>('/products/lookup', { params: { q: dq || undefined, limit: 12, ...filterParams(flt) } })).data,
  });
  const rows = Array.isArray(res.data) ? res.data : [];
  const active = dq.length >= 2 || fltOn;

  return (
    <section data-tour="demo-price-check" className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Tag size={15} className="text-brand" /> Price Check
        </span>
        <div ref={boxRef} className="relative min-w-[260px] flex-1">
          <Search size={15} className="absolute left-3 top-[10px] text-ink-faint" />
          <input
            className="ctl pl-9 pr-9"
            placeholder={features.partNumbers ? 'Code, stock number, manufacturer part, brand, name...' : 'Product code, stock number, machine name or brand...'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQ('')}
          />
          <button
            type="button"
            title={fltOn ? 'Filters (active)' : 'Filter by Code / Stock No / Mfr / Alternate / Brand / Vehicle'}
            className={cn('absolute right-1.5 top-1.5 rounded p-1.5 text-ink-faint hover:bg-surface-2 hover:text-brand', fltOn && 'text-brand')}
            onClick={() => {
              setDraft(flt);
              if (boxRef.current) setRect(boxRef.current.getBoundingClientRect());
              setFltOpen((x) => !x);
            }}
          >
            <Filter size={14} fill={fltOn ? 'currentColor' : 'none'} />
          </button>
        </div>
        {(active || q) && (
          <button type="button" className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink" onClick={() => { setQ(''); setFlt(NO_FILTER); }}>
            <X size={13} /> Clear
          </button>
        )}
      </div>
      {fltOn && (
        <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
          {Object.entries(filterParams(flt))
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <span key={k} className="rounded-full border border-brand/30 bg-brand-soft px-2 py-0.5 text-brand-ink">
                {k === 'brandIds' ? `${flt.brandIds.length} brand(s)` : `${k}: ${v}`}
              </span>
            ))}
        </div>
      )}

      {active && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line">
          {res.isLoading ? (
            <div className="p-4 text-[13px] text-ink-muted">Searching...</div>
          ) : res.isError ? (
            <div className="p-4 text-[13px] text-danger">{apiError(res.error)}</div>
          ) : rows.length === 0 ? (
            <div className="p-4 text-[13px] text-ink-muted">No items match.</div>
          ) : (
            <table className="w-full min-w-[860px] border-collapse text-[13px]">
              <thead>
                <tr className="h-8">
                  {['Code', 'Stock No', 'Mfr / Alternate', 'Name', 'Brand', 'Retail', 'Wholesale', 'Avg cost', 'Last pur.', 'On hand', 'Avail.'].map((h, i) => (
                    <th key={h} className={cn('grid-th', i >= 5 && 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="h-9 cursor-pointer hover:bg-brand-soft/50" onClick={() => open(features.partNumbers ? 'part-lookup' : 'product-form', features.partNumbers ? { number: p.code } : { id: p.id }, `Lookup ${p.code}`)} title="Open Part Lookup">
                    <td className="grid-td font-medium text-brand">{p.code}</td>
                    <td className="grid-td text-ink-muted">{p.stockNumber}</td>
                    <td className="grid-td text-ink-muted">{p.matchedPartNumber && p.matchedPartNumber !== p.oemNumber ? `${p.matchedPartNumber}${p.matchedPartBrand ? ` (${p.matchedPartBrand})` : ''}` : p.oemNumber}</td>
                    <td className="grid-td max-w-[260px] truncate">{p.name}</td>
                    <td className="grid-td text-ink-muted">{p.brand}</td>
                    <td className="grid-td text-right font-semibold tabular-nums">{fmt.money(p.retailPrice)}</td>
                    <td className="grid-td text-right tabular-nums">{fmt.money(p.wholesalePrice)}</td>
                    <td className="grid-td text-right tabular-nums text-ink-muted">{fmt.money(p.averageCost)}</td>
                    <td className="grid-td text-right tabular-nums text-ink-muted">{fmt.money(p.lastPurchasePrice)}</td>
                    <td className="grid-td text-right tabular-nums">{fmt.qty(p.onHand)}</td>
                    <td className={cn('grid-td text-right tabular-nums', (p.available ?? 0) <= 0 && 'text-danger')}>{fmt.qty(p.available)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {fltOpen && rect && createPortal(<FilterPanel rect={rect} value={draft} onChange={setDraft} onApply={(f) => { setFlt(f); setFltOpen(false); }} onClose={() => setFltOpen(false)} />, document.body)}
    </section>
  );
}
