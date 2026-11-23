import sharp from 'sharp';
import { companyLogoDataUri, drawCompanyLogo } from './report-brand';
import { readCompanyLogo } from './product-config';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { AlignmentType, Document, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { num } from '../lib/calc';
import { ColType } from './report-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export const exportColSchema = z.object({
  key: z.string().min(1).max(200),
  label: z.string().max(200).optional(),
  type: z.enum(['text', 'number', 'money', 'qty', 'percent', 'date']).optional(),
  align: z.enum(['left', 'right', 'center']).optional(),
});
export const exportBodySchema = z.object({
  title: z.string().min(1).max(200).default('Report'),
  subtitle: z.string().max(300).optional(),
  columns: z.array(exportColSchema).min(1).max(80),
  rows: z.array(z.record(z.any())).max(100000),
  totals: z.record(z.any()).optional(),
  params: z.record(z.any()).optional(),
  format: z.enum(['pdf', 'xlsx', 'csv', 'docx']).default('xlsx'),
  filename: z.string().max(120).optional(),
});

export interface ExportCol {
  key: string;
  label?: string;
  type?: ColType;
  align?: 'left' | 'right' | 'center';
}
export interface ExportInput {
  title: string;
  subtitle?: string;
  columns: ExportCol[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

export const getPath = (row: Any, key: string): unknown => {
  if (row == null) return undefined;
  if (key in row) return row[key];
  if (!key.includes('.')) return undefined;
  return key.split('.').reduce((o: Any, k) => (o == null ? undefined : o[k]), row);
};

const typeOf = (c: ExportCol, sample: unknown): ColType => c.type ?? (typeof sample === 'number' ? 'number' : 'text');
const labelOf = (c: ExportCol) => c.label ?? c.key;
const alignOf = (c: ExportCol, t: ColType) => c.align ?? (t === 'text' ? 'left' : t === 'date' ? 'center' : 'right');

export function fmtNum(v: number, t: ColType): string {
  if (t === 'money') return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (t === 'qty') return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  if (t === 'percent') return v.toFixed(2) + '%';
  return Number.isInteger(v) ? String(v) : v.toLocaleString('en-US', { maximumFractionDigits: 3 });
}
export function fmtCell(v: unknown, t: ColType): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number' || (t !== 'text' && t !== 'date' && v !== '' && !isNaN(Number(v)) && typeof v === 'string')) {
    const n = Number(v);
    if (isNaN(n)) return String(v);
    return t === 'text' || t === 'date' ? String(v) : fmtNum(n, t);
  }
  if (t === 'date' && typeof v === 'string') return v.slice(0, 10);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

async function companyInfo() {
  const c = await prisma.company.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } });
  return { name: c?.name ?? 'Business ERP', trn: c?.trn ?? '', address: c?.address ?? '', phone: c?.phone ?? '', email: c?.email ?? '', currency: c?.baseCurrency ?? 'AED' };
}
export { companyInfo };

const paramLine = (params?: Record<string, unknown>) =>
  params
    ? Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('   |   ')
    : '';

export const safeFilename = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80) || 'report';

// ============ CSV ============
const csvEsc = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export function toCsv(inp: ExportInput): Buffer {
  const lines: string[] = [];
  lines.push(inp.columns.map((c) => csvEsc(labelOf(c))).join(','));
  const cell = (v: unknown, c: ExportCol) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const t = typeOf(c, v);
    if (typeof v === 'number') return String(t === 'money' || t === 'percent' ? Math.round(v * 100) / 100 : v);
    if (t === 'date' && typeof v === 'string') return v.slice(0, 10);
    if (typeof v === 'object') return csvEsc(JSON.stringify(v));
    return csvEsc(String(v));
  };
  for (const r of inp.rows) lines.push(inp.columns.map((c) => cell(getPath(r, c.key), c)).join(','));
  if (inp.totals && Object.keys(inp.totals).length) {
    lines.push(inp.columns.map((c, i) => (i === 0 && getPath(inp.totals, c.key) === undefined ? 'Total' : cell(getPath(inp.totals, c.key), c))).join(','));
  }
  return Buffer.concat([Buffer.from('﻿', 'utf8'), Buffer.from(lines.join('\r\n') + '\r\n', 'utf8')]);
}

