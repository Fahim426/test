import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useToastStore } from '@/store/toast';

const style = {
  success: ['text-success bg-success-soft', CheckCircle2],
  error: ['text-danger bg-danger-soft', XCircle],
  info: ['text-info bg-info-soft', Info],
  warning: ['text-warning bg-warning-soft', AlertTriangle],
} as const;

export function Toaster() {
  const { items, dismiss } = useToastStore();
  return (
    <div className="no-print pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((t) => {
        const [cls, Icon] = style[t.kind];
        return (
          <div key={t.id} className="pointer-events-auto flex animate-slide-in items-start gap-3 rounded-xl border border-line bg-surface p-3 text-[13px] text-ink shadow-pop">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${cls}`}>
              <Icon size={15} />
            </span>
            <span className="min-w-0 flex-1 break-words pt-1 leading-5">{t.message}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="rounded-md p-1 text-ink-faint transition hover:bg-surface-3 hover:text-ink">
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
