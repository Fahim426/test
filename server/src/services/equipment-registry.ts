import { createHash } from 'node:crypto';
import { prisma, Tx, Prisma } from '../lib/prisma';
import { badRequest, notFound, conflict } from '../lib/errors';
import { audit } from './audit';
export const UNIT_PREFIX = 'equipment.unit.';
export type Unit = { id: string; serialNo: string; productId: number; sourceType: 'OPENING'|'GOODS_RECEIPT'|'LEGACY_INSTALLED'; sourceId: number; sourceNo: string; status: 'IN_STOCK'|'DELIVERED'|'INSTALLED'; warehouseId: number|null; branchId: number|null; customerId: number|null; amcId: number|null; installationDate: string|null; warrantyEnd: string|null; createdAt: string; updatedAt: string; version: number; events: { action: string; date: string; employee: string; refId?: number; refNo?: string; notes?: string }[] };
export const serialKey = (serial: string) => createHash('sha256').update(serial.normalize('NFKC').trim().toUpperCase()).digest('hex').slice(0,32);
export async function units(db: Tx | typeof prisma = prisma): Promise<Unit[]> { return (await db.systemSetting.findMany({ where: { key: { startsWith: UNIT_PREFIX } } })).map(row => JSON.parse(row.value)); }
export async function registryLock(tx: Tx) {
  await tx.$executeRaw(Prisma.sql`INSERT INTO SystemSetting (\`key\`, \`value\`) VALUES ('equipment.registry.lock', '1') ON DUPLICATE KEY UPDATE \`key\` = VALUES(\`key\`)`);
}
export async function readUnit(db: Tx | typeof prisma, id: string): Promise<Unit> { const row = await db.systemSetting.findUnique({ where: { key: UNIT_PREFIX + id } }); if (!row) throw notFound('Machine serial not found'); return JSON.parse(row.value); }
export async function assertStockCapacity(tx: Tx, all: Unit[], productId: number, warehouseId: number, excluding?: string) {
  const stock = await tx.stockBalance.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
  const registered = all.filter(u => u.id !== excluding && u.status === 'IN_STOCK' && u.productId === productId && u.warehouseId === warehouseId).length;
  if (registered + 1 > Number(stock?.onHand || 0)) throw badRequest('Registered serials would exceed the posted stock in this warehouse. Post the stock transaction first.');
}
export async function bindDelivery(tx: Tx, unit: Unit, deliveryId: number, all: Unit[]) {
  const dn = await tx.deliveryNote.findUnique({ where: { id: deliveryId }, include: { items: true } });
  if (!dn || dn.status !== 'POSTED') throw badRequest('Select a posted delivery note');
  if (dn.warehouseId !== unit.warehouseId) throw badRequest('Delivery warehouse does not match this machine location');
  const quantity = dn.items.filter(i => i.productId === unit.productId).reduce((n,i) => n + Number(i.qty),0);
  const linked = all.filter(u => u.id !== unit.id && u.productId === unit.productId && u.events.some(e => e.action === 'DELIVERY' && e.refId === deliveryId)).length;
  if (linked + 1 > quantity) throw badRequest('Serial assignments exceed the delivered quantity for this product');
  unit.status = 'DELIVERED'; unit.customerId = dn.customerId; unit.warehouseId = null;
  unit.events.push({ action: 'DELIVERY', date: dn.docDate.toISOString(), employee: '', refId: dn.id, refNo: dn.docNo });
}
export async function saveUnit(tx: Tx, unit: Unit, user: { id?: number; username?: string } | undefined, action: string, before?: Unit, reason?: string) {
  const now = new Date().toISOString(); unit.updatedAt = now;
  if (JSON.stringify(unit).length > 45000) throw badRequest('Machine history is full; contact the administrator before adding further events');
  await tx.systemSetting.upsert({ where: { key: UNIT_PREFIX + unit.id }, create: { key: UNIT_PREFIX + unit.id, value: JSON.stringify(unit) }, update: { value: JSON.stringify(unit) } });
  const changes = before ? ['warehouseId','branchId','customerId','status','installationDate','warrantyEnd','amcId','serialNo'].filter(field => (before as any)[field] !== (unit as any)[field]).map(field => ({field,before:(before as any)[field],after:(unit as any)[field]})) : [];
  await audit(tx, user, action, 'EquipmentUnit', unit.id, { serialNo: unit.serialNo, reason, changes });
}
export async function registerUnit(tx: Tx, input: { serialNo: string; productId: number; sourceType: Unit['sourceType']; sourceId: number; deliveryId?: number; notes?: string }, user: { id?: number; username?: string } | undefined) {
  await registryLock(tx); const id = serialKey(input.serialNo);
  if (await tx.systemSetting.findUnique({ where: { key: UNIT_PREFIX + id } })) throw conflict('This serial number is already registered');
  if (!(await tx.product.findUnique({ where: { id: input.productId } }))) throw badRequest('Product not found');
  const all = await units(tx); const now = new Date().toISOString();
  let sourceNo = '', warehouseId: number|null = null, customerId: number|null = null, branchId: number|null = null, amcId: number|null = null;
  if (input.sourceType === 'LEGACY_INSTALLED') {
    const amc = await tx.amcContract.findUnique({ where: { id: input.sourceId } });
    if (!amc || amc.productId !== input.productId || serialKey(amc.serialNo || '') !== id) throw badRequest('Legacy installation requires an AMC with the same product and serial number');
    customerId = amc.customerId; amcId = amc.id; sourceNo = amc.contractNo;
  } else {
    const source = input.sourceType === 'OPENING' ? await tx.stockAdjustment.findUnique({ where: { id: input.sourceId }, include: { items: true } }) : await tx.goodsReceipt.findUnique({ where: { id: input.sourceId }, include: { items: true } });
    if (!source || source.status !== 'POSTED' || ('adjType' in source && source.adjType !== 'OPENING')) throw badRequest('Select a posted goods receipt or opening stock document');
    const quantity = source.items.filter(i => i.productId === input.productId).reduce((n,i) => n + Number('qtyChange' in i ? i.qtyChange : i.qty),0);
    const linked = all.filter(u => u.productId === input.productId && u.sourceType === input.sourceType && u.sourceId === input.sourceId).length;
    if (linked + 1 > quantity) throw badRequest('Serial assignments exceed the source document quantity');
    warehouseId = source.warehouseId; sourceNo = 'adjNo' in source ? source.adjNo : source.docNo;
    branchId = (await tx.warehouse.findUnique({ where: { id: warehouseId } }))?.branchId ?? null;
  }
  const unit: Unit = { id, serialNo: input.serialNo.normalize('NFKC').trim().toUpperCase(), productId: input.productId, sourceType: input.sourceType, sourceId: input.sourceId, sourceNo, status: customerId ? 'INSTALLED' : 'IN_STOCK', warehouseId, branchId, customerId, amcId, installationDate: null, warrantyEnd: null, createdAt: now, updatedAt: now, version: 1, events: [{ action: 'REGISTER', date: now, employee: user?.username || '', refId: input.sourceId, refNo: sourceNo, notes: input.notes }] };
  if (input.deliveryId) { if (unit.status !== 'IN_STOCK') throw badRequest('Legacy installations cannot be delivered again'); await bindDelivery(tx, unit, input.deliveryId, all); unit.events[unit.events.length-1].employee = user?.username || ''; }
  else if (warehouseId) await assertStockCapacity(tx, all, input.productId, warehouseId);
  await saveUnit(tx, unit, user, 'CREATE'); return unit;
}
