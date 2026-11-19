import type { IntentDef } from './types';
export const intents:IntentDef[] = [
  {
    "id": "sales_summary",
    "title": "Sales totals",
    "core": [
      [
        "sale"
      ],
      [
        "total",
        "revenue",
        "summary",
        "value",
        "amount"
      ]
    ],
    "permissions": [
      "sales_invoice"
    ],
    "filters": [
      "period",
      "customerId",
      "productId",
      "branchId"
    ],
    "examples": [
      "what are total sales",
      "show sales revenue",
      "how much did we sell",
      "sales summary for this month",
      "sales today",
      "total selling value last month",
      "what were our sales",
      "sales amount between dates"
    ]
  },
  {
    "id": "sales_invoices",
    "title": "Sales invoices",
    "core": [
      [
        "sale"
      ],
      [
        "invoice"
      ]
    ],
    "permissions": [
      "sales_invoice"
    ],
    "filters": [
      "period",
      "customerId",
      "productId",
      "branchId",
      "amountMin",
      "amountMax",
      "top",
      "overdue",
      "status"
    ],
    "examples": [
      "list sales invoices",
      "show customer sales invoices",
      "find issued sales invoices",
      "which sales invoices are unpaid",
      "sales invoice register",
      "list overdue sales bills",
      "show sales invoices above amount",
      "customer invoice list"
    ]
  },
  {
    "id": "sales_orders",
    "title": "Sales orders",
    "core": [
      [
        "sale"
      ],
      [
        "order"
      ]
    ],
    "permissions": [
      "sales_order"
    ],
    "filters": [
      "period",
      "customerId",
      "productId",
      "branchId",
      "amountMin",
      "amountMax",
      "top",
      "status"
    ],
    "examples": [
      "list sales orders",
      "show customer orders",
      "find sales orders awaiting approval",
      "which sales orders are open",
      "sales order list",
      "show approved customer orders",
      "customer sales order register",
      "list draft sales orders"
    ]
  },
  {
    "id": "quotations",
    "title": "Sales quotations",
    "core": [
      [
        "quote"
      ],
      [
        "list",
        "sale",
        "customer",
        "pending",
        "draft",
        "sent"
      ]
    ],
    "permissions": [
      "sales_quotation"
    ],
    "filters": [
      "period",
      "customerId",
      "productId",
      "branchId",
      "amountMin",
      "amountMax",
      "top",
      "status"
    ],
    "examples": [
      "list quotations",
      "show sales quotes",
      "which quotations are pending",
      "find customer quotations",
      "sales quote register",
      "show sent estimates",
      "list draft quotes",
      "customer quotation list"
    ]
  },
  {
    "id": "pending_deliveries",
    "title": "Pending deliveries",
    "core": [
      [
        "delivery"
      ],
      [
        "pending",
        "due",
        "ready",
        "undelivered"
      ]
    ],
    "permissions": [
      "delivery_note"
    ],
    "filters": [
      "period",
      "customerId",
      "productId",
      "branchId",
      "top"
    ],
    "examples": [
      "show pending deliveries",
      "which deliveries are waiting",
      "list orders ready for delivery",
      "what still needs delivering",
      "undelivered customer orders",
      "delivery backlog",
      "pending delivery notes",
      "which customer deliveries are outstanding"
    ]
  },
  {
    "id": "purchase_summary",
    "title": "Purchase totals",
    "core": [
      [
        "purchase"
      ],
      [
        "total",
        "summary",
        "amount",
        "value",
        "spending"
      ]
    ],
    "permissions": [
      "purchase_invoice"
    ],
    "filters": [
      "period",
      "supplierId",
      "productId",
      "branchId"
    ],
    "examples": [
      "what are total purchases",
      "show purchase summary",
      "how much did we purchase",
      "purchase total this month",
      "total buying value",
      "how much have we spent on purchases",
      "purchases last month",
      "purchase amount today"
    ]
  },
  {
    "id": "purchase_invoices",
    "title": "Purchase invoices",
    "core": [
      [
        "purchase",
        "supplier"
      ],
      [
        "invoice"
      ]
    ],
    "permissions": [
      "purchase_invoice"
    ],
    "filters": [
      "period",
      "supplierId",
      "productId",
      "branchId",
      "amountMin",
      "amountMax",
      "top",
      "overdue",
      "status"
    ],
    "examples": [
      "list purchase invoices",
      "show supplier bills",
      "find purchase invoices",
      "which vendor invoices are unpaid",
      "purchase invoice register",
      "list overdue supplier bills",
      "show purchase invoices above amount",
      "supplier invoice list"
    ]
  },
  {
    "id": "purchase_orders",
    "title": "Purchase orders",
    "core": [
      [
        "purchase",
        "supplier"
      ],
      [
        "order"
      ]
    ],
    "permissions": [
      "purchase_order"
    ],
    "filters": [
      "period",
      "supplierId",
      "productId",
      "branchId",
      "amountMin",
      "amountMax",
      "top",
      "status"
    ],
    "examples": [
      "list purchase orders",
      "show supplier orders",
      "find buying orders",
      "purchase order register",
      "which purchase orders are approved",
      "list open supplier orders",
      "show pending purchase orders",
      "draft purchase orders"
    ]
  },
  {
    "id": "goods_receipts",
    "title": "Goods receipts",
    "core": [
      [
        "receipt",
        "grn"
      ],
      [
        "goods",
        "purchase",
        "received",
        "stock"
      ]
    ],
    "permissions": [
      "goods_receipt"
    ],
    "filters": [
      "period",
      "supplierId",
      "productId",
      "branchId",
      "top"
    ],
    "examples": [
      "list goods receipts",
      "show received goods",
      "find goods receipt notes",
      "goods receipt register",
      "which purchase deliveries were received",
      "list stock receipts",
      "show grns",
      "goods received today"
    ]
  },
  {
    "id": "stock_summary",
    "title": "Stock available",
    "core": [
      [
        "stock"
      ],
      [
        "available",
        "quantity",
        "balance",
        "list",
        "onhand"
      ]
    ],
    "permissions": [
      "stock"
    ],
    "filters": [
      "productId",
      "branchId",
      "top"
    ],
    "examples": [
      "how much stock is available",
      "show stock quantities",
      "current inventory balance",
      "list stock on hand",
      "available stock by warehouse",
      "stock for a product",
      "show inventory availability",
      "what quantity is in stock"
    ]
  },
  {
    "id": "low_stock",
    "title": "Low stock",
    "core": [
      [
        "stock"
      ],
      [
        "low",
        "reorder",
        "shortage",
        "minimum"
      ]
    ],
    "permissions": [
      "stock"
    ],
    "filters": [
      "productId",
      "branchId",
      "top"
    ],
    "examples": [
      "which products have low stock",
      "show reorder items",
      "list inventory shortages",
      "stock below minimum",
      "products needing replenishment",
      "low stock alert list",
      "which stock is running low",
      "reorder stock report"
    ]
  },
  {
    "id": "product_lookup",
    "title": "Product details",
    "core": [
      [
        "product",
        "price",
        "cost",
        "detail",
        "specification",
        "code"
      ],
      [
        "detail",
        "price",
        "cost",
        "product",
        "brand"
      ]
    ],
    "permissions": [
      "products"
    ],
    "filters": [
      "productId",
      "top"
    ],
    "examples": [
      "show product details",
      "find a product by code",
      "what is the selling price",
      "product information",
      "what does this machine cost",
      "show product brand and price",
      "look up machine specifications",
      "price for product code"
    ]
  },
  {
    "id": "top_products",
    "title": "Best-selling products",
    "core": [
      [
        "top"
      ],
      [
        "product",
        "sale",
        "machine"
      ]
    ],
    "permissions": [
      "sales_invoice"
    ],
    "filters": [
      "period",
      "productId",
      "customerId",
      "branchId",
      "top"
    ],
    "examples": [
      "what are the top selling products",
      "show best sellers",
      "which machines sold the most",
      "top products by sales",
      "rank products by sales revenue",
      "best selling equipment",
      "list our leading products",
      "highest selling product models"
    ]
  },
  {
    "id": "top_customers",
    "title": "Top customers",
    "core": [
      [
        "top"
      ],
      [
        "customer"
      ]
    ],
    "permissions": [
      "sales_invoice"
    ],
    "filters": [
      "period",
      "customerId",
      "branchId",
      "top"
    ],
    "examples": [
      "who are our top customers",
      "show highest spending clients",
      "rank customers by sales",
      "biggest customers by revenue",
      "list leading buyers",
      "which clients bought the most",
      "top customer sales",
      "best customers by turnover"
    ]
  },
  {
    "id": "customer_dues",
    "title": "Customer invoice dues",
    "core": [
      [
        "customer"
      ],
      [
        "due"
      ]
    ],
    "permissions": [
      "sales_invoice"
    ],
    "filters": [
      "period",
      "customerId",
      "branchId",
      "amountMin",
      "amountMax",
      "top",
      "overdue"
    ],
    "examples": [
      "which customers owe us money",
      "show customer outstanding balances",
      "who owes more than amount",
      "customer receivables list",
      "unpaid customer invoice amounts",
      "list client arrears",
      "how much does a customer owe",
      "overdue customer balances"
    ]
  },
  {
    "id": "supplier_dues",
    "title": "Supplier invoice dues",
    "core": [
      [
        "supplier"
      ],
      [
        "due"
      ]
    ],
    "permissions": [
      "purchase_invoice"
    ],
    "filters": [
      "period",
      "supplierId",
      "branchId",
      "amountMin",
      "amountMax",
      "top",
      "overdue"
    ],
    "examples": [
      "which suppliers do we owe",
      "show supplier outstanding balances",
      "how much do we owe vendors",
      "supplier payables list",
      "unpaid vendor invoice amounts",
      "list supplier arrears",
      "outstanding amounts to suppliers",
      "overdue supplier balances"
    ]
  },
  {
    "id": "branch_performance",
    "title": "Branch performance",
    "core": [
      [
        "branch"
      ],
      [
        "compare",
        "sale",
        "performance",
        "revenue",
        "top"
      ]
    ],
    "permissions": [
      "reports",
      "sales_invoice"
    ],
    "filters": [
      "period",
      "branchId",
      "top"
    ],
    "examples": [
      "compare branch performance",
      "show sales by branch",
      "which branch sold the most",
      "branch revenue comparison",
      "rank our branches by sales",
      "branch sales performance",
      "sales performance across branches",
      "compare branch sales totals"
    ]
  },
  {
    "id": "gross_profit",
    "title": "Gross profit",
    "core": [
      [
        "gross",
        "margin"
      ],
      [
        "profit",
        "margin"
      ]
    ],
    "permissions": [
      "reports",
      "sales_invoice"
    ],
    "filters": [
      "period",
      "branchId",
      "customerId",
      "productId"
    ],
    "examples": [
      "what is our gross profit",
      "show gross margin",
      "gross profit last month",
      "gross margin report",
      "calculate gross profit on sales",
      "sales revenue minus cost of goods",
      "how much gross profit did we make",
      "show gross profit percentage"
    ]
  },
  {
    "id": "machine_trace",
    "title": "Machine serial trace",
    "core": [
      [
        "serial",
        "trace",
        "warranty",
        "installed"
      ],
      [
        "machine",
        "serial",
        "location",
        "trace",
        "warranty",
        "customer"
      ]
    ],
    "permissions": [
      "products"
    ],
    "filters": [
      "unitId",
      "productId",
      "branchId",
      "top"
    ],
    "examples": [
      "where is machine serial number",
      "trace this machine serial",
      "show the serial history",
      "which customer has this machine",
      "machine warranty details",
      "find installed machine by serial",
      "track a serial number",
      "show machine installation history"
    ],
    "required": "unitId"
  },
  {
    "id": "amc_contracts",
    "title": "AMC contracts",
    "core": [
      [
        "amc"
      ],
      [
        "contract",
        "list",
        "customer",
        "active"
      ]
    ],
    "permissions": [
      "amc"
    ],
    "filters": [
      "customerId",
      "productId",
      "branchId",
      "top",
      "status"
    ],
    "examples": [
      "list amc contracts",
      "show maintenance contracts",
      "find active amcs",
      "amc contract list",
      "which customers have maintenance contracts",
      "show machine amc details",
      "customer amc contracts",
      "list current service contracts"
    ]
  },
  {
    "id": "amc_expiring",
    "title": "AMC renewals due",
    "core": [
      [
        "amc"
      ],
      [
        "expire",
        "renew",
        "due",
        "end"
      ]
    ],
    "permissions": [
      "amc"
    ],
    "filters": [
      "customerId",
      "productId",
      "branchId",
      "top"
    ],
    "examples": [
      "which amcs expire soon",
      "show amc renewals due",
      "list expiring maintenance contracts",
      "when are amc contracts ending",
      "amc expiry dates",
      "which amc needs renewal",
      "maintenance contracts due to expire",
      "upcoming amc renewals"
    ]
  },
  {
    "id": "service_due",
    "title": "Service visits due",
    "core": [
      [
        "service",
        "visit",
        "maintenance"
      ],
      [
        "due",
        "scheduled",
        "upcoming",
        "pending",
        "next"
      ]
    ],
    "permissions": [
      "amc"
    ],
    "filters": [
      "customerId",
      "productId",
      "branchId",
      "top",
      "period",
      "overdue"
    ],
    "examples": [
      "which service visits are due",
      "show upcoming maintenance visits",
      "list scheduled service visits",
      "what servicing is overdue",
      "next preventive maintenance visits",
      "service visits this month",
      "pending technician visits",
      "what maintenance is due soon"
    ]
  },
  {
    "id": "employees",
    "title": "Employee list",
    "core": [
      [
        "employee"
      ],
      [
        "list",
        "count",
        "active",
        "headcount"
      ]
    ],
    "permissions": [
      "hr_employees"
    ],
    "filters": [
      "employeeId",
      "branchId",
      "top",
      "status"
    ],
    "examples": [
      "list employees",
      "show active staff",
      "how many employees do we have",
      "employee headcount",
      "staff directory",
      "show our team members",
      "list company employees",
      "which employees are active"
    ]
  },
  {
    "id": "employee_lookup",
    "title": "Employee details",
    "core": [
      [
        "employee"
      ],
      [
        "detail",
        "profile",
        "contact",
        "information"
      ]
    ],
    "permissions": [
      "hr_employees"
    ],
    "filters": [
      "employeeId",
      "branchId"
    ],
    "examples": [
      "show employee details",
      "find a staff member",
      "employee contact information",
      "look up an employee profile",
      "staff member details",
      "show employee department",
      "what is the employee phone number",
      "find employee information"
    ],
    "required": "employeeId"
  },
  {
    "id": "audit_history",
    "title": "Edit history",
    "core": [
      [
        "history",
        "edit",
        "change"
      ],
      [
        "history",
        "record",
        "change",
        "edit"
      ]
    ],
    "permissions": [
      "audit"
    ],
    "filters": [
      "recordId",
      "recordType",
      "top",
      "branchId"
    ],
    "examples": [
      "who edited this record",
      "show edit history",
      "what changed on this record",
      "who changed the product price",
      "show previous and new values",
      "record revision history",
      "which employee updated this invoice",
      "show field change history"
    ],
    "required": "recordId"
  }
];
export const intentById = new Map(intents.map(i=>[i.id,i]));

for (const i of intents) { if (['sales_invoices','purchase_invoices'].includes(i.id)) i.filters.push('unpaid'); if (['sales_orders','purchase_orders','quotations'].includes(i.id)) i.filters.push('openOnly'); if (i.id==='amc_expiring') i.filters.push('period'); }

intentById.get('audit_history')!.filters.push('productId','customerId','supplierId','employeeId','unitId');

for(const i of intents){if(i.filters.includes('amountMin'))i.filters.push('amountMinInclusive');if(i.filters.includes('amountMax'))i.filters.push('amountMaxInclusive');}
