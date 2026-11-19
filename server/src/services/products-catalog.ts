import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { Tx } from '../lib/prisma';

export const fortuneCompany = { code: 'F7', name: 'Fortune 7 Printing Equipment Trading LLC', arabicName: null, trn: null, address: 'Showroom No. 5, Team Engineering Building, Industrial Area 15, Sharjah', country: 'UAE', baseCurrency: 'AED', phone: '+971 56 507 4814', email: 'info@fortune7.online' };

/** Idempotent catalogue setup. Existing selling prices, stock and transactions are never reset. */
export async function seedFortuneCatalog(db: PrismaClient | Tx) {
  const catalog = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'assets/products/catalog.json'), 'utf8')) as { code: string; name: string; alternateCode?: string }[];
  for (const [code, name] of [['GXU','GXU'], ['FORTUNE','Fortune'], ['7M','7M'], ['TOYO','TOYO INK'], ['LANQI','LANQI']]) await db.brand.upsert({ where: { code }, update: {}, create: { code, name } });
  for (const [code, name] of [['PRINTERS','Printing Machines'], ['FINISHING','Laminators & Plotters'], ['INDUSTRIAL','Industrial Machinery'], ['INKS','Inks & Consumables'], ['MEDIA','Printing Materials'], ['PRINTHEADS','Printheads'], ['SPARES','Equipment Spare Parts']]) await db.category.upsert({ where: { code }, update: {}, create: { code, name } });
  const parent = await db.category.findUniqueOrThrow({ where: { code: 'INDUSTRIAL' } });
  const category = await db.category.upsert({ where: { code: 'FIBER-LASER' }, update: {}, create: { code: 'FIBER-LASER', name: 'Fiber Laser Machines', parentId: parent.id } });
  for (const [code, name] of [['EQUIPMENT','Equipment'], ['CONSUMABLES','Consumables'], ['PARTS','Spare Parts']]) await db.productGroup.upsert({ where: { code }, update: {}, create: { code, name } });
  for (const [code, name] of [['MACHINE','Machine'], ['CONSUMABLE','Consumable'], ['PART','Part']]) await db.productType.upsert({ where: { code }, update: {}, create: { code, name } });
  const brand = await db.brand.findUniqueOrThrow({ where: { code: 'GXU' } });
  const group = await db.productGroup.findUniqueOrThrow({ where: { code: 'EQUIPMENT' } });
  const type = await db.productType.findUniqueOrThrow({ where: { code: 'MACHINE' } });
  for (const item of catalog) {
    const existing = await db.product.findUnique({ where: { code: item.code } });
    if (existing) continue;
    await db.product.create({ data: { code: item.code, name: item.name, description: 'Sample catalogue machine. Prices, opening stock and detailed specifications await confirmation.', brandId: brand.id, categoryId: parent.id, subCategoryId: category.id, productGroupId: group.id, productTypeId: type.id, purchaseUnit: 'PCS', salesUnit: 'PCS', vehicleMake: 'GXU', vehicleModel: item.code,
      ...(item.alternateCode ? { partNumbers: { create: [{ number: item.alternateCode, kind: 'ALTERNATE' }] } } : {}),
    } });
  }
}
