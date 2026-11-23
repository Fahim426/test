import { ReactNode, useContext, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Modal } from '@/components/ui';
import { useWorkspaceStore } from '@/store/workspace';
import { useAuth } from '@/store/auth';
import { useBuStore, useDocBuStore } from '@/store/bu';
import { TabIdContext } from '@/store/tabContext';
import { api, Paged } from '@/lib/api';
import { getScreenMeta } from '@/store/screenMeta';
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
        <div className="flex-1" /><BuPicker hasNo={!!docNo} /><CloseToList />
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
    <section data-tour={'demo-section-'+title.toLowerCase().replace(/[^a-z0-9]+/g,'-')} className={cn('border border-app-border bg-white', className)}>
      <SectionHeader title={title} right={right} className="border-x-0 border-t-0" />
      <div className={cn('grid gap-x-3 gap-y-2 p-3', cols)}>{children}</div>
    </section>
  );
}

/** A plain titled section containing arbitrary content (items grid, terms, ...). */
export function DocSection({ title, children, right, className, bodyClassName }: { title: string; children: ReactNode; right?: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section data-tour={'demo-section-'+title.toLowerCase().replace(/[^a-z0-9]+/g,'-')} className={cn('border border-app-border bg-white', className)}>
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
    <section data-tour="demo-document-totals" className={cn('border border-app-border bg-white', className)}>
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
  if (!show) return null;
  // prompt as soon as a new document is opened (only in the visible tab); "Choose later" leaves the header field
  const prompt = active && !picked && !dismissed;
  return (
    <>
    <Modal
      open={prompt}
      title="Which Business Unit is this document for?"
      width="sm"
      onClose={() => setDismissed(true)}
      footer={<Button onClick={() => setDismissed(true)}>Choose later</Button>}
    >
      <p className="mb-3 text-[13px] text-ink-muted">The top bar is on All BUs, so this new document needs one Business Unit. Its journals and numbers follow it.</p>
      <div className="flex flex-wrap gap-2">
        {(list.data ?? []).map((b) => (
          <Button key={b.id} variant="primary" onClick={() => tabId && setDocBu(tabId, b.id)}>
            {b.code}
          </Button>
        ))}
      </div>
    </Modal>
    <label className={cn('flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[12px]', picked ? 'border-brand/40 bg-brand-soft' : 'border-warning/50 bg-warning-soft')} title="Business Unit of this new document (the top bar is on All BUs)">
      <span className="font-medium text-ink-muted">Business Unit</span>
      <select className="cursor-pointer bg-transparent py-1 font-medium text-ink outline-none" value={picked ?? ''} onChange={(e) => tabId && setDocBu(tabId, e.target.value ? Number(e.target.value) : null)}>
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
