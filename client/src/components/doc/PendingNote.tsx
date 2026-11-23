import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RotateCcw, XCircle } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { formScreenOf } from '@/lib/docRoutes';
import { useWorkspaceStore } from '@/store/workspace';
import { toast } from '@/store/toast';
import { Button, Field, Modal, StatusBadge, Textarea } from '@/components/ui';

export interface PendingLine {
  key: string;
  productId: number | null;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  sourceQty: number;
  processedQty: number;
  closedQty: number;
  pendingQty: number;
}
export interface PendingGroup {
  stage: string;
  label: string;
  sourceType: string;
  sourceLabel: string;
  sourceId: number;
  sourceNo: string;
  sourceStatus: string | null;
  targetType: string;
  targetLabel: string;
  targets: { id: number; no: string; status: string | null }[];
  lines: PendingLine[];
  closures: { id: number; itemKey: string; productId: number | null; code?: string | null; name?: string | null; description?: string | null; qty: number; reason: string; createdAt: string }[];
  canClose?: boolean;
}
interface PendingResponse {
  asSource: PendingGroup[];
  asTarget: PendingGroup[];
}

const itemLabel = (l: { code?: string | null; name?: string | null; description?: string | null; key: string }) => (
  <>
    {l.code && <span className="font-medium text-slate-800">{l.code}</span>}
    <span className="text-slate-500">{l.code ? ' · ' : ''}{l.name ?? l.description ?? l.key}</span>
  </>
);

/**
 * "Pending items" note: what this document still has to pass on (as a source, with Close-with-reason) and what the
 * documents it came from still have pending (as a target). Fetched separately from the document and rendered only
 * when there is something to show, so it never delays the document screen.
 */
