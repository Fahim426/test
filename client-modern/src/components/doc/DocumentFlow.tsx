import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { formScreenOf } from '@/lib/docRoutes';
import { useWorkspaceStore } from '@/store/workspace';
import { StatusBadge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { PendingNote } from './PendingNote';

export interface FlowDoc {
  type?: string;
  id: number;
  no: string;
  status?: string | null;
  screenId?: string;
  typeLabel?: string;
  party?: string | null;
}
export interface FlowStage {
  key?: string;
  type?: string;
  label: string;
  state: 'done' | 'current' | 'pending';
  docs: FlowDoc[];
}
interface FlowResponse {
  /** server: several chains, one primary */
  chains?: { key: string; label: string; primary?: boolean; applicable?: boolean; stages: FlowStage[] }[];
  /** simple form (per spec): single list of stages */
  stages?: FlowStage[];
  createdFrom?: FlowDoc[];
  convertedTo?: FlowDoc[];
  related?: FlowDoc[];
}

const icon = { done: '✓', current: '●', pending: '○' } as const;

function useOpenDoc() {
  const open = useWorkspaceStore((s) => s.open);
  return (d: FlowDoc, fallbackType?: string) => {
    const type = d.type ?? fallbackType;
    const screenId = d.screenId ?? (type ? formScreenOf(type) : undefined);
    if (screenId) open({ screenId, params: { id: d.id }, title: d.no });
  };
}

function DocChip({ d, fallbackType }: { d: FlowDoc; fallbackType?: string }) {
  const openDoc = useOpenDoc();
  return (
    <button onClick={() => openDoc(d, fallbackType)} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-brand shadow-card transition hover:border-brand/40 hover:bg-brand-soft" title={d.typeLabel ?? d.type}>
      {d.typeLabel && <span className="text-ink-muted">{d.typeLabel}</span>}
      <span className="font-medium">{d.no}</span>
      <StatusBadge status={d.status} />
    </button>
  );
}

/**
 * Visual document flow (spec 49): Quotation ✓ → Sales Order ✓ → Picking ✓ → Delivery ● → Invoice ○ → Receipt ○.
 * Clicking a stage opens its (first) linked document; Created From / Converted To / Related listed below.
 * `docType` is UPPER_SNAKE (e.g. SALES_ORDER). Renders nothing until the document has an id.
 */
export function DocumentFlow({ docType, docId }: { docType: string; docId?: number | string }) {
  const openDoc = useOpenDoc();
  const [more, setMore] = useState(false);
  const q = useQuery({
    queryKey: ['doc-flow', docType, docId],
    enabled: !!docId,
    retry: false,
    queryFn: async () => (await api.get<FlowResponse>(`/doc-flow/${docType}/${docId}`)).data,
  });
  if (!docId) return null;
  const d = q.data;
  const chain = d?.chains?.find((c) => c.primary) ?? d?.chains?.find((c) => c.applicable);
  const stages = d?.stages ?? chain?.stages ?? [];
  const Group = ({ title, docs }: { title: string; docs?: FlowDoc[] }) =>
    docs && docs.length ? (
      <div className="flex items-start gap-3">
        <span className="w-32 shrink-0 pt-1 text-xs font-medium text-ink-muted">{title}</span>
        <div className="flex flex-wrap gap-1.5">{docs.map((x) => <DocChip key={`${x.type}-${x.id}`} d={x} />)}</div>
      </div>
    ) : null;

  const count = (d?.createdFrom?.length ?? 0) + (d?.convertedTo?.length ?? 0) + (d?.related?.length ?? 0);
  // compact one-line strip: small step pills joined by arrows; related documents fold out below
  return (
    <>
    <PendingNote docType={docType} docId={docId} />
    <section className="rounded-card border border-line bg-surface px-3 py-1.5 shadow-card">
      <div className="flex min-h-[30px] items-center gap-2">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{chain?.label ? `Flow · ${chain.label}` : 'Flow'}</span>
        {q.isLoading && <div className="skeleton h-5 flex-1" />}
        {q.isError && <span className="text-xs text-ink-muted">Not available</span>}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {stages.map((s, i) => {
            const first = s.docs[0];
            return (
              <Fragment key={`${s.key ?? s.type ?? s.label}-${i}`}>
                {i > 0 && <ChevronRight size={13} className={cn('shrink-0', stages[i - 1].state === 'done' ? 'text-success' : 'text-ink-faint')} />}
                <button
                  disabled={!first || s.state === 'current'}
                  onClick={() => first && openDoc(first, s.type)}
                  title={s.docs.map((x) => x.no).join(', ') || 'Not created yet'}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] transition disabled:cursor-default',
                    s.state === 'done' && 'border-success/30 bg-success-soft text-ink hover:border-success',
                    s.state === 'current' && 'border-brand/40 bg-brand-soft font-semibold text-brand-ink',
                    s.state === 'pending' && 'border-line bg-surface text-ink-faint',
                  )}
                >
                  <span className={cn('text-[11px] leading-none', s.state === 'done' ? 'text-success' : s.state === 'current' ? 'text-brand' : 'text-ink-faint')}>{icon[s.state]}</span>
                  <span>{s.label}</span>
                  {s.docs.length > 1 ? <span className="text-[11px] text-ink-faint">×{s.docs.length}</span> : first?.no && s.state !== 'current' ? <span className="max-w-[110px] truncate text-[11px] text-ink-faint">{first.no}</span> : null}
                </button>
              </Fragment>
            );
          })}
        </div>
        {count > 0 && (
          <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-brand hover:underline">
            {more ? 'Less' : `Related (${count})`}
            <ChevronDown size={13} className={cn('transition-transform', more && 'rotate-180')} />
          </button>
        )}
      </div>
      {more && (
        <div className="mb-1 mt-2 flex flex-col gap-2 border-t border-line pt-2">
          <Group title="Created From" docs={d?.createdFrom} />
          <Group title="Converted To" docs={d?.convertedTo} />
          <Group title="Related Documents" docs={d?.related} />
        </div>
      )}
    </section>
    </>
  );
}
