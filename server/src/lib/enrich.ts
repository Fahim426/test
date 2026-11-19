import { prisma } from './prisma';

/**
 * Batch-attaches related master records to rows that only carry plain FK ids (no Prisma relation).
 * enrich(rows, { customerId: 'customer', supplierId: 'supplier', warehouseId: 'warehouse', productId: 'product', salesmanId: 'salesman' })
 * adds row.customer = {id, code, name, ...} etc. Works on lists and on nested item arrays.
 */
const MODELS: Record<string, { model: string; select: Record<string, boolean> }> = {
  customerId: { model: 'customer', select: { id: true, code: true, name: true, trn: true, address: true, paymentTermId: true, creditLimit: true } },
  supplierId: { model: 'supplier', select: { id: true, code: true, name: true, country: true, currencyCode: true } },
  warehouseId: { model: 'warehouse', select: { id: true, code: true, name: true } },
  fromWarehouseId: { model: 'warehouse', select: { id: true, code: true, name: true } },
  toWarehouseId: { model: 'warehouse', select: { id: true, code: true, name: true } },
  productId: { model: 'product', select: { id: true, code: true, name: true, oemNumber: true, barcode: true, purchaseUnit: true, salesUnit: true, rack: true, shelf: true, bin: true, vatRate: true, weight: true } },
  salesmanId: { model: 'salesman', select: { id: true, code: true, name: true } },
  accountId: { model: 'account', select: { id: true, code: true, name: true } },
};

export async function enrich<T extends Record<string, unknown>>(rows: T[], map: Record<string, string>): Promise<T[]> {
  for (const [fk, target] of Object.entries(map)) {
    const spec = MODELS[fk];
    if (!spec) throw new Error(`enrich: unknown FK ${fk}`);
    const ids = [...new Set(rows.map((r) => r[fk]).filter((v): v is number => typeof v === 'number'))];
    if (!ids.length) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const found = await (prisma as any)[spec.model].findMany({ where: { id: { in: ids } }, select: spec.select });
    const byId = new Map<number, unknown>(found.map((f: { id: number }) => [f.id, f]));
    for (const r of rows) (r as Record<string, unknown>)[target] = typeof r[fk] === 'number' ? byId.get(r[fk] as number) ?? null : null;
  }
  return rows;
}
