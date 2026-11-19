import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { badRequest } from '../lib/errors';
import { audit } from './audit';
import { nextCode } from './admin-master';
import { customerSchema } from '../modules/customers';
import { supplierSchema } from '../modules/suppliers';
import { productSchema } from '../modules/products';

export const ENTITIES = ['customers', 'suppliers', 'products'] as const;
export type Entity = (typeof ENTITIES)[number];

export const EXPORT_COLUMNS: Record<Entity, string[]> = {
  customers: ['code', 'name', 'arabicName', 'trn', 'contactPerson', 'phone', 'mobile', 'email', 'address', 'city', 'country', 'paymentTerm', 'creditLimit', 'currencyCode', 'salesman', 'territory', 'area', 'vatCategory', 'openingBalance', 'isActive'],
  suppliers: ['code', 'name', 'country', 'contactPerson', 'phone', 'email', 'address', 'currencyCode', 'paymentTerm', 'vatCategory', 'trn', 'creditLimit', 'openingBalance', 'bankDetails', 'isActive'],
  products: [
    'code', 'name', 'arabicName', 'description', 'oemNumber', 'barcode', 'brand', 'category', 'productGroup', 'productType', 'partNumbers', 'vehicleMake', 'vehicleModel', 'vehicleVariant', 'yearInfo',
    'engine', 'fuelType', 'purchaseUnit', 'salesUnit', 'costPrice', 'retailPrice', 'wholesalePrice', 'minStock', 'maxStock', 'reorderLevel', 'weight', 'countryOfOrigin', 'warranty', 'vatRate', 'rack', 'shelf', 'bin', 'isActive',
  ],
};

const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();

async function nameMaps() {
  const [terms, salesmen, territories, areas, brands, cats, groups, types] = await Promise.all([
    prisma.paymentTerm.findMany(),
    prisma.salesman.findMany(),
    prisma.territory.findMany(),
    prisma.area.findMany(),
    prisma.brand.findMany(),
    prisma.category.findMany(),
    prisma.productGroup.findMany(),
    prisma.productType.findMany(),
  ]);
  const m = (rows: { id: number; code: string; name: string }[]) => {
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(lc(r.name), r.id);
      map.set(lc(r.code), r.id);
    }
    return map;
  };
  return {
    paymentTerm: m(terms), salesman: m(salesmen), territory: m(territories), area: m(areas),
    brand: m(brands), category: m(cats), productGroup: m(groups), productType: m(types),
    reverse: {
      paymentTerm: new Map(terms.map((x) => [x.id, x.name])),
      salesman: new Map(salesmen.map((x) => [x.id, x.name])),
      territory: new Map(territories.map((x) => [x.id, x.name])),
      area: new Map(areas.map((x) => [x.id, x.name])),
      brand: new Map(brands.map((x) => [x.id, x.name])),
      category: new Map(cats.map((x) => [x.id, x.name])),
      productGroup: new Map(groups.map((x) => [x.id, x.name])),
      productType: new Map(types.map((x) => [x.id, x.name])),
    },
  };
}

const LOOKUPS: Record<Entity, [string, string, keyof Awaited<ReturnType<typeof nameMaps>>][]> = {
  customers: [['paymentTerm', 'paymentTermId', 'paymentTerm'], ['salesman', 'salesmanId', 'salesman'], ['territory', 'territoryId', 'territory'], ['area', 'areaId', 'area']],
  suppliers: [['paymentTerm', 'paymentTermId', 'paymentTerm']],
  products: [['brand', 'brandId', 'brand'], ['category', 'categoryId', 'category'], ['productGroup', 'productGroupId', 'productGroup'], ['productType', 'productTypeId', 'productType']],
};

function truthy(v: unknown) {
  const s = lc(v);
  if (['true', '1', 'yes', 'y', 'active'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'inactive'].includes(s)) return false;
  return undefined;
}

export interface ImportRowReport {
  row: number; // 1-based data row (excluding header)
  status: 'OK' | 'ERROR';
  action?: 'create' | 'update';
  code?: string | null;
  errors: string[];
}

