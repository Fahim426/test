import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Features {
  partNumbers: boolean;
  vehicleCompatibility: boolean;
  amc: boolean;
  hr: boolean;
}

export function useFeatures(): Features {
  const q = useQuery({
    queryKey: ['admin', 'settings', 'features'],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => (await api.get<Record<string, string>>('/settings')).data,
  });
  const s = q.data ?? {};
  return {
    // default ON if not explicitly set to 'false'
    partNumbers: s['features.partNumbers'] !== 'false',
    vehicleCompatibility: s['features.vehicleCompatibility'] !== 'false',
    amc: s['features.amc'] !== 'false',
    hr: s['features.hr'] !== 'false',
  };
}
