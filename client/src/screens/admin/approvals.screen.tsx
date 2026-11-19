import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, GitBranch, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { ScreenDef } from '@/screens/types';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { toast } from '@/store/toast';
import { usePermission } from '@/store/auth';
import { Badge, Button, Checkbox, ConfirmDialog, Field, IconButton, Input, Modal, NumberInput, Select, StatusBadge, Tabs, Textarea } from '@/components/ui';
import { Column, DataTable, RowAction } from '@/components/DataTable';

interface Rule {
  id: number;
  docType: string;
  name: string;
  minAmount: number | string;
  maxAmount: number | string | null;
  steps: string[];
  isActive: boolean;
}
interface Meta {
  docTypes: string[];
  roles: { id: number; name: string }[];
}
interface ApprovalReq {
  id: number;
  docType: string;
  docLabel: string;
  docId: number;
  docNo: string;
  amount: number | string;
  steps: string[];
  currentStep: number;
  currentRole: string | null;
  status: string;
  canAct: boolean;
  createdAt: string;
  requester: { username: string; fullName: string } | null;
  actions: { id: number; step: number; roleName: string; username: string | null; action: string; comment: string | null; createdAt: string }[];
}

const useMeta = () => useQuery({ queryKey: ['admin', 'rule-meta'], queryFn: async () => (await api.get<Meta>('/approval-rules/meta')).data, staleTime: 30_000 });
const pretty = (t: string) => t.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');

