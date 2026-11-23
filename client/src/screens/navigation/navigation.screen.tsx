import { ChevronRight } from 'lucide-react';
import { ribbonConfig, navigationScreenId, type RibbonModule } from '@/ribbon/ribbonConfig';
import { getScreen } from '@/screens/registry';
import type { ScreenDef } from '@/screens/types';
import { useFeatures, moduleEnabled, screenEnabled } from '@/hooks/useFeatures';
import { usePermission } from '@/store/auth';
import { useWorkspaceStore } from '@/store/workspace';

function NavigationMenu({ module, group }: { module: RibbonModule; group?: string }) {
  const features = useFeatures();
  const can = usePermission();
  const open = useWorkspaceStore(s => s.open);
  const groups = module.groups
    .filter(item => !group || item.label === group)
    .map(item => ({ ...item, items: item.items.filter(screen => {
      if (!screenEnabled(screen.id, features)) return false;
      const required = getScreen(screen.id)?.permission;
      if (!required) return true;
      const [permission, action = 'view'] = required.split(':');
      return can(permission, action);
    }) }))
    .filter(item => item.items.length > 0);
  const title = group || module.module.charAt(0) + module.module.slice(1).toLowerCase();

  return (
    <div className="min-h-full bg-surface p-5">
      <h1 className="mb-5 text-xl font-semibold text-ink">{title}</h1>
      {!moduleEnabled(module.key, features) ? (
        <p role="status" className="text-sm text-ink-muted">This module is switched off in Company &amp; Modules.</p>
      ) : !groups.length ? (
        <p role="status" className="text-sm text-ink-muted">There are no screens available for your role in this menu.</p>
      ) : (
        <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
          {groups.map(section => (
            <section key={section.label}>
              {!group && (
                <h2 className="mb-2 text-sm font-semibold text-ink">
                  <button type="button" onClick={() => open({ screenId: navigationScreenId(module.key, section.label) })} className="rounded underline-offset-4 hover:text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                    {section.label}
                  </button>
                </h2>
              )}
              <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {section.items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => open({ screenId: item.id, title: getScreen(item.id)?.title ?? item.label })}
                    className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left text-[13px] text-ink transition hover:bg-brand-soft hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-brand"
                  >
                    <item.icon size={18} aria-hidden="true" className="shrink-0 text-brand" />
                    <span className="flex-1">{item.label}</span>
                    <ChevronRight size={15} aria-hidden="true" className="text-ink-faint" />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

const screens = new Map<string, ScreenDef>();
for (const module of ribbonConfig) {
  for (const group of [undefined, ...module.groups.map(item => item.label)]) {
    const id = navigationScreenId(module.key, group);
    screens.set(id, {
      id,
      title: group || module.module.charAt(0) + module.module.slice(1).toLowerCase(),
      icon: module.groups[0]?.items[0]?.icon,
      component: () => <NavigationMenu module={module} group={group} />,
    });
  }
}
export default [...screens.values()];
