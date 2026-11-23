import './sidebar-colors.css';
import { useProductConfig, moduleEnabled, screenEnabled } from '@/hooks/useProductConfig';
import { usePermission } from '@/store/auth';
import { useEffect, useRef, useState } from 'react';
import { Boxes, ChevronDown, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { ribbonConfig, locateScreen, RibbonItem, RibbonModule } from '@/ribbon/ribbonConfig';
import { useUi } from '@/store/ui';
import { useWorkspaceStore } from '@/store/workspace';
import { getScreen } from '@/screens/registry';
import { useApiStatus, useCompany } from '@/hooks/useCompany';
import { cn } from '@/lib/cn';
import { MODULE_ICONS } from './nav';

function useActiveScreen() {
  return useWorkspaceStore((s) => s.tabs.find((t) => t.id === s.activeId)?.screenId);
}
/** The module whose items contain the active screen. */
function activeModuleKey(screenId?: string): string | undefined {
  if (!screenId) return undefined;
  const loc = locateScreen(screenId);
  return ribbonConfig.find((m) => m.module === loc?.module)?.key;
}

function NavItem({ item, active, onPick }: { item: RibbonItem; active: boolean; onPick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      data-active={active}
      onClick={onPick}
      title={item.label}
      className={cn(
        'ss-sidebar-item group relative flex h-8 w-full items-center gap-2.5 rounded-lg pl-3 pr-2 text-left text-[13px] transition',
        active ? 'bg-brand-soft font-medium text-brand-ink' : 'text-ink-muted hover:bg-surface-3 hover:text-ink',
      )}
    >
      {active && <span className="ss-sidebar-active-bar absolute left-0 top-1.5 h-5 w-[3px] rounded-r-full bg-brand" />}
      <Icon size={16} strokeWidth={1.8} className={cn('shrink-0', active ? 'text-brand' : 'text-ink-faint group-hover:text-ink-muted')} />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

/** groups of a module (a group with a single item of the same name is rendered as a plain item). */
function ModuleItems({ mod, onPick, activeScreen }: { mod: RibbonModule; onPick: (it: RibbonItem) => void; activeScreen?: string }) {
  return (
    <div className="flex flex-col gap-0.5 pb-2 pl-3.5 pr-1">
      <div className="ss-sidebar-branch flex flex-col gap-0.5 border-l border-line pl-1.5">
        {mod.groups.map((g) => {
          const plain = g.items.length === 1 && g.items[0].label === g.label;
          return (
            <div key={g.label} className="flex flex-col gap-0.5">
              {!plain && <div className="ss-sidebar-caption px-3 pb-0.5 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">{g.label}</div>}
              {g.items.map((it) => (
                <NavItem key={g.label + it.id} item={it} active={activeScreen === it.id} onPick={() => onPick(it)} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SidebarBody({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const features = useProductConfig().config.features;
  const can = usePermission();
  const modules = ribbonConfig.filter(m => moduleEnabled(m.key, features)).map(m => ({ ...m, groups: m.groups.map(g => ({ ...g, items: g.items.filter(it => {
    if (!screenEnabled(it.id, features)) return false;
    const permission = getScreen(it.id)?.permission;
    if (!permission) return true;
    const [module, action = 'view'] = permission.split(':');
    return can(module, action);
  }) })).filter(g => g.items.length) })).filter(m => m.groups.length);
  const { openModules, toggleModuleOpen, setModuleOpen, setSidebarCollapsed } = useUi();
  const open = useWorkspaceStore((s) => s.open);
  const activeScreen = useActiveScreen();
  const [fly, setFly] = useState<{ key: string; top: number } | null>(null);
  const flyRef = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // expand the module of the active screen
  const am = activeModuleKey(activeScreen);
  const firstRun = useRef(true);
  useEffect(() => {
    // all groups start collapsed; afterwards follow the active screen's module
    if (!am) return;
    if (firstRun.current) { firstRun.current = false; return; }
    if (am && !collapsed) setModuleOpen(am, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [am, collapsed]);

  useEffect(() => {
    if (!fly) return;
    const h = (e: MouseEvent) => flyRef.current && !flyRef.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-rail]') && setFly(null);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [fly]);

  const pick = (it: RibbonItem) => {
    open({ screenId: it.id, title: getScreen(it.id)?.title ?? it.label });
    setFly(null);
    onNavigate?.();
  };

  if (collapsed) {
    const flyMod = modules.find((m) => m.key === fly?.key);
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto px-2 pt-3">
          {modules.map((m) => {
            const Icon = MODULE_ICONS[m.key];
            const on = am === m.key;
            return (
              <button
                key={m.key}
                data-rail
                data-module={m.key}
                data-current={on || fly?.key === m.key}
                aria-label={m.module}
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setFly((f) => (f?.key === m.key ? null : { key: m.key, top: Math.max(8, Math.min(r.top, window.innerHeight - Math.min(360, window.innerHeight * 0.8))) }));
                }}
                className={cn('ss-sidebar-module ss-sidebar-rail group relative flex h-10 w-10 items-center justify-center rounded-xl transition', on || fly?.key === m.key ? 'bg-brand-soft text-brand' : 'text-ink-muted hover:bg-surface-3 hover:text-ink')}
              >
                <Icon size={19} strokeWidth={1.8} />
                {!fly && <span className="pointer-events-none absolute left-full z-50 ml-3 hidden whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-surface shadow-pop group-hover:block">{m.module}</span>}
              </button>
            );
          })}
        </div>
        {flyMod && fly && (
          <div
            ref={flyRef}
            data-module={flyMod.key}
            style={{ top: Math.max(8, fly.top), left: 76, maxHeight: Math.min(window.innerHeight * 0.8, window.innerHeight - Math.max(8, fly.top) - 8) }}
            className="ss-sidebar-module fixed z-[140] max-h-[80vh] w-[250px] animate-pop-in overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-pop"
          >
            <div className="ss-sidebar-caption px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-brand">{flyMod.module}</div>
            <ModuleItems mod={flyMod} onPick={pick} activeScreen={activeScreen} />
          </div>
        )}
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="mx-auto mb-1 mt-2 flex h-9 w-9 items-center justify-center rounded-lg text-ink-faint transition hover:bg-surface-3 hover:text-ink"
          title="Expand sidebar" aria-label="Expand sidebar"
        >
          <PanelLeftOpen size={17} />
        </button>
      </>
    );
  }

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
      {modules.map((m) => {
        const Icon = MODULE_ICONS[m.key];
        const isOpen = !!openModules[m.key];
        const hasActive = am === m.key;
        return (
          <div key={m.key} data-module={m.key} data-open={isOpen} data-current={hasActive} className="ss-sidebar-module mb-0.5">
            <button
              onClick={() => toggleModuleOpen(m.key)}
              className={cn(
                'ss-sidebar-module-button flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12px] font-semibold uppercase tracking-wider transition hover:bg-surface-3',
                hasActive ? 'text-brand' : 'text-ink-muted',
              )}
            >
              <span className="ss-sidebar-module-icon"><Icon size={16} strokeWidth={1.9} /></span>
              <span className="flex-1">{m.module}</span>
              <ChevronDown size={14} className={cn('text-ink-faint transition-transform duration-200', !isOpen && '-rotate-90')} />
            </button>
            {isOpen && <ModuleItems mod={m} onPick={pick} activeScreen={activeScreen} />}
          </div>
        );
      })}
    </div>
  );
}

export function Logo({ size = 34 }: { size?: number }) {
  const company = useCompany();
  const { config } = useProductConfig();
  const logo = (typeof company.data?.logo === 'string' ? company.data.logo : null) || config.logoDataUri;
  if (logo)
    return (
      <span style={{ width: size * 1.7, height: size }} className="flex shrink-0 items-center justify-center overflow-hidden rounded">
        <img src={logo} alt="" className="h-full w-full object-contain" />
      </span>
    );
  return (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-brand-600 to-violet-600 text-white shadow-[0_4px_12px_-2px_rgb(99_102_241/0.55),inset_0_1px_0_rgb(255_255_255/0.25)]"
    >
      <Boxes size={size * 0.55} strokeWidth={2} />
    </span>
  );
}

function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  const status = useApiStatus();
  const online = status.isSuccess;
  const dot = <span className={cn('h-2 w-2 shrink-0 rounded-full', status.isLoading ? 'bg-warning' : online ? 'bg-success' : 'bg-danger')} />;
  if (collapsed) return <div className="flex justify-center pb-1" title={online ? 'API online' : 'API offline'}>{dot}</div>;
  return (
    <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[11px] text-ink-faint">
      {dot}
      <span>{status.isLoading ? 'Checking API' : online ? `API online · ${status.data} ms` : 'API offline'}</span>
      <span className="ml-auto">v0.1</span>
    </div>
  );
}

export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  const { mobileNavOpen, setMobileNavOpen } = useUi();
  const company = useCompany();

  const header = (isCollapsed: boolean, mobile?: boolean) => (
    <div className={cn('flex min-h-14 shrink-0 items-center gap-3 border-b border-line py-2', isCollapsed ? 'justify-center px-2' : 'px-4')}>
      <Logo />
      {!isCollapsed && (
        <div className="min-w-0 flex-1 leading-tight">
          <div className="line-clamp-2 break-words text-[14px] font-semibold leading-snug text-ink" title={company.data?.name ?? 'Business ERP'}>{company.data?.name ?? 'FlixERP'}</div>
          <div className="truncate text-[11px] text-ink-faint">{(company.data?.tagline as string | undefined) || 'ERP workspace'}</div>
        </div>
      )}
      {!isCollapsed && !mobile && (
        <button onClick={toggle} title="Collapse sidebar" aria-label="Collapse sidebar" className="rounded-lg p-1.5 text-ink-faint transition hover:bg-surface-3 hover:text-ink">
          <PanelLeftClose size={16} />
        </button>
      )}
      {mobile && (
        <button aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-3">
          <X size={16} />
        </button>
      )}
    </div>
  );

  return (
    <>
      <aside data-tour="tree" className={cn('no-print relative z-30 hidden shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 md:flex', collapsed ? 'w-[68px]' : 'w-[264px]')}>
        {header(collapsed)}
        <SidebarBody collapsed={collapsed} />
        <SidebarFooter collapsed={collapsed} />
      </aside>
      {mobileNavOpen && (
        <div className="fixed inset-0 z-[110] md:hidden">
          <div className="absolute inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setMobileNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[280px] animate-slide-in flex-col bg-surface shadow-pop">
            {header(false, true)}
            <SidebarBody collapsed={false} onNavigate={() => setMobileNavOpen(false)} />
            <SidebarFooter collapsed={false} />
          </aside>
        </div>
      )}
    </>
  );
}
