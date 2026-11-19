import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import { useApiStatus, useCompany } from '@/hooks/useCompany';
import { fmt } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { api, Paged } from '@/lib/api';
import { cn } from '@/lib/cn';

export function StatusBar() {
  const user = useAuth((s) => s.user);
  const company = useCompany();
  const status = useApiStatus();
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const branch = useQuery({
    queryKey: ['branch', user?.branchId],
    enabled: !!user?.branchId,
    retry: false,
    queryFn: async () => (await api.get<Paged<{ id: number; name: string }>>('/branches', { params: { pageSize: 200 } })).data.rows.find((b) => b.id === user?.branchId)?.name,
  });
  const online = status.isSuccess;
  return (
    <div className="no-print flex h-6 shrink-0 items-center gap-4 border-t border-brand-dark bg-brand px-3 text-[11px] text-white">
      <span>User: {user?.fullName ?? user?.username}</span>
      <span>Company: {company.data?.name ?? '-'}</span>
      <span>Branch: {branch.data ?? 'All'}</span>
      <span className="flex-1" />
      <span className="flex items-center gap-1.5">
        <span className={cn('h-2 w-2 rounded-full', status.isLoading ? 'bg-amber-300' : online ? 'bg-green-400' : 'bg-red-400')} />
        API {status.isLoading ? 'checking' : online ? `online (${status.data} ms)` : 'offline'}
      </span>
      <span>{fmt.date(now)} {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}</span>
    </div>
  );
}
