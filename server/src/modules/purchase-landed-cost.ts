/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import { z } from 'zod';
import { prisma, Tx } from '../lib/prisma';
import { ah, intParam, parse } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import { nextNumber } from '../services/numbering';
import { linkDocs } from '../services/docLink';
import { revalueStock } from '../services/stock';
import { postJournal, reverseJournal } from '../services/accounting';
import { enrich } from '../lib/enrich';
import { num, r2, r4 } from '../lib/calc';
import { assertStatus, deleteLinks, finishDoc, findSourceJournal, listDocs } from '../services/purchase-common';
import type { ModuleDef } from '../app';

const T = { timeout: 30000 };
const L = 'landed_cost';
const CHARGES = ['FREIGHT', 'INSURANCE', 'CUSTOMS_DUTY', 'PORT_CHARGES', 'CLEARING', 'TRANSPORT', 'HANDLING', 'OTHER'] as const;
const METHODS = ['QUANTITY', 'VALUE', 'WEIGHT', 'VOLUME'] as const;
type Db = Tx | typeof prisma;

const chargeIn = z.object({ chargeType: z.enum(CHARGES), description: z.string().nullish(), amount: z.coerce.number().positive(), supplierId: z.coerce.number().int().nullish() });
const lcSchema = z.object({
  docDate: z.coerce.date().optional(),
  receiptId: z.coerce.number().int(),
  allocationMethod: z.enum(METHODS).default('VALUE'),
  remarks: z.string().nullish(),
  charges: z.array(chargeIn).min(1),
});

/** Allocation of total additional cost over the lines of a posted import GRN (amounts in base currency). */
export async function computeAllocation(db: Db, receiptId: number, method: (typeof METHODS)[number], totalAdditional: number) {
  const g: any = await db.goodsReceipt.findUnique({ where: { id: receiptId }, include: { items: { orderBy: { id: 'asc' } } } });
  if (!g) throw notFound('Goods receipt not found');
  if (g.status !== 'POSTED') throw badRequest(`Goods receipt ${g.docNo} is not posted`);
  if (g.grnType !== 'IMPORT') throw badRequest('Landed cost can only be attached to an import goods receipt');
  const ps = await db.product.findMany({ where: { id: { in: g.items.map((i: any) => i.productId) } } });
  const pm = new Map(ps.map((p) => [p.id, p]));
  const lines = g.items.filter((i: any) => num(i.qty) > 0).map((i: any) => {
    const p = pm.get(i.productId);
    const qty = num(i.qty);
    const baseCost = r2(qty * num(i.unitCost));
    const basis =
      method === 'QUANTITY' ? qty : method === 'VALUE' ? baseCost : method === 'WEIGHT' ? qty * num(p?.weight) : qty * num(p?.length) * num(p?.width) * num(p?.height);
    return { receiptItemId: i.id, productId: i.productId, qty, baseCost, basis, oldUnitCost: r4(num(i.landedUnitCost) || num(i.unitCost)), allocated: 0, newUnitCost: 0 };
  });
  const sumBasis = lines.reduce((s: number, l: any) => s + l.basis, 0);
  if (sumBasis <= 0) throw badRequest(`Cannot allocate by ${method}: the products have no ${method.toLowerCase()} data`);
  let given = 0;
  const live = lines.filter((l: any) => l.basis > 0);
  live.forEach((l: any, idx: number) => {
    l.allocated = idx === live.length - 1 ? r2(totalAdditional - given) : r2((totalAdditional * l.basis) / sumBasis);
    given = r2(given + l.allocated);
  });
  for (const l of lines) l.newUnitCost = r4(l.oldUnitCost + (l.qty ? l.allocated / l.qty : 0));
  const productCost = r2(lines.reduce((s: number, l: any) => s + l.baseCost, 0));
  return { receipt: g, lines, productCost, totalAdditional: r2(totalAdditional), actualLandedCost: r2(productCost + totalAdditional) };
}

const sumCharges = (c: Array<{ amount: unknown }>) => r2(c.reduce((s, x) => s + num(x.amount), 0));

async function validateCharges(db: Db, charges: z.infer<typeof chargeIn>[]) {
  const ids = [...new Set(charges.map((c) => c.supplierId).filter((x): x is number => !!x))];
  if (ids.length && (await db.supplier.count({ where: { id: { in: ids } } })) !== ids.length) throw badRequest('Unknown supplier on a charge');
}

async function saveAllocations(tx: Tx, lcId: number, a: Awaited<ReturnType<typeof computeAllocation>>) {
  await tx.landedCostAllocation.deleteMany({ where: { landedCostId: lcId } });
  await tx.landedCostAllocation.createMany({
    data: a.lines.map((l: any) => ({ landedCostId: lcId, productId: l.productId, receiptItemId: l.receiptItemId, qty: l.qty, baseCost: l.baseCost, allocated: l.allocated, oldUnitCost: l.oldUnitCost, newUnitCost: l.newUnitCost })),
  });
}

