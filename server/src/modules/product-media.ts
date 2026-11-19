import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { ah, intParam } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import { productPhotoDir, productPhotoPath } from '../services/products-media';
import type { ModuleDef } from '../app';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
router.get('/:id/photo', can('products', 'view'), ah(async (req, res) => {
  const id = intParam(req);
  if (!(await prisma.product.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Product not found');
  const file = await productPhotoPath(id);
  res.setHeader('Cache-Control', 'private, no-cache');
  if (!file) { res.status(204).end(); return; }
  res.type('image/webp').sendFile(file);
}));
router.post('/:id/photo', can('products', 'edit'), (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => next(err ? badRequest('Choose one JPEG, PNG or WebP image up to 5 MB') : undefined));
}, ah(async (req, res) => {
  const id = intParam(req);
  if (!(await prisma.product.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Product not found');
  if (!req.file) throw badRequest('Choose a product image');
  const input = sharp(req.file.buffer, { limitInputPixels: 40000000 });
  let webp: Buffer, jpg: Buffer;
  try {
    const meta = await input.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format || '')) throw new Error('Unsupported image');
    [webp, jpg] = await Promise.all([
      input.clone().rotate().resize({ width: 1200, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(),
      input.clone().rotate().flatten({ background: '#ffffff' }).resize({ width: 600, height: 500, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer(),
    ]);
  } catch { throw badRequest('Image cannot be read. Choose a valid JPEG, PNG or WebP.'); }
  const filename = randomUUID() + '.webp';
  const target = path.join(productPhotoDir, filename);
  const print = target.replace(/\.webp$/, '.jpg');
  await fs.mkdir(productPhotoDir, { recursive: true });
  try {
    await fs.writeFile(target, webp); await fs.writeFile(print, jpg);
    await prisma.$transaction(async tx => {
      await tx.attachment.create({ data: { docType: 'PRODUCT_PHOTO', docId: id, fileName: filename, filePath: target, mimeType: 'image/webp', size: webp.length, uploadedBy: req.user?.id } });
      await audit(tx, req.user, 'UPDATE_PHOTO', 'Product', id, { fileName: filename, size: webp.length });
    });
  } catch (error) { await Promise.all([fs.rm(target, { force: true }), fs.rm(print, { force: true })]); throw error; }
  res.json({ ok: true, size: webp.length });
}));
export default [{ path: '/products', router }] satisfies ModuleDef[];
