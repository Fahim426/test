import { ChevronRight } from 'lucide-react';
import { useWorkspaceStore } from '@/store/workspace';
import { getScreen } from '@/screens/registry';
import { docRoutes } from '@/lib/docRoutes';
import { locateScreen, navigationScreenId, ribbonConfig } from '@/ribbon/ribbonConfig';
import { cn } from '@/lib/cn';

interface Crumb { label: string; screenId?: string }

export function BreadcrumbTrail({ classic = false }: { classic?: boolean }) {
  const tab = useWorkspaceStore(s => s.tabs.find(item => item.id === s.activeId));
  const open = useWorkspaceStore(s => s.open);
  if (!tab) return <nav aria-label="Breadcrumb" className="text-xs text-ink-faint">Workspace</nav>;

  const location = locateScreen(tab.screenId);
  const module = ribbonConfig.find(item => item.module === location?.module);
  const definition = getScreen(tab.screenId);
  const crumbs: Crumb[] = [];
  if (module) {
    const moduleId = navigationScreenId(module.key);
    crumbs.push({ label: module.module.charAt(0) + module.module.slice(1).toLowerCase(), screenId: moduleId });
    if (tab.screenId !== moduleId && location?.group) {
      const groupId = navigationScreenId(module.key, location.group);
      crumbs.push({ label: location.group, screenId: groupId });
      if (tab.screenId === groupId) crumbs[crumbs.length - 1].screenId = undefined;
    }
  }

  const parentMenu = module && (
    tab.screenId === navigationScreenId(module.key) ||
    tab.screenId === navigationScreenId(module.key, location?.group)
  );
  if (!parentMenu) {
    const route = Object.values(docRoutes).find(item => item.form === tab.screenId);
    const base = tab.screenId.endsWith('-form') ? tab.screenId.slice(0, -5) : undefined;
    const listId = route?.list ?? (base ? [base + 's', base + 'es', base.replace(/y$/, 'ies'), base].find(id => getScreen(id)) : undefined);
    if (listId && getScreen(listId)) {
      crumbs.push({ label: getScreen(listId)!.title, screenId: listId });
    }
    crumbs.push({ label: tab.title || definition?.title || location?.label || tab.screenId });
  }

  const visible = crumbs.filter((crumb, index) => crumb.label !== crumbs[index + 1]?.label);
  return (
    <nav
      data-tour="breadcrumb"
      aria-label="Breadcrumb"
      className={cn(
        'no-print flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none]',
        classic ? 'h-6 shrink-0 border-b border-app-border bg-white px-3 text-[11px] text-slate-500' : 'text-[13px] text-ink-faint',
      )}
    >
      {visible.map((crumb, index) => {
        const current = index === visible.length - 1;
        return (
          <span key={crumb.screenId ?? index} className="flex shrink-0 items-center gap-1.5">
            {index > 0 && <ChevronRight size={classic ? 11 : 13} aria-hidden="true" className="shrink-0 text-ink-faint" />}
            {!current && crumb.screenId ? (
              <button
                type="button"
                title={'Open ' + crumb.label}
                onClick={() => open({ screenId: crumb.screenId! })}
                className="rounded px-0.5 py-0.5 text-inherit underline-offset-4 transition hover:text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >{crumb.label}</button>
            ) : (
              <span aria-current={current ? 'page' : undefined} className={current ? 'font-semibold text-ink' : undefined}>{crumb.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