// ============ XLSX ============
const XL_FMT: Partial<Record<ColType, string>> = { money: '#,##0.00;[Red]-#,##0.00', qty: '#,##0.###', percent: '0.00"%"', number: '#,##0.###', date: 'yyyy-mm-dd' };
export async function toXlsx(inp: ExportInput): Promise<Buffer> {
  const co = await companyInfo();
  const wb = new ExcelJS.Workbook();
  wb.creator = co.name;
  wb.created = new Date();
  const ws = wb.addWorksheet(inp.title.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31) || 'Report', { views: [] });
  const ncols = inp.columns.length;
  const types = inp.columns.map((c) => typeOf(c, inp.rows.find((r) => getPath(r, c.key) != null) ? getPath(inp.rows.find((r) => getPath(r, c.key) != null), c.key) : undefined));
  const logo = await readCompanyLogo();
  if (logo) {
    const logoId = wb.addImage({ filename: logo.file, extension: logo.file.endsWith('.png') ? 'png' : 'jpeg' });
    const meta = await sharp(logo.data).metadata();
    const scale = Math.min(220 / (meta.width || 220), 85 / (meta.height || 85));
    ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: (meta.width || 220) * scale, height: (meta.height || 85) * scale } });
  }
  for (let r = 1; r <= 5; r++) ws.getRow(r).height = 15;
  let rowNo = 7;
  const titleRow = (text: string, size: number, bold = true, color = 'FF1F2937') => {
    const r = ws.getRow(rowNo++);
    r.getCell(1).value = text;
    r.getCell(1).font = { bold, size, color: { argb: color } };
    if (ncols > 1) ws.mergeCells(r.number, 1, r.number, ncols);
  };
  titleRow(co.name, 14);
  titleRow(inp.title, 12);
  if (inp.subtitle) titleRow(inp.subtitle, 10, false, 'FF4B5563');
  const pl = paramLine(inp.params);
  if (pl) titleRow(pl, 9, false, 'FF4B5563');
  titleRow(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`, 9, false, 'FF6B7280');
  rowNo++;
  const headerRowNo = rowNo;
  const hr = ws.getRow(rowNo++);
  inp.columns.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = labelOf(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.alignment = { horizontal: alignOf(c, types[i]) === 'left' ? 'left' : alignOf(c, types[i]), vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
  });
  hr.height = 22;
  const widths = inp.columns.map((c) => Math.max(8, labelOf(c).length + 2));
  const put = (r: ExcelJS.Row, rowData: Any, isTotal = false) => {
    inp.columns.forEach((c, i) => {
      let v = getPath(rowData, c.key) as Any;
      const t = types[i];
      if (isTotal && i === 0 && v === undefined) v = 'Total';
      const cell = r.getCell(i + 1);
      if (v === undefined || v === null) {
        cell.value = null;
      } else if (t === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
        cell.value = new Date(v.slice(0, 10) + 'T00:00:00Z');
        cell.numFmt = XL_FMT.date!;
      } else if (v instanceof Date) {
        cell.value = v;
        cell.numFmt = XL_FMT.date!;
      } else if (typeof v === 'number') {
        cell.value = v;
        if (XL_FMT[t]) cell.numFmt = XL_FMT[t]!;
      } else if (typeof v === 'object') {
        cell.value = JSON.stringify(v);
      } else {
        cell.value = v;
      }
      cell.alignment = { horizontal: alignOf(c, t), vertical: 'top' };
      const len = fmtCell(v instanceof Date ? v.toISOString() : v, t).length;
      if (len + 2 > widths[i]) widths[i] = Math.min(60, len + 2);
      if (isTotal) {
        cell.font = { bold: true };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      }
    });
  };
  inp.rows.forEach((r, idx) => {
    const row = ws.getRow(rowNo++);
    put(row, r);
    if (idx % 2 === 1) row.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; });
  });
  if (inp.totals && Object.keys(inp.totals).length) put(ws.getRow(rowNo++), inp.totals, true);
  inp.columns.forEach((_, i) => (ws.getColumn(i + 1).width = widths[i]));
  ws.views = [{ state: 'frozen', ySplit: headerRowNo, xSplit: 0 }];
  if (inp.rows.length) ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: headerRowNo, column: ncols } };
  ws.pageSetup = { orientation: ncols > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ============ PDF primitives ============
export interface PdfCol {
  label: string;
  type: ColType;
  align: 'left' | 'right' | 'center';
  w: number; // relative weight
}
export const PDF_COLORS = { head: '#1E3A5F', zebra: '#F8FAFC', line: '#CBD5E1', text: '#111827', muted: '#6B7280' };

export function newDoc(landscape: boolean, size: 'A4' = 'A4') {
  const doc = new PDFDocument({ size, layout: landscape ? 'landscape' : 'portrait', margin: 36, bufferPages: true, info: { Producer: 'Business ERP' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  return { doc, done };
}

export function addFooters(doc: PDFKit.PDFDocument, leftText: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const b = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(PDF_COLORS.muted);
    const y = doc.page.height - 26;
    doc.text(leftText, 36, y, { width: doc.page.width / 2 - 36, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, doc.page.width / 2, y, { width: doc.page.width / 2 - 36, align: 'right', lineBreak: false });
    doc.page.margins.bottom = b;
  }
}

/** Draws a table with wrapped cells and repeating header; returns final y. */
export function drawTable(
  doc: PDFKit.PDFDocument,
  cols: PdfCol[],
  rows: string[][],
  opts: { fontSize?: number; totalsRow?: string[]; startY?: number; onNewPage?: () => number } = {},
) {
  const fs = opts.fontSize ?? 8;
  const left = doc.page.margins.left;
  const avail = doc.page.width - left - doc.page.margins.right;
  const sumW = cols.reduce((a, c) => a + c.w, 0) || 1;
  const widths = cols.map((c) => (c.w / sumW) * avail);
  const pad = 3;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 20;
  let y = opts.startY ?? doc.y;

  const header = () => {
    doc.font('Helvetica-Bold').fontSize(fs);
    const h = Math.max(...cols.map((c, i) => doc.heightOfString(c.label, { width: widths[i] - pad * 2 }))) + 6;
    doc.rect(left, y, avail, h).fill(PDF_COLORS.head);
    let x = left;
    cols.forEach((c, i) => {
      doc.fillColor('#FFFFFF').text(c.label, x + pad, y + 3, { width: widths[i] - pad * 2, align: c.align });
      x += widths[i];
    });
    y += h;
  };
  header();
  const drawRow = (cells: string[], idx: number, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs);
    const h = Math.max(...cells.map((t, i) => doc.heightOfString(t || ' ', { width: widths[i] - pad * 2 }))) + 5;
    if (y + h > bottomLimit()) {
      doc.addPage();
      y = opts.onNewPage ? opts.onNewPage() : doc.page.margins.top;
      header();
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs);
    }
    if (bold) doc.rect(left, y, avail, h).fill('#E2E8F0');
    else if (idx % 2 === 1) doc.rect(left, y, avail, h).fill(PDF_COLORS.zebra);
    let x = left;
    cells.forEach((t, i) => {
      doc.fillColor(PDF_COLORS.text).text(t, x + pad, y + 2.5, { width: widths[i] - pad * 2, align: cols[i].align });
      x += widths[i];
    });
    doc.moveTo(left, y + h).lineTo(left + avail, y + h).lineWidth(0.3).strokeColor(PDF_COLORS.line).stroke();
    y += h;
  };
  rows.forEach((r, i) => drawRow(r, i));
  if (opts.totalsRow) drawRow(opts.totalsRow, 0, true);
  doc.y = y;
  return y;
}

export async function toPdf(inp: ExportInput): Promise<Buffer> {
  const co = await companyInfo();
  const cols = inp.columns.map((c) => {
    const sample = inp.rows.find((r) => getPath(r, c.key) != null);
    const t = typeOf(c, sample ? getPath(sample, c.key) : undefined);
    const lens = inp.rows.slice(0, 200).map((r) => fmtCell(getPath(r, c.key), t).length);
    const maxLen = Math.min(34, Math.max(labelOf(c).length * 0.8, ...lens, 4));
    return { key: c.key, label: labelOf(c), type: t, align: alignOf(c, t), w: Math.max(maxLen, t === 'text' ? 8 : 7) } as PdfCol & { key: string };
  });
  const natural = cols.reduce((a, c) => a + c.w * 4.6 + 6, 0);
  const landscape = natural > 523;
  const { doc, done } = newDoc(landscape);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const generated = new Date().toISOString().replace('T', ' ').slice(0, 16);

  doc.font('Helvetica-Bold').fontSize(15).fillColor(PDF_COLORS.head).text(co.name, left, await drawCompanyLogo(doc, left, 28, 200), { width });
  doc.font('Helvetica').fontSize(8).fillColor(PDF_COLORS.muted);
  const sub = [co.trn ? `TRN: ${co.trn}` : '', co.address, co.phone].filter(Boolean).join('  |  ');
  if (sub) doc.text(sub, { width });
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(PDF_COLORS.text).text(inp.title, { width });
  if (inp.subtitle) doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted).text(inp.subtitle, { width });
  const pl = paramLine(inp.params);
  if (pl) doc.font('Helvetica').fontSize(8).fillColor(PDF_COLORS.muted).text(pl, { width });
  doc.moveDown(0.2);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1).strokeColor(PDF_COLORS.head).stroke();
  doc.moveDown(0.5);

  const body = inp.rows.map((r) => cols.map((c) => fmtCell(getPath(r, c.key), c.type)));
  let totalsRow: string[] | undefined;
  if (inp.totals && Object.keys(inp.totals).length) {
    totalsRow = cols.map((c, i) => {
      const v = getPath(inp.totals, c.key);
      return v === undefined ? (i === 0 ? 'Total' : '') : fmtCell(v, c.type);
    });
  }
  if (!body.length) doc.font('Helvetica-Oblique').fontSize(9).fillColor(PDF_COLORS.muted).text('No data for the selected criteria.');
  else drawTable(doc, cols, body, { fontSize: cols.length > 10 ? 7 : 8, totalsRow, startY: doc.y });
  addFooters(doc, `${co.name}  -  Generated ${generated}`);
  doc.end();
  return done;
}

// ============ HTML (print) ============
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export async function toHtml(inp: ExportInput): Promise<string> {
  const co = await companyInfo();
  const types = inp.columns.map((c) => {
    const sample = inp.rows.find((r) => getPath(r, c.key) != null);
    return typeOf(c, sample ? getPath(sample, c.key) : undefined);
  });
  const th = inp.columns.map((c, i) => `<th style="text-align:${alignOf(c, types[i])}">${esc(labelOf(c))}</th>`).join('');
  const tr = inp.rows.map((r) => `<tr>${inp.columns.map((c, i) => `<td style="text-align:${alignOf(c, types[i])}">${esc(fmtCell(getPath(r, c.key), types[i]))}</td>`).join('')}</tr>`).join('');
  const tot = inp.totals && Object.keys(inp.totals).length ? `<tfoot><tr>${inp.columns.map((c, i) => `<td style="text-align:${alignOf(c, types[i])}">${esc(getPath(inp.totals, c.key) === undefined ? (i === 0 ? 'Total' : '') : fmtCell(getPath(inp.totals, c.key), types[i]))}</td>`).join('')}</tr></tfoot>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inp.title)}</title><style>
