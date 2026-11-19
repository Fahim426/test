import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SelectOption } from '@/components/ui';
import { formScreenOf } from '@/lib/docRoutes';
import { useOpenScreen } from '@/store/workspace';

type OptRow = { id: number; code?: string; name?: string; parentId?: number | null; [k: string]: unknown };

/** Rows of a master endpoint (handles both Paged and plain-array responses). */
export function useMasterRows(url: string, params?: Record<string, unknown>) {
  return useQuery({
    queryKey: ['inv-opts', url, params ?? null],
    staleTime: 60_000,
    queryFn: async (): Promise<OptRow[]> => {
      const d = (await api.get<{ rows?: OptRow[] } | OptRow[]>(url, { params: { pageSize: 500, ...(params ?? {}) } })).data;
      return Array.isArray(d) ? d : (d.rows ?? []);
    },
  });
}

/** id -> "CODE - Name" select options. */
export function useOptions(url: string, params?: Record<string, unknown>) {
  const q = useMasterRows(url, params);
  const data: SelectOption[] = (q.data ?? []).map((r) => ({ value: r.id, label: r.code ? `${r.code} - ${r.name ?? ''}` : String(r.name ?? r.id) }));
  return { ...q, options: data };
}

export const STATUS_OPTIONS = (vals: string[]): SelectOption[] => vals.map((v) => ({ value: v, label: v.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }));

/** Clickable document reference (opens the document form in a workspace tab). */
export function DocLink({ type, id, no }: { type?: string | null; id?: number | null; no?: string | null }) {
  const open = useOpenScreen();
  if (!no) return null;
  if (!type || !id) return <span>{no}</span>;
  return (
    <button
      type="button"
      className="text-brand underline-offset-2 hover:underline"
      onClick={(e) => {
        e.stopPropagation();
        open(formScreenOf(type), { id }, no);
      }}
    >
      {no}
    </button>
  );
}

export const numOrNull = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const numOr0 = (v: unknown): number => numOrNull(v) ?? 0;
export const strOrNull = (v: unknown): string | null => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === '' ? null : s;
};
export const toStr = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
