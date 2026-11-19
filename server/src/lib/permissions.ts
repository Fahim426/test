export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'post', 'cancel', 'print', 'export'] as const;

// Module-specific permission keys. Use these strings in can(module, action) and in the Roles UI.
export const PERMISSION_MODULES = [
  'dashboard',
  // dimensions
  'dimensions',
  'customers',
  'suppliers',
  'products',
  // purchase
  'material_request',
  'purchase_requisition',
  'purchase_enquiry',
  'supplier_quotation',
  'comparative_statement',
  'purchase_order',
  'import_purchase',
  'goods_receipt',
  'landed_cost',
  'purchase_invoice',
  'purchase_return',
  // sales
  'sales_enquiry',
  'sales_quotation',
  'proforma_invoice',
  'sales_order',
  'picking',
  'packing',
  'delivery_note',
  'sales_invoice',
  'sales_return',
  // inventory
  'stock',
  'stock_transfer',
  'stock_adjustment',
  // finance
  'chart_of_accounts',
  'receipts',
  'payments',
  'journal',
  'notes',
  'ledger',
  'vat',
  // reports
  'reports',
  'report_builder',
  // amc
  'amc',
  // hr
  'hr_employees',
  'hr_attendance',
  'hr_leave',
  'hr_payroll',
  // admin
  'users',
  'roles',
  'settings',
  'numbering',
  'approvals',
  'audit',
  'import_export',
  'backup',
] as const;
