import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../lib/prisma';
import { env } from '../lib/env';

export const productPhotoDir = path.resolve(env.uploadDir, 'product-photos');
const assetDir = path.resolve(process.cwd(), 'assets/products');
/** Only generated filenames are accepted; attachment paths never become arbitrary file reads. */
export async function productPhotoPath(id: number, print = false): Promise<string | null> {
  const photo = await prisma.attachment.findFirst({ where: { docType: 'PRODUCT_PHOTO', docId: id }, orderBy: { id: 'desc' } });
  if (photo && /^[a-f0-9-]+\.webp$/i.test(photo.fileName)) {
    const p = path.join(productPhotoDir, photo.fileName.replace(/\.webp$/i, print ? '.jpg' : '.webp'));
    await fs.access(p);
    return p;
  }
  const product = await prisma.product.findUnique({ where: { id }, select: { code: true } });
  if (!product) return null;
  const slug = product.code.replace(/[^A-Za-z0-9_-]/g, '-');
  const p = path.join(assetDir, slug + (print ? '.jpg' : '.webp'));
  try { await fs.access(p); return p; } catch { return null; }
}
export async function productPrintPhoto(id: number): Promise<Buffer | null> {
  const p = await productPhotoPath(id, true);
  return p ? fs.readFile(p) : null;
}
