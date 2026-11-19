/**
 * Maps backend document types (UPPER_SNAKE, as used by numbering/doc-flow/approvals/audit)
 * to the list + form screen ids. Used by DocumentFlow, global search, approvals, recent documents.
 */
export interface DocRoute {
  label: string;
  list: string;
  form: string;
}

const d = (label: string, base: string, plural?: string): DocRoute => ({ label, list: plural ?? base + 's', form: base + '-form' });

export const docRoutes: Record<string, DocRoute> = {
  MATERIAL_REQUEST: d('Material Request', 'material-request'),
  PURCHASE_REQUISITION: d('Purchase Requisition', 'purchase-requisition'),
  PURCHASE_ENQUIRY: d('Purchase Enquiry', 'purchase-enquiry', 'purchase-enquiries'),
  SUPPLIER_QUOTATION: d('Supplier Quotation', 'supplier-quotation'),
  COMPARATIVE_STATEMENT: d('Comparative Statement', 'comparative-statement'),
  PURCHASE_ORDER: d('Purchase Order', 'purchase-order'),
  IMPORT_REQUEST: d('Import Request', 'import-request'),
  SUPPLIER_PROFORMA: d('Supplier Proforma', 'supplier-proforma', 'supplier-proformas'),
  IMPORT_PURCHASE_ORDER: d('Import PO', 'import-purchase-order'),
  IMPORT_SHIPMENT: d('Shipment', 'import-shipment', 'goods-in-transit'),
  GOODS_RECEIPT: d('Goods Receipt', 'goods-receipt'),
  LANDED_COST: d('Landed Cost', 'landed-cost'),
  PURCHASE_INVOICE: d('Purchase Invoice', 'purchase-invoice'),
  PURCHASE_RETURN: d('Purchase Return', 'purchase-return'),
  SALES_ENQUIRY: d('Sales Enquiry', 'sales-enquiry', 'sales-enquiries'),
  SALES_QUOTATION: d('Quotation', 'sales-quotation'),
  PROFORMA_INVOICE: d('Proforma Invoice', 'proforma-invoice'),
  SALES_ORDER: d('Sales Order', 'sales-order'),
  PICKING_LIST: d('Picking', 'picking'),
  PACKING_LIST: d('Packing List', 'packing-list'),
  DELIVERY_NOTE: d('Delivery Note', 'delivery-note'),
  SALES_INVOICE: d('Sales Invoice', 'sales-invoice'),
  SALES_RETURN: d('Sales Return', 'sales-return'),
  STOCK_TRANSFER: d('Stock Transfer', 'stock-transfer'),
  STOCK_ADJUSTMENT: d('Stock Adjustment', 'stock-adjustment'),
  STOCK_COUNT: d('Stock Count', 'stock-count'),
  RECEIPT_VOUCHER: d('Receipt Voucher', 'receipt-voucher'),
  PAYMENT_VOUCHER: d('Payment Voucher', 'payment-voucher'),
  JOURNAL: d('Journal Voucher', 'journal-voucher'),
  CREDIT_NOTE: d('Credit Note', 'credit-note'),
  DEBIT_NOTE: d('Debit Note', 'debit-note'),
  CUSTOMER: { label: 'Customer', list: 'customers', form: 'customer-form' },
  SUPPLIER: { label: 'Supplier', list: 'suppliers', form: 'supplier-form' },
  EMPLOYEE: { label: 'Employee', list: 'hr-employees', form: 'hr-employee-form' },
  LEAVE_REQUEST: { label: 'Leave Request', list: 'hr-leave', form: 'hr-leave-form' },
  PAYROLL: { label: 'Payroll', list: 'hr-payroll', form: 'hr-payroll-form' },
  AMC_CONTRACT: { label: 'AMC Contract', list: 'amc-contracts', form: 'amc-form' },
  PRODUCT: { label: 'Product', list: 'products', form: 'product-form' },
};

/** Normalise "Purchase Order", "purchase-order", "PurchaseOrder", "PURCHASE_ORDER" -> PURCHASE_ORDER */
export function normalizeDocType(t: string): string {
  return t
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
}

export const docRoute = (t?: string | null): DocRoute | undefined => (t ? docRoutes[normalizeDocType(t)] : undefined);

/** Form screen id for a doc type (falls back to `<kebab>-form`). */
export function formScreenOf(docType: string): string {
  return docRoute(docType)?.form ?? normalizeDocType(docType).toLowerCase().replace(/_/g, '-') + '-form';
}
