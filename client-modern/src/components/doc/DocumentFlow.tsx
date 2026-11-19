import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { formScreenOf } from '@/lib/docRoutes';
import { useWorkspaceStore } from '@/store/workspace';
import { StatusBadge } from '@/components/ui';
import { DocSection } from './DocumentLayout';
import { cn } from '@/lib/cn';

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

  return (
    <DocSection title={`Document Flow${chain ? ` · ${chain.label}` : ''}`} bodyClassName="p-5 pt-3">
      {q.isLoading && <div className="skeleton h-14 w-full" />}
      {q.isError && <div className="text-[13px] text-ink-muted">Document flow is not available.</div>}
      {stages.length > 0 && (
        <div className="flex items-start overflow-x-auto pb-3">
          {stages.map((s, i) => {
            const first = s.docs[0];
            return (
              <Fragment key={`${s.key ?? s.type ?? s.label}-${i}`}>
                {i > 0 && <span className={cn('mt-[15px] h-0.5 min-w-[28px] flex-1 rounded-full', stages[i - 1].state === 'done' ? 'bg-success' : 'bg-line-strong')} />}
                <button
                  disabled={!first || s.state === 'current'}
                  onClick={() => first && openDoc(first, s.type)}
                  title={s.docs.map((x) => x.no).join(', ') || 'Not created yet'}
                  className="group flex min-w-[88px] flex-col items-center gap-1 px-1 text-center disabled:cursor-default"
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full border-2 text-[13px] font-semibold transition',
                      s.state === 'done' && 'border-success bg-success text-white group-hover:brightness-95 dark:text-[#0c0d14]',
                      s.state === 'current' && 'border-brand bg-brand-soft text-brand ring-4 ring-brand/15',
                      s.state === 'pending' && 'border-line-strong bg-surface text-ink-faint',
                    )}
                  >
                    {icon[s.state]}
                  </span>
                  <span className={cn('text-[13px]', s.state === 'current' ? 'font-semibold text-ink' : s.state === 'done' ? 'font-medium text-ink' : 'text-ink-faint')}>{s.label}</span>
                  <span className="max-w-[110px] truncate text-[11px] text-ink-faint">{s.docs.length > 1 ? `${s.docs.length} docs` : (first?.no ?? '')}</span>
                </button>
              </Fragment>
            );
          })}
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        <Group title="Created From" docs={d?.createdFrom} />
        <Group title="Converted To" docs={d?.convertedTo} />
        <Group title="Related Documents" docs={d?.related} />
      </div>
    </DocSection>
  );
}
