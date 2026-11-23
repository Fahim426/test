import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { formScreenOf } from '@/lib/docRoutes';
import { useWorkspaceStore } from '@/store/workspace';
import { StatusBadge } from '@/components/ui';
import { DocSection } from './DocumentLayout';
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
    <button onClick={() => openDoc(d, fallbackType)} className="inline-flex items-center gap-1.5 rounded border border-app-border bg-white px-1.5 py-0.5 text-[11px] text-brand hover:bg-brand-light" title={d.typeLabel ?? d.type}>
      {d.typeLabel && <span className="text-slate-500">{d.typeLabel}</span>}
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
      <div className="flex items-start gap-2">
        <span className="w-28 shrink-0 pt-0.5 text-[11px] font-semibold text-slate-500">{title}</span>
        <div className="flex flex-wrap gap-1">{docs.map((x) => <DocChip key={`${x.type}-${x.id}`} d={x} />)}</div>
      </div>
    ) : null;

  return (
    <>
    <PendingNote docType={docType} docId={docId} />
    <DocSection title={`Document Flow${chain ? ` - ${chain.label}` : ''}`} bodyClassName="p-3">
      {q.isLoading && <div className="text-[12px] text-slate-500">Loading flow...</div>}
      {q.isError && <div className="text-[12px] text-slate-500">Document flow is not available.</div>}
      {stages.length > 0 && (
        <div className="flex flex-wrap items-center gap-y-2 pb-2">
          {stages.map((s, i) => {
            const first = s.docs[0];
            return (
              <Fragment key={`${s.key ?? s.type ?? s.label}-${i}`}>
                {i > 0 && <ChevronRight size={14} className="mx-1 text-slate-400" />}
                <button
                  disabled={!first || s.state === 'current'}
                  onClick={() => first && openDoc(first, s.type)}
                  title={s.docs.map((x) => x.no).join(', ') || 'Not created yet'}
                  className={cn(
                    'flex flex-col items-center rounded border px-3 py-1 text-[12px] disabled:cursor-default',
                    s.state === 'done' && 'border-green-400 bg-green-50 text-green-800 hover:bg-green-100',
                    s.state === 'current' && 'border-brand bg-brand-light font-semibold text-brand',
                    s.state === 'pending' && 'border-slate-300 bg-white text-slate-400',
                  )}
                >
                  <span className="text-[13px] leading-4">{icon[s.state]}</span>
                  <span>{s.label}</span>
                  <span className="text-[10px] leading-3">{s.docs.length > 1 ? `${s.docs.length} docs` : (first?.no ?? '')}</span>
                </button>
              </Fragment>
            );
          })}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Group title="Created From" docs={d?.createdFrom} />
        <Group title="Converted To" docs={d?.convertedTo} />
        <Group title="Related Documents" docs={d?.related} />
      </div>
    </DocSection>
    </>
  );
}
