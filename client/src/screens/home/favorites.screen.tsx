import { Star, Trash2, ExternalLink } from 'lucide-react';
import { decodeRoute, useFavorites } from '@/hooks/useFavorites';
import { useOpenScreen } from '@/store/workspace';
import { getScreen } from '@/screens/registry';
import { apiError } from '@/lib/api';
import { Button, EmptyState, ErrorState, LoadingBlock, Toolbar } from '@/components/ui';
import type { ScreenDef } from '@/screens/types';

function FavoritesScreen() {
  const { favorites, isLoading, error, remove, refetch } = useFavorites();
  const open = useOpenScreen();

  const go = (route: string, label: string) => {
    const { screenId, params } = decodeRoute(route);
    open(screenId, params, label);
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <Toolbar>
        <Star size={14} className="text-amber-500" />
        <span className="text-[12px] font-semibold text-slate-700">Favorites</span>
        <div className="flex-1" />
        <span className="text-[11px] text-slate-500">Click a row (or press Enter) to open. Use the star in the title bar to pin the current screen.</span>
        <Button size="sm" onClick={() => refetch()}>Refresh</Button>
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading && <LoadingBlock />}
        {error && !isLoading && <ErrorState message={apiError(error)} onRetry={() => refetch()} />}
        {!isLoading && !error && favorites.length === 0 && (
          <EmptyState icon={<Star size={28} strokeWidth={1.3} />} title="No favorites yet" hint="Pin screens you use often so they are one click away." />
        )}
        {favorites.length > 0 && (
          <table className="w-full border-separate border-spacing-0 text-[12px]">
            <thead>
              <tr className="h-7">
                <th className="grid-th w-8" />
                <th className="grid-th">Name</th>
                <th className="grid-th">Screen</th>
                <th className="grid-th w-[1%] text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {favorites.map((f, i) => {
                const { screenId } = decodeRoute(f.route);
                const def = getScreen(screenId);
                return (
                  <tr
                    key={f.id}
                    className={`h-7 cursor-pointer hover:bg-brand-light/60 ${i % 2 ? 'bg-slate-50' : ''}`}
                    tabIndex={0}
                    onClick={() => go(f.route, f.label)}
                    onKeyDown={(e) => e.key === 'Enter' && go(f.route, f.label)}
                  >
                    <td className="grid-td text-center"><Star size={13} className="fill-amber-400 text-amber-500" /></td>
                    <td className="grid-td font-medium text-brand">{f.label}</td>
                    <td className="grid-td text-slate-500">{def ? def.title : `${screenId} (unavailable)`}</td>
                    <td className="grid-td whitespace-nowrap text-center">
                      <button title="Open" className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded text-brand hover:bg-brand-light" onClick={(e) => { e.stopPropagation(); go(f.route, f.label); }}>
                        <ExternalLink size={13} />
                      </button>
                      <button title="Remove from favorites" className="inline-flex h-5 w-5 items-center justify-center rounded text-red-600 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); remove.mutate(f.id); }}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default [{ id: 'favorites', title: 'Favorites', icon: Star, component: FavoritesScreen }] satisfies ScreenDef[];
