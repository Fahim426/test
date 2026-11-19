import { api, saveBlob } from './api';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export interface ExportColumn {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
}

/**
 * POST /api/export/rows {title, columns, rows, format} -> blob download.
 * `rows` are plain objects keyed by column.key (already formatted/primitive).
 */
export async function downloadExport(opts: {
  title: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  format: ExportFormat;
  filename?: string;
}): Promise<void> {
  const res = await api.post(
    '/export/rows',
    {
      title: opts.title,
      // server export schema reads `label`
      columns: opts.columns.map((c) => ({ key: c.key, label: c.header, align: c.align })),
      rows: opts.rows,
      format: opts.format,
    },
    { responseType: 'blob' },
  );
  const ext = opts.format === 'xlsx' ? 'xlsx' : opts.format;
  const safe = (opts.filename ?? opts.title).replace(/[^\w\- ]+/g, '_');
  saveBlob(res.data as Blob, `${safe}.${ext}`);
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Print a table through a hidden iframe (multi-page safe). */
export function printRows(title: string, columns: ExportColumn[], rows: Record<string, unknown>[]): void {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow!.document;
  const head = columns.map((c) => `<th style="text-align:${c.align ?? 'left'}">${esc(c.header)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${columns.map((c) => `<td style="text-align:${c.align ?? 'left'}">${esc(r[c.key])}</td>`).join('')}</tr>`)
    .join('');
  doc.open();
  doc.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
    @page { size: A4 landscape; margin: 10mm }
    body{font-family:Segoe UI,Arial,sans-serif;font-size:10px;color:#111}
    h2{font-size:14px;margin:0 0 6px} .meta{color:#666;margin-bottom:8px}
    table{border-collapse:collapse;width:100%} th,td{border:1px solid #bbb;padding:2px 5px}
    th{background:#eef1f5} thead{display:table-header-group} tr{page-break-inside:avoid}
  </style></head><body><h2>${esc(title)}</h2><div class="meta">Printed ${esc(new Date().toLocaleString())}</div>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(() => iframe.remove(), 2000);
  }, 200);
}
