import { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button, ButtonProps, LoadingBlock, SectionHeader, StatusBadge, Textarea, Field } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fmt } from '@/lib/format';
import { Totals } from '@/lib/calc';

/**
 * Document screen frame: title bar (doc type + number + status), toolbar slot, sections.
 *
 *   <DocumentLayout title="Purchase Order" docNo={doc?.docNo} status={doc?.status}
 *     actions={<><DocAction icon={Save} variant="primary" onClick=...>Save</DocAction> ...</>}>
 *     <HeaderSection title="PO Information">...fields...</HeaderSection>
 *     <LineItemsGrid ... />
 *     <TotalsSection ... />
 *   </DocumentLayout>
 */
export function DocumentLayout({
  title, docNo, status, actions, children, loading, error, aside, icon: Icon,
}: {
  title: string;
  docNo?: string | null;
  status?: string | null;
  actions?: ReactNode;
  children: ReactNode;
  loading?: boolean;
  error?: string;
  /** optional right-hand column (e.g. DocumentFlow summary) */
  aside?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg">
      <div className="no-print flex shrink-0 flex-wrap items-center gap-3 border-b border-app-border bg-white px-3 py-1.5">
        {Icon && <Icon size={18} className="text-brand" />}
        <h1 className="text-[14px] font-semibold text-slate-800">{title}</h1>
        {docNo ? <span className="rounded border border-app-border bg-app-head px-2 text-[13px] font-semibold text-brand">{docNo}</span> : <span className="text-[12px] italic text-slate-400">New</span>}
        <StatusBadge status={status ?? undefined} />
        <div className="flex-1" />
      </div>
      {actions && <div className="no-print flex shrink-0 flex-wrap items-center gap-1.5 border-b border-app-border bg-app-head px-3 py-1">{actions}</div>}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <LoadingBlock />
        ) : error ? (
          <div className="m-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</div>
        ) : (
          <div className={cn('flex gap-3 p-3', !!aside && 'items-start')}>
            <div className="flex min-w-0 flex-1 flex-col gap-3">{children}</div>
            {aside && <div className="w-[300px] shrink-0">{aside}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Toolbar action button. `hidden` removes it (e.g. Post when status != APPROVED). */
export function DocAction({ hidden, ...p }: ButtonProps & { hidden?: boolean }) {
  if (hidden) return null;
  return <Button size="md" {...p} />;
}
export const DocActionSep = () => <span className="mx-1 h-5 w-px bg-app-border" />;

/** "-----PO INFORMATION-----" band + responsive field grid. */
export function HeaderSection({ title, children, columns = 4, right, className }: { title: string; children: ReactNode; columns?: 2 | 3 | 4 | 5 | 6; right?: ReactNode; className?: string }) {
  const cols = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5', 6: 'grid-cols-6' }[columns];
  return (
    <section className={cn('border border-app-border bg-white', className)}>
      <SectionHeader title={title} right={right} className="border-x-0 border-t-0" />
      <div className={cn('grid gap-x-3 gap-y-2 p-3', cols)}>{children}</div>
    </section>
  );
}

/** A plain titled section containing arbitrary content (items grid, terms, ...). */
export function DocSection({ title, children, right, className, bodyClassName }: { title: string; children: ReactNode; right?: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('border border-app-border bg-white', className)}>
      <SectionHeader title={title} right={right} className="border-x-0 border-t-0" />
      <div className={cn('p-2', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Right-aligned totals box. Pass `totals` (calcTotals result) or explicit rows. */
export function TotalsSection({
  totals, currency, extra, roundOffInput, className,
}: {
  totals: Totals;
  currency?: string;
  extra?: { label: string; value: ReactNode }[];
  /** render an editable round-off control in the Round Off row */
  roundOffInput?: ReactNode;
  className?: string;
}) {
  const Row = ({ l, v, bold }: { l: string; v: ReactNode; bold?: boolean }) => (
    <div className={cn('flex items-center justify-between gap-6 py-0.5 text-[12px]', bold && 'border-t border-app-border pt-1 text-[14px] font-bold text-brand')}>
      <span className={cn('text-slate-600', bold && 'text-slate-800')}>{l}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
  return (
    <section className={cn('border border-app-border bg-white', className)}>
      <SectionHeader title="Totals" className="border-x-0 border-t-0" />
      <div className="flex justify-end p-3">
        <div className="w-[300px]">
          <Row l="Subtotal" v={fmt.money(totals.subtotal)} />
          <Row l="Discount" v={fmt.money(totals.discount)} />
          <Row l="VAT" v={fmt.money(totals.vatAmount)} />
          <Row l="Round Off" v={roundOffInput ?? fmt.money(totals.roundOff)} />
          {extra?.map((e) => <Row key={e.label} l={e.label} v={e.value} />)}
          <Row l={`Grand Total${currency ? ` (${currency})` : ''}`} v={fmt.money(totals.total)} bold />
        </div>
      </div>
    </section>
  );
}

/** Notes / Terms & Conditions block (uncontrolled-friendly: pass register('remarks')). */
export function NotesSection({ title = 'Notes', fields }: { title?: string; fields: { label: string; props: React.ComponentProps<typeof Textarea> }[] }) {
  return (
    <DocSection title={title} bodyClassName="grid grid-cols-2 gap-3 p-3">
      {fields.map((f) => (
        <Field key={f.label} label={f.label}>
          <Textarea rows={3} {...f.props} />
        </Field>
      ))}
    </DocSection>
  );
}
