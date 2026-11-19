import { useFeatures } from '@/hooks/useFeatures';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { formScreenOf } from '@/lib/docRoutes';
import { useWorkspaceStore } from '@/store/workspace';
import { useUi } from '@/store/ui';

export interface SearchItem {
  type: string;
  id: number;
  no?: string;
  label: string;
  screenId?: string;
  extra?: Record<string, unknown>;
}
export interface SearchGroup {
  type: string;
  label: string;
  items: SearchItem[];
}

/** Accepts {groups:[{type,typeLabel|label,items}]} (current backend) or a flat {results:[...]}. */
export function normalize(data: unknown): SearchGroup[] {
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

/** Debounced `GET /api/search?q=` -> grouped results. */
export function useGlobalSearch(q: string) {
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 220);
    return () => clearTimeout(t);
  }, [q]);
  const query = useQuery({
    queryKey: ['global-search', debounced],
    enabled: debounced.length >= 1,
    staleTime: 15_000,
    retry: false,
    queryFn: async () => normalize((await api.get('/search', { params: { q: debounced } })).data),
  });
  return { debounced, groups: debounced ? (query.data ?? []) : [], isFetching: query.isFetching || (q.trim() !== debounced && q.trim().length > 0), error: query.error };
}

/** Open a search result in the workspace (products -> product master form). */
export function openSearchItem(it: SearchItem) {
  const open = useWorkspaceStore.getState().open;
  if (it.type === 'PRODUCT' && it.no) open({ screenId: 'product-form', params: { id: it.id }, title: it.no });
  else open({ screenId: it.screenId ?? formScreenOf(it.type), params: { id: it.id }, title: it.no ?? it.label });
}
export function openPartLookup(n: string) {
  useWorkspaceStore.getState().open({ screenId: 'part-lookup', title: `Part: ${n}`, params: { number: n }, instanceKey: `part-lookup:${n}` });
}

/** Topbar search trigger: opens the command palette (Ctrl/Cmd+K is registered by the palette itself). */
export function GlobalSearch() {
  const features = useFeatures();
  const setOpen = useUi((s) => s.setPaletteOpen);
  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  return (
    <button
      onClick={() => setOpen(true)}
      className="group flex h-9 w-full max-w-[380px] items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-left text-[13px] text-ink-faint shadow-card transition hover:border-line-strong hover:bg-surface"
    >
      <Search size={15} />
      <span className="flex-1 truncate">Search products, customers, documents, screens...</span>
      <span className="kbd">{mac ? '⌘' : 'Ctrl'}</span>
      <span className="kbd -ml-1">K</span>
    </button>
  );
}
