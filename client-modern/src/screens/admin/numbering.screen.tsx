import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hash, RotateCcw, Save } from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { api, apiError } from '@/lib/api';
import { toast } from '@/store/toast';
import { usePermission } from '@/store/auth';
import { useWorkspace } from '@/store/workspace';
import { Badge, Button, Checkbox, ConfirmDialog, ErrorState, Input, LoadingBlock, NumberInput, Select, Toolbar } from '@/components/ui';

interface NumRow {
  docType: string;
  label: string;
  prefix: string;
  includeYear: boolean;
  includeBranch: boolean;
  padding: number;
  separator: string;
  resetRule: 'YEARLY' | 'MONTHLY' | 'NEVER';
  currentSeq: number;
  periodKey: string;
  configured: boolean;
  example: string;
}
type Draft = Pick<NumRow, 'prefix' | 'includeYear' | 'includeBranch' | 'padding' | 'separator' | 'resetRule' | 'currentSeq'>;

const pick = (r: NumRow): Draft => ({
  prefix: r.prefix, includeYear: r.includeYear, includeBranch: r.includeBranch, padding: r.padding, separator: r.separator, resetRule: r.resetRule, currentSeq: r.currentSeq,
});
const same = (a: Draft, b: Draft) => (Object.keys(a) as (keyof Draft)[]).every((k) => a[k] === b[k]);

/** Mirrors server previewNumber(): next number given the saved period state. */
function preview(row: NumRow, d: Draft): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const periodKey = d.resetRule === 'YEARLY' ? year : d.resetRule === 'MONTHLY' ? `${year}${month}` : 'ALL';
  const seq = row.periodKey === periodKey ? d.currentSeq + 1 : 1;
  const parts = [d.prefix];
  if (d.includeBranch) parts.push('BR');
  if (d.includeYear) parts.push(year);
  parts.push(String(seq).padStart(Math.min(10, Math.max(1, d.padding || 1)), '0'));
  return parts.join(d.separator);
}

