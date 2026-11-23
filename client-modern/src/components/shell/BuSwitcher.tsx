import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building } from 'lucide-react';
import { api, Paged } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useBuStore } from '@/store/bu';
import { cn } from '@/lib/cn';

interface Bu {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
}

/**
 * Business Unit in the top bar.
 *  - Admin: selector All / TZ / CARSN. Narrows every list and report; new documents get the selected BU.
 *  - Other users: their own BU (fixed on their login), shown read-only.
 */
export function BuSwitcher() {
  const user = useAuth((s) => s.user);
  const selected = useBuStore((s) => s.selectedBuId);
  const setSelected = useBuStore((s) => s.setSelectedBuId);
  const qc = useQueryClient();
  const isAdmin = user?.role === 'Admin';
  const list = useQuery({
    queryKey: ['business-units'],
    enabled: isAdmin,
    staleTime: 300_000,
    queryFn: async () => (await api.get<Paged<Bu>>('/business-units', { params: { pageSize: 100 } })).data.rows.filter((b) => b.isActive),
  });
  if (!user) return null;

  if (!isAdmin) {
    return user.businessUnit ? (
      <span data-tour="demo-business-unit" className="hidden items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-ink sm:inline-flex" title={user.businessUnit.name}>
        <Building size={13} className="text-brand" /> {user.businessUnit.code}
      </span>
    ) : (
      <span className="hidden items-center gap-1.5 rounded-lg border border-warning/40 bg-warning-soft px-2.5 py-1 text-[12px] font-medium text-warning sm:inline-flex" title="Ask an administrator to assign your Business Unit">
        <Building size={13} /> No BU
      </span>
    );
  }

  return (
    <label data-tour="demo-business-unit" className={cn('hidden items-center gap-1.5 rounded-lg border px-2 py-0.5 sm:inline-flex', selected ? 'border-brand/40 bg-brand-soft' : 'border-line bg-surface-2')} title="Business Unit: filters every list and report; new documents are created in the selected BU">
      <Building size={13} className="text-brand" />
      <select
        className="cursor-pointer bg-transparent py-1 text-[12px] font-medium text-ink outline-none"
        value={selected ?? ''}
        onChange={(e) => {
          setSelected(e.target.value ? Number(e.target.value) : null);
          qc.invalidateQueries(); // every open list / report reloads for the new BU
        }}
      >
        <option value="">All BUs</option>
        {(list.data ?? []).map((b) => (
          <option key={b.id} value={b.id}>{b.code}</option>
        ))}
      </select>
    </label>
  );
}
