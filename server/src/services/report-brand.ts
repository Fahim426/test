import fs from 'fs';
import path from 'path';

// Bundled local asset: works from src/services and dist/services, without network access.
export const companyLogoPath = path.resolve(__dirname, '../../assets/brand/fortune7-logo.jpeg');
export const companyLogoDataUri = () => 'data:image/jpeg;base64,' + fs.readFileSync(companyLogoPath).toString('base64');
export function drawCompanyLogo(doc: PDFKit.PDFDocument, x: number, y: number, width = 200) {
  const height = width * 494 / 1280;
  doc.image(companyLogoPath, x, y, { width });
  return y + height + 6;
}
