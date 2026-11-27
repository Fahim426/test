import { Children, Fragment, isValidElement, ReactElement, ReactNode, useContext, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MoreHorizontal, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, ButtonProps, LoadingBlock, Menu, Modal, SectionHeader, StatusBadge, Textarea, Field } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useWorkspaceStore } from '@/store/workspace';
import { useAuth } from '@/store/auth';
import { useBuStore, useDocBuStore } from '@/store/bu';
import { TabIdContext } from '@/store/tabContext';
import { api, Paged } from '@/lib/api';
import { getScreenMeta } from '@/store/screenMeta';
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
        <BuPicker hasNo={!!docNo} />
        <CloseToList />
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

/** list screen of a form screen: product-form -> products, sales-invoice-form -> sales-invoices (if registered) */
function listOf(screenId: string): string | null {
  if (!screenId.endsWith('-form')) return null;
  const base = screenId.slice(0, -5);
  for (const c of [`${base}s`, `${base}es`, base.replace(/y$/, 'ies')]) if (getScreenMeta(c)) return c;
  return null;
}

/** forms that are not Business Unit documents (masters, HR, opening journal, selection screens) */
const NO_BU_FORMS = new Set(['customer-form', 'supplier-form', 'product-form', 'hr-employee-form', 'hr-leave-form', 'hr-payroll-form', 'opening-balance-form', 'comparative-statement-form']);

/**
 * Admin with "All BUs" selected: a new document is created in the Business Unit picked here (required before saving).
 * With a BU selected in the top bar, or for other users, the document simply belongs to that BU and nothing is shown.
 */
function BuPicker({ hasNo }: { hasNo: boolean }) {
  const tabId = useContext(TabIdContext);
  const screenId = useWorkspaceStore((s) => s.tabs.find((t) => t.id === tabId)?.screenId ?? '');
  const isAdmin = useAuth((s) => s.user?.role) === 'Admin';
  const selected = useBuStore((s) => s.selectedBuId);
  const picked = useDocBuStore((s) => (tabId ? s.byTab[tabId] : undefined));
  const setDocBu = useDocBuStore((s) => s.setDocBu);
  // the Business Unit the admin works in: chosen once, remembered across refreshes, used for every new document
  const userId = useAuth(s => s.user?.id ?? 0);
  const remembered = useBuStore(s => s.newDocBuUserId === userId ? s.newDocBuId : null);
  const setRemembered = useBuStore((s) => s.setNewDocBuId);
  const show = isAdmin && selected === null && !!tabId && screenId.endsWith('-form') && !NO_BU_FORMS.has(screenId) && !hasNo;
  const active = useWorkspaceStore((s) => s.activeId === tabId);
  const [dismissed, setDismissed] = useState(false);
  const list = useQuery({
    queryKey: ['business-units'],
    enabled: show,
    staleTime: 300_000,
    queryFn: async () => (await api.get<Paged<{ id: number; code: string; name: string; isActive: boolean }>>('/business-units', { params: { pageSize: 100 } })).data.rows.filter((b) => b.isActive),
  });
  // once the document has its number it is saved: stop forcing the BU on later requests of this tab
  useEffect(() => {
    if (hasNo && tabId && picked) setDocBu(tabId, null);
  }, [hasNo, tabId, picked, setDocBu]);
  // a new document starts in the remembered BU (no prompt); forget it if that BU no longer exists
  const known = list.data ? list.data.some((b) => b.id === remembered) : true;
  useEffect(() => {
    if (!show || !tabId || !list.data) return;
    if (remembered && !known) setRemembered(null, userId);
    else if (remembered && !picked) setDocBu(tabId, remembered);
  }, [show, tabId, list.data, remembered, known, picked, setDocBu, setRemembered, userId]);
  const choose = (id: number | null) => {
    if (!tabId) return;
    setDocBu(tabId, id);
    if (id) setRemembered(id, userId); // keep it for the next documents; switch any time with this field
  };
  if (!show) return null;
  // the prompt appears only when no BU has been chosen yet (never after a refresh or for the next document)
  const prompt = active && !picked && (!remembered || !known) && !dismissed && !!list.data;
  return (
    <>
    <Modal
      open={prompt}
      title="Which Business Unit is this document for?"
      width="sm"
      onClose={() => setDismissed(true)}
      footer={<Button onClick={() => setDismissed(true)}>Choose later</Button>}
    >
      <p className="mb-3 text-[13px] text-ink-muted">The top bar is on All BUs, so documents need one Business Unit. Your choice is remembered for the next documents; change it any time with the Business Unit field on a new document.</p>
      <div className="flex flex-wrap gap-2">
        {(list.data ?? []).map((b) => (
          <Button key={b.id} variant="primary" onClick={() => choose(b.id)}>
            {b.code}
          </Button>
        ))}
      </div>
    </Modal>
    <label className={cn('flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[12px]', picked ? 'border-brand/40 bg-brand-soft' : 'border-warning/50 bg-warning-soft')} title="Business Unit of this new document (the top bar is on All BUs)">
      <span className="font-medium text-ink-muted">Business Unit</span>
      <select className="cursor-pointer bg-transparent py-1 font-medium text-ink outline-none" value={picked ?? ''} onChange={(e) => choose(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Select...</option>
        {(list.data ?? []).map((b) => (
          <option key={b.id} value={b.id}>{b.code}</option>
        ))}
      </select>
    </label>
    </>
  );
}

/** Header Close: closes this window (asks if there are unsaved changes) and returns to its list. */
function CloseToList() {
  const tab = useWorkspaceStore((s) => s.tabs.find((t) => t.id === s.activeId));
  const close = useWorkspaceStore((s) => s.close);
  const open = useWorkspaceStore((s) => s.open);
  if (!tab) return null;
  return (
    <Button
      size="md"
      icon={X}
      title="Close and go back to the list"
      onClick={() => {
        const list = listOf(tab.screenId);
        const before = useWorkspaceStore.getState().tabs.length;
        close(tab.id);
        // only when the window really closed (not cancelled on the unsaved-changes prompt)
        if (list && useWorkspaceStore.getState().tabs.length < before) open({ screenId: list });
      }}
    >
      Close
    </Button>
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
    <section data-tour={'demo-section-'+title.toLowerCase().replace(/[^a-z0-9]+/g,'-')} className={cn(cardCls, className)}>
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
    <section data-tour={'demo-section-'+title.toLowerCase().replace(/[^a-z0-9]+/g,'-')} className={cn(cardCls, className)}>
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
    <section data-tour="demo-document-totals" className={cn(cardCls, 'ml-auto w-full max-w-[400px] overflow-hidden', className)}>
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
