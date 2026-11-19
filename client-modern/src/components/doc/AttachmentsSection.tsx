import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip, Trash2, Upload } from 'lucide-react';
import { api, apiError, saveBlob } from '@/lib/api';
import { toast } from '@/store/toast';
import { fmt } from '@/lib/format';
import { Button, EmptyState } from '@/components/ui';
import { DocSection } from './DocumentLayout';

interface Attachment {
  id: number;
  fileName: string;
  mimeType?: string | null;
  size: number;
  createdAt: string;
  uploadedByName?: string | null;
}

const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Upload/list/delete files for a saved document. docType = UPPER_SNAKE (e.g. PURCHASE_ORDER). Disabled until the doc has an id. */
export function AttachmentsSection({ docType, docId, readOnly }: { docType: string; docId?: number | string; readOnly?: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const key = ['attachments', docType, docId];
  const q = useQuery({
    queryKey: key,
    enabled: !!docId,
    queryFn: async () => (await api.get<Attachment[]>('/attachments', { params: { docType, docId } })).data,
  });
  const up = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('docType', docType);
      fd.append('docId', String(docId));
      fd.append('file', file);
      return api.post('/attachments', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      toast.success('File uploaded');
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/attachments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(apiError(e)),
  });
  const download = async (a: Attachment) => {
    try {
      const r = await api.get(`/attachments/${a.id}/download`, { responseType: 'blob' });
      saveBlob(r.data as Blob, a.fileName);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  return (
    <DocSection
      title="Attachments"
      right={
        !readOnly && (
          <>
            <input
              ref={input}
              type="file"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) up.mutate(f);
                e.target.value = '';
              }}
            />
            <Button size="sm" icon={Upload} disabled={!docId} loading={up.isPending} onClick={() => input.current?.click()}>
              Upload
            </Button>
          </>
        )
      }
    >
      {!docId ? (
        <div className="p-4 text-[13px] text-ink-muted">Save the document first to attach files.</div>
      ) : q.data && q.data.length > 0 ? (
        <table className="w-full text-[13px]">
          <tbody>
            {q.data.map((a) => (
              <tr key={a.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                <td className="w-10 py-2 pl-3"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-soft text-brand"><Paperclip size={14} /></span></td>
                <td>{a.fileName}</td>
                <td className="w-20 text-right text-ink-muted">{kb(a.size)}</td>
                <td className="w-32 px-2 text-ink-muted">{a.uploadedByName}</td>
                <td className="w-32 text-ink-muted">{fmt.dateTime(a.createdAt)}</td>
                <td className="w-20 pr-2 text-right">
                  <button className="rounded-md p-1.5 text-ink-muted transition hover:bg-brand-soft hover:text-brand" title="Download" onClick={() => download(a)}><Download size={15} /></button>
                  {!readOnly && (
                    <button className="rounded-md p-1.5 text-ink-muted transition hover:bg-danger-soft hover:text-danger" title="Delete" onClick={() => window.confirm(`Delete ${a.fileName}?`) && del.mutate(a.id)}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState title="No attachments" />
      )}
    </DocSection>
  );
}
