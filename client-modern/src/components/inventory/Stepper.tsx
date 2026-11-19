import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Horizontal stage stepper. `current` is the index of the active stage; stages before it are done. */
export function Stepper({ stages, current, halted }: { stages: string[]; current: number; halted?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-card border border-line bg-surface px-4 py-3 shadow-card">
      {stages.map((s, i) => {
        const done = i < current || (i === current && current === stages.length - 1 && !halted);
        const active = i === current && !done && !halted;
        return (
          <div key={s} className="flex items-center gap-1">
            <div
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
                done && 'border-success bg-success-soft text-success',
                active && 'border-brand bg-brand text-white',
                !done && !active && 'border-line text-ink-faint',
                halted && i >= current && 'border-line text-ink-faint',
              )}
            >
              {done ? <Check size={11} /> : <span className="text-xs">{i + 1}</span>}
              {s}
            </div>
            {i < stages.length - 1 && <span className={cn('h-0.5 w-6 rounded', i < current ? 'bg-success' : 'bg-line')} />}
          </div>
        );
      })}
      {halted && <span className="ml-3 rounded-lg border border-danger bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">{halted}</span>}
    </div>
  );
}