body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111827;margin:24px}
h1{font-size:18px;margin:0;color:#1E3A5F}h2{font-size:14px;margin:6px 0 2px}.m{color:#6B7280;font-size:10px}
table{border-collapse:collapse;width:100%;margin-top:12px}th{background:#1E3A5F;color:#fff;padding:5px 6px;font-size:10px}
td{padding:4px 6px;border-bottom:1px solid #E5E7EB}tbody tr:nth-child(even){background:#F8FAFC}tfoot td{font-weight:bold;background:#E2E8F0;border-top:2px solid #1E3A5F}
@media print{body{margin:8mm}@page{size:${inp.columns.length > 6 ? 'A4 landscape' : 'A4'};margin:8mm}thead{display:table-header-group}tr{page-break-inside:avoid}}
</style></head><body><img src="${await companyLogoDataUri()}" alt="Company logo" style="display:block;width:220px;height:auto;margin-bottom:6px" /><h1>${esc(co.name)}</h1><div class="m">${esc([co.trn ? 'TRN: ' + co.trn : '', co.address].filter(Boolean).join(' | '))}</div>
<h2>${esc(inp.title)}</h2>${inp.subtitle ? `<div class="m">${esc(inp.subtitle)}</div>` : ''}<div class="m">${esc(paramLine(inp.params))}</div>
<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${tot}</table><div class="m" style="margin-top:10px">Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)}</div></body></html>`;
}

/** Word (.docx): company header, title, filters, table (header row repeats on every page), totals. Landscape for wide tables. */
export async function toDocx(inp: ExportInput): Promise<Buffer> {
  const co = await companyInfo();
  const cols = inp.columns.map((c) => {
    const sample = inp.rows.find((r) => getPath(r, c.key) != null);
    const t = typeOf(c, sample ? getPath(sample, c.key) : undefined);
    return { c, t, align: alignOf(c, t) };
  });
  const landscape = cols.length > 6;
  const AL = { left: AlignmentType.LEFT, right: AlignmentType.RIGHT, center: AlignmentType.CENTER } as const;
  const SZ = cols.length > 10 ? 14 : 16; // half-points: 7 / 8 pt
  const cell = (text: string, align: 'left' | 'right' | 'center', o: { head?: boolean; bold?: boolean; shade?: string } = {}) =>
    new TableCell({
      children: [new Paragraph({ alignment: AL[align], children: [new TextRun({ text, size: SZ, bold: o.head || o.bold, color: o.head ? 'FFFFFF' : '111827', font: 'Arial' })] })],
      shading: o.shade ? { type: ShadingType.CLEAR, color: 'auto', fill: o.shade } : undefined,
      margins: { top: 30, bottom: 30, left: 60, right: 60 },
    });
  const header = new TableRow({ tableHeader: true, children: cols.map((x) => cell(labelOf(x.c), x.align, { head: true, shade: '1E3A5F' })) });
  const body = inp.rows.map((r, i) => new TableRow({ children: cols.map((x) => cell(fmtCell(getPath(r, x.c.key), x.t), x.align, { shade: i % 2 ? 'F8FAFC' : undefined })) }));
  const tot =
    inp.totals && Object.keys(inp.totals).length
      ? [new TableRow({ children: cols.map((x, i) => cell(getPath(inp.totals, x.c.key) != null ? fmtCell(getPath(inp.totals, x.c.key), x.t) : i === 0 ? 'Total' : '', x.align, { bold: true, shade: 'E2E8F0' })) })]
      : [];
  const p = (text: string, o: { size?: number; bold?: boolean; color?: string; after?: number } = {}) =>
    new Paragraph({ spacing: { after: o.after ?? 40 }, children: [new TextRun({ text, size: o.size ?? 18, bold: o.bold, color: o.color ?? '111827', font: 'Arial' })] });
  const doc = new Document({
    creator: co.name,
    title: inp.title,
    sections: [
      {
        properties: { page: { size: { orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: 567, bottom: 567, left: 567, right: 567 } } },
        children: [
          p(co.name, { size: 30, bold: true, color: '1E3A5F' }),
          ...([co.trn ? `TRN: ${co.trn}` : '', co.address].filter(Boolean).length ? [p([co.trn ? `TRN: ${co.trn}` : '', co.address].filter(Boolean).join(' | '), { size: 16, color: '6B7280' })] : []),
          p(inp.title, { size: 24, bold: true, after: 20 }),
          ...(inp.subtitle ? [p(inp.subtitle, { size: 16, color: '6B7280' })] : []),
          ...(paramLine(inp.params) ? [p(paramLine(inp.params), { size: 16, color: '6B7280' })] : []),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body, ...tot] }),
          p(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)}  ·  ${inp.rows.length} rows`, { size: 14, color: '6B7280' }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

export const MIME = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

export async function render(inp: ExportInput, format: 'pdf' | 'xlsx' | 'csv' | 'docx'): Promise<{ buffer: Buffer; mime: string; ext: string }> {
  if (format === 'csv') return { buffer: toCsv(inp), mime: MIME.csv, ext: 'csv' };
  if (format === 'xlsx') return { buffer: await toXlsx(inp), mime: MIME.xlsx, ext: 'xlsx' };
  if (format === 'docx') return { buffer: await toDocx(inp), mime: MIME.docx, ext: 'docx' };
  return { buffer: await toPdf(inp), mime: MIME.pdf, ext: 'pdf' };
}
void num;
