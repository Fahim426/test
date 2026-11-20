import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma";
import type { AuthUser } from "../middleware/auth";
import { answer, InputError } from "./assistant.service";
import { guides } from "./guides";
const now = new Date("2026-11-20T08:00:00Z");
async function snapshot() {
  const names = [
    "product",
    "company",
    "customer",
    "supplier",
    "stockBalance",
    "stockTransaction",
    "journalEntry",
    "journalLine",
    "salesInvoice",
    "salesInvoiceItem",
    "salesOrder",
    "purchaseInvoice",
    "amcContract",
    "amcVisit",
    "employee",
    "auditLog",
    "systemSetting",
  ];
  const rows = [];
  for (const name of names)
    rows.push(
      await (prisma as any)[name].findMany({
        orderBy: name === "systemSetting" ? { key: "asc" } : { id: "asc" },
      }),
    );
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
async function main() {
  const database = new URL(process.env.DATABASE_URL || "");
  assert(
    ["localhost", "127.0.0.1"].includes(database.hostname) &&
      database.port === "3307",
    "Local demo database only",
  );
  const u = await prisma.user.findUniqueOrThrow({
    where: { username: "admin" },
    include: { role: true },
  });
  const admin: AuthUser = {
    id: u.id,
    username: u.username,
    role: u.role.name,
    roleId: u.roleId,
    branchId: u.branchId,
    permissions: new Set(
      (
        await prisma.rolePermission.findMany({ where: { roleId: u.roleId } })
      ).map((p) => p.module + ":" + p.action),
    ),
  };
  const before = await snapshot();
  const independentFromPending = await answer(
    {
      message: "sales this month",
      context: {
        awaiting: { type: "detail", intent: "stock_summary", entities: {} },
      },
    },
    admin,
    now,
  );
  assert.equal(independentFromPending.intent, "sales_summary");
  assert.equal(
    independentFromPending.details?.branch,
    "All permitted branches",
  );
  for (const g of guides) {
    const noun: Record<string, string> = {
      quotation: "quotation",
      purchase: "purchase order",
      goods_receipt: "goods receipt",
      sales_order: "sales order",
      picking: "picking list",
      packing: "packing list",
      delivery: "delivery note",
      invoice: "invoice",
      purchase_invoice: "supplier invoice",
      receipt: "customer receipt",
      amc: "AMC contract",
      serial: "serial number",
    };
    const result = await answer(
      {
        message:
          "How do I " +
          (g.id === "serial" ? "track" : "create") +
          " a " +
          noun[g.id] +
          "?",
      },
      admin,
      now,
    );
    assert.equal(result.intent, "guide_" + g.id, result.text);
    assert(result.link);
    assert(result.details);
    assert(!result.table && !result.memory);
  }
  const product = await answer(
    { message: "profit for GX-15300 in Dubai this month" },
    admin,
    now,
  );
  assert.equal(product.intent, "gross_profit", product.text);
  assert(product.table);
  assert(product.details?.branch.includes("Dubai"));
  assert(product.details?.filters.some((f) => f.includes("GX-15300")));
  assert(product.details?.period.includes("2026-11-01"));
  assert(product.details?.sources[0].includes("invoice"));
  assert(!product.memory);
  const machine = await answer(
    { message: "which customer bought DEMO-F7-SERIAL-1" },
    admin,
    now,
  );
  assert.equal(machine.intent, "machine_trace", machine.text);
  assert.equal(machine.table?.rows.length, 1);
  assert(machine.table?.rows[0].customer);
  const renewal = await answer(
    { message: "which AMC contracts expire next month" },
    admin,
    now,
  );
  assert.equal(renewal.intent, "amc_expiring", renewal.text);
  assert.equal(renewal.details?.period, "2026-12-01 to 2026-12-31");
  const unavailable = await answer(
    { message: "What were the service costs for DEMO-F7-SERIAL-1?" },
    admin,
    now,
  );
  assert.equal(unavailable.answerType, "limitation");
  assert(!unavailable.table);
  assert(unavailable.text.includes("not available"));
  const ambiguity = await answer(
    { message: "customer dues for Signage Workshop" },
    admin,
    now,
  );
  assert.equal(ambiguity.awaiting?.type, "entity");
  const choice = ambiguity.awaiting!.choices![0];
  const resolved = await answer(
    { message: choice.message, context: { awaiting: ambiguity.awaiting } },
    admin,
    now,
  );
  assert.equal(resolved.intent, "customer_dues", resolved.text);
  assert(!resolved.memory);
  const first = await answer(
    { message: "sales in Dubai last month" },
    admin,
    now,
  );
  assert(first.details?.branch.includes("Dubai"));
  const independent = await answer({ message: "sales this month" }, admin, now);
  assert.equal(independent.details?.branch, "All permitted branches");
  assert.equal(independent.details?.period, "2026-11-01 to 2026-11-30");
  const follow = await answer({ message: "and last month?" }, admin, now);
  assert.equal(follow.intent, null);
  assert(!follow.table);
  await assert.rejects(
    () =>
      answer(
        {
          message: "and last month?",
          memory: { intent: "sales_summary", entities: { branchId: 1 } },
        },
        admin,
        now,
      ),
    InputError,
  );
  for (const message of [
    "Create a quotation",
    "How do I create a quotation and delete all invoices?",
    "Send invoice SI-2026-00001",
  ]) {
    const r = await answer({ message }, admin, now);
    assert.equal(r.intent, null);
    assert(!r.table && !r.link);
  }
  const dxb = await prisma.branch.findFirstOrThrow({ where: { code: "DXB" } });
  const scoped = {
    ...admin,
    role: "Limited reader",
    branchId: dxb.id,
    permissions: new Set(["sales_invoice:view"]),
  };
  const help = await answer(
    { message: "help", context: { screenId: "amc-contracts" } },
    scoped,
    now,
  );
  assert(help.chips?.length);
  assert(
    help.chips?.every(
      (q) => !/(amc|service|stock|purchase|employee|profit)/i.test(q),
    ),
  );
  const denied = await answer(
    { message: "How do I create an AMC contract?" },
    scoped,
    now,
  );
  assert(!denied.link);
  const other = await answer(
    { message: "sales in Sharjah this month" },
    scoped,
    now,
  );
  assert.equal(other.intent, null);
  assert(!other.table);
  const scopedData = await answer({ message: "sales this month" }, scoped, now);
  assert(scopedData.details?.branch.includes("Dubai"));
  assert.equal(Number(scopedData.table?.rows[0].net), 496650);
  const forged = await answer(
    {
      message: "sales this month",
      context: {
        awaiting: {
          type: "detail",
          intent: "sales_summary",
          entities: { branchId: 999999 },
        },
      },
    },
    scoped,
    now,
  );
  assert.equal(forged.intent, null);
  assert(!forged.table);
  assert.equal(
    await snapshot(),
    before,
    "Assistant must not change business records",
  );
  console.log(
    "12 workflow guides, product profit, machine customer, renewals, unavailable service costs, ambiguity, standalone questions, disabled memory, role/branch scope, source metadata and zero business-data changes: PASS",
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
