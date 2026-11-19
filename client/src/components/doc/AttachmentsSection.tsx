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
        <div className="p-2 text-[12px] text-slate-500">Save the document first to attach files.</div>
      ) : q.data && q.data.length > 0 ? (
        <table className="w-full text-[12px]">
          <tbody>
            {q.data.map((a) => (
              <tr key={a.id} className="border-b border-slate-100">
                <td className="w-6 py-1"><Paperclip size={12} className="text-slate-400" /></td>
                <td>{a.fileName}</td>
                <td className="w-20 text-right text-slate-500">{kb(a.size)}</td>
                <td className="w-32 px-2 text-slate-500">{a.uploadedByName}</td>
                <td className="w-32 text-slate-500">{fmt.dateTime(a.createdAt)}</td>
                <td className="w-14 text-right">
                  <button className="rounded p-1 text-brand hover:bg-brand-light" title="Download" onClick={() => download(a)}><Download size={13} /></button>
                  {!readOnly && (
                    <button className="rounded p-1 text-red-600 hover:bg-red-50" title="Delete" onClick={() => window.confirm(`Delete ${a.fileName}?`) && del.mutate(a.id)}>
                      <Trash2 size={13} />
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
