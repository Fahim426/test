import { Star, Trash2, ExternalLink, RefreshCw } from 'lucide-react';
import { decodeRoute, useFavorites } from '@/hooks/useFavorites';
import { useOpenScreen } from '@/store/workspace';
import { getScreen } from '@/screens/registry';
import { apiError } from '@/lib/api';
import { Button, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui';
import type { ScreenDef } from '@/screens/types';

function FavoritesScreen() {
  const { favorites, isLoading, error, remove, refetch } = useFavorites();
  const open = useOpenScreen();

  const go = (route: string, label: string) => {
    const { screenId, params } = decodeRoute(route);
    open(screenId, params, label);
  };

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-6">
      <PageHeader
        icon={<Star size={22} />}
        title="Favorites"
        subtitle="Screens and documents you pinned. Use the star in the tab bar to pin the current screen."
        actions={<Button icon={RefreshCw} onClick={() => refetch()}>Refresh</Button>}
      />
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px] !rounded-card" />)}
        </div>
      )}
      {error && !isLoading && <ErrorState message={apiError(error)} onRetry={() => refetch()} />}
      {!isLoading && !error && favorites.length === 0 && (
        <div className="rounded-card border border-dashed border-line-strong bg-surface">
          <EmptyState icon={<Star size={24} strokeWidth={1.5} />} title="No favorites yet" hint="Pin screens you use often so they are one click away." />
        </div>
      )}
      {favorites.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {favorites.map((f) => {
            const { screenId } = decodeRoute(f.route);
            const def = getScreen(screenId);
            const Icon = def?.icon ?? Star;
            return (
              <div
                key={f.id}
                tabIndex={0}
                role="button"
                onClick={() => go(f.route, f.label)}
                onKeyDown={(e) => e.key === 'Enter' && go(f.route, f.label)}
                className="group flex cursor-pointer items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-card transition duration-150 hover:-translate-y-px hover:border-brand/40 hover:shadow-pop"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <Icon size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">{f.label}</div>
                  <div className="truncate text-xs text-ink-faint">{def ? def.title : `${screenId} (unavailable)`}</div>
                </div>
                <div className="flex gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                  <button title="Open" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-brand-soft hover:text-brand" onClick={(e) => { e.stopPropagation(); go(f.route, f.label); }}>
                    <ExternalLink size={15} />
                  </button>
                  <button title="Remove from favorites" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-danger-soft hover:text-danger" onClick={(e) => { e.stopPropagation(); remove.mutate(f.id); }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default [{ id: 'favorites', title: 'Favorites', icon: Star, component: FavoritesScreen }] satisfies ScreenDef[];
