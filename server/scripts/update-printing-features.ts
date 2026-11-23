import { PrismaClient } from '@prisma/client';

/** Backfill existing records after applying the additive printing-feature schema upgrade. Safe to rerun. */
const database = new PrismaClient();

async function main() {
  const result = await database.$transaction(async (tx) => {
    const businessUnit = await tx.businessUnit.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } })
      ?? await tx.businessUnit.create({ data: { code: 'PRINT', name: 'Printing Equipment Trading' } });
    await tx.systemSetting.upsert({ where: { key: 'bu.defaultId' }, create: { key: 'bu.defaultId', value: String(businessUnit.id) }, update: {} });
    const setting = await tx.systemSetting.findUniqueOrThrow({ where: { key: 'bu.defaultId' } });
    const defaultId = Number(setting.value);
    if (!Number.isInteger(defaultId) || !(await tx.businessUnit.findUnique({ where: { id: defaultId } }))) {
      throw new Error('The configured default Business Unit is invalid.');
    }
    const scopedModels = [
      'salesEnquiry', 'salesQuotation', 'proformaInvoice', 'salesOrder', 'pickingList', 'packingList',
      'deliveryNote', 'salesInvoice', 'salesReturn', 'materialRequest', 'purchaseRequisition', 'purchaseEnquiry',
      'supplierQuotation', 'purchaseOrder', 'importRequest', 'supplierProforma', 'importShipment', 'goodsReceipt',
      'landedCost', 'purchaseInvoice', 'purchaseReturn', 'stockTransfer', 'stockAdjustment', 'stockTransaction',
      'voucher', 'note', 'amcContract', 'journalEntry', 'journalLine', 'approvalRequest',
    ] as const;
    let updated = 0;
    for (const model of scopedModels) {
      const delegate = tx[model] as unknown as { updateMany(input: { where: { buId: null }; data: { buId: number } }): Promise<{ count: number }> };
      updated += (await delegate.updateMany({ where: { buId: null }, data: { buId: defaultId } })).count;
    }
    const staff = await tx.user.updateMany({ where: { businessUnitId: null, role: { name: { not: 'Admin' } } }, data: { businessUnitId: defaultId } });
    const purchases = await tx.stockTransaction.groupBy({ by: ['productId'], where: { qty: { gt: 0 }, refType: 'GOODS_RECEIPT' }, _max: { txDate: true } });
    for (const purchase of purchases) {
      if (purchase._max.txDate) await tx.product.updateMany({ where: { id: purchase.productId, lastPurchaseAt: null }, data: { lastPurchaseAt: purchase._max.txDate } });
    }
    return { defaultBusinessUnit: defaultId, updatedDocumentsAndLines: updated, assignedStaff: staff.count, productsWithPurchaseHistory: purchases.length };
  }, { timeout: 60000 });
  console.log(JSON.stringify(result));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => database.$disconnect());
