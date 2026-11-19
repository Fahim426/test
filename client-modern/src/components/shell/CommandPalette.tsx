import { useFeatures, screenEnabled } from '@/hooks/useFeatures';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, FilePlus2, History, Loader2, ScanSearch, Search } from 'lucide-react';
import { useUi } from '@/store/ui';
import { useWorkspaceStore } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { getScreen } from '@/screens/registry';
import { cn } from '@/lib/cn';
import { navEntries, QUICK_GROUPS, titleCase } from './nav';
import { openPartLookup, openSearchItem, useGlobalSearch } from './GlobalSearch';
import type { LucideIcon } from 'lucide-react';
import { FileText } from 'lucide-react';

interface Row {
  key: string;
  section: string;
  label: ReactNode;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
}

const stem = (w: string) => w.replace(/s$/, '');
const score = (hay: string, q: string) => {
  const h = hay.toLowerCase();
  if (h === q) return 100;
  if (h.startsWith(q)) return 80;
  if (h.includes(q)) return 60;
  // every query word (singular/plural tolerant) is a prefix of some word in the label
  const hw = h.split(/[^a-z0-9]+/).map(stem);
  const qw = q.split(/\s+/).filter(Boolean).map(stem);
  if (qw.length && qw.every((w) => hw.some((x) => x.startsWith(w)))) return 70;
  return 0;
};

export function CommandPalette() {
  const { paletteOpen: open, setPaletteOpen: setOpen } = useUi();
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const openTab = useWorkspaceStore((s) => s.open);
  const closed = useWorkspaceStore((s) => s.closed);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const can = usePermission();
  const { debounced, groups, isFetching } = useGlobalSearch(open ? q : '');

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useUi.getState().setPaletteOpen(!useUi.getState().paletteOpen);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => {
    if (open) {
      setQ('');
      setHi(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);

  const close = () => setOpen(false);

  const features = useFeatures();
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const term = q.trim().toLowerCase();
    const goScreen = (id: string, label: string) => () => {
      openTab({ screenId: id, title: getScreen(id)?.title ?? label });
      close();
    };
    const quick = QUICK_GROUPS.flatMap((g) => g.items.map((a) => ({ ...a, group: g.name }))).filter((a) => can(a.perm, 'create'));

    if (!term) {
      // recent screens: open tabs (most recent first) + recently closed
      const recent: { screenId: string; title: string; params: Record<string, unknown> }[] = [];
      for (const t of [...tabs].reverse()) recent.push({ screenId: t.screenId, title: t.title, params: t.params });
      for (const c of closed) recent.push({ screenId: c.screenId, title: c.title, params: c.params });
      const seen = new Set<string>();
      for (const r of recent.filter(r=>screenEnabled(r.screenId,features))) {
        const k = r.screenId + JSON.stringify(r.params);
        if (seen.has(k) || seen.size >= 5) continue;
        seen.add(k);
        out.push({
          key: 'r' + k,
          section: 'Recent',
          label: r.title,
          icon: getScreen(r.screenId)?.icon ?? History,
          run: () => {
            openTab({ screenId: r.screenId, title: r.title, params: r.params });
            close();
          },
        });
      }
      for (const a of quick.slice(0, 8))
        out.push({ key: 'q' + a.form, section: 'Quick create', label: a.label, hint: a.group, icon: FilePlus2, run: () => { openTab({ screenId: a.form, title: a.label }); close(); } });
      for (const e of navEntries.filter(e=>screenEnabled(e.id,features)))
        out.push({ key: 'n' + e.id, section: 'Go to', label: e.label, hint: `${titleCase(e.module)} › ${e.group}`, icon: e.icon, run: goScreen(e.id, e.label) });
      return out;
    }

    const scr = navEntries
      .filter(e=>screenEnabled(e.id,features)).map((e) => ({ e, s: Math.max(score(e.label, term), score(`${e.group} ${e.label}`, term) - 5, score(e.module, term) - 30) }))
      .filter((x) => x.s >= 60)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8);
    for (const { e } of scr) out.push({ key: 'n' + e.id, section: 'Screens', label: e.label, hint: `${titleCase(e.module)} › ${e.group}`, icon: e.icon, run: goScreen(e.id, e.label) });
    for (const a of quick.filter((a) => score(a.label, term) > 0).slice(0, 4))
      out.push({ key: 'q' + a.form, section: 'Quick create', label: a.label, hint: a.group, icon: FilePlus2, run: () => { openTab({ screenId: a.form, title: a.label }); close(); } });
    if(features.partNumbers) out.push({ key: 'part', section: 'Part lookup', label: <>Lookup part number <b>{q.trim()}</b></>, icon: ScanSearch, run: () => { openPartLookup(q.trim()); close(); } });
    if (debounced)
      for (const g of groups)
        for (const it of g.items.slice(0, 6))
          out.push({ key: `s${g.type}${it.id}`, section: g.label, label: it.label, icon: FileText, run: () => { openSearchItem(it); close(); } });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tabs, closed, groups, debounced, features]);

  useEffect(() => setHi(0), [q, groups]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Escape') close();
    else if (e.key === 'Enter') {
      e.preventDefault();
      const v = q.trim();
      if (!v) return rows[hi]?.run();
      // an exact product hit -> part lookup, else the highlighted row (default: part lookup)
      const exact = groups.flatMap((g) => g.items).find((i) => i.type === 'PRODUCT' && (i.no?.toLowerCase() === v.toLowerCase() || String(i.extra?.matchedPartNumber ?? '').toLowerCase() === v.toLowerCase() || String(i.extra?.oemNumber ?? '').toLowerCase() === v.toLowerCase()));
      if (exact && features.partNumbers) {
        openPartLookup(v);
        close();
      } else rows[hi]?.run();
    }
  };

  let last = '';
  return (
    <div className="fixed inset-0 z-[160] flex animate-fade-in items-start justify-center bg-slate-900/40 px-4 pt-[12vh] backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="flex max-h-[68vh] w-[640px] max-w-full animate-pop-in flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop" role="dialog" aria-label="Command palette">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={17} className="text-ink-faint" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search products, manufacturer part numbers, customers, documents, screens…"
            className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
          />
          {isFetching && <Loader2 size={15} className="animate-spin text-brand" />}
          <span className="kbd">Esc</span>
        </div>
        <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-2">
          {rows.map((r, i) => {
            const head = r.section !== last;
            last = r.section;
            const Icon = r.icon;
            return (
              <div key={r.key}>
                {head && <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint first:pt-1">{r.section}</div>}
                <button
                  data-i={i}
                  onMouseMove={() => hi !== i && setHi(i)}
                  onClick={r.run}
                  className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors', i === hi ? 'bg-brand-soft text-brand-ink' : 'text-ink')}
                >
                  <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', i === hi ? 'bg-surface text-brand' : 'bg-surface-3 text-ink-muted')}>
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  {r.hint && <span className="shrink-0 text-xs text-ink-faint">{r.hint}</span>}
                  {i === hi && <CornerDownLeft size={13} className="shrink-0 text-ink-faint" />}
                </button>
              </div>
            );
          })}
          {rows.length === 0 && <div className="p-8 text-center text-sm text-ink-muted">No results</div>}
        </div>
        <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-4 py-2 text-[11px] text-ink-faint">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> navigate</span>
          <span><span className="kbd">↵</span> open</span>
          <span className="ml-auto">Enter on an exact part number opens Part Lookup</span>
        </div>
      </div>
    </div>
  );
}
