import { api, saveBlob } from '@/lib/api';

export type ColType = 'text' | 'number' | 'money' | 'qty' | 'percent' | 'date';
export interface ReportCol { key: string; label: string; type: ColType; align: 'left' | 'right' | 'center'; sum?: boolean }
export type Row = Record<string, unknown>;

export interface ParamDef {
  key: string;
  label: string;
  type: 'date' | 'number' | 'select' | 'text';
  entity?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  default?: string | number;
}
export interface CatalogReport {
  key: string; title: string; group: 'Sales' | 'Purchase' | 'Inventory' | 'Finance';
  description: string; params: ParamDef[]; columns: ReportCol[];
  source: string; endpoint: string; route?: string;
}
export interface Catalog { groups: { group: string; reports: CatalogReport[] }[] }

export interface ReportResult {
  key?: string; title: string; columns: ReportCol[]; rows: Row[]; totals: Row;
  params: Record<string, unknown>; total: number; generatedAt: string;
  truncated?: boolean; entity?: string;
}

export type ExportFmt = 'pdf' | 'xlsx' | 'csv';

/** Blob error bodies are JSON text; extract the server message. */
export async function blobError(e: unknown): Promise<string> {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      const j = JSON.parse(await data.text()) as { error?: string };
      if (j.error) return j.error;
    } catch { /* fallthrough */ }
  }
  return e instanceof Error ? e.message : 'Request failed';
}

function filenameOf(cd: unknown, fallback: string): string {
  const m = /filename="?([^";]+)"?/i.exec(String(cd ?? ''));
  return m ? m[1] : fallback;
}

export async function downloadFile(req: Promise<{ data: Blob; headers: Record<string, unknown> }>, fallback: string) {
  const res = await req;
  saveBlob(res.data, filenameOf(res.headers['content-disposition'], fallback));
}

/** Print an HTML string through a hidden iframe. */
export function printHtml(html: string) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(iframe);
  const w = iframe.contentWindow!;
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); setTimeout(() => iframe.remove(), 1500); }, 300);
}

export async function fetchPrintHtml(url: string, params: Record<string, unknown>): Promise<string> {
  const r = await api.get<string>(url, { params, responseType: 'text', transformResponse: (d) => d });
  return r.data;
}

/** Strip empty values from a params object. */
export const cleanParams = (p: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined && v !== null));
