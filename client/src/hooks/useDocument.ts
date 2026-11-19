import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '@/lib/api';
import { toast } from '@/store/toast';
import { useWorkspaceStore } from '@/store/workspace';

export interface UseDocumentOptions<T> {
  /** workspace tab hosting this form: enables auto tab title + retarget after first save */
  tabId?: string;
  /** derive the tab title from the loaded/saved document (default: doc.docNo ?? doc.code ?? doc.name) */
  titleOf?: (doc: T) => string | undefined;
  /** called after create/update succeeded */
  onSaved?: (doc: T, created: boolean) => void;
}

const defaultTitle = (d: unknown): string | undefined => {
  const o = d as Record<string, unknown> | null;
  const v = o?.docNo ?? o?.voucherNo ?? o?.transferNo ?? o?.adjNo ?? o?.code ?? o?.name;
  return v ? String(v) : undefined;
};

/**
 * Generic REST document hook.
 *
 *   const doc = useDocument<PO>('/purchase-orders', params.id, { tabId });
 *   doc.data        -> GET /purchase-orders/:id   (undefined while creating)
 *   doc.save(body)  -> POST / (create) or PUT /:id (update), toast + invalidate
 *   doc.transition('submit' | 'approve' | 'post' | ..., body?)  -> POST /:id/<action>
 *   doc.convert('create-goods-receipt')  -> POST /:id/create-goods-receipt, returns created doc
 *   doc.remove()  -> DELETE /:id
 */
export function useDocument<T extends object = Record<string, unknown>>(url: string, id: number | string | undefined, opts: UseDocumentOptions<T> = {}) {
  const qc = useQueryClient();
  const hasId = id !== undefined && id !== null && id !== '';
  const key = ['doc', url, hasId ? String(id) : 'new'];
  const retarget = useWorkspaceStore((s) => s.retarget);
  const setTitle = useWorkspaceStore((s) => s.setTitle);
  const titleOf = opts.titleOf ?? defaultTitle;

  const query = useQuery({
    queryKey: key,
    enabled: hasId,
    queryFn: async () => {
      const d = (await api.get<T>(`${url}/${id}`)).data;
      const t = titleOf(d);
      if (opts.tabId && t) setTitle(opts.tabId, t);
      return d;
    },
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['doc', url] });
    qc.invalidateQueries({ queryKey: ['table'] });
    qc.invalidateQueries({ queryKey: ['doc-flow'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  }, [qc, url]);

  const save = useMutation({
    mutationFn: async (body: unknown) => (hasId ? (await api.put<T>(`${url}/${id}`, body)).data : (await api.post<T>(url, body)).data),
    onSuccess: (d) => {
      const created = !hasId;
      toast.success(created ? 'Created successfully' : 'Saved successfully');
      const newId = (d as { id?: number | string }).id;
      if (created && opts.tabId && newId !== undefined) retarget(opts.tabId, { id: newId, title: titleOf(d) });
      else if (opts.tabId && titleOf(d)) setTitle(opts.tabId, titleOf(d)!);
      qc.setQueryData(['doc', url, String(newId ?? id)], d);
      invalidate();
      opts.onSaved?.(d, created);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const act = useMutation({
    mutationFn: async (v: { action: string; body?: unknown }) => (await api.post<T>(`${url}/${id}/${v.action}`, v.body ?? {})).data,
    onSuccess: (d, v) => {
      toast.success(`${v.action.replace(/^create-/, 'Created ').replace(/-/g, ' ')} done`);
      invalidate();
      return d;
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const del = useMutation({
    mutationFn: async () => (await api.delete(`${url}/${id}`)).data,
    onSuccess: () => {
      toast.success('Deleted');
      invalidate();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return {
    id: hasId ? id : undefined,
    isNew: !hasId,
    data: query.data,
    isLoading: query.isLoading && hasId,
    error: query.error ? apiError(query.error) : undefined,
    refetch: query.refetch,
    invalidate,
    save: save.mutateAsync,
    saving: save.isPending,
    transition: (action: string, body?: unknown) => act.mutateAsync({ action, body }),
    /** alias of transition, for conversions (`create-<target>`), returns the created document */
    convert: (action: string, body?: unknown) => act.mutateAsync({ action, body }),
    acting: act.isPending,
    remove: del.mutateAsync,
    removing: del.isPending,
  };
}
