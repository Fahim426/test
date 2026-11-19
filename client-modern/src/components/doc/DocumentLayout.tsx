import { Children, Fragment, isValidElement, ReactElement, ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, ButtonProps, LoadingBlock, Menu, SectionHeader, StatusBadge, Textarea, Field } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fmt } from '@/lib/format';
import { Totals } from '@/lib/calc';

type ActionProps = ButtonProps & { hidden?: boolean };

/** Flatten fragments/arrays into a list of children (falsy removed). */
function flatten(node: ReactNode, out: ReactNode[] = []): ReactNode[] {
  Children.forEach(node, (c) => {
    if (!c && c !== 0) return;
    if (isValidElement(c) && c.type === Fragment) flatten((c.props as { children?: ReactNode }).children, out);
    else out.push(c);
  });
  return out;
}

const MAX_INLINE = 4;

/** Splits the actions into inline buttons and an overflow "More" menu (only when there are many). */
function ActionsBar({ actions }: { actions: ReactNode }) {
  const items = flatten(actions);
  const isAction = (n: ReactNode): n is ReactElement<ActionProps> => isValidElement(n) && n.type === DocAction;
  const visible = items.filter((n) => !(isAction(n) && n.props.hidden));
  const secondary = visible.filter((n) => isAction(n) && n.props.variant !== 'primary');
  let overflow: ReactElement<ActionProps>[] = [];
  let inline = visible;
  if (secondary.length > MAX_INLINE) {
    // keep primary + first N secondary inline, rest in the menu
    const keep = new Set(secondary.slice(0, MAX_INLINE - 1));
    overflow = secondary.slice(MAX_INLINE - 1) as ReactElement<ActionProps>[];
    inline = visible.filter((n) => !overflow.includes(n as ReactElement<ActionProps>) && (!(isAction(n)) || n.props.variant === 'primary' || keep.has(n)));
  }
  // drop separators that would dangle (leading/trailing/double)
  const isSep = (n: ReactNode) => isValidElement(n) && n.type === DocActionSep;
  const cleaned: ReactNode[] = [];
  inline.forEach((n) => {
    if (isSep(n) && (cleaned.length === 0 || isSep(cleaned[cleaned.length - 1]))) return;
    cleaned.push(n);
  });
  while (cleaned.length && isSep(cleaned[cleaned.length - 1])) cleaned.pop();
  // primary actions go last (right-most) so they are emphasised
  const prim = cleaned.filter((n) => isAction(n) && n.props.variant === 'primary');
  const rest = cleaned.filter((n) => !(isAction(n) && n.props.variant === 'primary'));
  if (!cleaned.length && !overflow.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {rest.map((n, i) => <Fragment key={i}>{n}</Fragment>)}
      {overflow.length > 0 && (
        <Menu
          width={220}
          trigger={({ toggle }) => (
            <Button onClick={toggle} aria-label="More actions">
              <MoreHorizontal size={16} /> More
            </Button>
          )}
        >
          {(close) =>
            overflow.map((o, i) => {
              const { icon: Icon, children, onClick, disabled, loading, variant } = o.props;
              return (
                <button
                  key={i}
                  disabled={disabled || loading}
                  onClick={(e) => {
                    close();
                    onClick?.(e);
                  }}
                  className={cn('menu-item', variant === 'danger' && 'text-danger hover:bg-danger-soft')}
                >
                  {Icon && <Icon size={15} className={variant === 'danger' ? '' : 'text-ink-faint'} />}
                  {children}
                </button>
              );
            })
          }
        </Menu>
      )}
      {prim.map((n, i) => <Fragment key={`p${i}`}>{n}</Fragment>)}
    </div>
  );
}

