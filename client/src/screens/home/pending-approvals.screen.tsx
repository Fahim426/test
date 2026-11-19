import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, ShieldCheck, X } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { DataTable, Column } from '@/components/DataTable';
import { Button, Field, Modal, Textarea } from '@/components/ui';
import { docRoute, formScreenOf } from '@/lib/docRoutes';
import { fmt } from '@/lib/format';
import { toast } from '@/store/toast';
import { useOpenScreen } from '@/store/workspace';
import type { ScreenDef } from '@/screens/types';

interface ApprovalRow {
  id: number;
  docType: string;
  docId: number;
  docNo?: string | null;
  docLabel?: string;
  amount?: number | string | null;
  status: string;
  steps?: string[];
  currentStep?: number;
  currentRole?: string | null;
  canAct?: boolean;
  createdAt?: string;
  requester?: { id: number; username: string; fullName?: string } | null;
}

type Target = { mode: 'approve' | 'reject'; rows: ApprovalRow[]; clear?: () => void };

function PendingApprovalsScreen() {
  const open = useOpenScreen();
  const qc = useQueryClient();
  const [target, setTarget] = useState<Target | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const openDoc = (r: ApprovalRow) => open(formScreenOf(r.docType), { id: r.docId }, r.docNo ?? undefined);
  const ask = (mode: Target['mode'], rows: ApprovalRow[], clear?: () => void) => {
    setComment('');
    setTarget({ mode, rows, clear });
  };

  const submit = async () => {
    if (!target) return;
    if (target.mode === 'reject' && !comment.trim()) {
      toast.error('A comment is required when rejecting');
      return;
    }
    setBusy(true);
    let ok = 0;
    const errs: string[] = [];
    for (const r of target.rows) {
      try {
        await api.post(`/approvals/${r.id}/${target.mode}`, { comment: comment.trim() || undefined });
        ok++;
      } catch (e) {
        errs.push(`${r.docNo ?? r.id}: ${apiError(e)}`);
      }
    }
    setBusy(false);
    if (ok) toast.success(`${ok} document${ok > 1 ? 's' : ''} ${target.mode === 'approve' ? 'approved' : 'rejected'}`);
    errs.forEach((m) => toast.error(m));
    if (!errs.length) setTarget(null);
    target.clear?.();
    qc.invalidateQueries({ queryKey: ['table'] });
    qc.invalidateQueries({ queryKey: ['pending-approvals-count'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const columns: Column<ApprovalRow>[] = [
    { key: 'docNo', header: 'Doc No', sortable: false, filter: 'text', cell: (r) => <button className="text-brand underline" onClick={() => openDoc(r)}>{r.docNo ?? `#${r.docId}`}</button> },
    { key: 'docLabel', header: 'Type', sortable: false, accessor: (r) => r.docLabel ?? docRoute(r.docType)?.label ?? fmt.status(r.docType), filter: 'text' },
    { key: 'amount', header: 'Amount', type: 'money', sortable: false },
    { key: 'requester', header: 'Requested By', sortable: false, accessor: (r) => r.requester?.fullName || r.requester?.username || '' },
    { key: 'currentRole', header: 'Step / Role', sortable: false, accessor: (r) => `${(r.currentStep ?? 0) + 1}/${r.steps?.length ?? 1} - ${r.currentRole ?? ''}` },
    { key: 'createdAt', header: 'Date', type: 'datetime', sortable: false },
  ];

  return (
    <>
      <DataTable<ApprovalRow>
        tableKey="pending-approvals"
        url="/approvals"
        queryKey="approvals-pending"
        filters={{ status: 'PENDING', mine: 1 }}
        columns={columns}
        exportName="Pending Approvals"
        onRowDoubleClick={openDoc}
        rowActions={[
          { label: 'Open document', icon: ExternalLink, onClick: openDoc },
          { label: 'Approve', icon: Check, onClick: (r) => ask('approve', [r]), hidden: (r) => r.canAct === false },
          { label: 'Reject', icon: X, danger: true, onClick: (r) => ask('reject', [r]), hidden: (r) => r.canAct === false },
        ]}
        bulkActions={[
          { label: 'Approve selected', icon: ShieldCheck, onClick: (rows, clear) => ask('approve', rows, clear) },
          { label: 'Reject selected', icon: X, danger: true, onClick: (rows, clear) => ask('reject', rows, clear) },
        ]}
      />
      <Modal
        open={!!target}
        onClose={() => !busy && setTarget(null)}
        title={target ? `${target.mode === 'approve' ? 'Approve' : 'Reject'} ${target.rows.length === 1 ? (target.rows[0].docNo ?? 'document') : `${target.rows.length} documents`}` : ''}
        width="sm"
        footer={
          <>
            <Button onClick={() => setTarget(null)} disabled={busy}>Cancel</Button>
            <Button variant={target?.mode === 'reject' ? 'danger' : 'primary'} loading={busy} onClick={submit}>
              {target?.mode === 'reject' ? 'Reject' : 'Approve'}
            </Button>
          </>
        }
      >
        <Field label="Comment" required={target?.mode === 'reject'}>
          <Textarea rows={3} autoFocus value={comment} onChange={(e) => setComment(e.target.value)} placeholder={target?.mode === 'reject' ? 'Reason for rejection' : 'Optional'} />
        </Field>
      </Modal>
    </>
  );
}

export default [{ id: 'pending-approvals', title: 'Pending Approvals', icon: ShieldCheck, component: PendingApprovalsScreen }] satisfies ScreenDef[];
