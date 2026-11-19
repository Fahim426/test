import { PrismaClient, Prisma } from '@prisma/client';

// Serialize Decimal as JS number in JSON responses.
(Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON = function (this: Prisma.Decimal) {
  return this.toNumber();
};

export const prisma = new PrismaClient();
export type Tx = Prisma.TransactionClient;
export { Prisma };
