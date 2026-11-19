import { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { fmt } from '@/lib/format';

const tones = {
  gray: ['bg-surface-3 text-ink-muted', 'bg-ink-faint'],
  blue: ['bg-info-soft text-info', 'bg-info'],
  green: ['bg-success-soft text-success', 'bg-success'],
  amber: ['bg-warning-soft text-warning', 'bg-warning'],
  red: ['bg-danger-soft text-danger', 'bg-danger'],
  purple: ['bg-brand-soft text-brand-ink', 'bg-brand'],
  teal: ['bg-success-soft text-success', 'bg-success'],
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = 'gray', children, className, dot = true }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  const [cls, dotCls] = tones[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-4', cls, className)}>
      {dot && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotCls)} />}
      {children}
    </span>
  );
}

const statusTone: Record<string, Tone> = {
  DRAFT: 'gray',
  SUBMITTED: 'blue',
  PENDING: 'amber',
  PENDING_APPROVAL: 'amber',
  CONFIRMED: 'blue',
  APPROVED: 'green',
  PICKED: 'green',
  PACKED: 'teal',
  DELIVERED: 'green',
  RECEIVED: 'green',
  INVOICED: 'green',
  POSTED: 'teal',
  PAID: 'green',
  COMPLETED: 'green',
  ACTIVE: 'green',
  CANCELLED: 'red',
  REJECTED: 'red',
  OVERDUE: 'red',
  INACTIVE: 'gray',
  CLOSED: 'gray',
  IN_TRANSIT: 'purple',
  ARRIVED: 'purple',
  CUSTOMS: 'purple',
  PAYMENT_PENDING: 'amber',
  OPEN: 'blue',
};

export const statusToneOf = (s: string | null | undefined): Tone => {
  if (!s) return 'gray';
  const k = s.toUpperCase();
  if (statusTone[k]) return statusTone[k];
  if (k.startsWith('PARTIALLY')) return 'amber';
  if (k.startsWith('FULLY')) return 'green';
  return 'gray';
};

/** Colored status pill. Pass raw server status (e.g. PARTIALLY_RECEIVED). */
export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  if (!status) return null;
  return (
    <Badge tone={statusToneOf(status)} className={className}>
      {fmt.status(status)}
    </Badge>
  );
}
