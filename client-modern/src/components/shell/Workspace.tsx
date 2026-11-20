import { useFeatures, screenEnabled } from '@/hooks/useFeatures';
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
  if (!tab) return <div className="text-[13px] text-ink-faint">Workspace</div>;
  const loc = locateScreen(tab.screenId);
  const crumbs: string[] = [];
  if (loc) crumbs.push(loc.module.charAt(0) + loc.module.slice(1).toLowerCase(), loc.group);
  const def = getScreen(tab.screenId);
  crumbs.push(def?.title ?? loc?.label ?? tab.title);
  if (tab.screenId.endsWith('-form') || tab.params.id !== undefined) {
    if (tab.title && tab.title !== crumbs[crumbs.length - 1]) crumbs.push(tab.title);
  }
  // collapse a group that repeats the screen name (e.g. Dashboard › Dashboard)
  const shown = crumbs.filter((c, i) => i === 0 || c !== crumbs[i - 1]);
  return (
    <nav className="no-print flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[13px] text-ink-faint" aria-label="Breadcrumb">
      {shown.map((c, i) => (
        <span key={i} className={cn('flex min-w-0 items-center gap-1.5', i < shown.length - 2 && 'hidden md:flex')}>
          {i > 0 && <ChevronRight size={13} className="shrink-0 text-line-strong" />}
          <span className={cn('truncate', i === shown.length - 1 ? 'font-semibold text-ink' : 'hover:text-ink-muted')}>{c}</span>
        </span>
      ))}
    </nav>
  );
}

/** Renders every open tab; inactive tabs stay mounted but hidden so unsaved state survives tab switches. */
export function Workspace() {
  const features = useFeatures();
  const { tabs, activeId } = useWorkspaceStore();
  const perms = useAuth((s) => s.user?.permissions);
  if (tabs.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center bg-canvas">
        <EmptyState title="No open screens" hint="Pick a screen from the sidebar or press Ctrl+K." icon={<LayoutDashboard size={24} strokeWidth={1.5} />} />
      </div>
    );
  return (
    <div className="relative min-h-0 flex-1 bg-canvas">
      {tabs.map((t) => {
        const def = getScreen(t.screenId);
        const Screen = def?.component;
        const allowed = screenEnabled(t.screenId, features) && (!def?.permission || hasPermission(perms, ...(def.permission.includes(':') ? (def.permission.split(':') as [string, string]) : ([def.permission, 'view'] as [string, string]))));
        const props = { params: t.params, tabId: t.id, instanceKey: t.instanceKey };
        return (
          <div data-tour={'screen-'+t.screenId} key={`${t.id}:${t.refreshKey}`} className={cn('absolute inset-0 overflow-auto', t.id === activeId ? 'block' : 'hidden')}>
            <ErrorBoundary label={t.screenId}>
              {!allowed ? (
                <EmptyState title={screenEnabled(t.screenId, features) ? "Access denied" : "Feature switched off"} hint={screenEnabled(t.screenId, features) ? `You do not have permission to open ${def?.title ?? t.screenId}.` : "Enable this feature under Admin > Company & Modules."} />
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
