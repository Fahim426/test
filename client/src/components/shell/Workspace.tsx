import { ChevronRight, LayoutDashboard } from 'lucide-react';
import { useWorkspaceStore } from '@/store/workspace';
import { getScreen } from '@/screens/registry';
import { locateScreen } from '@/ribbon/ribbonConfig';
import PlaceholderScreen from '@/screens/PlaceholderScreen';
import { ErrorBoundary } from './ErrorBoundary';
import { useAuth, hasPermission } from '@/store/auth';
import { EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';

export function Breadcrumb() {
  const tab = useWorkspaceStore((s) => s.tabs.find((t) => t.id === s.activeId));
  if (!tab) return <div className="h-6 border-b border-app-border bg-white" />;
  const loc = locateScreen(tab.screenId);
  const crumbs: string[] = [];
  if (loc) crumbs.push(loc.module.charAt(0) + loc.module.slice(1).toLowerCase(), loc.group);
  const def = getScreen(tab.screenId);
  crumbs.push(def?.title ?? loc?.label ?? tab.title);
  if (tab.screenId.endsWith('-form') || tab.params.id !== undefined) {
    if (tab.title && tab.title !== crumbs[crumbs.length - 1]) crumbs.push(tab.title);
  }
  return (
    <div className="no-print flex h-6 shrink-0 items-center gap-1 border-b border-app-border bg-white px-3 text-[11px] text-slate-500">
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={11} className="text-slate-400" />}
          <span className={cn(i === crumbs.length - 1 && 'font-semibold text-slate-700')}>{c}</span>
        </span>
      ))}
    </div>
  );
}

/** Renders every open tab; inactive tabs stay mounted but hidden so unsaved state survives tab switches. */
export function Workspace() {
  const { tabs, activeId } = useWorkspaceStore();
  const perms = useAuth((s) => s.user?.permissions);
  if (tabs.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <EmptyState title="No open screens" hint="Pick a function from the ribbon above." icon={<LayoutDashboard size={32} strokeWidth={1.2} />} />
      </div>
    );
  return (
    <div className="relative min-h-0 flex-1 bg-white">
      {tabs.map((t) => {
        const def = getScreen(t.screenId);
        const Screen = def?.component;
        const allowed = !def?.permission || hasPermission(perms, ...(def.permission.includes(':') ? (def.permission.split(':') as [string, string]) : ([def.permission, 'view'] as [string, string])));
        const props = { params: t.params, tabId: t.id, instanceKey: t.instanceKey };
        return (
          <div key={`${t.id}:${t.refreshKey}`} className={cn('absolute inset-0 overflow-auto', t.id === activeId ? 'block' : 'hidden')}>
            <ErrorBoundary label={t.screenId}>
              {!allowed ? (
                <EmptyState title="Access denied" hint={`You do not have permission to open ${def?.title ?? t.screenId}.`} />
              ) : Screen ? (
                <Screen {...props} />
              ) : (
                <PlaceholderScreen {...props} screenId={t.screenId} />
              )}
            </ErrorBoundary>
          </div>
        );
      })}
    </div>
  );
}
