import { ReactNode, useState } from 'react';
import { Loader2, Inbox } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn('animate-spin text-brand', className)} />;
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('h-4 animate-pulse bg-slate-200', className)} />;
}
export function LoadingBlock({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-[12px] text-slate-500">
      <Spinner /> {label}
    </div>
  );
}
export function EmptyState({ title = 'No data', hint, icon, action }: { title?: string; hint?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 p-8 text-slate-400">
      {icon ?? <Inbox size={28} strokeWidth={1.3} />}
      <div className="text-[12px] font-medium text-slate-500">{title}</div>
      {hint && <div className="text-[11px]">{hint}</div>}
      {action}
    </div>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="m-3 flex items-center justify-between gap-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700">
      <span>{message}</span>
      {onRetry && (
        <button className="rounded border border-red-300 bg-white px-2 py-0.5 hover:bg-red-100" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** The "-----PO INFORMATION-----" style band. */
export function SectionHeader({ title, right, className }: { title: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-6 items-center gap-2 border-y border-app-border bg-brand-light px-2', className)}>
      <span className="text-[11px] font-bold uppercase tracking-wider text-brand">{title}</span>
      <span className="h-px flex-1 bg-brand/20" />
      {right}
    </div>
  );
}

export function Panel({
  title, right, children, className, bodyClassName,
}: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('border border-app-border bg-white', className)}>
      {title !== undefined && <SectionHeader title={title} right={right} className="border-x-0 border-t-0" />}
      <div className={cn('p-2', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('no-print flex min-h-[32px] flex-wrap items-center gap-1.5 border-b border-app-border bg-app-head px-2 py-1', className)}>{children}</div>;
}
export const ToolbarSep = () => <span className="mx-0.5 h-5 w-px bg-app-border" />;

export interface TabDef {
  key: string;
  label: ReactNode;
  content: ReactNode;
  hidden?: boolean;
}
/** Inner (in-screen) tabs. All panes stay mounted so form state is retained. */
export function Tabs({ tabs, initial, className }: { tabs: TabDef[]; initial?: string; className?: string }) {
  const visible = tabs.filter((t) => !t.hidden);
  const [active, setActive] = useState(initial ?? visible[0]?.key);
  return (
    <div className={className}>
      <div className="flex border-b border-app-border bg-app-head">
        {visible.map((t) => (
          <button
            data-tour={'document-tab-'+t.key} key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={cn(
              '-mb-px border border-transparent px-3 py-1 text-[12px]',
              active === t.key ? 'border-app-border border-b-white bg-white font-semibold text-brand' : 'text-slate-600 hover:bg-slate-200',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {visible.map((t) => (
        <div key={t.key} className={cn(active === t.key ? 'block' : 'hidden')}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
