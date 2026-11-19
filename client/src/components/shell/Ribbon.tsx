import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ribbonConfig, RibbonItem } from '@/ribbon/ribbonConfig';
import { useUi } from '@/store/ui';
import { useWorkspaceStore } from '@/store/workspace';
import { getScreen } from '@/screens/registry';
import { cn } from '@/lib/cn';
import { useFeatures } from '@/hooks/useFeatures';

function RibbonButton({ item, active, onClick, small }: { item: RibbonItem; active: boolean; onClick: () => void; small?: boolean }) {
  const Icon = item.icon;
  if (small)
    return (
      <button
        onClick={onClick}
        title={item.label}
        className={cn(
          'flex h-6 w-[138px] items-center gap-1.5 rounded border px-1.5 text-left text-slate-700',
          active ? 'border-brand/50 bg-brand-mid' : 'border-transparent hover:border-brand/30 hover:bg-brand-light',
        )}
      >
        <Icon size={14} strokeWidth={1.7} className="shrink-0 text-brand" />
        <span className="truncate text-[11px]">{item.label}</span>
      </button>
    );
  return (
    <button
      onClick={onClick}
      title={item.label}
      className={cn(
        'flex h-[72px] w-[68px] shrink-0 flex-col items-center justify-start gap-1 rounded border px-0.5 pt-1.5 text-slate-700',
        active ? 'border-brand/50 bg-brand-mid' : 'border-transparent hover:border-brand/30 hover:bg-brand-light',
      )}
    >
      <Icon size={26} strokeWidth={1.4} className="text-brand" />
      <span className="line-clamp-2 break-words text-center text-[11px] leading-[12px]">{item.label}</span>
    </button>
  );
}

function RibbonPanel({ moduleKey, onPick }: { moduleKey: string; onPick?: () => void }) {
  const mod = ribbonConfig.find((m) => m.key === moduleKey) ?? ribbonConfig[0];
  const open = useWorkspaceStore((s) => s.open);
  const activeScreen = useWorkspaceStore((s) => s.tabs.find((t) => t.id === s.activeId)?.screenId);
  const features = useFeatures();
  const pick = (it: RibbonItem) => {
    open({ screenId: it.id, title: getScreen(it.id)?.title ?? it.label });
    onPick?.();
  };
  const filterItem = (it: RibbonItem) => {
    if (it.id === 'vehicle-compatibility' && !features.vehicleCompatibility) return false;
    return true;
  };
  return (
    <div className="flex h-[98px] items-stretch overflow-x-auto border-b border-app-border bg-white px-1">
      {mod.groups.map((g, gi) => {
        const visibleItems = g.items.filter(filterItem);
        if (visibleItems.length === 0) return null;
        return (
          <div key={g.label} className={cn('flex shrink-0 flex-col border-app-border px-1.5 pb-0.5 pt-1', gi > 0 && 'border-l')}>
            {visibleItems.length > 6 ? (
              <div className="grid flex-1 grid-flow-col grid-rows-3 content-start gap-x-0.5">
                {visibleItems.map((it) => (
                  <RibbonButton small key={it.id} item={it} active={activeScreen === it.id} onClick={() => pick(it)} />
                ))}
              </div>
            ) : (
              <div className="flex flex-1 gap-0.5">
                {visibleItems.map((it) => (
                  <RibbonButton key={it.id} item={it} active={activeScreen === it.id} onClick={() => pick(it)} />
                ))}
              </div>
            )}
            <div className="text-center text-[10px] leading-3 text-slate-500">{g.label}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Module tab strip + ribbon panel (collapsible; when collapsed, clicking a tab peeks the ribbon). */
export function Ribbon() {
  const { activeModule, setModule, ribbonCollapsed, toggleRibbon } = useUi();
  const features = useFeatures();
  const [peek, setPeek] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const visibleModules = ribbonConfig.filter((m) => {
    if (m.key === 'amc' && !features.amc) return false;
    if (m.key === 'hr' && !features.hr) return false;
    return true;
  });

  useEffect(() => {
    if (!peek) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPeek(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [peek]);

  return (
    <div ref={ref} className="no-print relative z-30 shrink-0">
      <div className="flex h-7 items-end border-b border-app-border bg-app-head pl-1">
        {visibleModules.map((m) => {
          const on = m.key === activeModule;
          return (
            <button
              key={m.key}
              onClick={() => {
                setModule(m.key);
                if (ribbonCollapsed) setPeek(on ? !peek : true);
              }}
              className={cn(
                'h-[26px] border border-b-0 px-4 text-[12px] font-semibold tracking-wide',
                on ? 'border-app-border bg-white text-brand' : 'border-transparent text-slate-600 hover:bg-slate-200',
              )}
            >
              {m.module}
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          onClick={() => {
            toggleRibbon();
            setPeek(false);
          }}
          title={ribbonCollapsed ? 'Expand ribbon' : 'Collapse ribbon'}
          className="mb-0.5 mr-1 rounded p-1 text-slate-500 hover:bg-slate-200"
        >
          {ribbonCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
      {!ribbonCollapsed && <RibbonPanel moduleKey={activeModule} />}
      {ribbonCollapsed && peek && (
        <div className="absolute left-0 right-0 top-full shadow-md">
          <RibbonPanel moduleKey={activeModule} onPick={() => setPeek(false)} />
        </div>
      )}
    </div>
  );
}
