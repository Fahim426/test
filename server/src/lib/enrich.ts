import { prisma } from './prisma';

/**
 * Batch-attaches related master records to rows that only carry plain FK ids (no Prisma relation).
 * enrich(rows, { customerId: 'customer', supplierId: 'supplier', warehouseId: 'warehouse', productId: 'product', salesmanId: 'salesman' })
 * adds row.customer = {id, code, name, ...} etc. Works on lists and on nested item arrays.
 * A product also gets stockNumber, brandName, altNo (alternative numbers) and vehicle (compatibility) display strings
 * for the item grids.
 */
const MODELS: Record<string, { model: string; select: Record<string, unknown> }> = {
  customerId: { model: 'customer', select: { id: true, code: true, name: true, trn: true, address: true, paymentTermId: true, creditLimit: true } },
  supplierId: { model: 'supplier', select: { id: true, code: true, name: true, country: true, currencyCode: true } },
  warehouseId: { model: 'warehouse', select: { id: true, code: true, name: true } },
  fromWarehouseId: { model: 'warehouse', select: { id: true, code: true, name: true } },
  toWarehouseId: { model: 'warehouse', select: { id: true, code: true, name: true } },
  productId: {
    model: 'product',
    select: { id: true, code: true, stockNumber: true, name: true, oemNumber: true, barcode: true, purchaseUnit: true, salesUnit: true, rack: true, shelf: true, bin: true, vatRate: true, weight: true, brand: { select: { name: true } } },
  },
  salesmanId: { model: 'salesman', select: { id: true, code: true, name: true } },
  accountId: { model: 'account', select: { id: true, code: true, name: true } },
};

const more = (list: string[], show: number) => (list.length > show ? `${list.slice(0, show).join('; ')} (+${list.length - show})` : list.join('; '));

/** Alternative numbers ("0 986 AF0 050 (BOSCH); W 712/75 (MANN)") and vehicles ("Toyota Hilux 2018-2022") as short strings. */
export async function productExtras(ids: number[]): Promise<Map<number, { altNo: string; vehicle: string }>> {
  const out = new Map<number, { altNo: string; vehicle: string }>();
  const uniq = [...new Set(ids)].slice(0, 500);
  if (!uniq.length) return out;
  const [pns, vs] = await Promise.all([
    prisma.productPartNumber.findMany({ where: { productId: { in: uniq }, kind: 'ALTERNATE' }, select: { productId: true, number: true, brand: true }, orderBy: { id: 'asc' }, take: 5000 }),
    prisma.productVehicle.findMany({ where: { productId: { in: uniq } }, select: { productId: true, make: true, model: true, yearFrom: true, yearTo: true }, orderBy: { id: 'asc' }, take: 5000 }),
  ]);
  const alt = new Map<number, string[]>();
  for (const p of pns) alt.set(p.productId, [...(alt.get(p.productId) ?? []), `${p.number}${p.brand ? ` (${p.brand})` : ''}`]);
  const veh = new Map<number, string[]>();
  for (const v of vs) {
    const years = v.yearFrom ? ` ${v.yearFrom}${v.yearTo ? (v.yearTo === v.yearFrom ? '' : `-${v.yearTo}`) : '+'}` : '';
    veh.set(v.productId, [...(veh.get(v.productId) ?? []), `${v.make} ${v.model}${years}`]);
  }
  for (const id of uniq) out.set(id, { altNo: more(alt.get(id) ?? [], 3), vehicle: more(veh.get(id) ?? [], 2) });
  return out;
}

export async function enrich<T extends Record<string, unknown>>(rows: T[], map: Record<string, string>): Promise<T[]> {
  for (const [fk, target] of Object.entries(map)) {
    const spec = MODELS[fk];
    if (!spec) throw new Error(`enrich: unknown FK ${fk}`);
    const ids = [...new Set(rows.map((r) => r[fk]).filter((v): v is number => typeof v === 'number'))];
    if (!ids.length) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const found = await (prisma as any)[spec.model].findMany({ where: { id: { in: ids } }, select: spec.select });
    if (spec.model === 'product') {
      const extras = await productExtras(ids);
      for (const f of found as Record<string, unknown>[]) {
        f.brandName = (f.brand as { name?: string } | null)?.name ?? null;
        delete f.brand;
        Object.assign(f, extras.get(f.id as number) ?? { altNo: '', vehicle: '' });
      }
    }
    const byId = new Map<number, unknown>(found.map((f: { id: number }) => [f.id, f]));
    for (const r of rows) (r as Record<string, unknown>)[target] = typeof r[fk] === 'number' ? byId.get(r[fk] as number) ?? null : null;
  }
  return rows;
}
