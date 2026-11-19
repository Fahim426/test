import { useState } from 'react';
import { Checkbox, Input } from '@/components/ui';
import type { SupplierRow } from './kit';

/** Multi-select list of suppliers with search (used for RFQ supplier lists). */
export function SupplierMulti({
  suppliers, value, onChange, disabled,
}: {
  suppliers: SupplierRow[];
  value: number[];
  onChange: (v: number[]) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const shown = suppliers.filter((s) => !q || `${s.code} ${s.name} ${s.country ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input className="max-w-[260px]" placeholder="Search suppliers..." value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-xs text-ink-muted">{value.length} selected</span>
      </div>
      <div className="grid max-h-[180px] grid-cols-3 gap-x-4 gap-y-0.5 overflow-auto rounded-lg border border-line bg-surface p-2">
        {shown.map((s) => (
          <Checkbox key={s.id} disabled={disabled} checked={value.includes(s.id)} onChange={() => toggle(s.id)} label={<span>{s.code} - {s.name}{s.country ? <span className="text-ink-faint"> ({s.country})</span> : null}</span>} />
        ))}
        {shown.length === 0 && <span className="text-[13px] text-ink-faint">No suppliers</span>}
      </div>
    </div>
  );
}
