import { FilePlus2, Zap, ShoppingCart, ShoppingBag, Landmark, Package, Network, type LucideIcon } from 'lucide-react';
import { usePermission } from '@/store/auth';
import { useOpenScreen } from '@/store/workspace';
import { PageHeader } from '@/components/ui';
import { QUICK_GROUPS } from '@/components/shell/nav';
import type { ScreenDef } from '@/screens/types';

const ICONS: Record<string, LucideIcon> = { Sales: ShoppingCart, Purchase: ShoppingBag, Finance: Landmark, Inventory: Package, Dimensions: Network };
const TONE: Record<string, string> = {
  Sales: 'bg-brand-soft text-brand',
  Purchase: 'bg-info-soft text-info',
  Finance: 'bg-success-soft text-success',
  Inventory: 'bg-warning-soft text-warning',
  Dimensions: 'bg-surface-3 text-ink-muted',
};

function QuickActionsScreen() {
  const can = usePermission();
  const open = useOpenScreen();
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-6">
      <PageHeader icon={<Zap size={22} />} title="Quick actions" subtitle="Create a new document in one click." />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {QUICK_GROUPS.map((grp) => {
          const GIcon = ICONS[grp.name] ?? Zap;
          return (
            <section key={grp.name} className="rounded-card border border-line bg-surface p-5 shadow-card">
              <header className="mb-4 flex items-center gap-3">
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${TONE[grp.name] ?? TONE.Dimensions}`}>
                  <GIcon size={18} />
                </span>
                <h2 className="text-sm font-semibold text-ink">{grp.name}</h2>
              </header>
              <div className="grid grid-cols-1 gap-2 2xl:grid-cols-2">
                {grp.items.map((a) => {
                  const allowed = can(a.perm, 'create');
                  return (
                    <button
                      key={a.form}
                      type="button"
                      disabled={!allowed}
                      title={allowed ? a.label : `No permission (${a.perm}:create)`}
                      onClick={() => open(a.form, {}, a.label)}
                      className="group flex h-10 items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-3 text-left text-[13px] font-medium text-ink transition duration-150 hover:border-brand/50 hover:bg-brand-soft hover:text-brand-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-surface-2/60 disabled:hover:text-ink"
                    >
                      <FilePlus2 size={15} className="shrink-0 text-ink-faint transition group-hover:text-brand" />
                      <span className="truncate">{a.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default [{ id: 'quick-actions', title: 'Quick Actions', icon: Zap, component: QuickActionsScreen }] satisfies ScreenDef[];
