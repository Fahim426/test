import { useFeatures, screenEnabled, moduleEnabled } from '@/hooks/useFeatures';
import { useEffect } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { ribbonConfig, locateScreen, RibbonItem } from '@/ribbon/ribbonConfig';
import { useUi } from '@/store/ui';
import { useWorkspaceStore } from '@/store/workspace';
import { getScreen } from '@/screens/registry';
import { cn } from '@/lib/cn';
import { MODULE_ICONS } from './nav';

function useActiveScreen() {
  return useWorkspaceStore((s) => s.tabs.find((t) => t.id === s.activeId)?.screenId);
}

/** HOME | FINANCE | INVENTORY | ... module tabs with icons. Follows the active workspace tab. */
export function ModuleTabs() {
  const features = useFeatures();
  const activeModule = useUi((s) => s.activeModule);
  const setModule = useUi((s) => s.setModule);
  const ribbonCollapsed = useUi((s) => s.ribbonCollapsed);
  const toggleRibbon = useUi((s) => s.toggleRibbon);
  const screenId = useActiveScreen();

  // switch the module tab when the active screen belongs to another module
  useEffect(() => {
    if (!screenId) return;
    const loc = locateScreen(screenId);
    const key = ribbonConfig.find((m) => m.module === loc?.module)?.key;
    if (key) setModule(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenId]);

  return (
    <nav className="no-print flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Modules" data-tour="modules">
      {ribbonConfig.filter(m=>moduleEnabled(m.key,features)).map((m) => {
        const Icon = MODULE_ICONS[m.key];
        const on = activeModule === m.key;
        return (
          <button
            key={m.key}
            onClick={() => {
              if (on) toggleRibbon();
              else {
                setModule(m.key);
                if (ribbonCollapsed) toggleRibbon();
              }
            }}
            className={cn(
              'relative flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold uppercase tracking-wide transition',
              on ? 'bg-brand-soft text-brand-ink' : 'text-ink-muted hover:bg-surface-3 hover:text-ink',
            )}
          >
            <Icon size={17} strokeWidth={1.9} className={on ? 'text-brand' : 'text-ink-faint'} />
            {m.module}
            {on && <span className="absolute inset-x-3 -bottom-[7px] h-[2px] rounded-full bg-brand" />}
          </button>
        );
      })}
    </nav>
  );
}

function MenuButton({ item, active, onPick }: { item: RibbonItem; active: boolean; onPick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onPick}
      title={item.label}
      className={cn(
        'group flex w-[78px] shrink-0 flex-col items-center gap-1 rounded-xl px-1.5 py-1.5 text-center transition',
        active ? 'bg-brand-soft' : 'hover:bg-surface-3',
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg transition',
          active ? 'bg-brand text-white dark:text-[#0c0d14]' : 'bg-surface-2 text-brand group-hover:bg-brand-soft',
        )}
      >
        <Icon size={19} strokeWidth={1.8} />
      </span>
      <span className={cn('line-clamp-2 w-full text-[11px] leading-[13px]', active ? 'font-semibold text-brand-ink' : 'text-ink-muted group-hover:text-ink')}>{item.label}</span>
    </button>
  );
}

/** Ribbon-style strip: grouped icon buttons of the selected module. */
export function MenuStrip() {
  const features = useFeatures();
  const activeModule = useUi((s) => s.activeModule);
  const collapsed = useUi((s) => s.ribbonCollapsed);
  const toggleRibbon = useUi((s) => s.toggleRibbon);
  const open = useWorkspaceStore((s) => s.open);
  const activeScreen = useActiveScreen();
  const mod = ribbonConfig.find((m) => m.key === activeModule && moduleEnabled(m.key,features)) ?? ribbonConfig[0];

  if (collapsed)
    return (
      <div className="no-print flex h-5 shrink-0 items-center justify-center border-b border-line bg-surface">
        <button onClick={toggleRibbon} className="flex h-4 w-12 items-center justify-center rounded text-ink-faint hover:bg-surface-3 hover:text-ink" title="Show menu">
          <ChevronDown size={13} />
        </button>
      </div>
    );

  return (
    <div data-tour="ribbon" className="no-print relative shrink-0 border-b border-line bg-surface">
      <div className="flex items-stretch overflow-x-auto px-3 pb-1 pt-1.5 [scrollbar-width:thin]">
        {mod.groups.map((g, gi) => (
          <div key={g.label} className={cn('flex shrink-0 flex-col px-1.5', gi > 0 && 'border-l border-line')}>
            <div className="flex flex-1 items-start gap-0.5">
              {g.items.filter(it=>screenEnabled(it.id,features)).map((it) => (
                <MenuButton key={it.id} item={it} active={activeScreen === it.id} onPick={() => open({ screenId: it.id, title: getScreen(it.id)?.title ?? it.label })} />
              ))}
            </div>
            <div className="pt-0.5 text-center text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{g.label}</div>
          </div>
        ))}
      </div>
      <button onClick={toggleRibbon} className="absolute bottom-0.5 right-2 flex h-5 w-6 items-center justify-center rounded text-ink-faint hover:bg-surface-3 hover:text-ink" title="Hide menu">
        <ChevronUp size={13} />
      </button>
    </div>
  );
}
