import { prisma, Tx } from '../lib/prisma';
import { badRequest, forbidden } from '../lib/errors';
import { num } from '../lib/calc';

/**
 * Configurable approval engine. Rules live in ApprovalRule (Admin > Approval Workflows) — no thresholds hard-coded.
 * Document modules call submitForApproval(); when the whole chain approves/rejects, the registered handler fires
 * so the module can move its document status (e.g. PENDING_APPROVAL -> APPROVED).
 */

type Handler = (tx: Tx, req: { docType: string; docId: number; docNo: string }, outcome: 'APPROVED' | 'REJECTED') => Promise<void>;
const handlers = new Map<string, Handler>();
export const registerApprovalHandler = (docType: string, h: Handler) => handlers.set(docType, h);

export async function findRule(tx: Tx | typeof prisma, docType: string, amount: number) {
  const rules = await tx.approvalRule.findMany({ where: { docType, isActive: true }, orderBy: { minAmount: 'asc' } });
  return rules.find((r) => amount >= num(r.minAmount) && (r.maxAmount === null || amount < num(r.maxAmount))) ?? null;
}

/**
 * Returns {required:false} if no rule matches (caller may auto-approve), else creates a PENDING request.
 */
export async function submitForApproval(
  tx: Tx,
  i: { docType: string; docId: number; docNo: string; amount: number; userId?: number },
) {
  const rule = await findRule(tx, i.docType, i.amount);
  if (!rule) return { required: false as const };
  const existing = await tx.approvalRequest.findFirst({ where: { docType: i.docType, docId: i.docId, status: 'PENDING' } });
  if (existing) throw badRequest('Document is already pending approval');
  const request = await tx.approvalRequest.create({
    data: { docType: i.docType, docId: i.docId, docNo: i.docNo, amount: i.amount, steps: rule.steps, requestedBy: i.userId },
  });
  return { required: true as const, request };
}

export async function actOnApproval(
  tx: Tx,
  requestId: number,
  user: { id: number; username: string; role: string },
  action: 'APPROVED' | 'REJECTED',
  comment?: string,
) {
  const req = await tx.approvalRequest.findUnique({ where: { id: requestId } });
  if (!req) throw badRequest('Approval request not found');
  if (req.status !== 'PENDING') throw badRequest(`Request already ${req.status.toLowerCase()}`);
  const steps: string[] = JSON.parse(req.steps);
  const roleName = steps[req.currentStep];
  if (user.role !== 'Admin' && user.role !== roleName) throw forbidden(`This step requires role "${roleName}"`);
  await tx.approvalAction.create({
    data: { requestId, step: req.currentStep, roleName, userId: user.id, username: user.username, action, comment },
  });
  let status = 'PENDING';
  let currentStep = req.currentStep;
  if (action === 'REJECTED') status = 'REJECTED';
  else if (req.currentStep + 1 >= steps.length) status = 'APPROVED';
  else currentStep = req.currentStep + 1;
  const updated = await tx.approvalRequest.update({ where: { id: requestId }, data: { status, currentStep } });
  if (status !== 'PENDING') {
    const h = handlers.get(req.docType);
    if (h) await h(tx, { docType: req.docType, docId: req.docId, docNo: req.docNo }, status as 'APPROVED' | 'REJECTED');
  }
  return updated;
}
