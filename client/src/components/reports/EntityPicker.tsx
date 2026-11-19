import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { Select } from '@/components/ui';

/** Lookup entities offered by report parameter bars. */
export type EntityKind = 'warehouse' | 'branch' | 'customer' | 'supplier' | 'product' | 'brand' | 'category' | 'salesman';

const LIST_URL: Record<EntityKind, string> = {
  warehouse: '/warehouses', branch: '/branches', brand: '/brands', category: '/categories', salesman: '/salesmen',
  customer: '/customers', supplier: '/suppliers', product: '/products/lookup',
};
const TYPEAHEAD = new Set<EntityKind>(['customer', 'supplier', 'product']);

interface Item { id: number; code?: string; name?: string }
const labelOf = (i: Item) => [i.code, i.name].filter(Boolean).join(' - ') || `#${i.id}`;
const rowsOf = (d: unknown): Item[] => (Array.isArray(d) ? d : ((d as { rows?: Item[] })?.rows ?? [])) as Item[];

export const isEntityKind = (e: string | undefined): e is EntityKind => !!e && e in LIST_URL;

/** Select (small masters) or typeahead (customer / supplier / product). value = id or ''. */
export function EntityPicker({ entity, value, onChange, placeholder = 'All' }: {
  entity: EntityKind; value: number | ''; onChange: (id: number | '') => void; placeholder?: string;
}) {
  if (TYPEAHEAD.has(entity)) return <Typeahead entity={entity} value={value} onChange={onChange} placeholder={placeholder} />;
  return <SimpleSelect entity={entity} value={value} onChange={onChange} placeholder={placeholder} />;
}

function SimpleSelect({ entity, value, onChange, placeholder }: { entity: EntityKind; value: number | ''; onChange: (id: number | '') => void; placeholder: string }) {
  const q = useQuery({
    queryKey: ['report-lookup', entity],
    staleTime: 5 * 60_000,
    queryFn: async () => rowsOf((await api.get(LIST_URL[entity], { params: { pageSize: 500 } })).data),
  });
  return (
    <Select
      value={value === '' ? '' : String(value)}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
      options={(q.data ?? []).map((i) => ({ value: i.id, label: labelOf(i) }))}
    />
  );
}

function Typeahead({ entity, value, onChange, placeholder }: { entity: EntityKind; value: number | ''; onChange: (id: number | '') => void; placeholder: string }) {
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(text.trim()), 200); return () => clearTimeout(t); }, [text]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  // restore label for a preset id (restored tab / favourite)
  useEffect(() => {
    if (value === '' || label) return;
    const url = `${entity === 'product' ? '/products' : LIST_URL[entity]}/${value}`;
    api.get<Item>(url).then((r) => setLabel(labelOf(r.data))).catch(() => setLabel(`#${value}`));
  }, [value, label, entity]);

  const q = useQuery({
    queryKey: ['report-lookup', entity, debounced],
    enabled: open,
    staleTime: 30_000,
    queryFn: async () => {
      const params = entity === 'product' ? { q: debounced } : { search: debounced, pageSize: 15 };
      return rowsOf((await api.get(LIST_URL[entity], { params })).data).slice(0, 15);
    },
  });

  return (
    <div ref={box} className="relative">
      <input
        className="ctl pr-6"
        value={open ? text : value === '' ? '' : label}
        placeholder={placeholder}
        onFocus={() => { setText(''); setOpen(true); }}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
      />
      {value !== '' && (
        <button type="button" title="Clear" className="absolute right-1 top-1.5 text-slate-400 hover:text-slate-700" onClick={() => { onChange(''); setLabel(''); setText(''); }}>
          <X size={12} />
        </button>
      )}
      {open && (
        <div className="absolute z-40 mt-0.5 max-h-56 w-72 overflow-auto rounded border border-app-border bg-white shadow">
          {q.isLoading && <div className="px-2 py-1 text-[11px] text-slate-500">Searching...</div>}
          {q.data?.length === 0 && <div className="px-2 py-1 text-[11px] text-slate-500">No matches</div>}
          {q.data?.map((i) => (
            <button
              key={i.id}
              type="button"
              className="block w-full truncate px-2 py-1 text-left text-[12px] hover:bg-brand-light"
              onMouseDown={(e) => { e.preventDefault(); onChange(i.id); setLabel(labelOf(i)); setOpen(false); }}
            >
              {labelOf(i)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
