import type { AuthUser } from "../middleware/auth";
import type { ChatResponse, Entities, IndexedRecord } from "./types";
import { canView, branchScope } from "./security";
import { intents, intentById } from "./intents";
import { currentMonth } from "./entities";
import { guides } from "./guides";
type Features = { amc: boolean; hr: boolean; serialTracking: boolean };
export function intentAvailable(
  id: string,
  user: AuthUser,
  features: Features,
) {
  const def = intentById.get(id);
  return (
    !!def &&
    def.permissions.every((p) => canView(user, p)) &&
    (!(id.startsWith("amc_") || id === "service_due") || features.amc) &&
    (!["employees", "employee_lookup"].includes(id) || features.hr) &&
    (id !== "machine_trace" || features.serialTracking)
  );
}
const questions: Record<string, string> = {
  sales_summary: "Sales this month",
  purchase_summary: "Purchases this month",
  stock_summary: "Show current stock",
  low_stock: "Which products are low in stock?",
  customer_dues: "Who owes us money?",
  supplier_dues: "Show supplier dues",
  branch_performance: "Compare branch performance this month",
  gross_profit: "Gross profit this month",
  amc_expiring: "Which AMC contracts expire next month?",
  service_due: "Which service visits are due?",
  machine_trace: "Trace a machine serial number",
  amc_contracts: "List AMC contracts",
  employees: "List active employees",
  sales_invoices: "Show unpaid sales invoices",
  purchase_invoices: "Show unpaid purchase invoices",
  quotations: "Show sales quotations",
  pending_deliveries: "Show pending deliveries",
};
export function suggestions(user: AuthUser, features: Features, screen = "") {
  let preferred = [
    "sales_summary",
    "purchase_summary",
    "stock_summary",
    "customer_dues",
  ];
  let guide: string | undefined;
  if (/product|stock|warehouse|equipment/.test(screen)) {
    preferred = ["stock_summary", "low_stock", "gross_profit", "machine_trace"];
    guide = screen.includes("equipment") ? "serial" : undefined;
  }
  if (/purchase|goods-receipt/.test(screen)) {
    preferred = [
      "purchase_summary",
      "purchase_invoices",
      "supplier_dues",
      "stock_summary",
    ];
    guide = screen.includes("goods-receipt") ? "goods_receipt" : "purchase";
  }
  if (/sales|picking|packing|delivery|quotation/.test(screen)) {
    preferred = [
      "sales_summary",
      "sales_invoices",
      "customer_dues",
      "pending_deliveries",
    ];
    guide = screen.includes("quotation")
      ? "quotation"
      : screen.includes("delivery")
        ? "delivery"
        : screen.includes("order")
          ? "sales_order"
          : "invoice";
  }
  if (/amc|service/.test(screen)) {
    preferred = [
      "amc_expiring",
      "service_due",
      "amc_contracts",
      "machine_trace",
    ];
    guide = "amc";
  }
  if (/gross-profit|branch-performance/.test(screen))
    preferred = [
      "gross_profit",
      "branch_performance",
      "sales_summary",
      "purchase_summary",
    ];
  if (/^hr-/.test(screen)) preferred = ["employees"];
  const data = [...new Set([...preferred, ...Object.keys(questions)])]
    .filter((id) => intentAvailable(id, user, features))
    .slice(0, 4)
    .map((id) => questions[id]);
  const how = guides.find(
    (g) =>
      g.id === guide &&
      canView(user, g.permission) &&
      (!("feature" in g) || features[g.feature]),
  );
  if (how)
    data.push(
      "How do I " +
        (how.id === "serial"
          ? "track a serial number"
          : how.id === "amc"
            ? "create an AMC contract"
            : how.id === "goods_receipt"
              ? "create a goods receipt"
              : "create a " + how.id.replace(/_/g, " ")) +
        "?",
    );
  return data;
}
const sources: Record<string, [string, string]> = {
  sales_summary: [
    "Sales invoices and invoice lines",
    "Posted invoice values before VAT, VAT and inclusive totals. Credit notes/returns are not deducted.",
  ],
  purchase_summary: [
    "Purchase invoices and invoice lines",
    "Posted purchase invoice values before VAT, VAT and inclusive totals. Purchase returns are not deducted.",
  ],
  sales_invoices: [
    "Sales invoices and customers",
    "Invoice totals and current unpaid amounts; includes all statuses unless filtered.",
  ],
  purchase_invoices: [
    "Purchase invoices and suppliers",
    "Supplier invoice totals and current unpaid amounts; includes all statuses unless filtered.",
  ],
  sales_orders: [
    "Sales orders and customers",
    "Saved sales order values and statuses; orders are not posted revenue.",
  ],
  purchase_orders: [
    "Purchase orders and suppliers",
    "Saved purchase order values and statuses; orders are not posted purchases.",
  ],
  quotations: [
    "Sales quotations and customers",
    "Saved offers and statuses; quotations are not revenue.",
  ],
  goods_receipts: [
    "Goods receipts and suppliers",
    "Recorded receipt documents, warehouses and statuses.",
  ],
  pending_deliveries: [
    "Sales orders and order lines",
    "Approved orders with ordered quantity still to deliver.",
  ],
  stock_summary: [
    "Stock balances, products and warehouses",
    "Current on-hand minus reserved quantity gives available stock. Historical stock is not reconstructed.",
  ],
  low_stock: [
    "Stock balances and product reorder/minimum levels",
    "Current available stock at or below the recorded reorder/minimum level.",
  ],
  product_lookup: [
    "Product catalogue",
    "Recorded catalogue prices and warranty notes; catalogue cost is not a service cost or guaranteed transaction cost.",
  ],
  top_products: [
    "Posted sales invoice lines and products",
    "Ranked invoice revenue before VAT; returns are excluded.",
  ],
  top_customers: [
    "Posted sales invoices and customers",
    "Ranked invoice revenue before VAT; returns are excluded.",
  ],
  customer_dues: [
    "Unpaid posted sales invoices",
    "Current invoice total minus allocated receipts. Opening balances and unallocated advances are excluded.",
  ],
  supplier_dues: [
    "Unpaid posted purchase invoices",
    "Current invoice total minus allocated payments. Opening balances and unallocated advances are excluded.",
  ],
  branch_performance: [
    "Posted sales invoices, recorded COGS and warehouse branch links",
    "Invoice revenue before VAT minus recorded COGS. Returns and overhead expenses are excluded.",
  ],
  gross_profit: [
    "Posted sales invoice lines and captured unit costs",
    "Revenue before VAT minus quantity × captured unit cost. Gross profit is before overhead expenses; returns are excluded.",
  ],
  machine_trace: [
    "Machine Serial Register and linked customer/AMC records",
    "Recorded serial assignment, installation and warranty dates. Missing links/dates are not inferred.",
  ],
  amc_contracts: [
    "AMC contracts and recorded customer/product links",
    "Recorded contract fees and dates; fees are not actual service costs or profit.",
  ],
  amc_expiring: [
    "Active AMC contracts and end dates",
    "Renewals selected by recorded end date. Without a period: within 30 days, including overdue renewals.",
  ],
  service_due: [
    "AMC service visits and active contracts",
    "Scheduled/in-progress visits selected by scheduled date. Without a period: next 7 days, including overdue visits.",
  ],
  employees: [
    "Employee directory",
    "Permitted employee directory only; excludes payroll, bank and identity-document information.",
  ],
  employee_lookup: [
    "Employee directory",
    "Permitted contact/department information only; excludes payroll, bank and identity-document information.",
  ],
  audit_history: [
    "Audit events for the selected visible record",
    "Recorded employee, time and before/after values. Older/unrecorded field values cannot be reconstructed.",
  ],
};
export function answerDetails(
  intent: string,
  e: Entities,
  user: AuthUser,
  index: IndexedRecord[],
  now: Date,
): NonNullable<ChatResponse["details"]> {
  const b = branchScope(user, e),
    branch = index.find((r) => r.kind === "branch" && r.id === b);
  const filtered = e.period,
    month = currentMonth(now),
    monthly = [
      "sales_summary",
      "purchase_summary",
      "top_products",
      "top_customers",
      "branch_performance",
      "gross_profit",
    ].includes(intent);
  let period = filtered
    ? filtered.from + " to " + filtered.to
    : monthly
      ? month.from + " to " + month.to
      : [
            "sales_invoices",
            "purchase_invoices",
            "sales_orders",
            "purchase_orders",
            "quotations",
            "goods_receipts",
            "pending_deliveries",
          ].includes(intent)
        ? "All document dates"
        : "Current records";
  if (["customer_dues", "supplier_dues"].includes(intent))
    period =
      "Current unpaid amounts" +
      (filtered
        ? "; invoice dates " + filtered.from + " to " + filtered.to
        : "; all invoice dates");
  if (!filtered && intent === "amc_expiring")
    period = "Through the next 30 days, including overdue renewals";
  if (!filtered && intent === "service_due")
    period = "Through the next 7 days, including overdue visits";
  const filters: string[] = [];
  for (const [key, kind] of Object.entries({
    productId: "product",
    customerId: "customer",
    supplierId: "supplier",
    employeeId: "employee",
    unitId: "unit",
  })) {
    const value = (e as any)[key];
    if (value !== undefined) {
      const r = index.find(
        (r) => r.kind === kind && String(r.id) === String(value),
      );
      if (r) filters.push(r.code + " — " + r.name);
    }
  }
  if (e.recordId && e.recordType && !filters.length)
    filters.push(e.recordType + " #" + e.recordId);
  if (e.status) filters.push("Status: " + e.status);
  if (e.unpaid) filters.push("Unpaid invoices only");
  if (e.openOnly) filters.push("Open documents only");
  if (e.overdue) filters.push("Overdue only");
  if (e.amountMin !== undefined)
    filters.push(
      "Amount " + (e.amountMinInclusive ? ">=" : ">") + " AED " + e.amountMin,
    );
  if (e.amountMax !== undefined)
    filters.push(
      "Amount " + (e.amountMaxInclusive ? "<=" : "<") + " AED " + e.amountMax,
    );
  if (!["sales_summary", "purchase_summary", "gross_profit"].includes(intent))
    filters.push("Source limit: " + (e.top ?? 10) + " records");
  const definition = sources[intent] ?? [intent, "Recorded ERP data only."];
  return {
    branch:
      b === null
        ? "All permitted branches"
        : branch
          ? branch.code + " — " + branch.name
          : "Assigned branch",
    period,
    filters,
    sources: [definition[0]],
    calculation: definition[1],
  };
}
