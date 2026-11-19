import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, ScanSearch } from 'lucide-react';
import { api } from '@/lib/api';
import { formScreenOf } from '@/lib/docRoutes';
import { useWorkspaceStore } from '@/store/workspace';

interface SearchItem {
  type: string;
  id: number;
  no?: string;
  label: string;
  screenId?: string;
  extra?: Record<string, unknown>;
}
interface SearchGroup {
  type: string;
  label: string;
  items: SearchItem[];
}

/** Accepts {groups:[{type,typeLabel|label,items}]} (current backend) or a flat {results:[...]}. */
function normalize(data: unknown): SearchGroup[] {
  const d = data as { groups?: { type: string; typeLabel?: string; label?: string; items?: SearchItem[] }[]; results?: (SearchItem & { typeLabel?: string })[] };
  if (d?.groups) return d.groups.map((g) => ({ type: g.type, label: g.typeLabel ?? g.label ?? g.type, items: g.items ?? [] }));
  const map = new Map<string, SearchGroup>();
  for (const r of d?.results ?? []) {
    const g = map.get(r.type) ?? { type: r.type, label: r.typeLabel ?? r.type, items: [] };
    g.items.push(r);
    map.set(r.type, g);
  }
  return [...map.values()];
}

export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const openTab = useWorkspaceStore((s) => s.open);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
    };
    const click = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', h);
    document.addEventListener('mousedown', click);
    return () => {
      window.removeEventListener('keydown', h);
      document.removeEventListener('mousedown', click);
    };
  }, []);

  const { data, isFetching, error } = useQuery({
    queryKey: ['global-search', debounced],
    enabled: debounced.length >= 1,
    staleTime: 15_000,
    retry: false,
    queryFn: async () => normalize((await api.get('/search', { params: { q: debounced } })).data),
  });

  const flat = useMemo(() => (data ?? []).flatMap((g) => g.items), [data]);
  useEffect(() => setHi(0), [debounced]);

  const openPart = (n: string) => {
    openTab({ screenId: 'part-lookup', title: `Part: ${n}`, params: { number: n }, instanceKey: `part-lookup:${n}` });
    setOpen(false);
  };
  const openItem = (it: SearchItem) => {
    if (it.type === 'PRODUCT' && it.no) {
      // products open their master form; part lookup is one click away from the product row
      openTab({ screenId: 'product-form', params: { id: it.id }, title: it.no });
    } else {
      const sid = it.screenId ?? formScreenOf(it.type);
      openTab({ screenId: sid, params: { id: it.id }, title: it.no ?? it.label });
    }
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Escape') {
      setOpen(false);
      input.current?.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const v = q.trim();
      if (!v) return;
      // exact part number (internal code / OEM / alternate) -> part lookup; otherwise highlighted result
      const exact = flat.find((i) => i.type === 'PRODUCT' && (i.no?.toLowerCase() === v.toLowerCase() || String(i.extra?.matchedPartNumber ?? '').toLowerCase() === v.toLowerCase() || String(i.extra?.oemNumber ?? '').toLowerCase() === v.toLowerCase()));
      if (exact) openPart(v);
      else if (flat[hi] && debounced === v) openItem(flat[hi]);
      else openPart(v);
    }
  };

  let idx = -1;
  return (
    <div ref={box} className="relative w-full max-w-[520px]">
      <Search size={13} className="absolute left-2 top-[7px] text-slate-400" />
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search products, manufacturer part numbers, customers, documents...   (Ctrl+K)"
        className="h-7 w-full rounded border border-white/30 bg-white pl-7 pr-7 text-[12px] text-slate-800 outline-none placeholder:text-slate-400"
      />
      {isFetching && <Loader2 size={13} className="absolute right-2 top-[7px] animate-spin text-brand" />}
      {open && q.trim() && (
        <div className="absolute left-0 right-0 top-8 z-[120] max-h-[70vh] overflow-auto border border-slate-400 bg-white text-slate-800 shadow-lg">
          <button className="flex w-full items-center gap-2 border-b border-app-border bg-brand-light px-2 py-1 text-left text-[12px] hover:bg-brand-mid" onClick={() => openPart(q.trim())}>
            <ScanSearch size={13} className="text-brand" /> Part lookup for <b>{q.trim()}</b>
            <span className="ml-auto text-[10px] text-slate-500">Enter</span>
          </button>
          {error ? <div className="p-2 text-[12px] text-red-600">Search failed.</div> : null}
          {!isFetching && data && data.length === 0 && <div className="p-3 text-center text-[12px] text-slate-500">No results</div>}
          {data?.map((g) => (
            <div key={g.type}>
              <div className="sticky top-0 bg-app-head px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">{g.label}</div>
              {g.items.map((it) => {
                idx++;
                const mine = idx;
                return (
                  <button
                    key={`${g.type}-${it.id}`}
                    onMouseEnter={() => setHi(mine)}
                    onClick={() => openItem(it)}
                    className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] ${mine === hi ? 'bg-brand-light' : ''}`}
                  >
                    <span className="truncate">{it.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