export async function runImport(
  entity: Entity,
  rawRows: Record<string, unknown>[],
  opts: { dryRun: boolean; updateExisting: boolean; user?: { id: number; username: string } },
) {
  if (rawRows.length > 20000) throw badRequest('Too many rows (max 20000 per import)');
  const maps = await nameMaps();
  const schema = (entity === 'customers' ? customerSchema : entity === 'suppliers' ? supplierSchema : productSchema) as z.ZodObject<z.ZodRawShape>;
  const model = entity === 'customers' ? 'customer' : entity === 'suppliers' ? 'supplier' : 'product';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dlg = (prisma as any)[model];
  const existing: { id: number; code: string }[] = await dlg.findMany({ select: { id: true, code: true } });
  const existingByCode = new Map(existing.map((e) => [lc(e.code), e.id]));
  const seen = new Set<string>();
  const report: ImportRowReport[] = [];
  const prepared: { idx: number; data: Record<string, unknown>; partNumbers?: string[]; existingId?: number }[] = [];

  rawRows.forEach((raw, i) => {
    const errors: string[] = [];
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = k.trim();
      if (!key) continue;
      row[key] = typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim()) : v === null ? undefined : v;
    }
    // name lookups (accept either the Id column or the name/code column)
    for (const [col, idCol, mapKey] of LOOKUPS[entity]) {
      if (row[col] !== undefined && row[idCol] === undefined) {
        const id = (maps[mapKey] as Map<string, number>).get(lc(row[col]));
        if (id === undefined) errors.push(`${col}: "${row[col]}" not found`);
        else row[idCol] = id;
      }
      delete row[col];
    }
    if ('isActive' in row && row.isActive !== undefined) {
      const b = truthy(row.isActive);
      if (b === undefined) {
        errors.push('isActive: use true/false');
        delete row.isActive;
      }
      else row.isActive = b;
    }
    let partNumbers: string[] | undefined;
    if (entity === 'products') {
      if (row.partNumbers !== undefined) partNumbers = String(row.partNumbers).split(/[|;]/).map((s) => s.trim()).filter(Boolean);
      delete row.partNumbers;
      delete row.vehicles;
    }
    const rowCode = typeof row.code === 'string' ? row.code : row.code !== undefined ? String(row.code) : undefined;
    const isUpdate = !!rowCode && existingByCode.has(lc(rowCode)) && opts.updateExisting;
    const parsed = (isUpdate ? schema.partial() : schema).safeParse(row);
    let data: Record<string, unknown> = {};
    if (!parsed.success) {
      for (const e of parsed.error.issues) errors.push(`${e.path.join('.') || 'row'}: ${e.message}`);
    } else data = parsed.data as Record<string, unknown>;
    const code = (data.code as string | undefined) ?? undefined;
    let existingId: number | undefined;
    if (code) {
      const k = lc(code);
      if (seen.has(k)) errors.push(`code "${code}" is duplicated in the file`);
      seen.add(k);
      existingId = existingByCode.get(k);
      if (existingId && !opts.updateExisting) errors.push(`code "${code}" already exists (enable updateExisting to update)`);
    }
    if (!errors.length) {
      report.push({ row: i + 1, status: 'OK', action: existingId ? 'update' : 'create', code: code ?? null, errors: [] });
      prepared.push({ idx: i + 1, data, partNumbers, existingId });
    } else report.push({ row: i + 1, status: 'ERROR', code: code ?? null, errors });
  });

  let created = 0;
  let updated = 0;
  if (!opts.dryRun) {
    for (const p of prepared) {
      const rep = report[p.idx - 1];
      try {
        await prisma.$transaction(
          async (tx) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const t = (tx as any)[model];
            const data = { ...p.data };
            let id: number;
            if (p.existingId) {
              delete data.code;
              await t.update({ where: { id: p.existingId }, data });
              id = p.existingId;
              updated++;
            } else {
              data.code = data.code || (await nextCode(tx, model as 'customer', entity === 'customers' ? 'C' : entity === 'suppliers' ? 'V' : 'BP-', entity === 'products' ? 5 : 4));
              if (!data.name) throw new Error('name is required');
              const c = await t.create({ data });
              id = c.id;
              rep.code = c.code;
              created++;
            }
            if (entity === 'products' && (p.partNumbers !== undefined || data.oemNumber)) {
              const prod = await tx.product.findUniqueOrThrow({ where: { id } });
              const alts = p.partNumbers ?? (await tx.productPartNumber.findMany({ where: { productId: id, kind: 'ALTERNATE' } })).map((x) => x.number);
              const seen2 = new Set<string>();
              const rows: { number: string; kind: string; productId: number }[] = [];
              if (prod.oemNumber) {
                seen2.add(prod.oemNumber.toUpperCase());
                rows.push({ number: prod.oemNumber, kind: 'OEM', productId: id });
              }
              for (const n of alts) {
                if (seen2.has(n.toUpperCase())) continue;
                seen2.add(n.toUpperCase());
                rows.push({ number: n, kind: 'ALTERNATE', productId: id });
              }
              await tx.productPartNumber.deleteMany({ where: { productId: id } });
              if (rows.length) await tx.productPartNumber.createMany({ data: rows });
            }
          },
          { timeout: 30000 },
        );
      } catch (e) {
        rep.status = 'ERROR';
        rep.action = undefined;
        rep.errors.push(e instanceof Error ? e.message : 'save failed');
        if (rep.errors.length === 1 && /Unique constraint/i.test(rep.errors[0])) rep.errors[0] = 'duplicate value violates a unique constraint';
      }
    }
    await audit(prisma, opts.user, 'IMPORT', entity, undefined, { total: rawRows.length, created, updated });
  }
  const ok = report.filter((r) => r.status === 'OK').length;
  return {
    entity,
    dryRun: opts.dryRun,
    total: rawRows.length,
    valid: opts.dryRun ? ok : created + updated,
    invalid: report.length - (opts.dryRun ? ok : created + updated),
    created: opts.dryRun ? report.filter((r) => r.action === 'create' && r.status === 'OK').length : created,
    updated: opts.dryRun ? report.filter((r) => r.action === 'update' && r.status === 'OK').length : updated,
    rows: report,
  };
}

