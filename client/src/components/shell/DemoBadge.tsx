import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
export function DemoBadge() {
  const status = useQuery({ queryKey: ['demo-status'], staleTime: 60000, retry: false, queryFn: async () => (await api.get<{ active: boolean; label: string; description: string }>('/demo-status')).data });
  if (!status.data?.active) return null;
  return <span title={status.data.description} aria-label="Demo data: fictional business figures" className="inline-flex shrink-0 items-center rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold leading-3 text-amber-900">{status.data.label}</span>;
}
