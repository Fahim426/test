import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useToastStore } from '@/store/toast';
import { cn } from '@/lib/cn';

const style = {
  success: ['border-green-400 bg-green-50 text-green-800', CheckCircle2],
  error: ['border-red-400 bg-red-50 text-red-800', XCircle],
  info: ['border-blue-400 bg-blue-50 text-blue-800', Info],
  warning: ['border-amber-400 bg-amber-50 text-amber-900', AlertTriangle],
} as const;

export function Toaster() {
  const { items, dismiss } = useToastStore();
  return (
    <div className="no-print pointer-events-none fixed bottom-8 right-3 z-[200] flex w-[340px] flex-col gap-1.5">
      {items.map((t) => {
        const [cls, Icon] = style[t.kind];
        return (
          <div key={t.id} className={cn('pointer-events-auto flex items-start gap-2 rounded border px-2.5 py-1.5 text-[12px] shadow', cls)}>
            <Icon size={14} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