async function lcDetail(id: number) {
  const lc = await prisma.landedCost.findUnique({ where: { id }, include: { charges: { orderBy: { id: 'asc' } }, allocations: { orderBy: { id: 'asc' } } } });
  if (!lc) throw notFound('Landed cost not found');
  const d: any = await finishDoc(lc, 'LANDED_COST', {});
  await enrich(d.allocations, { productId: 'product' });
  await enrich(d.charges, { supplierId: 'supplier' });
  d.receipt = await prisma.goodsReceipt.findUnique({ where: { id: lc.receiptId }, select: { id: true, docNo: true, grnType: true, supplierId: true, warehouseId: true, status: true, shipmentId: true } });
  if (d.receipt) await enrich([d.receipt], { supplierId: 'supplier', warehouseId: 'warehouse' });
  return d;
}

const router = Router();
router.get('/', can(L, 'view'), ah(async (req, res) => {
  res.json(await listDocs(req, {
    model: 'landedCost', search: ['docNo', 'remarks'], numeric: ['receiptId'], strings: ['allocationMethod'], enrich: {},
    after: async (rows) => {
      const gs = await prisma.goodsReceipt.findMany({ where: { id: { in: rows.map((r) => r.receiptId) } }, select: { id: true, docNo: true, supplierId: true } });
      const m = new Map(gs.map((g) => [g.id, g]));
      rows.forEach((r) => (r.receipt = m.get(r.receiptId) ?? null));
      await enrich(rows.map((r) => r.receipt).filter(Boolean), { supplierId: 'supplier' });
    },
  }));
}));

router.post('/preview', can(L, 'view'), ah(async (req, res) => {
  const b = parse(lcSchema.pick({ receiptId: true, allocationMethod: true, charges: true }), req.body);
  await validateCharges(prisma, b.charges);
  const a = await computeAllocation(prisma, b.receiptId, b.allocationMethod ?? 'VALUE', sumCharges(b.charges));
  const lines: any[] = a.lines;
  await enrich(lines, { productId: 'product' });
  const byType: Record<string, number> = {};
  for (const c of b.charges) byType[c.chargeType] = r2((byType[c.chargeType] ?? 0) + c.amount);
  res.json({ receiptId: b.receiptId, receiptNo: a.receipt.docNo, allocationMethod: b.allocationMethod ?? 'VALUE', productCost: a.productCost, totalAdditional: a.totalAdditional, actualLandedCost: a.actualLandedCost, chargesByType: byType, lines });
}));

router.get('/:id', can(L, 'view'), ah(async (req, res) => res.json(await lcDetail(intParam(req)))));

router.post('/', can(L, 'create'), ah(async (req, res) => {
  const b = parse(lcSchema, req.body);
  const id = await prisma.$transaction(async (tx) => {
    await validateCharges(tx, b.charges);
    const a = await computeAllocation(tx, b.receiptId, b.allocationMethod ?? 'VALUE', sumCharges(b.charges));
    const docDate = b.docDate ?? new Date();
    const docNo = await nextNumber(tx, 'LANDED_COST', { date: docDate });
    const lc = await tx.landedCost.create({
      data: {
        docNo, docDate, receiptId: b.receiptId, allocationMethod: b.allocationMethod ?? 'VALUE', productCost: a.productCost, totalAdditional: a.totalAdditional, actualLandedCost: a.actualLandedCost, status: 'DRAFT', remarks: b.remarks, createdBy: req.user!.id,
        charges: { create: b.charges.map((c) => ({ chargeType: c.chargeType, description: c.description, amount: c.amount, supplierId: c.supplierId ?? null })) },
      },
    });
    await saveAllocations(tx, lc.id, a);
    await linkDocs(tx, { type: 'GOODS_RECEIPT', id: a.receipt.id, no: a.receipt.docNo }, { type: 'LANDED_COST', id: lc.id, no: lc.docNo });
    await audit(tx, req.user, 'CREATE', 'LandedCost', lc.id, { docNo, receipt: a.receipt.docNo, totalAdditional: a.totalAdditional });
    return lc.id;
  }, T);
  res.status(201).json(await lcDetail(id));
}));

router.put('/:id', can(L, 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const b = parse(lcSchema.partial().omit({ receiptId: true }), req.body);
  await prisma.$transaction(async (tx) => {
    const cur: any = assertStatus(await tx.landedCost.findUnique({ where: { id }, include: { charges: true } }), ['DRAFT'], 'edit');
    const charges = b.charges ?? cur.charges.map((c: any) => ({ chargeType: c.chargeType, description: c.description, amount: num(c.amount), supplierId: c.supplierId }));
    await validateCharges(tx, charges);
    const method = b.allocationMethod ?? cur.allocationMethod;
    const a = await computeAllocation(tx, cur.receiptId, method, sumCharges(charges));
    if (b.charges) {
      await tx.landedCostCharge.deleteMany({ where: { landedCostId: id } });
      await tx.landedCostCharge.createMany({ data: charges.map((c: any) => ({ landedCostId: id, chargeType: c.chargeType, description: c.description, amount: c.amount, supplierId: c.supplierId ?? null })) });
    }
    await tx.landedCost.update({ where: { id }, data: { docDate: b.docDate, allocationMethod: method, remarks: b.remarks, productCost: a.productCost, totalAdditional: a.totalAdditional, actualLandedCost: a.actualLandedCost } });
    await saveAllocations(tx, id, a);
    await audit(tx, req.user, 'UPDATE', 'LandedCost', id);
  }, T);
  res.json(await lcDetail(id));
}));

