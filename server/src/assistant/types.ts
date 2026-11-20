export type RecordKind =
  | "product"
  | "customer"
  | "supplier"
  | "branch"
  | "employee"
  | "unit"
  | "salesInvoice"
  | "purchaseInvoice"
  | "salesOrder"
  | "purchaseOrder"
  | "quotation"
  | "receipt"
  | "amc";
export interface IndexedRecord {
  kind: RecordKind;
  id: number | string;
  code: string;
  name: string;
  aliases?: string[];
}
export interface Period {
  from: string;
  to: string;
  label: string;
}
export interface Entities {
  period?: Period;
  productId?: number;
  customerId?: number;
  supplierId?: number;
  employeeId?: number;
  branchId?: number;
  unitId?: string;
  recordType?: string;
  recordId?: string;
  amountMin?: number;
  amountMax?: number;
  amountMinInclusive?: boolean;
  amountMaxInclusive?: boolean;
  top?: number;
  overdue?: boolean;
  unpaid?: boolean;
  openOnly?: boolean;
  status?: string;
}
export interface Memory {
  intent: string;
  entities: Entities;
}
export interface Awaiting {
  type: "intent" | "entity" | "detail";
  intent?: string;
  slot?: string;
  entities?: Entities;
  choices?: {
    label: string;
    message: string;
    kind?: RecordKind;
    id?: number | string;
    intent?: string;
  }[];
}
export interface Target {
  label?: string;
  screenId: string;
  params?: Record<string, unknown>;
  highlight?: string;
}
export interface ChatResponse {
  intent: string | null;
  text: string;
  table?: {
    columns: {
      key: string;
      label: string;
      format?: "money" | "number" | "date";
    }[];
    rows: Record<string, unknown>[];
    targets?: (Target | null)[];
  };
  link?: Target;
  chips?: string[];
  awaiting?: Awaiting;
  memory?: Memory;
  responseId?: string;
  answerType?: "guide" | "limitation";
  details?: {
    branch: string;
    period: string;
    filters: string[];
    sources: string[];
    calculation: string;
  };
}
export interface IntentDef {
  id: string;
  title: string;
  examples: string[];
  core: string[][];
  permissions: string[];
  required?: "employeeId" | "unitId" | "recordId";
  filters: string[];
}
export interface Understanding {
  intent: string | null;
  entities: Entities;
  score: number;
  margin: number;
  candidates: { intent: string; title: string; score: number }[];
  awaiting?: Awaiting;
  text?: string;
  refused?: boolean;
}
