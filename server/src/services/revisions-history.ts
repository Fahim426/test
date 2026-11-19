import { Prisma } from '@prisma/client';
import { Tx } from '../lib/prisma';
import { audit } from './audit';

export async function revisionSnapshot(tx: Tx, entity: string, id: number) {
  const model = Prisma.dmmf.datamodel.models.find(m => m.name === entity);
  if (!model) throw new Error('Unsupported revision entity');
  // Serialize edits to this record before taking its before-image. Model names come only from Prisma metadata.
  await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('`' + entity + '`')} WHERE id = ${id} FOR UPDATE`);
  const include: Record<string, unknown> = {};
  for (const name of ['items', ...(entity === 'Product' ? ['partNumbers','vehicles'] : []), ...(entity === 'AmcContract' ? ['visits'] : [])]) {
    if (model.fields.some(f => f.name === name && f.kind === 'object' && f.isList)) include[name] = { orderBy: { id: 'asc' } };
  }
  const delegate = (tx as any)[entity[0].toLowerCase() + entity.slice(1)];
  return delegate.findUnique({ where: { id }, ...(Object.keys(include).length ? { include } : {}) });
}
function flatten(value: any, prefix = '', out: Record<string, unknown> = {}) {
  if (value === null || value === undefined || typeof value !== 'object' || value instanceof Date || Prisma.Decimal.isDecimal(value)) {
    out[prefix] = value instanceof Date ? value.toISOString() : Prisma.Decimal.isDecimal(value) ? value.toString() : value ?? null;
  } else if (Array.isArray(value)) {
    if (!value.length) out[prefix] = [];
    value.forEach((v, i) => flatten(v, prefix + '[' + (i + 1) + ']', out));
  } else for (const [key, v] of Object.entries(value)) {
    if (['id','createdAt','updatedAt','passwordHash','tokenHash'].includes(key)) continue;
    flatten(v, prefix ? prefix + '.' + key : key, out);
  }
  return out;
}
export async function auditRevision(tx: Tx, user: { id?: number; username?: string } | undefined, entity: string, id: number, before: unknown, reason?: unknown) {
  const after = await revisionSnapshot(tx, entity, id);
  const a = flatten(before), b = flatten(after);
  const changes = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)).map(field => ({ field, before: a[field] ?? null, after: b[field] ?? null }));
  let chunk: typeof changes = [];
  const write = async () => { if (chunk.length) await audit(tx, user, 'UPDATE_FIELDS', entity, id, { version: 1, reason: typeof reason === 'string' ? reason.slice(0, 1000) : null, changes: chunk }); chunk = []; };
  for (const change of changes) {
    if (Buffer.byteLength(JSON.stringify([...chunk, change])) > 45000) await write();
    chunk.push(change);
  }
  await write();
}
