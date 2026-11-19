// Rebuilds StockBalance.onHand / reserved from the stock ledger and active reservations (maintenance tool).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tx = await prisma.stockTransaction.groupBy({ by: ['productId', 'warehouseId'], _sum: { qty: true } });
  const res = await prisma.stockReservation.findMany({ where: { status: 'ACTIVE' } });
  const reserved = new Map<string, number>();
  for (const r of res) {
    const k = `${r.productId}:${r.warehouseId}`;
    reserved.set(k, (reserved.get(k) ?? 0) + Number(r.qty) - Number(r.fulfilledQty));
  }
  const seen = new Set<string>();
  for (const g of tx) {
    const k = `${g.productId}:${g.warehouseId}`;
    seen.add(k);
    const onHand = Number(g._sum.qty ?? 0);
    const rsv = reserved.get(k) ?? 0;
    const bal = await prisma.stockBalance.findUnique({ where: { productId_warehouseId: { productId: g.productId, warehouseId: g.warehouseId } } });
    if (!bal) await prisma.stockBalance.create({ data: { productId: g.productId, warehouseId: g.warehouseId, onHand, reserved: rsv } });
    else if (Number(bal.onHand) !== onHand || Number(bal.reserved) !== rsv) {
      console.log(`fix ${k}: onHand ${bal.onHand} -> ${onHand}, reserved ${bal.reserved} -> ${rsv}`);
      await prisma.stockBalance.update({ where: { id: bal.id }, data: { onHand, reserved: rsv } });
    }
  }
  for (const b of await prisma.stockBalance.findMany()) {
    const k = `${b.productId}:${b.warehouseId}`;
    if (!seen.has(k) && (Number(b.onHand) !== 0 || Number(b.reserved) !== 0)) {
      console.log(`zero ${k}`);
      await prisma.stockBalance.update({ where: { id: b.id }, data: { onHand: 0, reserved: reserved.get(k) ?? 0 } });
    }
  }
  console.log('done');
}
main().finally(() => prisma.$disconnect());
