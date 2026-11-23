import { BreadcrumbTrail } from './BreadcrumbTrail';
import { useFeatures, screenEnabled } from '@/hooks/useFeatures';
import { LayoutDashboard } from 'lucide-react';
import { useWorkspaceStore } from '@/store/workspace';
import { TabIdContext } from '@/store/tabContext';
import { getScreen } from '@/screens/registry';
import PlaceholderScreen from '@/screens/PlaceholderScreen';
import { ErrorBoundary } from './ErrorBoundary';
import { useAuth, hasPermission } from '@/store/auth';
import { EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';

export function Breadcrumb() {
  return <BreadcrumbTrail />;
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
                <TabIdContext.Provider value={t.id}>
                  <Screen {...props} />
                </TabIdContext.Provider>
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