const RESET_OPTS = [
  { value: 'YEARLY', label: 'Yearly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'NEVER', label: 'Never' },
];

function NumberingScreen({ tabId }: ScreenProps) {
  const can = usePermission();
  const qc = useQueryClient();
  const ws = useWorkspace();
  const canEdit = can('numbering', 'edit');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [forceFor, setForceFor] = useState<NumRow | null>(null);
  const [filter, setFilter] = useState('');

  const q = useQuery({ queryKey: ['admin', 'numbering'], queryFn: async () => (await api.get<{ rows: NumRow[] }>('/numbering')).data.rows });
  const rows = q.data ?? [];

  // Business Units: one number series for all BUs, or a separate series per BU with its code in the number
  const perBu = useQuery({ queryKey: ['admin', 'numbering-perbu'], queryFn: async () => (await api.get<Record<string, string>>('/settings', { params: { prefix: 'numbering.perBu' } })).data });
  const perBuOn = ['true', '1', 'yes', 'on'].includes((perBu.data?.['numbering.perBu'] ?? '').toLowerCase());
  const setPerBu = useMutation({
    mutationFn: async (on: boolean) => api.put('/settings', { settings: { 'numbering.perBu': on } }),
    onSuccess: () => {
      toast.success('Numbering setting saved');
      qc.invalidateQueries({ queryKey: ['admin', 'numbering-perbu'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const dirtyKeys = useMemo(() => rows.filter((r) => drafts[r.docType] && !same(drafts[r.docType], pick(r))).map((r) => r.docType), [rows, drafts]);
  useEffect(() => {
    ws.setDirty(tabId, dirtyKeys.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyKeys.length, tabId]);

  const patch = (r: NumRow, p: Partial<Draft>) => setDrafts((d) => ({ ...d, [r.docType]: { ...(d[r.docType] ?? pick(r)), ...p } }));

  const save = useMutation({
    mutationFn: async ({ row, force }: { row: NumRow; force?: boolean }) => {
      const d = drafts[row.docType];
      return (await api.put(`/numbering/${row.docType}`, { ...d, ...(force ? { force: true } : {}) })).data;
    },
    onMutate: ({ row }) => setSaving(row.docType),
    onSuccess: (_d, { row }) => {
      toast.success(`${row.label} numbering saved`);
      setDrafts((d) => {
        const n = { ...d };
        delete n[row.docType];
        return n;
      });
      setForceFor(null);
      qc.invalidateQueries({ queryKey: ['admin', 'numbering'] });
    },
    onError: (e) => toast.error(apiError(e)),
    onSettled: () => setSaving(null),
  });

  const doSave = (r: NumRow) => {
    const d = drafts[r.docType];
    if (d && d.currentSeq < r.currentSeq) setForceFor(r);
    else save.mutate({ row: r });
  };

  const shown = rows.filter((r) => !filter || `${r.docType} ${r.label}`.toLowerCase().includes(filter.toLowerCase()));

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState message={apiError(q.error)} onRetry={() => q.refetch()} />;
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <input className="ctl w-52" placeholder="Filter document types..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="text-xs text-ink-muted">Preview shows the next number that will be issued. Lowering the current sequence may create duplicates.</span>
        {dirtyKeys.length > 0 && <Badge tone="amber">{dirtyKeys.length} unsaved</Badge>}
        <span className="mx-1 h-5 w-px bg-line" />
        <Checkbox
          label="Separate series per Business Unit (e.g. INV-TZ-2026-00001)"
          checked={perBuOn}
          disabled={!canEdit || setPerBu.isPending}
          onChange={(e) => setPerBu.mutate(e.target.checked)}
        />
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10">
            <tr>
              {['Document', 'Prefix', 'Year', 'Branch', 'Separator', 'Padding', 'Reset', 'Current Seq', 'Next Number', ''].map((h) => (
                <th key={h} className="grid-th text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const d = drafts[r.docType] ?? pick(r);
              const isDirty = !!drafts[r.docType] && !same(drafts[r.docType], pick(r));
              return (
                <tr key={r.docType} className={isDirty ? 'h-9 bg-warning-soft' : 'h-9 hover:bg-surface-2'}>
                  <td className="grid-td">
                    <div className="font-medium">{r.label}</div>
                    <div className="text-xs text-ink-faint">
                      {r.docType} {!r.configured && <Badge className="ml-1">default</Badge>}
                    </div>
                  </td>
                  <td className="grid-td"><Input className="w-20" maxLength={10} disabled={!canEdit} value={d.prefix} onChange={(e) => patch(r, { prefix: e.target.value })} /></td>
                  <td className="grid-td text-center"><input type="checkbox" className="accent-brand" disabled={!canEdit} checked={d.includeYear} onChange={(e) => patch(r, { includeYear: e.target.checked })} /></td>
                  <td className="grid-td text-center"><input type="checkbox" className="accent-brand" disabled={!canEdit} checked={d.includeBranch} onChange={(e) => patch(r, { includeBranch: e.target.checked })} /></td>
                  <td className="grid-td"><Input className="w-14 text-center" maxLength={3} disabled={!canEdit} value={d.separator} onChange={(e) => patch(r, { separator: e.target.value })} /></td>
                  <td className="grid-td"><NumberInput className="w-16" min={1} max={10} step={1} disabled={!canEdit} value={d.padding} onChange={(e) => patch(r, { padding: Math.min(10, Math.max(1, Math.trunc(Number(e.target.value)) || 1)) })} /></td>
                  <td className="grid-td"><Select className="w-24" disabled={!canEdit} value={d.resetRule} options={RESET_OPTS} onChange={(e) => patch(r, { resetRule: e.target.value as Draft['resetRule'] })} /></td>
                  <td className="grid-td"><NumberInput className="w-24" min={0} step={1} disabled={!canEdit} value={d.currentSeq} onChange={(e) => patch(r, { currentSeq: Math.max(0, Math.trunc(Number(e.target.value)) || 0) })} /></td>
                  <td className="grid-td font-mono text-brand">{preview(r, d)}</td>
                  <td className="grid-td whitespace-nowrap">
                    {canEdit && isDirty && (
                      <>
                        <Button size="sm" variant="primary" icon={Save} loading={saving === r.docType} onClick={() => doSave(r)}>Save</Button>{' '}
                        <Button size="sm" icon={RotateCcw} onClick={() => setDrafts((x) => { const n = { ...x }; delete n[r.docType]; return n; })}>Undo</Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={!!forceFor}
        danger
        title="Lower current sequence?"
        message="Lowering the current sequence may create duplicate document numbers. Continue anyway?"
        confirmLabel="Save anyway"
        loading={save.isPending}
        onCancel={() => setForceFor(null)}
        onConfirm={() => forceFor && save.mutate({ row: forceFor, force: true })}
      />
    </div>
  );
}

export default [{ id: 'document-numbering', title: 'Document Numbering', icon: Hash, component: NumberingScreen, permission: 'numbering' }] satisfies ScreenDef[];
