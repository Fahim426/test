import { MouseEvent, useEffect, useRef, useState } from 'react';
import { XCircle, Pin, RotateCcw, Star, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Tab, useWorkspaceStore } from '@/store/workspace';
import { getScreen } from '@/screens/registry';
import { useFavorites, encodeRoute } from '@/hooks/useFavorites';
import { cn } from '@/lib/cn';

interface Menu {
  x: number;
  y: number;
  tab: Tab;
}

function ContextMenu({ menu, onClose }: { menu: Menu; onClose: () => void }) {
  const ws = useWorkspaceStore();
  const t = menu.tab;
  useEffect(() => {
    const h = () => onClose();
    window.addEventListener('mousedown', h);
    window.addEventListener('blur', h);
    return () => {
      window.removeEventListener('mousedown', h);
      window.removeEventListener('blur', h);
    };
  }, [onClose]);
  const items: { label: string; run: () => void; disabled?: boolean; sep?: boolean }[] = [
    { label: 'Close', run: () => ws.close(t.id) },
    { label: 'Close Others', run: () => ws.closeOthers(t.id), disabled: ws.tabs.length < 2 },
    { label: 'Close All', run: () => ws.closeAll() },
    { label: t.pinned ? 'Unpin' : 'Pin', run: () => ws.togglePin(t.id), sep: true },
    { label: 'Refresh', run: () => ws.refresh(t.id) },
    { label: 'Duplicate', run: () => ws.duplicate(t.id) },
    { label: 'Reopen Closed Tab', run: () => ws.reopenLast(), disabled: ws.closed.length === 0, sep: true },
  ];
  return (
    <div
      className="fixed z-[150] min-w-[160px] border border-slate-400 bg-white py-0.5 shadow-lg"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((it) => (
        <div key={it.label}>
          {it.sep && <div className="my-0.5 h-px bg-app-border" />}
          <button
            disabled={it.disabled}
            className="block w-full px-3 py-1 text-left text-[12px] hover:bg-brand-light disabled:text-slate-400 disabled:hover:bg-transparent"
            onClick={() => {
              it.run();
              onClose();
            }}
          >
            {it.label}
          </button>
        </div>
      ))}
    </div>
  );
}

export function TabBar() {
  const { tabs, activeId, closed, activate, close, reopenLast, togglePin, move } = useWorkspaceStore();
  const [menu, setMenu] = useState<Menu | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<number | null>(null);
  const { favorites, add, remove } = useFavorites();

  const active = tabs.find((t) => t.id === activeId);
  const favRoute = active ? encodeRoute(active.screenId, active.params) : '';
  const fav = favorites.find((f) => f.route === favRoute);

  useEffect(() => {
    if (!activeId) return;
    scroller.current?.querySelector<HTMLElement>(`[data-tab="${activeId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, tabs.length]);

  const scrollBy = (d: number) => scroller.current?.scrollBy({ left: d, behavior: 'smooth' });

  return (
    <div className="no-print flex h-8 shrink-0 items-end border-b border-app-border bg-app-bg pl-1">
      <button className="h-7 px-0.5 text-slate-500 hover:text-brand" onClick={() => scrollBy(-250)} title="Scroll tabs left">
        <ChevronLeft size={14} />
      </button>
      <div
        ref={scroller}
        className="flex min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(e) => scroller.current && (scroller.current.scrollLeft += e.deltaY)}
      >
        {tabs.map((t, idx) => {
          const Icon = getScreen(t.screenId)?.icon;
          const on = t.id === activeId;
          return (
            <div
              key={t.id}
              data-tab={t.id}
              draggable
              onDragStart={() => (dragFrom.current = idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragFrom.current !== null && dragFrom.current !== idx) move(dragFrom.current, idx);
                dragFrom.current = null;
              }}
              onClick={() => activate(t.id)}
              onMouseDown={(e: MouseEvent) => {
                if (e.button === 1) {
                  e.preventDefault();
                  if (!t.pinned) close(t.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: Math.min(e.clientX, window.innerWidth - 180), y: e.clientY, tab: t });
              }}
              className={cn(
                'group relative flex h-[27px] max-w-[200px] shrink-0 cursor-default select-none items-center gap-1.5 border border-b-0 px-2 text-[12px]',
                on ? 'z-10 border-app-border border-t-brand bg-white font-semibold text-slate-900 [border-top-width:2px]' : 'border-transparent text-slate-600 hover:bg-slate-200',
              )}
              title={t.title}
            >
              {t.pinned ? <Pin size={11} className="shrink-0 text-brand" /> : Icon ? <Icon size={12} className="shrink-0 text-slate-500" /> : null}
              <span className="truncate">{t.title}</span>
              {t.dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" />}
              {!t.pinned && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    close(t.id);
                  }}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-300 hover:text-slate-800"
                  aria-label="Close tab"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button className="h-7 px-0.5 text-slate-500 hover:text-brand" onClick={() => scrollBy(250)} title="Scroll tabs right">
        <ChevronRight size={14} />
      </button>
      <div className="flex h-7 items-center gap-0.5 border-l border-app-border px-1.5">
        <button type="button" disabled={tabs.length === 0} onClick={() => useWorkspaceStore.getState().closeAll()} title="Close all tabs" aria-label="Close all tabs" className="rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-40"><XCircle size={14} /></button>
        <button
          disabled={!active}
          onClick={() =>
            active &&
            (fav ? remove.mutate(fav.id) : add.mutate({ label: active.title, route: favRoute }))
          }
          title={fav ? 'Remove from favorites' : 'Add this screen to favorites'}
          className="rounded p-1 hover:bg-slate-200 disabled:opacity-40"
        >
          <Star size={14} className={fav ? 'fill-amber-400 text-amber-500' : 'text-slate-500'} />
        </button>
        <button
          disabled={!active}
          onClick={() => active && togglePin(active.id)}
          title={active?.pinned ? 'Unpin tab' : 'Pin tab'}
          className="rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-40"
        >
          <Pin size={14} className={active?.pinned ? 'text-brand' : ''} />
        </button>
        <button
          disabled={closed.length === 0}
          onClick={reopenLast}
          title="Reopen recently closed tab (Ctrl+Shift+T)"
          className="rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-40"
        >
          <RotateCcw size={14} />
        </button>
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