function RuleModal({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const meta = useMeta();
  const [docType, setDocType] = useState(rule?.docType ?? '');
  const [name, setName] = useState(rule?.name ?? '');
  const [min, setMin] = useState(rule ? String(Number(rule.minAmount)) : '0');
  const [max, setMax] = useState(rule?.maxAmount != null ? String(Number(rule.maxAmount)) : '');
  const [steps, setSteps] = useState<string[]>(rule?.steps ?? ['']);
  const [active, setActive] = useState(rule?.isActive ?? true);

  const move = (i: number, d: number) =>
    setSteps((s) => {
      const n = [...s];
      const j = i + d;
      if (j < 0 || j >= n.length) return s;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        docType,
        name: name.trim(),
        minAmount: Number(min) || 0,
        maxAmount: max.trim() === '' ? null : Number(max),
        steps: steps.filter(Boolean),
        isActive: active,
      };
      return rule ? (await api.put(`/approval-rules/${rule.id}`, body)).data : (await api.post('/approval-rules', body)).data;
    },
    onSuccess: () => {
      toast.success('Rule saved');
      qc.invalidateQueries({ queryKey: ['table', 'admin-approval-rules'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const valid = docType && name.trim() && steps.filter(Boolean).length > 0;
  const roleOpts = (meta.data?.roles ?? []).map((r) => ({ value: r.name, label: r.name }));
  const example = (() => {
    const chain = steps.filter(Boolean);
    const rng = max.trim() === '' ? `${fmt.money(Number(min) || 0)} and above` : `${fmt.money(Number(min) || 0)} up to ${fmt.money(Number(max))}`;
    return chain.length ? `A ${pretty(docType || 'document')} with total ${rng} must be approved by: ${chain.join('  >  ')}.` : 'Add at least one approver role.';
  })();

  return (
    <Modal
      open
      width="md"
      onClose={onClose}
      title={rule ? `Edit Approval Rule - ${rule.name}` : 'New Approval Rule'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Field label="Document type" required>
          <Select placeholder="Select..." value={docType} onChange={(e) => setDocType(e.target.value)} options={(meta.data?.docTypes ?? []).map((d) => ({ value: d, label: pretty(d) }))} />
        </Field>
        <Field label="Rule name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Minimum amount">
          <NumberInput min={0} value={min} onChange={(e) => setMin(e.target.value)} />
        </Field>
        <Field label="Maximum amount" hint="Leave blank for no limit">
          <NumberInput min={0} value={max} onChange={(e) => setMax(e.target.value)} />
        </Field>
        <div className="col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-600">Approval steps (in order) *</span>
            <Button size="sm" icon={Plus} onClick={() => setSteps((s) => [...s, ''])} disabled={steps.length >= 10}>Add step</Button>
          </div>
          <div className="space-y-1">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="w-12 text-[11px] text-slate-500">Step {i + 1}</span>
                <Select className="flex-1" placeholder="Select role..." value={s} options={roleOpts} onChange={(e) => setSteps((x) => x.map((v, k) => (k === i ? e.target.value : v)))} />
                <IconButton icon={ArrowUp} label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
                <IconButton icon={ArrowDown} label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)} />
                <IconButton icon={Trash2} label="Remove" variant="danger" disabled={steps.length === 1} onClick={() => setSteps((x) => x.filter((_, k) => k !== i))} />
              </div>
            ))}
          </div>
        </div>
        <div className="col-span-2">
          <Checkbox label="Active" checked={active} onChange={(e) => setActive(e.target.checked)} />
        </div>
        <div className="col-span-2 rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-[11px] text-blue-900">
          <b>Example:</b> {example}
          <div className="mt-0.5 text-blue-700">Each step must be approved in order by a user holding that role. Active rules of the same document type cannot have overlapping amount ranges.</div>
        </div>
      </div>
    </Modal>
  );
}

function RulesTab() {
  const can = usePermission();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const [docType, setDocType] = useState('');
  const meta = useMeta();
  const del = useMutation({
    mutationFn: (r: Rule) => api.delete(`/approval-rules/${r.id}`),
    onSuccess: () => {
      toast.success('Rule deleted');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['table', 'admin-approval-rules'] });
    },
    onError: (e) => {
      toast.error(apiError(e));
      setDeleting(null);
    },
  });
  const columns: Column<Rule>[] = [
    { key: 'docType', header: 'Document', width: 170, cell: (r) => pretty(r.docType) },
    { key: 'name', header: 'Rule', sortable: false },
    { key: 'minAmount', header: 'Min Amount', type: 'money', sortable: false, width: 110 },
    { key: 'maxAmount', header: 'Max Amount', sortable: false, width: 110, align: 'right', cell: (r) => (r.maxAmount === null ? <span className="text-slate-400">No limit</span> : fmt.money(r.maxAmount)) },
    { key: 'steps', header: 'Approval Steps', sortable: false, cell: (r) => <span>{r.steps.map((s, i) => <span key={i}>{i > 0 && <span className="px-1 text-slate-400">{'>'}</span>}<Badge tone="blue">{s}</Badge></span>)}</span> },
    { key: 'isActive', header: 'Status', sortable: false, width: 80, cell: (r) => (r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
  ];
  const actions: RowAction<Rule>[] = [
    ...(can('approvals', 'edit') ? [{ label: 'Edit', icon: Pencil, onClick: (r: Rule) => setEditing(r) }] : []),
    ...(can('approvals', 'delete') ? [{ label: 'Delete', icon: Trash2, danger: true, onClick: (r: Rule) => setDeleting(r) }] : []),
  ];
  return (
    <div className="flex h-[calc(100vh-170px)] min-h-[300px] flex-col">
      <div className="border-b border-app-border bg-blue-50 px-3 py-1 text-[11px] text-blue-900">
        Example: Purchase Orders from 0 to 5,000 need <b>Manager</b>; 5,000 and above need <b>Manager &gt; Admin</b>. A document is routed to the first active rule whose range matches its total.
      </div>
      <DataTable<Rule>
        tableKey="admin-approval-rules"
        queryKey="admin-approval-rules"
        url="/approval-rules"
        columns={columns}
        filters={{ docType: docType || undefined }}
        rowActions={actions}
        exportName="Approval Rules"
        onRowDoubleClick={(r) => can('approvals', 'edit') && setEditing(r)}
        toolbarExtras={
          <>
            {can('approvals', 'create') && <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>New</Button>}
            <Select className="w-44" placeholder="All document types" value={docType} onChange={(e) => setDocType(e.target.value)} options={(meta.data?.docTypes ?? []).map((d) => ({ value: d, label: pretty(d) }))} />
          </>
        }
      />
      {editing && <RuleModal rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        danger
        title="Delete Rule"
        message={`Delete approval rule "${deleting?.name ?? ''}"?`}
        confirmLabel="Delete"
        loading={del.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting)}
      />
    </div>
  );
}

function RequestsTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const [acting, setActing] = useState<{ req: ApprovalReq; kind: 'approve' | 'reject' } | null>(null);
  const [comment, setComment] = useState('');
  const [detail, setDetail] = useState<ApprovalReq | null>(null);

  const act = useMutation({
    mutationFn: async () => (await api.post(`/approvals/${acting!.req.id}/${acting!.kind}`, comment.trim() ? { comment: comment.trim() } : {})).data,
    onSuccess: () => {
      toast.success(acting?.kind === 'approve' ? 'Approved' : 'Rejected');
      setActing(null);
      setComment('');
      qc.invalidateQueries({ queryKey: ['table', 'admin-approval-requests'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const columns: Column<ApprovalReq>[] = [
    { key: 'createdAt', header: 'Requested', type: 'datetime', width: 140, sortable: false },
    { key: 'docLabel', header: 'Document', width: 150, sortable: false },
    { key: 'docNo', header: 'Doc No', width: 130, sortable: false },
    { key: 'amount', header: 'Amount', type: 'money', width: 110, sortable: false },
    { key: 'requester', header: 'Requested By', width: 120, sortable: false, cell: (r) => r.requester?.fullName ?? r.requester?.username ?? '' },
    { key: 'currentRole', header: 'Awaiting', width: 110, sortable: false, cell: (r) => r.currentRole ?? '' },
    { key: 'steps', header: 'Progress', sortable: false, cell: (r) => `Step ${Math.min(r.currentStep + (r.status === 'PENDING' ? 1 : 0), r.steps.length)} of ${r.steps.length}` },
    { key: 'status', header: 'Status', type: 'status', width: 100, sortable: false },
  ];
  const actions = (r: ApprovalReq): RowAction<ApprovalReq>[] => [
    { label: 'Details', icon: GitBranch, onClick: (x) => setDetail(x) },
    ...(r.canAct
      ? [
          { label: 'Approve', icon: Check, onClick: (x: ApprovalReq) => { setComment(''); setActing({ req: x, kind: 'approve' }); } },
          { label: 'Reject', icon: X, danger: true, onClick: (x: ApprovalReq) => { setComment(''); setActing({ req: x, kind: 'reject' }); } },
        ]
      : []),
  ];

  return (
    <div className="flex h-[calc(100vh-170px)] min-h-[300px] flex-col">
      <DataTable<ApprovalReq>
        tableKey="admin-approval-requests"
        queryKey="admin-approval-requests"
        url="/approvals"
        columns={columns}
        filters={{ status: status || undefined }}
        rowActions={actions}
        exportName="Approval Requests"
        searchPlaceholder="Search document no..."
        onRowDoubleClick={(r) => setDetail(r)}
        toolbarExtras={
          <Select
            className="w-36"
            placeholder="All statuses"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[{ value: 'PENDING', label: 'Pending' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }]}
          />
        }
      />
      <Modal
        open={!!acting}
        width="sm"
        onClose={() => setActing(null)}
        title={`${acting?.kind === 'approve' ? 'Approve' : 'Reject'} ${acting?.req.docNo ?? ''}`}
        footer={
          <>
            <Button onClick={() => setActing(null)}>Cancel</Button>
            <Button variant={acting?.kind === 'reject' ? 'danger' : 'primary'} loading={act.isPending} disabled={acting?.kind === 'reject' && !comment.trim()} onClick={() => act.mutate()}>
              {acting?.kind === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </>
        }
      >
        <Field label="Comment" required={acting?.kind === 'reject'} hint={acting?.kind === 'reject' ? 'A comment is required when rejecting' : undefined}>
          <Textarea value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </Modal>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Approval - ${detail?.docLabel ?? ''} ${detail?.docNo ?? ''}`} footer={<Button onClick={() => setDetail(null)}>Close</Button>}>
        {detail && (
          <div className="space-y-2 text-[12px]">
            <div className="flex items-center gap-2">
              <StatusBadge status={detail.status} /> <span>Amount: {fmt.money(detail.amount)}</span>
            </div>
            <div>Chain: {detail.steps.map((s, i) => <span key={i}>{i > 0 && ' > '}<b className={i === detail.currentStep && detail.status === 'PENDING' ? 'text-amber-700' : ''}>{s}</b></span>)}</div>
            <table className="w-full border-collapse">
              <thead><tr><th className="grid-th text-left">When</th><th className="grid-th text-left">Role</th><th className="grid-th text-left">User</th><th className="grid-th text-left">Action</th><th className="grid-th text-left">Comment</th></tr></thead>
              <tbody>
                {detail.actions.map((a) => (
                  <tr key={a.id}><td className="grid-td">{fmt.dateTime(a.createdAt)}</td><td className="grid-td">{a.roleName}</td><td className="grid-td">{a.username}</td><td className="grid-td"><StatusBadge status={a.action} /></td><td className="grid-td">{a.comment}</td></tr>
                ))}
                {detail.actions.length === 0 && <tr><td className="grid-td text-slate-400" colSpan={5}>No actions yet</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ApprovalWorkflowsScreen() {
  const can = usePermission();
  return (
    <div className="h-full overflow-auto">
      <Tabs
        tabs={[
          { key: 'rules', label: 'Approval Rules', hidden: !can('approvals', 'view'), content: <RulesTab /> },
          { key: 'requests', label: 'Requests', content: <RequestsTab /> },
        ]}
      />
    </div>
  );
}

export default [{ id: 'approval-workflows', title: 'Approval Workflows', icon: GitBranch, component: ApprovalWorkflowsScreen, permission: 'approvals' }] satisfies ScreenDef[];
