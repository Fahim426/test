import { PrismaClient, Prisma } from '@prisma/client';
import { scopeQuery, setRawClient } from './bu';

// Serialize Decimal as JS number in JSON responses.
(Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON = function (this: Prisma.Decimal) {
  return this.toNumber();
};

const base = new PrismaClient();
setRawClient(base);
/**
 * The app's client. Business Units (lib/bu.ts): creates of BU documents are stamped and reads / writes are narrowed to
 * the BU visible to the current user. The query-only extension keeps the PrismaClient API, hence the cast.
 */
export const prisma = base.$extends({
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        return scopeQuery(model, operation, args as Record<string, unknown>, query as (a: Record<string, unknown>) => Promise<unknown>);
      },
    },
  },
}) as unknown as PrismaClient;
/** unscoped client (all BUs): system jobs and BU look-ups only */
export const prismaAll = base;
export type Tx = Prisma.TransactionClient;
export { Prisma };

/**
 * Product ids whose part number matches (contains by default, exact when `exact`).
 * Used instead of `partNumbers: { some }` inside an OR: on SQL Server that EXISTS-inside-OR shape
 * scans pathologically (minutes on ~16k part numbers); a separate lookup returns in milliseconds.
 */
export async function partNumberProductIds(number: string, exact = false): Promise<number[]> {
  const rows = await prisma.productPartNumber.findMany({
    where: { number: exact ? number : { contains: number } },
    select: { productId: true },
    distinct: ['productId'],
    take: 1000,
  });
  return rows.map((r) => r.productId);
}
