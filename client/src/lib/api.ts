import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { useAuth } from '@/store/auth';

export const api = axios.create({ baseURL: '/api', timeout: 60000 });

api.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
  const t = useAuth.getState().accessToken;
  if (t) cfg.headers.set('Authorization', `Bearer ${t}`);
  return cfg;
});

/** Shape of paged list responses. */
export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Unwrap `res.data` from an axios promise: `const po = await unwrap(api.get('/purchase-orders/1'))` */
export const unwrap = async <T = unknown>(p: Promise<{ data: T }>): Promise<T> => (await p).data;

interface ApiErrorBody {
  error?: string;
  details?: unknown;
}

/** Human readable error message (server `error` first). */
export function apiError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data as ApiErrorBody | undefined;
    if (d?.error) {
      const det = d.details as { fieldErrors?: Record<string, string[]> } | undefined;
      const fe = det?.fieldErrors ? Object.entries(det.fieldErrors).map(([k, v]) => `${k}: ${v.join(', ')}`).join('; ') : '';
      return fe ? `${d.error} (${fe})` : d.error;
    }
    if (e.code === 'ERR_NETWORK' || !e.response) return 'Cannot reach the server. Check your connection.';
    return e.message;
  }
  return e instanceof Error ? e.message : 'Unexpected error';
}

/** Server-side field errors {field: message} when available (zod flatten). */
export function apiFieldErrors(e: unknown): Record<string, string> {
  if (!axios.isAxiosError(e)) return {};
  const det = (e.response?.data as ApiErrorBody | undefined)?.details as { fieldErrors?: Record<string, string[]> } | undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(det?.fieldErrors ?? {})) out[k] = v.join(', ');
  return out;
}

// ---- 401 -> refresh flow (concurrent requests queue behind a single refresh) ----
let refreshing: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  const { refreshToken } = useAuth.getState();
  if (!refreshToken) throw new Error('no refresh token');
  const res = await axios.post<{ accessToken: string; refreshToken: string }>('/api/auth/refresh', { refreshToken });
  useAuth.getState().setTokens(res.data.accessToken, res.data.refreshToken);
  return res.data.accessToken;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const cfg = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    const url = cfg?.url ?? '';
    if (error.response?.status === 401 && cfg && !cfg._retry && !url.includes('/auth/login') && !url.includes('/auth/refresh')) {
      cfg._retry = true;
      try {
        refreshing = refreshing ?? doRefresh().finally(() => (refreshing = null));
        const token = await refreshing;
        cfg.headers = { ...(cfg.headers ?? {}), Authorization: `Bearer ${token}` } as AxiosRequestConfig['headers'];
        return api.request(cfg);
      } catch {
        useAuth.getState().logout(false);
      }
    }
    return Promise.reject(error);
  },
);

/** Download a blob response with a filename (used by exports). */
export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