/**
 * Document screen frame: page header (doc type + number + status + actions), scrolling body of section cards.
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
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="no-print flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-line bg-surface px-6 py-3.5">
        {Icon && (
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <Icon size={20} />
          </span>
        )}
        <div className="min-w-0 leading-tight">
          <div className="text-xs font-medium uppercase tracking-wider text-ink-faint">{title}</div>
          <div className="mt-0.5 flex items-center gap-2.5">
            {docNo ? <h1 className="text-xl font-semibold tracking-tight text-ink">{docNo}</h1> : <h1 className="text-xl font-semibold tracking-tight text-ink-muted">New {title.toLowerCase()}</h1>}
            <StatusBadge status={status ?? undefined} />
          </div>
        </div>
        <div className="min-w-0 flex-1">{actions && <ActionsBar actions={actions} />}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <LoadingBlock />
        ) : error ? (
          <div className="m-6 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</div>
        ) : (
          <div className={cn('flex gap-5 p-6', !!aside && 'items-start')}>
            <div className="flex min-w-0 flex-1 flex-col gap-5">{children}</div>
            {aside && <div className="w-[300px] shrink-0">{aside}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Toolbar action button. `hidden` removes it (e.g. Post when status != APPROVED). */
export function DocAction({ hidden, variant, ...p }: ActionProps) {
  if (hidden) return null;
  return <Button size="md" variant={variant} {...p} />;
}
export const DocActionSep = () => <span className="mx-0.5 h-6 w-px bg-line" />;

const cardCls = 'rounded-card border border-line bg-surface shadow-card';

/** Titled card + responsive field grid (at most `columns` columns, fewer when the screen is narrow). */
export function HeaderSection({ title, children, columns = 4, right, className }: { title: string; children: ReactNode; columns?: 2 | 3 | 4 | 5 | 6; right?: ReactNode; className?: string }) {
  const gap = 16;
  return (
    <section className={cn(cardCls, className)}>
      <SectionHeader title={title} right={right} className="px-5 pt-4" />
      <div
        className="grid gap-x-4 gap-y-4 p-5 pt-4"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(max(168px, calc((100% - ${(columns - 1) * gap}px) / ${columns})), 1fr))` }}
      >
        {children}
      </div>
    </section>
  );
}

/** A plain titled card containing arbitrary content (items grid, terms, ...). */
export function DocSection({ title, children, right, className, bodyClassName }: { title: string; children: ReactNode; right?: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn(cardCls, className)}>
      <SectionHeader title={title} right={right} className="px-5 pt-4" />
      <div className={cn('p-3', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Right-aligned totals summary card. Pass `totals` (calcTotals result) or explicit rows. */
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
  const Row = ({ l, v }: { l: string; v: ReactNode }) => (
    <div className="flex items-center justify-between gap-6 py-1.5 text-[13px]">
      <span className="text-ink-muted">{l}</span>
      <span className="tabular-nums text-ink">{v}</span>
    </div>
  );
  return (
    <section className={cn(cardCls, 'ml-auto w-full max-w-[400px] overflow-hidden', className)}>
      <div className="px-5 pb-1 pt-4">
        <Row l="Subtotal" v={fmt.money(totals.subtotal)} />
        <Row l="Discount" v={fmt.money(totals.discount)} />
        <Row l="VAT" v={fmt.money(totals.vatAmount)} />
        <Row l="Round Off" v={roundOffInput ?? fmt.money(totals.roundOff)} />
        {extra?.map((e) => <Row key={e.label} l={e.label} v={e.value} />)}
      </div>
      <div className="mt-2 flex items-center justify-between gap-6 border-t border-line bg-brand-soft px-5 py-3.5">
        <span className="text-[13px] font-semibold text-brand-ink">Grand Total{currency ? ` (${currency})` : ''}</span>
        <span className="text-xl font-bold tabular-nums text-brand-ink">{fmt.money(totals.total)}</span>
      </div>
    </section>
  );
}

/** Notes / Terms & Conditions block (uncontrolled-friendly: pass register('remarks')). */
export function NotesSection({ title = 'Notes', fields }: { title?: string; fields: { label: string; props: React.ComponentProps<typeof Textarea> }[] }) {
  return (
    <DocSection title={title} bodyClassName="grid grid-cols-1 gap-4 p-5 pt-3 md:grid-cols-2">
      {fields.map((f) => (
        <Field key={f.label} label={f.label}>
          <Textarea rows={3} {...f.props} />
        </Field>
      ))}
    </DocSection>
  );
}