export function PendingNote({ docType, docId }: { docType: string; docId?: number | string }) {
  const qc = useQueryClient();
  const open = useWorkspaceStore((s) => s.open);
  const [closing, setClosing] = useState<{ g: PendingGroup; line?: PendingLine } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  // key under 'doc-flow' so the existing save / convert invalidation refreshes it as well
  const q = useQuery({
    queryKey: ['doc-flow', 'pending', docType, docId],
    enabled: !!docId,
    retry: false,
    staleTime: 15_000,
    queryFn: async () => (await api.get<PendingResponse>(`/pending/doc/${docType}/${docId}`)).data,
  });
  const d = q.data;
  if (!docId || !d || (!d.asSource.length && !d.asTarget.length)) return null;

  const openDoc = (type: string, id: number, no: string) => {
    const screenId = formScreenOf(type);
    if (screenId) open({ screenId, params: { id }, title: no });
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['doc-flow'] });
    qc.invalidateQueries({ queryKey: ['doc'] });
    qc.invalidateQueries({ queryKey: ['table'] });
  };
  const submitClose = async () => {
    if (!closing) return;
    setBusy(true);
    try {
      await api.post('/pending/close', { stage: closing.g.stage, sourceId: closing.g.sourceId, key: closing.line?.key, reason });
      toast.success(closing.line ? 'Pending item closed' : 'All pending items closed');
      setClosing(null);
      setReason('');
      refresh();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  const reopen = async (id: number) => {
    try {
      await api.delete(`/pending/closures/${id}`);
      toast.success('Closed item is pending again');
      refresh();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const th = 'px-2 py-0.5 text-left text-[11px] font-semibold text-slate-500';
  const td = 'px-2 py-0.5 text-[12px]';
  const num = `${td} text-right tabular-nums`;

  return (
    <section className="border border-amber-300 bg-white">
      <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-2 py-1">
        <AlertTriangle size={14} className="text-amber-700" />
        <h3 className="text-[12px] font-semibold text-slate-800">Pending items</h3>
        <span className="text-xs text-slate-500">Items not carried into the next document</span>
      </div>
      <div className="flex flex-col gap-3 p-2">
        {d.asTarget.map((g) => (
          <div key={`t-${g.stage}-${g.sourceId}`}>
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-slate-500">Still pending on</span>
              <button className="font-medium text-brand hover:underline" onClick={() => openDoc(g.sourceType, g.sourceId, g.sourceNo)}>
                {g.sourceLabel} {g.sourceNo}
              </button>
              <StatusBadge status={g.sourceStatus} />
              <span className="text-slate-500">· not included in this {g.targetLabel.toLowerCase()}</span>
            </div>
            <table className="w-full border border-app-border">
              <thead className="bg-slate-50">
                <tr><th className={th}>Item</th><th className={`${th} text-right`}>On {g.sourceLabel}</th><th className={`${th} text-right`}>Carried</th><th className={`${th} text-right`}>Closed</th><th className={`${th} text-right`}>Pending</th></tr>
              </thead>
              <tbody>
                {g.lines.map((l) => (
                  <tr key={l.key} className="border-t border-app-border">
                    <td className={td}>{itemLabel(l)}</td>
                    <td className={num}>{fmt.qty(l.sourceQty)}</td>
                    <td className={num}>{fmt.qty(l.processedQty)}</td>
                    <td className={num}>{l.closedQty ? fmt.qty(l.closedQty) : ''}</td>
                    <td className={`${num} font-semibold text-amber-700`}>{fmt.qty(l.pendingQty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {d.asSource.map((g) => (
          <div key={`s-${g.stage}`}>
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-semibold text-slate-800">{g.label}</span>
              {g.targets.length > 0 && <span className="text-slate-500">· {g.targetLabel}:</span>}
              {g.targets.map((t) => (
                <button key={t.id} className="font-medium text-brand hover:underline" onClick={() => openDoc(g.targetType, t.id, t.no)}>{t.no}</button>
              ))}
              {g.canClose && g.lines.length > 1 && (
                <Button size="sm" variant="ghost" icon={XCircle} className="ml-auto" onClick={() => setClosing({ g })}>Close all pending</Button>
              )}
            </div>
            {g.lines.length > 0 && (
              <table className="w-full border border-app-border">
                <thead className="bg-slate-50">
                  <tr><th className={th}>Item</th><th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>In {g.targetLabel}</th><th className={`${th} text-right`}>Closed</th><th className={`${th} text-right`}>Pending</th>{g.canClose && <th className={th} />}</tr>
                </thead>
                <tbody>
                  {g.lines.map((l) => (
                    <tr key={l.key} className="border-t border-app-border">
                      <td className={td}>{itemLabel(l)}</td>
                      <td className={num}>{fmt.qty(l.sourceQty)}</td>
                      <td className={num}>{fmt.qty(l.processedQty)}</td>
                      <td className={num}>{l.closedQty ? fmt.qty(l.closedQty) : ''}</td>
                      <td className={`${num} font-semibold text-amber-700`}>{fmt.qty(l.pendingQty)}</td>
                      {g.canClose && (
                        <td className={`${td} w-[1%] whitespace-nowrap text-right`}>
                          <Button size="sm" variant="ghost" onClick={() => setClosing({ g, line: l })}>Close</Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {g.closures.length > 0 && (
              <div className="mt-2 flex flex-col gap-1 text-xs text-slate-500">
                {g.closures.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-1.5">
                    <span>Closed {fmt.qty(c.qty)} × {c.code ?? c.description ?? c.name}{c.code && c.name ? ` ${c.name}` : ''} on {fmt.date(c.createdAt)}: “{c.reason}”</span>
                    {g.canClose && (
                      <button className="inline-flex items-center gap-0.5 text-brand hover:underline" onClick={() => reopen(c.id)}>
                        <RotateCcw size={11} /> Reopen
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <Modal
        open={!!closing}
        title={closing?.line ? 'Close pending item' : 'Close all pending items'}
        onClose={() => !busy && setClosing(null)}
        width="sm"
        footer={
          <>
            <Button onClick={() => setClosing(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={reason.trim().length < 3} onClick={submitClose}>Close pending</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[12px]">
          <p className="text-slate-500">
            {closing?.line ? (
              <>{fmt.qty(closing.line.pendingQty)} × {closing.line.code ?? closing.line.description} will no longer be pending on {closing.g.sourceLabel} {closing.g.sourceNo}.</>
            ) : (
              <>All {closing?.g.lines.length} pending items on {closing?.g.sourceLabel} {closing?.g.sourceNo} will be closed.</>
            )}{' '}
            This is recorded in the audit log and can be reopened.
          </p>
          <Field label="Reason" required>
            <Textarea rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer no longer needs this item" />
          </Field>
        </div>
      </Modal>
    </section>
  );
}