/** Rows for export with names instead of ids. */
export async function exportRows(entity: Entity, search?: string, isActive?: boolean): Promise<Record<string, unknown>[]> {
  const maps = await nameMaps();
  const where: Record<string, unknown> = {};
  if (isActive !== undefined) where.isActive = isActive;
  if (search) where.OR = ['code', 'name'].map((f) => ({ [f]: { contains: search } }));
  if (entity === 'customers') {
    const rows = await prisma.customer.findMany({ where, orderBy: { code: 'asc' } });
    return rows.map((r) => ({ ...r, paymentTerm: maps.reverse.paymentTerm.get(r.paymentTermId ?? -1) ?? '', salesman: maps.reverse.salesman.get(r.salesmanId ?? -1) ?? '', territory: maps.reverse.territory.get(r.territoryId ?? -1) ?? '', area: maps.reverse.area.get(r.areaId ?? -1) ?? '' }));
  }
  if (entity === 'suppliers') {
    const rows = await prisma.supplier.findMany({ where, orderBy: { code: 'asc' } });
    return rows.map((r) => ({ ...r, paymentTerm: maps.reverse.paymentTerm.get(r.paymentTermId ?? -1) ?? '' }));
  }
  const rows = await prisma.product.findMany({ where, include: { partNumbers: true }, orderBy: { code: 'asc' } });
  return rows.map((r) => ({
    ...r,
    brand: maps.reverse.brand.get(r.brandId ?? -1) ?? '',
    category: maps.reverse.category.get(r.categoryId ?? -1) ?? '',
    productGroup: maps.reverse.productGroup.get(r.productGroupId ?? -1) ?? '',
    productType: maps.reverse.productType.get(r.productTypeId ?? -1) ?? '',
    partNumbers: r.partNumbers.filter((p) => p.kind === 'ALTERNATE').map((p) => p.number).join('|'),
  }));
}

export const SAMPLE_ROW: Record<Entity, Record<string, string>> = {
  customers: { code: '', name: 'Sample Trading LLC', trn: '100000000000003', phone: '04 000 0000', email: 'info@sample.example', paymentTerm: 'Net 30', creditLimit: '10000', isActive: 'true' },
  suppliers: { code: '', name: 'Sample Parts Co', country: 'Japan', currencyCode: 'USD', paymentTerm: 'Net 30', isActive: 'true' },
  products: { code: '', name: 'Brake Pad Front', oemNumber: '04465-60210', barcode: '', brand: '', category: '', partNumbers: '04465-60220|04465-0K240', purchaseUnit: 'PCS', salesUnit: 'PCS', costPrice: '100', retailPrice: '150', wholesalePrice: '130', vatRate: '5', isActive: 'true' },
};
