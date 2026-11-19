import { PdfCol, PDF_COLORS } from './report-export';
import { productPrintPhoto } from './products-media';

/** Photo rows keep images, wrapped descriptions and financial columns together across pages. */
export async function drawInvoicePhotoTable(doc: PDFKit.PDFDocument, columns: PdfCol[], rows: string[][], ids: number[], startY: number) {
  const photos = await Promise.all(ids.map(id => productPrintPhoto(id)));
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const photoWidth = 62;
  const weight = columns.reduce((n, c) => n + (c.w || 1), 0);
  const widths = columns.map(c => (width - photoWidth) * (c.w || 1) / weight);
  let y = startY;
  const header = () => {
    doc.rect(left, y, width, 25).fill(PDF_COLORS.head);
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff');
    doc.text('Photo', left + 4, y + 8, { width: photoWidth - 8, align: 'center' });
    let x = left + photoWidth;
    columns.forEach((c, i) => { doc.text(c.label, x + 3, y + 8, { width: widths[i] - 6, align: c.align || 'left' }); x += widths[i]; });
    y += 25;
  };
  if (y + 90 > doc.page.height - doc.page.margins.bottom - 20) { doc.addPage(); y = doc.page.margins.top; }
  header();
  rows.forEach((row, ri) => {
    doc.font('Helvetica').fontSize(7.5);
    const height = Math.max(60, ...row.map((text, i) => doc.heightOfString(text, { width: widths[i] - 8 }) + 12));
    if (y + height > doc.page.height - doc.page.margins.bottom - 20) { doc.addPage(); y = doc.page.margins.top; header(); }
    doc.rect(left, y, width, height).fill(ri % 2 ? '#f3f5f8' : '#ffffff');
    if (photos[ri]) doc.image(photos[ri]!, left + 4, y + 5, { fit: [photoWidth - 8, height - 10], align: 'center', valign: 'center' });
    else doc.font('Helvetica').fontSize(7).fillColor(PDF_COLORS.muted).text('No photo', left + 4, y + 24, { width: photoWidth - 8, align: 'center' });
    let x = left + photoWidth;
    doc.font('Helvetica').fontSize(7.5).fillColor(PDF_COLORS.text);
    row.forEach((text, i) => { doc.text(text, x + 4, y + 6, { width: widths[i] - 8, align: columns[i].align || 'left' }); x += widths[i]; });
    doc.moveTo(left, y + height).lineTo(left + width, y + height).lineWidth(0.4).strokeColor('#dce1e8').stroke();
    y += height;
  });
  doc.x = left; doc.y = y;
}
