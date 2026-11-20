import type { AuthUser } from "../middleware/auth";
import type { ChatResponse } from "./types";
import { canView } from "./security";
import { fold } from "./nlp";
type Features = { amc: boolean; hr: boolean; serialTracking: boolean };
export const guides = [
  {
    id: "quotation",
    noun: "(?:sales )?(?:quotation|quote|estimate)",
    permission: "sales_quotation",
    screen: "sales-quotations",
    title: "Quotations",
    text: "1. Open Sales Quotations and choose New.\n2. Select the customer, warehouse, products, quantities, prices, VAT and validity. Save and review the offer.\n3. When accepted, open the quotation and use Create Order. Approval and conversion buttons depend on your permissions and document status.",
  },
  {
    id: "purchase",
    noun: "(?:purchase(?: order)?|procurement|po)",
    permission: "purchase_order",
    screen: "purchase-orders",
    title: "Purchase Orders",
    text: "1. Create a Purchase Order with the supplier, warehouse, products, quantities and agreed costs.\n2. Complete any required approval. Receive the actual quantities through Goods Receipt.\n3. Post the receipt and create the linked Purchase Invoice. Posting stock and accounting documents is performed by authorised staff.",
  },
  {
    id: "goods_receipt",
    noun: "(?:goods receipt|grn|stock receipt)",
    permission: "goods_receipt",
    screen: "goods-receipts",
    title: "Goods Receipts",
    text: "1. Start a Goods Receipt from the purchase order.\n2. Check the receiving warehouse and actual quantities received.\n3. Post the receipt when verified. Then use Create Invoice for supplier billing. Saving a draft is different from posting stock.",
  },
  {
    id: "sales_order",
    noun: "(?:sales? order|so)",
    permission: "sales_order",
    screen: "sales-orders",
    title: "Sales Orders",
    text: "1. Open an accepted quotation and use Create Order, or start a Sales Order where your process permits.\n2. Review the customer, warehouse, quantities and prices; complete any required approval.\n3. Use Create Picking to begin warehouse fulfilment. Other available fulfilment routes depend on document status and your permissions.",
  },
  {
    id: "picking",
    noun: "(?:picking(?: list)?|pick list)",
    permission: "picking",
    screen: "pickings",
    title: "Picking Lists",
    text: "1. Use Create Picking on an eligible Sales Order.\n2. Check the requested products, warehouse and actual picked quantities.\n3. Complete the picking stage and use the available packing/delivery conversion for the next stage. The available actions depend on document status and permissions.",
  },
  {
    id: "packing",
    noun: "(?:packing(?: list)?)",
    permission: "packing",
    screen: "packing-lists",
    title: "Packing Lists",
    text: "1. Open the picking/sales document and create its packing document using the available conversion.\n2. Record the packed quantities and dispatch details.\n3. Use Create Delivery when the packing document is eligible. Check quantities before posting the delivery.",
  },
  {
    id: "delivery",
    noun: "(?:delivery(?: notes?)?|dispatch)",
    permission: "delivery_note",
    screen: "delivery-notes",
    title: "Delivery Notes",
    text: "1. Use Create Delivery from an eligible Sales Order, Picking List or Packing List.\n2. Verify what is leaving the warehouse and the delivery details.\n3. Use Post Delivery when authorised. A posted delivery can then use Create Invoice. A saved draft does not confirm dispatch.",
  },
  {
    id: "invoice",
    noun: "(?:(?:sales?|customer) )?invoice",
    permission: "sales_invoice",
    screen: "sales-invoices",
    title: "Sales Invoices",
    text: "1. Open the posted delivery and use Create Invoice, or use another permitted invoice route in your workflow.\n2. Check the customer, delivered quantities, prices, VAT and payment terms.\n3. Post the invoice when authorised. Record and allocate a customer receipt when money is received; issuing an invoice alone does not mean it is paid.",
  },
  {
    id: "purchase_invoice",
    noun: "(?:purchase|supplier) invoice",
    permission: "purchase_invoice",
    screen: "purchase-invoices",
    title: "Purchase Invoices",
    text: "1. Open the eligible purchase order or posted Goods Receipt and use Create Invoice.\n2. Check the supplier reference, received quantities, costs and VAT.\n3. Post the supplier invoice when authorised, then record the supplier payment through the finance workflow.",
  },
  {
    id: "receipt",
    noun: "(?:(?:customer|bank|payment) )?receipt",
    permission: "receipts",
    screen: "bank-receipts",
    title: "Bank Receipts",
    text: "1. Open Bank Receipts and start a receipt using the actual bank account, date and customer.\n2. Record the amount received and allocate it to the correct invoice(s).\n3. Post when verified. Only the recorded allocation reduces the invoice balance; an on-account receipt may remain unallocated.",
  },
  {
    id: "amc",
    noun: "(?:amc(?: contract)?|maintenance contract|service contract)",
    permission: "amc",
    screen: "amc-contracts",
    title: "AMC Contracts",
    feature: "amc",
    text: "1. Open AMC Contracts and create a contract for the customer and product/machine.\n2. Record the serial number, start/end dates, contract fee and planned service visits.\n3. Review due visits and renewals. Contract fees are not actual service-job cost or profit.",
  },
  {
    id: "serial",
    noun: "(?:serial(?: number)?(?: tracking)?|machine tracking|machine serial)",
    permission: "products",
    screen: "equipment-register",
    title: "Machine Serial Register",
    feature: "serialTracking",
    text: "1. Open the Machine Serial Register.\n2. Review each machine serial and its recorded product, warehouse/branch and customer assignment.\n3. Check installation/warranty dates and any linked AMC. A product code identifies a model; a serial identifies one physical unit. Missing links or dates are not inferred.",
  },
] as const;
export function matchGuide(message: string) {
  const text = fold(message.replace(/[?.!]+$/, "")).trim();
  const prefix =
    /^(?:how (?:do|can|should) (?:i|we)|how to|show me how to|guide me (?:on|through)|explain(?: the)?|what (?:comes|happens) after|what is (?:a|an)|where (?:do|can) (?:i|we))\s+(.+)$/;
  const found = text.match(prefix);
  if (!found) return;
  const content = found[1]
    .replace(
      /^(?:create|make|prepare|raise|start|record|manage|track|process|use|open)\s+/,
      "",
    )
    .replace(/^(?:a|an|the|new)\s+/, "")
    .replace(/\s+(?:work|works|workflow|process)$/, "")
    .replace(/\s+in (?:this|the) (?:erp|system)$/, "");
  return guides.find((g) => new RegExp("^" + g.noun + "$").test(content));
}
export function guideAnswer(
  message: string,
  user: AuthUser,
  features: Features,
): ChatResponse | undefined {
  const guide = matchGuide(message);
  if (!guide) return;
  if (!canView(user, guide.permission))
    return {
      intent: null,
      text: "Your role does not allow this workflow guide.",
    };
  if ("feature" in guide && !features[guide.feature])
    return {
      intent: null,
      text: "That module is switched off for this company.",
    };
  return {
    intent: "guide_" + guide.id,
    answerType: "guide",
    text:
      guide.text +
      "\n\nThis is guidance only. I have not created, posted, sent or changed anything.",
    link: { screenId: guide.screen, label: "Open " + guide.title },
    details: {
      branch: "No records queried",
      period: "Workflow guide",
      filters: [],
      sources: [guide.title + " workflow"],
      calculation:
        "Fixed instructions for this ERP. Available buttons depend on permissions, approvals and document status.",
    },
  };
}
export function serviceCostQuestion(message: string) {
  const text = fold(message);
  return (
    /^(?:what|how much|show|list|tell me|can you show)\b/.test(text) &&
    /\b(?:service|servicing|maintenance|amc)\b/.test(text) &&
    /\b(?:cost|costs|costing|profit|profitability|labour|labor|travel)\b/.test(
      text,
    ) &&
    !/\b(?:create|delete|update|send|post|approve|pay|edit|change)\b/.test(text)
  );
}
