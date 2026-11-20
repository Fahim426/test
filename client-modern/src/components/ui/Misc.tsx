import { ReactNode, useState } from 'react';
import { Loader2, Inbox, AlertTriangle, RotateCw } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn('animate-spin text-brand', className)} />;
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4', className)} />;
}
export function LoadingBlock({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex flex-col gap-3 p-6">
      <div className="flex items-center gap-2 text-[13px] text-ink-muted">
        <Spinner /> {label}
      </div>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}
export function EmptyState({ title = 'No data', hint, icon, action }: { title?: string; hint?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 p-10 text-center">
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-3 text-ink-faint">{icon ?? <Inbox size={22} strokeWidth={1.6} />}</div>
      <div className="text-sm font-medium text-ink">{title}</div>
      {hint && <div className="max-w-xs text-xs text-ink-muted">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="m-3 flex items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">
      <AlertTriangle size={18} className="shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <button className="inline-flex h-7 items-center gap-1 rounded-md border border-danger/30 bg-surface px-2.5 text-xs font-medium transition hover:bg-surface-2" onClick={onRetry}>
          <RotateCw size={12} /> Retry
        </button>
      )}
    </div>
  );
}

/** Section title with hairline divider (was the "-----PO INFORMATION-----" band). */
export function SectionHeader({ title, right, className }: { title: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-[28px] items-center gap-3 px-1 pt-1', className)}>
      <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-ink-muted">
        <span className="h-3.5 w-1 rounded-full bg-brand" />
        {title}
      </span>
      <span className="h-px flex-1 bg-line" />
      {right}
    </div>
  );
}

export function Panel({
  title, right, children, className, bodyClassName,
}: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('rounded-card border border-line bg-surface shadow-card', className)}>
      {title !== undefined && <SectionHeader title={title} right={right} className="px-4 pt-3" />}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Page title row for utility screens: icon chip, title, optional subtitle and right-hand actions. */
export function PageHeader({ title, subtitle, icon, actions, className }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-4 pb-1', className)}>
      {icon && <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand">{icon}</span>}
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold leading-7 tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="text-[13px] text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('no-print flex min-h-[48px] flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2', className)}>{children}</div>;
}
export const ToolbarSep = () => <span className="mx-1 h-5 w-px bg-line" />;

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
      <div className="flex gap-1 border-b border-line px-1">
        {visible.map((t) => (
          <button
            data-tour={'document-tab-'+t.key} key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition',
              active === t.key ? 'border-brand text-brand' : 'border-transparent text-ink-muted hover:text-ink',
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
