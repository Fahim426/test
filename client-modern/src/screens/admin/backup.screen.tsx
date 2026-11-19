import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, Download, Plus, Trash2 } from 'lucide-react';
import type { ScreenDef } from '@/screens/types';
import { api, apiError, saveBlob } from '@/lib/api';
import { fmt } from '@/lib/format';
import { toast } from '@/store/toast';
import { usePermission } from '@/store/auth';
import { Button, ConfirmDialog, EmptyState, ErrorState, IconButton, LoadingBlock, Toolbar } from '@/components/ui';

interface BackupFile {
  file: string;
  size: number;
  createdAt: string;
}
interface BackupResult extends BackupFile {
  tables: number;
  rows: number;
}
const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function BackupScreen() {
  const can = usePermission();
  const qc = useQueryClient();
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [deleting, setDeleting] = useState<BackupFile | null>(null);
  const [last, setLast] = useState<BackupResult | null>(null);
  const [dl, setDl] = useState<string | null>(null);

  const q = useQuery({ queryKey: ['admin', 'backups'], queryFn: async () => (await api.get<BackupFile[]>('/backup')).data });
  const create = useMutation({
    mutationFn: async () => (await api.post<BackupResult>('/backup', {}, { timeout: 300_000 })).data,
    onSuccess: (r) => {
      setLast(r);
      setConfirmCreate(false);
      toast.success(`Backup created: ${r.file}`);
      qc.invalidateQueries({ queryKey: ['admin', 'backups'] });
    },
    onError: (e) => {
      toast.error(apiError(e));
      setConfirmCreate(false);
    },
  });
  const del = useMutation({
    mutationFn: (f: BackupFile) => api.delete(`/backup/${f.file}`),
    onSuccess: () => {
      toast.success('Backup deleted');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['admin', 'backups'] });
    },
    onError: (e) => {
      toast.error(apiError(e));
      setDeleting(null);
    },
  });
  const download = async (f: BackupFile) => {
    setDl(f.file);
    try {
      const r = await api.get<Blob>(`/backup/${f.file}`, { responseType: 'blob', timeout: 300_000 });
      saveBlob(r.data, f.file);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setDl(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        {can('backup', 'create') && (
          <Button variant="primary" icon={Plus} onClick={() => setConfirmCreate(true)}>
            Create backup
          </Button>
        )}
        <span className="text-xs text-ink-muted">JSON dump of all tables (password hashes and refresh tokens excluded). Restore is not offered by the server: backups are for download and offline recovery.</span>
      </Toolbar>
      {last && (
        <div className="border-b border-success bg-success-soft px-3 py-1 text-[13px] text-success">
          Created {last.file} ({size(last.size)}, {last.tables} tables, {last.rows} rows)
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {q.isLoading ? (
          <LoadingBlock />
        ) : q.isError ? (
          <ErrorState message={apiError(q.error)} onRetry={() => q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState title="No backups yet" icon={<DatabaseBackup size={28} strokeWidth={1.3} />} />
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0">
              <tr>
                <th className="grid-th text-left">File</th>
                <th className="grid-th w-40 text-left">Created</th>
                <th className="grid-th w-24 text-right">Size</th>
                <th className="grid-th w-20" />
              </tr>
            </thead>
            <tbody>
              {q.data.map((f) => (
                <tr key={f.file} className="h-9 hover:bg-surface-2">
                  <td className="grid-td font-mono">{f.file}</td>
                  <td className="grid-td">{fmt.dateTime(f.createdAt)}</td>
                  <td className="grid-td text-right">{size(f.size)}</td>
                  <td className="grid-td whitespace-nowrap">
                    <IconButton icon={Download} label="Download" disabled={dl === f.file} onClick={() => download(f)} />
                    {can('backup', 'delete') && <IconButton icon={Trash2} variant="danger" label="Delete" onClick={() => setDeleting(f)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <ConfirmDialog
        open={confirmCreate}
        title="Create backup"
        message="Create a new full backup now? This may take a while on large databases."
        confirmLabel="Create"
        loading={create.isPending}
        onCancel={() => setConfirmCreate(false)}
        onConfirm={() => create.mutate()}
      />
      <ConfirmDialog
        open={!!deleting}
        danger
        title="Delete backup"
        message={`Permanently delete ${deleting?.file ?? ''}?`}
        confirmLabel="Delete"
        loading={del.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting)}
      />
    </div>
  );
}

export default [{ id: 'backup', title: 'Backup', icon: DatabaseBackup, component: BackupScreen, permission: 'backup' }] satisfies ScreenDef[];
