import { prisma } from '../lib/prisma';
import { num, r2 } from '../lib/calc';

/** Per-warehouse stock for a product with warehouse names. */
export async function productStock(productId: number) {
  const bal = await prisma.stockBalance.findMany({ where: { productId } });
  const wh = await prisma.warehouse.findMany({ select: { id: true, code: true, name: true } });
  const wm = new Map(wh.map((w) => [w.id, w]));
  const warehouses = bal
    .map((b) => ({
      warehouseId: b.warehouseId,
      warehouse: wm.get(b.warehouseId) ?? null,
      onHand: num(b.onHand),
      reserved: num(b.reserved),
      available: num(b.onHand) - num(b.reserved),
      avgCost: num(b.avgCost),
      value: r2(num(b.onHand) * num(b.avgCost)),
    }))
    .sort((a, b) => (a.warehouse?.code ?? '').localeCompare(b.warehouse?.code ?? ''));
  const onHand = warehouses.reduce((s, w) => s + w.onHand, 0);
  const reserved = warehouses.reduce((s, w) => s + w.reserved, 0);
  return {
    total: { onHand, reserved, available: onHand - reserved, value: r2(warehouses.reduce((s, w) => s + w.value, 0)) },
    warehouses,
  };
}

/** Last purchase / sales lines for a product, with party names. */
export async function productHistory(productId: number, limit = 10) {
  const [poItems, grnItems, piItems, siItems, dnItems, sqItems] = await Promise.all([
    prisma.purchaseOrderItem.findMany({ where: { productId }, include: { order: true }, orderBy: { id: 'desc' }, take: limit }),
    prisma.goodsReceiptItem.findMany({ where: { productId }, include: { receipt: true }, orderBy: { id: 'desc' }, take: limit }),
    prisma.purchaseInvoiceItem.findMany({ where: { productId }, include: { invoice: true }, orderBy: { id: 'desc' }, take: limit }),
    prisma.salesInvoiceItem.findMany({ where: { productId }, include: { invoice: true }, orderBy: { id: 'desc' }, take: limit }),
    prisma.deliveryNoteItem.findMany({ where: { productId }, include: { delivery: true }, orderBy: { id: 'desc' }, take: limit }),
    prisma.salesQuotationItem.findMany({ where: { productId }, include: { quotation: true }, orderBy: { id: 'desc' }, take: limit }),
  ]);
  const supIds = new Set<number>();
  const custIds = new Set<number>();
  poItems.forEach((i) => supIds.add(i.order.supplierId));
  grnItems.forEach((i) => supIds.add(i.receipt.supplierId));
  piItems.forEach((i) => supIds.add(i.invoice.supplierId));
  siItems.forEach((i) => custIds.add(i.invoice.customerId));
  dnItems.forEach((i) => custIds.add(i.delivery.customerId));
  sqItems.forEach((i) => custIds.add(i.quotation.customerId));
  const [sups, custs] = await Promise.all([
    prisma.supplier.findMany({ where: { id: { in: [...supIds] } }, select: { id: true, code: true, name: true } }),
    prisma.customer.findMany({ where: { id: { in: [...custIds] } }, select: { id: true, code: true, name: true } }),
  ]);
  const sm = new Map(sups.map((s) => [s.id, s]));
  const cm = new Map(custs.map((c) => [c.id, c]));
  const sup = (id: number) => sm.get(id) ?? null;
  const cus = (id: number) => cm.get(id) ?? null;

  const purchaseOrders = poItems.map((i) => ({
    type: 'PURCHASE_ORDER', docId: i.orderId, docNo: i.order.docNo, date: i.order.docDate, status: i.order.status,
    supplier: sup(i.order.supplierId), qty: num(i.qty), receivedQty: num(i.receivedQty), rate: num(i.rate), amount: num(i.amount), currencyCode: i.order.currencyCode,
  }));
  const goodsReceipts = grnItems.map((i) => ({
    type: 'GOODS_RECEIPT', docId: i.receiptId, docNo: i.receipt.docNo, date: i.receipt.docDate, status: i.receipt.status,
    supplier: sup(i.receipt.supplierId), qty: num(i.qty), rate: num(i.unitCost), landedRate: num(i.landedUnitCost),
  }));
  const purchaseInvoices = piItems.map((i) => ({
    type: 'PURCHASE_INVOICE', docId: i.invoiceId, docNo: i.invoice.docNo, date: i.invoice.docDate, status: i.invoice.status,
    supplier: sup(i.invoice.supplierId), qty: num(i.qty), rate: num(i.rate), amount: num(i.amount), currencyCode: i.invoice.currencyCode,
  }));
  const salesInvoices = siItems.map((i) => ({
    type: 'SALES_INVOICE', docId: i.invoiceId, docNo: i.invoice.docNo, date: i.invoice.docDate, status: i.invoice.status,
    customer: cus(i.invoice.customerId), qty: num(i.qty), rate: num(i.rate), discount: num(i.discount), amount: num(i.amount), unitCost: num(i.unitCost),
  }));
  const deliveries = dnItems.map((i) => ({
    type: 'DELIVERY_NOTE', docId: i.deliveryId, docNo: i.delivery.docNo, date: i.delivery.docDate, status: i.delivery.status,
    customer: cus(i.delivery.customerId), qty: num(i.qty),
  }));
  const quotations = sqItems.map((i) => ({
    type: 'SALES_QUOTATION', docId: i.quotationId, docNo: i.quotation.docNo, date: i.quotation.docDate, status: i.quotation.status,
    customer: cus(i.quotation.customerId), qty: num(i.qty), rate: num(i.rate), amount: num(i.amount),
  }));
  const byDate = <T extends { date: Date }>(a: T[]) => a.sort((x, y) => +y.date - +x.date);
  byDate(purchaseOrders); byDate(goodsReceipts); byDate(purchaseInvoices); byDate(salesInvoices); byDate(deliveries); byDate(quotations);

  const posted = (s: string) => s !== 'DRAFT' && s !== 'CANCELLED';
  const lastPurchase = purchaseInvoices.find((i) => posted(i.status)) ?? goodsReceipts.find((i) => posted(i.status)) ?? purchaseOrders.find((i) => posted(i.status)) ?? null;
  const lastSale = salesInvoices.find((i) => posted(i.status)) ?? null;
  return {
    summary: {
      lastPurchase: lastPurchase && { type: lastPurchase.type, docNo: lastPurchase.docNo, date: lastPurchase.date, supplier: lastPurchase.supplier, qty: lastPurchase.qty, rate: lastPurchase.rate },
      lastSale: lastSale && { type: lastSale.type, docNo: lastSale.docNo, date: lastSale.date, customer: lastSale.customer, qty: lastSale.qty, rate: lastSale.rate },
    },
    purchaseOrders, goodsReceipts, purchaseInvoices, salesInvoices, deliveries, quotations,
  };
}
