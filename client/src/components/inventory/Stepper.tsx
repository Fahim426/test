import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Horizontal stage stepper. `current` is the index of the active stage; stages before it are done. */
export function Stepper({ stages, current, halted }: { stages: string[]; current: number; halted?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border border-app-border bg-white px-3 py-2">
      {stages.map((s, i) => {
        const done = i < current || (i === current && current === stages.length - 1 && !halted);
        const active = i === current && !done && !halted;
        return (
          <div key={s} className="flex items-center gap-1">
            <div
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
                done && 'border-green-600 bg-green-50 text-green-700',
                active && 'border-brand bg-brand text-white',
                !done && !active && 'border-app-border text-slate-400',
                halted && i >= current && 'border-app-border text-slate-300',
              )}
            >
              {done ? <Check size={11} /> : <span className="text-[10px]">{i + 1}</span>}
              {s}
            </div>
            {i < stages.length - 1 && <span className={cn('h-px w-6', i < current ? 'bg-green-600' : 'bg-app-border')} />}
          </div>
        );
      })}
      {halted && <span className="ml-3 rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{halted}</span>}
    </div>
  );
}