router.delete('/:id', can(L, 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    assertStatus(await tx.landedCost.findUnique({ where: { id } }), ['DRAFT'], 'delete');
    await tx.landedCost.delete({ where: { id } });
    await deleteLinks(tx, 'LANDED_COST', id);
    await audit(tx, req.user, 'DELETE', 'LandedCost', id);
  }, T);
  res.json({ ok: true });
}));

router.post('/:id/post', can(L, 'post'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const lc: any = assertStatus(await tx.landedCost.findUnique({ where: { id }, include: { charges: true } }), ['DRAFT'], 'post');
    const a = await computeAllocation(tx, lc.receiptId, lc.allocationMethod, sumCharges(lc.charges)); // fresh: earlier landed costs may have changed unit costs
    await saveAllocations(tx, id, a);
    await tx.landedCost.update({ where: { id }, data: { productCost: a.productCost, totalAdditional: a.totalAdditional, actualLandedCost: a.actualLandedCost } });
    const g = a.receipt;
    let inventory = 0;
    for (const l of a.lines as any[]) {
      if (!l.allocated) continue;
      await revalueStock(tx, { productId: l.productId, warehouseId: g.warehouseId, extraValue: l.allocated, refType: 'LANDED_COST', refId: id, refNo: lc.docNo, userId: req.user!.id, date: lc.docDate });
      await tx.goodsReceiptItem.update({ where: { id: l.receiptItemId }, data: { landedUnitCost: l.newUnitCost } });
      inventory = r2(inventory + l.allocated);
    }
    // credit side: supplier AP for charges billed by a supplier, GRNI accrual for the rest
    const bySupplier = new Map<number, number>();
    let accrual = 0;
    for (const c of lc.charges) {
      if (c.supplierId) bySupplier.set(c.supplierId, r2((bySupplier.get(c.supplierId) ?? 0) + num(c.amount)));
      else accrual = r2(accrual + num(c.amount));
    }
    const j = await postJournal(tx, {
      date: lc.docDate, entryType: 'AUTO', sourceType: 'LANDED_COST', sourceId: id, sourceNo: lc.docNo, narration: `Landed cost ${lc.docNo} on ${g.docNo}`, userId: req.user!.id,
      lines: [
        { accountKey: 'INVENTORY', debit: inventory, description: `Landed cost ${lc.docNo}` },
        ...[...bySupplier.entries()].map(([supplierId, amount]) => ({ accountKey: 'AP', credit: amount, partyType: 'SUPPLIER' as const, partyId: supplierId, description: `Landed cost charges ${lc.docNo}` })),
        { accountKey: 'GRNI', credit: accrual, description: `Landed cost accrual ${lc.docNo}` },
      ],
    });
    await tx.landedCost.update({ where: { id }, data: { status: 'POSTED' } });
    await audit(tx, req.user, 'POST', 'LandedCost', id, { journal: j.entryNo, totalAdditional: a.totalAdditional });
  }, T);
  res.json(await lcDetail(id));
}));

router.post('/:id/cancel', can(L, 'cancel'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const lc: any = assertStatus(await tx.landedCost.findUnique({ where: { id }, include: { allocations: true } }), ['DRAFT', 'POSTED'], 'cancel');
    if (lc.status === 'POSTED') {
      if (await tx.landedCost.count({ where: { receiptId: lc.receiptId, status: 'POSTED', id: { gt: id } } })) throw badRequest('A later landed cost exists on this receipt; cancel that one first');
      const g: any = await tx.goodsReceipt.findUnique({ where: { id: lc.receiptId } });
      for (const a of lc.allocations) {
        if (!num(a.allocated)) continue;
        await revalueStock(tx, { productId: a.productId, warehouseId: g.warehouseId, extraValue: -num(a.allocated), refType: 'LANDED_COST', refId: id, refNo: `${lc.docNo}-REV`, userId: req.user!.id });
        await tx.goodsReceiptItem.update({ where: { id: a.receiptItemId }, data: { landedUnitCost: a.oldUnitCost } });
      }
      const j = await findSourceJournal(tx, 'LANDED_COST', id);
      if (j) await reverseJournal(tx, j.id, req.user!.id);
    }
    await tx.landedCost.update({ where: { id }, data: { status: 'CANCELLED' } });
    await audit(tx, req.user, 'CANCEL', 'LandedCost', id, { wasStatus: lc.status });
  }, T);
  res.json(await lcDetail(id));
}));

export default [{ path: '/landed-costs', router }] as ModuleDef[];
