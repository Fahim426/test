import { useEffect, useRef, useState } from 'react';
import {
  Home,
  Landmark,
  Package,
  BarChart3,
  Network,
  Users,
  Wrench,
  ShieldCheck,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Menu,
} from 'lucide-react';
import { ribbonConfig } from '@/ribbon/ribbonConfig';
import { getScreen } from '@/screens/registry';
import { useAuth, hasPermission } from '@/store/auth';
import { useUi } from '@/store/ui';
import { useWorkspaceStore } from '@/store/workspace';
import { useFeatures, screenEnabled, moduleEnabled } from '@/hooks/useFeatures';
import { useApiStatus } from '@/hooks/useCompany';
import './tree.css';
const icons: Record<string, typeof Home> = {
  home: Home,
  finance: Landmark,
  inventory: Package,
  reports: BarChart3,
  dimensions: Network,
  hr: Users,
  amc: Wrench,
  admin: ShieldCheck,
};
export function TreeControls() {
  const s = useUi();
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        data-tour="tree-toggle"
        aria-label="Toggle tree menu"
        aria-pressed={s.treeMenu}
        title="Toggle tree menu"
        className="ss-tree-control"
        onClick={s.toggleTreeMenu}
      >
        <PanelLeftOpen size={17} />
      </button>
      {s.treeMenu && (
        <button
          type="button"
          aria-label="Open navigation"
          className="ss-tree-control md:hidden"
          onClick={() => s.setMobileNavOpen(true)}
        >
          <Menu size={18} />
        </button>
      )}
    </div>
  );
}
export function TreeNavigation() {
  const ui = useUi(),
    features = useFeatures(),
    status = useApiStatus(),
    perms = useAuth((s) => s.user?.permissions),
    ws = useWorkspaceStore();
  const active = ws.tabs.find((t) => t.id === ws.activeId)?.screenId;
  const [fly, setFly] = useState<{ key: string; top: number } | null>(null),
    [top, setTop] = useState(8);
  const popup = useRef<HTMLDivElement>(null),
    last = useRef<string>();
  const allowed = (id: string) => {
    const d = getScreen(id);
    return (
      !!d &&
      screenEnabled(id, features) &&
      (!d.permission ||
        hasPermission(
          perms,
          ...(d.permission.includes(':')
            ? (d.permission.split(':') as [string, string])
            : ([d.permission, 'view'] as [string, string])),
        ))
    );
  };
  const modules = ribbonConfig.filter(
    (m) => moduleEnabled(m.key, features) && m.groups.some((g) => g.items.some((i) => allowed(i.id))),
  );
  const activeModule = modules.find((m) => m.groups.some((g) => g.items.some((i) => i.id === active)))?.key;
  useEffect(() => {
    if (!active) return;
    if (last.current && last.current !== active && activeModule) ui.setModuleOpen(activeModule, true);
    last.current = active;
  }, [active, activeModule]);
  useEffect(() => {
    if (!fly) return;
    const close = (e: MouseEvent) => {
      if (!popup.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-tree-rail]'))
        setFly(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFly(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    const resize = () => setFly(null);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resize);
    };
  }, [fly]);
  useEffect(() => {
    if (fly && popup.current)
      setTop(Math.max(8, Math.min(fly.top, window.innerHeight - popup.current.offsetHeight - 8)));
  }, [fly]);
  useEffect(() => {
    if (!ui.mobileNavOpen) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ui.setMobileNavOpen(false);
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [ui.mobileNavOpen]);
  const pick = (id: string) => {
    ws.open({ screenId: id, title: getScreen(id)?.title });
    setFly(null);
    ui.setMobileNavOpen(false);
  };
  const groups = (m: (typeof ribbonConfig)[number]) =>
    m.groups.map((g) => {
      const items = g.items.filter((i) => allowed(i.id));
      return items.length ? (
        <div key={g.label}>
          <div className="ss-tree-group">{g.label}</div>
          {items.map((i) => {
            const Icon = i.icon;
            return (
              <button
                type="button"
                className={'ss-tree-item ' + (active === i.id ? 'is-active' : '')}
                aria-current={active === i.id ? 'page' : undefined}
                key={i.id}
                onClick={() => pick(i.id)}
              >
                <Icon size={16} />
                <span>{i.label}</span>
              </button>
            );
          })}
        </div>
      ) : null;
    });
  const panel = (collapsed: boolean, mobile = false) => (
    <>
      <header className={collapsed ? 'hidden' : 'ss-tree-head'}>
        <span className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wider">Navigation</span>
        <button
          type="button"
          className="ss-tree-control"
          aria-label={mobile ? 'Close navigation' : collapsed ? 'Expand tree' : 'Collapse tree'}
          onClick={() => (mobile ? ui.setMobileNavOpen(false) : ui.toggleSidebar())}
        >
          {mobile ? <X size={17} /> : collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </header>
      <div className="ss-tree-body">
        {modules.map((m) => {
          const Icon = icons[m.key] || Package;
          return collapsed ? (
            <button
              type="button"
              data-tree-rail
              key={m.key}
              aria-label={m.module}
              title={m.module}
              className={'ss-tree-rail ' + (activeModule === m.key ? 'is-active' : '')}
              onClick={(e) => {
                setTop(Math.max(8, e.currentTarget.getBoundingClientRect().top));
                setFly(fly?.key === m.key ? null : { key: m.key, top: e.currentTarget.getBoundingClientRect().top });
              }}
            >
              <Icon size={20} />
            </button>
          ) : (
            <div key={m.key}>
              <button
                type="button"
                className={'ss-tree-module ' + (activeModule === m.key ? 'is-active' : '')}
                aria-expanded={!!ui.openModules[m.key]}
                onClick={() => ui.toggleModuleOpen(m.key)}
              >
                <Icon size={17} />
                <span>{m.module}</span>
                <ChevronDown size={14} style={{ transform: ui.openModules[m.key] ? 'none' : 'rotate(-90deg)' }} />
              </button>
              {ui.openModules[m.key] && groups(m)}
            </div>
          );
        })}
      </div>
      <footer className="ss-tree-footer">
        <span className={'ss-api-dot ' + (status.isSuccess ? 'online' : '')} />
        {!collapsed && (
          <>
            <span>{status.isSuccess ? 'API online · ' + status.data + ' ms' : 'API offline'}</span>
            <span className="ml-auto">v0.1.0</span>
          </>
        )}
      </footer>
      {collapsed && (
        <button
          type="button"
          className="ss-tree-rail"
          aria-label="Expand tree"
          onClick={() => ui.setSidebarCollapsed(false)}
        >
          <PanelLeftOpen size={18} />
        </button>
      )}
    </>
  );
  if (!ui.treeMenu) return null;
  const m = modules.find((m) => m.key === fly?.key);
  return (
    <>
      <aside
        data-tour="tree"
        className="ss-tree no-print hidden md:flex"
        style={{ width: ui.sidebarCollapsed ? 68 : 264 }}
      >
        {panel(ui.sidebarCollapsed)}
      </aside>
      {fly && m && ui.sidebarCollapsed && (
        <div ref={popup} className="ss-tree-flyout no-print" style={{ top, left: 76 }}>
          <strong>{m.module}</strong>
          {groups(m)}
        </div>
      )}
      {ui.mobileNavOpen && (
        <div className="ss-tree-mobile no-print md:hidden">
          <button
            type="button"
            aria-label="Close navigation backdrop"
            className="ss-tree-backdrop"
            onClick={() => ui.setMobileNavOpen(false)}
          />
          <aside data-tour="tree" role="dialog" aria-modal="true" aria-label="Navigation" className="ss-tree-drawer">
            {panel(false, true)}
          </aside>
        </div>
      )}
    </>
  );
}
