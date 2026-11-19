import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Eye, History } from 'lucide-react';
import type { ScreenDef } from '@/screens/types';
import { api, apiError, saveBlob } from '@/lib/api';
import { fmt } from '@/lib/format';
import { toast } from '@/store/toast';
import { usePermission } from '@/store/auth';
import { Badge, Button, DateInput, Input, Modal, Select } from '@/components/ui';
import { Column, DataTable, RowAction } from '@/components/DataTable';

interface AuditRow {
  id: number;
  userId: number | null;
  username: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: string | null;
  ip: string | null;
  createdAt: string;
}

const prettyDetails = (d: string | null): string => {
  if (!d) return '(no details)';
  try {
    return JSON.stringify(JSON.parse(d), null, 2);
  } catch {
    return d;
  }
};
const tone = (a: string) => (a.startsWith('DELETE') ? 'red' : a.startsWith('CREATE') ? 'green' : a.startsWith('UPDATE') ? 'blue' : a === 'LOGIN' ? 'teal' : 'gray') as 'red' | 'green' | 'blue' | 'teal' | 'gray';

function AuditScreen() {
  const can = usePermission();
  const [username, setUsername] = useState('');
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const meta = useQuery({
    queryKey: ['admin', 'audit-meta'],
    queryFn: async () => (await api.get<{ entities: string[]; actions: string[] }>('/audit-logs/entities')).data,
    staleTime: 60_000,
  });
  const toOpts = (a?: string[]) => (a ?? []).map((x) => ({ value: x, label: x }));
  const filters = { username: username.trim() || undefined, action: action || undefined, entity: entity || undefined, from: from || undefined, to: to || undefined };

  const exportCsv = async (format: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      const r = await api.get<Blob>('/audit-logs/export', { params: { ...filters, format }, responseType: 'blob' });
      saveBlob(r.data, `audit-log.${format}`);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<AuditRow>[] = [
    { key: 'createdAt', header: 'Date / Time', type: 'datetime', width: 150 },
    { key: 'username', header: 'User', width: 120 },
    { key: 'action', header: 'Action', width: 150, cell: (r) => <Badge tone={tone(r.action)}>{r.action}</Badge> },
    { key: 'entity', header: 'Entity', width: 150 },
    { key: 'entityId', header: 'Entity Id', width: 90, sortable: false },
    { key: 'details', header: 'Details', sortable: false, cell: (r) => <span className="block max-w-[420px] truncate text-slate-500">{r.details ?? ''}</span> },
    { key: 'ip', header: 'IP', width: 110, sortable: false, hidden: true },
  ];
  const actions: RowAction<AuditRow>[] = [{ label: 'View details', icon: Eye, onClick: (r) => setDetail(r) }];

  return (
    <div className="flex h-full flex-col">
      <DataTable<AuditRow>
        tableKey="admin-audit-logs"
        queryKey="admin-audit-logs"
        url="/audit-logs"
        columns={columns}
        filters={filters}
        rowActions={actions}
        exportName="Audit Logs"
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        defaultPageSize={50}
        searchPlaceholder="Search entity, user, action, details..."
        onRowDoubleClick={(r) => setDetail(r)}
        toolbarExtras={
          <>
            <Input className="w-28" placeholder="User" value={username} onChange={(e) => setUsername(e.target.value)} />
            <Select className="w-36" placeholder="All actions" value={action} onChange={(e) => setAction(e.target.value)} options={toOpts(meta.data?.actions)} />
            <Select className="w-36" placeholder="All entities" value={entity} onChange={(e) => setEntity(e.target.value)} options={toOpts(meta.data?.entities)} />
            <DateInput className="w-32" title="From" value={from} onChange={(e) => setFrom(e.target.value)} />
            <DateInput className="w-32" title="To" value={to} onChange={(e) => setTo(e.target.value)} />
            {can('audit', 'export') && (
              <Button icon={Download} loading={exporting} onClick={() => exportCsv('xlsx')}>
                Export all (xlsx)
              </Button>
            )}
          </>
        }
      />
      <Modal open={!!detail} onClose={() => setDetail(null)} width="lg" title={`Audit entry #${detail?.id ?? ''}`} footer={<Button onClick={() => setDetail(null)}>Close</Button>}>
        {detail && (
          <div className="space-y-2 text-[12px]">
            <div className="grid grid-cols-4 gap-2">
              <div><div className="text-[10px] text-slate-500">When</div>{fmt.dateTime(detail.createdAt)}</div>
              <div><div className="text-[10px] text-slate-500">User</div>{detail.username ?? '-'}</div>
              <div><div className="text-[10px] text-slate-500">Action</div>{detail.action}</div>
              <div><div className="text-[10px] text-slate-500">IP</div>{detail.ip ?? '-'}</div>
              <div className="col-span-2"><div className="text-[10px] text-slate-500">Entity</div>{detail.entity}{detail.entityId ? ` #${detail.entityId}` : ''}</div>
            </div>
            {(() => {
              let parsed: {changes?: {field:string;before:unknown;after:unknown}[];reason?:string} = {};
              try { parsed = JSON.parse(detail.details || '{}'); } catch { /* older unstructured event */ }
              const display = (value: unknown) => value == null ? '(empty)' : typeof value === 'object' ? JSON.stringify(value) : String(value);
              return parsed.changes?.length ? <div className="overflow-auto"><p className="mb-2">{parsed.reason || 'Field changes'}</p><table className="w-full border-collapse text-xs"><thead><tr><th className="border p-2 text-left">Field</th><th className="border p-2 text-left">Previous value</th><th className="border p-2 text-left">New value</th></tr></thead><tbody>{parsed.changes.map((change,index)=><tr key={index}><td className="border p-2">{change.field}</td><td className="max-w-xs whitespace-pre-wrap break-words border p-2">{display(change.before)}</td><td className="max-w-xs whitespace-pre-wrap break-words border p-2">{display(change.after)}</td></tr>)}</tbody></table></div> : null;
            })()}
            <pre className="max-h-[50vh] overflow-auto rounded border border-app-border bg-slate-50 p-2 font-mono text-[11px]">{prettyDetails(detail.details)}</pre>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default [{ id: 'audit-logs', title: 'Audit Logs', icon: History, component: AuditScreen, permission: 'audit' }] satisfies ScreenDef[];
