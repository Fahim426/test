import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '@/lib/api';
import { toast } from '@/store/toast';
import type { ScreenParams } from '@/screens/types';

export interface Favorite {
  id: number;
  label: string;
  /** encoded screen: `screenId` or `screenId|{json params}` */
  route: string;
}

export const encodeRoute = (screenId: string, params?: ScreenParams): string => {
  const clean = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null)) : {};
  return Object.keys(clean).length ? `${screenId}|${JSON.stringify(clean)}` : screenId;
};
export const decodeRoute = (route: string): { screenId: string; params: ScreenParams } => {
  const i = route.indexOf('|');
  if (i < 0) return { screenId: route, params: {} };
  try {
    return { screenId: route.slice(0, i), params: JSON.parse(route.slice(i + 1)) as ScreenParams };
  } catch {
    return { screenId: route.slice(0, i), params: {} };
  }
};

export function useFavorites() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['favorites'],
    retry: false,
    queryFn: async (): Promise<Favorite[]> => {
      const r = await api.get<Favorite[] | { rows: Favorite[] }>('/favorites');
      return Array.isArray(r.data) ? r.data : (r.data.rows ?? []);
    },
  });
  const add = useMutation({
    mutationFn: (v: { label: string; route: string }) => api.post('/favorites', v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['favorites'] });
      toast.success('Added to favorites');
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/favorites/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['favorites'] });
      toast.info('Removed from favorites');
    },
    onError: (e) => toast.error(apiError(e)),
  });
  return { favorites: q.data ?? [], isLoading: q.isLoading, error: q.error, add, remove, refetch: q.refetch };
}
