import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { fortuneCompany, seedFortuneCatalog } from '../src/services/products-catalog';
import { audit } from '../src/services/audit';

const db = new PrismaClient({ errorFormat: 'minimal' });
async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '3307' || url.pathname !== '/smartspare_erp') throw new Error('This script is restricted to the isolated local demo database on port 3307.');
  // Refuse replacement if any trading, inventory or ledger activity has begun.
  for (const model of Prisma.dmmf.datamodel.models.filter(m => m.fields.some(f => f.name === 'docNo') || ['StockTransaction','StockBalance','StockReservation','JournalEntry'].includes(m.name))) {
    const delegate = (db as any)[model.name[0].toLowerCase() + model.name.slice(1)];
    if (await delegate.count()) throw new Error('Demo replacement refused: existing activity in ' + model.name);
  }
  const products = await db.product.findMany();
  const oldCodes = ['BP-00125', 'OF-00231', 'AF-00310'];
  if (products.length !== 3 || products.some(p => !oldCodes.includes(p.code))) throw new Error('Demo replacement refused: product catalogue is no longer the original demo.');
  const contracts = await db.amcContract.findMany();
  if (contracts.length !== 10 || contracts.some((c) => !/^AMC-2026-000(0[1-9]|10)$/.test(c.contractNo) || !c.notes?.startsWith('AMC contract for '))) throw new Error('Demo replacement refused: AMC records differ from the original seed.');
  const tables = ['company','businessUnit','product','brand','category','productGroup','productType','productPartNumber','productVehicle','amcContract','amcVisit'];
  const backup: Record<string, unknown> = { createdAt: new Date().toISOString(), purpose: 'Before Fortune 7 demo catalogue replacement' };
  for (const table of tables) backup[table] = await (db as any)[table].findMany();
  const backupDir = path.resolve(process.cwd(), '../.local-run');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, 'before-fortune7-' + Date.now() + '.json');
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  await db.$transaction(async tx => {
    await tx.amcVisit.deleteMany({ where: { contractId: { in: contracts.map(c => c.id) } } });
    await tx.amcContract.deleteMany({ where: { id: { in: contracts.map(c => c.id) } } });
    await tx.product.deleteMany({ where: { id: { in: products.map(p => p.id) } } });
    await tx.category.updateMany({ data: { parentId: null } });
    await tx.category.deleteMany(); await tx.brand.deleteMany(); await tx.productGroup.deleteMany(); await tx.productType.deleteMany();
    await tx.company.update({ where: { code: 'SS' }, data: fortuneCompany });
    await tx.businessUnit.updateMany({ where: { code: 'BU1' }, data: { name: 'Printing & Industrial Equipment Trading' } });
    await seedFortuneCatalog(tx);
    const actor = await tx.user.findUnique({ where: { username: 'admin' }, select: { id: true, username: true } });
    await audit(tx, actor || undefined, 'REPLACE_DEMO_CATALOG', 'Product', undefined, { removedProducts: oldCodes, removedDemoAmcs: contracts.map(c => c.contractNo), newProducts: 10, backup: path.basename(backupFile) });
  }, { timeout: 30000 });
  console.log('Backup saved. Fortune 7: ' + await db.product.count() + ' products, ' + await db.amcContract.count() + ' AMC contracts. No stock or accounting entries changed.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
