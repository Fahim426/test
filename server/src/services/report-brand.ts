import sharp from "sharp";
import { readCompanyLogo } from "./product-config";
export async function companyLogoDataUri() {
  const logo = await readCompanyLogo();
  return logo
    ? "data:" +
        (logo.file.endsWith(".png") ? "image/png" : "image/jpeg") +
        ";base64," +
        logo.data.toString("base64")
    : "";
}
export async function drawCompanyLogo(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width = 200,
) {
  const logo = await readCompanyLogo();
  if (!logo) return y;
  const m = await sharp(logo.data).metadata();
  const height = Math.min(85, (width * (m.height ?? 1)) / (m.width ?? 1));
  doc.image(logo.data, x, y, { fit: [width, height] });
  return y + height + 6;
}
