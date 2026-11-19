import { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { fmt } from '@/lib/format';

const tones = {
  gray: 'bg-slate-100 text-slate-700 border-slate-300',
  blue: 'bg-blue-50 text-blue-700 border-blue-300',
  green: 'bg-green-50 text-green-700 border-green-300',
  amber: 'bg-amber-50 text-amber-800 border-amber-300',
  red: 'bg-red-50 text-red-700 border-red-300',
  purple: 'bg-purple-50 text-purple-700 border-purple-300',
  teal: 'bg-teal-50 text-teal-700 border-teal-300',
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-sm border px-1.5 text-[11px] font-medium leading-4', tones[tone], className)}>
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
