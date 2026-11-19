import { useQuery } from '@tanstack/react-query';
import { api, Paged } from '@/lib/api';

export interface Company {
  id: number;
  name: string;
  code?: string;
  trn?: string;
  baseCurrency?: string;
  [k: string]: unknown;
}

/** Company profile (first row of /api/companies). Falls back to null if unavailable. */
export function useCompany() {
  return useQuery({
    queryKey: ['company'],
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async (): Promise<Company | null> => {
      const r = await api.get<Paged<Company> | Company[]>('/company', { params: { pageSize: 1 } });
      const rows = Array.isArray(r.data) ? r.data : r.data.rows;
      return rows?.[0] ?? null;
    },
  });
}

/** API health probe for the status bar. */
export function useApiStatus() {
  return useQuery({
    queryKey: ['api-status'],
    refetchInterval: 30_000,
    retry: false,
    queryFn: async () => {
      const t = Date.now();
      await api.get('/auth/me');
      return Date.now() - t;
    },
  });
}
