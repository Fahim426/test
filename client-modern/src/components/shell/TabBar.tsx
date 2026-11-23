import { MouseEvent, useEffect, useRef, useState } from 'react';
import { MinusCircle, Pin, RotateCcw, Star, X, XCircle, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
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
      className="fixed z-[150] min-w-[180px] animate-pop-in rounded-xl border border-line bg-surface p-1 shadow-pop"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((it) => (
        <div key={it.label}>
          {it.sep && <div className="my-1 h-px bg-line" />}
          <button
            disabled={it.disabled}
            className="menu-item"
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

const barBtn = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint transition hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent';

export function TabBar() {
  const { tabs, activeId, closed, activate, close, reopenLast, togglePin, move, closeAll, closeOthers } = useWorkspaceStore();
  const askDirty = (list: typeof tabs) => !list.some((t) => t.dirty) || window.confirm('Some open windows have unsaved changes. Close them anyway?');
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
    <div data-tour="tabs" className="no-print flex h-12 shrink-0 items-center gap-1 border-b border-line bg-canvas px-3">
      <button className={barBtn} onClick={() => scrollBy(-250)} title="Scroll tabs left">
        <ChevronLeft size={15} />
      </button>
      <div
        ref={scroller}
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(e) => scroller.current && (scroller.current.scrollLeft += e.deltaY)}
      >
        {tabs.map((t, idx) => {
          const Icon = getScreen(t.screenId)?.icon ?? FileText;
          const on = t.id === activeId;
          return (
            <div
              key={t.id}
              data-tab={t.id}
              data-tour={on ? 'active-tab' : undefined}
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
                setMenu({ x: Math.min(e.clientX, window.innerWidth - 200), y: e.clientY, tab: t });
              }}
              className={cn(
                'group relative flex h-8 max-w-[210px] shrink-0 cursor-pointer select-none items-center gap-2 rounded-lg border px-2.5 text-[13px] transition-all duration-150',
                on
                  ? 'border-line bg-surface font-medium text-ink shadow-card'
                  : 'border-transparent text-ink-muted hover:bg-surface-3/70 hover:text-ink',
              )}
              title={t.title}
            >
              {t.pinned ? (
                <Pin size={13} className="shrink-0 text-brand" />
              ) : (
                <Icon size={14} className={cn('shrink-0', on ? 'text-brand' : 'text-ink-faint')} />
              )}
              <span className="truncate">{t.title}</span>
              {t.dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-warning" title="Unsaved changes" />}
              {!t.pinned && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    close(t.id);
                  }}
                  className={cn('-mr-1 rounded-md p-0.5 text-ink-faint transition hover:bg-surface-3 hover:text-ink', on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
                  aria-label="Close tab"
                >
                  <X size={13} />
                </button>
              )}
              {on && <span className="absolute inset-x-3 -bottom-[7px] h-[2px] rounded-full bg-brand" />}
            </div>
          );
        })}
      </div>
      <button className={barBtn} onClick={() => scrollBy(250)} title="Scroll tabs right">
        <ChevronRight size={15} />
      </button>
      <div className="ml-1 flex h-8 items-center gap-0.5 border-l border-line pl-2">
        <button type="button" disabled={tabs.length === 0} onClick={() => useWorkspaceStore.getState().closeAll()} title="Close all tabs" aria-label="Close all tabs" className={barBtn}><XCircle size={15} /></button>
        <button
          disabled={!active}
          onClick={() => active && (fav ? remove.mutate(fav.id) : add.mutate({ label: active.title, route: favRoute }))}
          title={fav ? 'Remove from favorites' : 'Add this screen to favorites'}
          className={barBtn}
        >
          <Star size={15} className={fav ? 'fill-amber-400 text-amber-500' : ''} />
        </button>
        <button disabled={!active} onClick={() => active && togglePin(active.id)} title={active?.pinned ? 'Unpin tab' : 'Pin tab'} className={barBtn}>
          <Pin size={15} className={active?.pinned ? 'text-brand' : ''} />
        </button>
        <button
          disabled={tabs.filter((t) => t.id !== activeId && !t.pinned).length === 0}
          onClick={() => active && askDirty(tabs.filter((t) => t.id !== active.id && !t.pinned)) && closeOthers(active.id)}
          title="Close all other windows (pinned tabs stay)"
          className={barBtn}
        >
          <MinusCircle size={15} />
        </button>
        <button
          disabled={tabs.filter((t) => !t.pinned).length === 0}
          onClick={() => askDirty(tabs.filter((t) => !t.pinned)) && closeAll()}
          title="Close all windows (pinned tabs stay)"
          className={barBtn}
        >
          <XCircle size={15} />
        </button>
        <button disabled={closed.length === 0} onClick={reopenLast} title="Reopen recently closed tab (Ctrl+Shift+T)" className={barBtn}>
          <RotateCcw size={15} />
        </button>
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
