import { prisma, Tx } from '../lib/prisma';

export async function audit(
  tx: Tx | typeof prisma,
  user: { id?: number; username?: string } | undefined,
  action: string,
  entity: string,
  entityId?: number | string,
  details?: unknown,
) {
  await tx.auditLog.create({
    data: {
      userId: user?.id,
      username: user?.username,
      action,
      entity,
      entityId: entityId !== undefined ? String(entityId) : undefined,
      details: details === undefined ? undefined : JSON.stringify(details).slice(0, 60000),
    },
  });
}
