import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { toast } from '@/store/toast';
import { useAuth } from '@/store/auth';
import { fmt } from '@/lib/format';
import { Badge, Button, Input, StatusBadge } from '@/components/ui';
import { DocSection } from './DocumentLayout';
import { cn } from '@/lib/cn';

export interface ApprovalAction {
  id: number;
  step: number;
  roleName: string;
  username?: string | null;
  action: string;
  comment?: string | null;
  createdAt: string;
}
/** `approval` field returned by GET /<doc>/:id (latest ApprovalRequest). `steps` may be a JSON string or array. */
export interface ApprovalRequestLike {
  id: number;
  status: string;
  steps: string | string[];
  currentStep: number;
  amount?: number | string;
  createdAt?: string;
  actions?: ApprovalAction[];
}

const stepsOf = (s: string | string[]): string[] => {
  if (Array.isArray(s)) return s;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** Approval steps timeline + approve/reject buttons when the current user's role matches the pending step. */
export function ApprovalSection({ approval, onChanged }: { approval?: ApprovalRequestLike | null; onChanged?: () => void }) {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const act = useMutation({
    mutationFn: async (v: { kind: 'approve' | 'reject' }) => api.post(`/approvals/${approval!.id}/${v.kind}`, { comment: comment || undefined }),
    onSuccess: (_d, v) => {
      toast.success(v.kind === 'approve' ? 'Approved' : 'Rejected');
      setComment('');
      qc.invalidateQueries();
      onChanged?.();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (!approval)
    return (
      <DocSection title="Approval">
        <div className="text-[12px] text-slate-500">No approval request for this document.</div>
      </DocSection>
    );

  const steps = stepsOf(approval.steps);
  const pending = approval.status === 'PENDING';
  const currentRole = pending ? steps[approval.currentStep] : undefined;
  const canAct = pending && !!user && (user.role === 'Admin' || user.role === currentRole);

  return (
    <DocSection title="Approval" right={<StatusBadge status={approval.status} />}>
      <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
        {steps.map((r, i) => {
          const done = approval.status === 'APPROVED' || i < approval.currentStep;
          const cur = pending && i === approval.currentStep;
          const rejected = approval.status === 'REJECTED' && i === approval.currentStep;
          return (
            <div key={i} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-5 bg-slate-300" />}
              <span className={cn('flex items-center gap-1 rounded border px-2 py-0.5 text-[12px]', done ? 'border-green-400 bg-green-50 text-green-800' : rejected ? 'border-red-400 bg-red-50 text-red-800' : cur ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-slate-300 text-slate-500')}>
                <span>{done ? '✓' : rejected ? '✕' : cur ? '●' : '○'}</span> {r}
              </span>
            </div>
          );
        })}
        {approval.amount !== undefined && <Badge className="ml-auto">Amount {fmt.money(approval.amount)}</Badge>}
      </div>
      {approval.actions && approval.actions.length > 0 && (
        <table className="mb-2 w-full text-[12px]">
          <thead>
            <tr className="border-b border-app-border text-left text-[11px] text-slate-500">
              <th className="py-0.5">Step</th><th>User</th><th>Action</th><th>Comment</th><th>Date</th>
            </tr>
          </thead>
          <tbody>
            {approval.actions.map((a) => (
              <tr key={a.id} className="border-b border-slate-100">
                <td className="py-0.5">{a.roleName}</td>
                <td>{a.username}</td>
                <td><StatusBadge status={a.action} /></td>
                <td>{a.comment}</td>
                <td className="text-slate-500">{fmt.dateTime(a.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canAct && (
        <div className="flex items-center gap-2 border-t border-app-border pt-2">
          <Input placeholder="Comment (required to reject)" value={comment} onChange={(e) => setComment(e.target.value)} className="max-w-[360px]" />
          <Button variant="primary" icon={Check} loading={act.isPending} onClick={() => act.mutate({ kind: 'approve' })}>Approve</Button>
          <Button variant="danger" icon={X} disabled={act.isPending} onClick={() => (comment.trim() ? act.mutate({ kind: 'reject' }) : toast.warning('Enter a comment to reject'))}>Reject</Button>
          <span className="text-[11px] text-slate-500">Waiting for: {currentRole}</span>
        </div>
      )}
    </DocSection>
  );
}
