import { prisma, Tx } from '../lib/prisma';

/** Records document flow from -> to. Call whenever a document is created from / converted to another. */
export async function linkDocs(
  tx: Tx | typeof prisma,
  from: { type: string; id: number; no: string },
  to: { type: string; id: number; no: string },
) {
  await tx.documentLink.create({
    data: { fromType: from.type, fromId: from.id, fromNo: from.no, toType: to.type, toId: to.id, toNo: to.no },
  });
}

export async function getLinks(type: string, id: number) {
  const [createdFrom, convertedTo] = await Promise.all([
    prisma.documentLink.findMany({ where: { toType: type, toId: id } }),
    prisma.documentLink.findMany({ where: { fromType: type, fromId: id } }),
  ]);
  return { createdFrom, convertedTo };
}
