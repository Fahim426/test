import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { matchGuide, guideAnswer, serviceCostQuestion } from "./guides";
import { understand } from "./understand";
import { fixture, NOW } from "./intent-cases";
import { suggestions, answerDetails } from "./presentation";
import type { AuthUser } from "../middleware/auth";
const features = { amc: true, hr: true, serialTracking: true };
const admin: AuthUser = {
  id: 1,
  username: "test",
  role: "Admin",
  roleId: 1,
  branchId: null,
  permissions: new Set(),
};
const cases = JSON.parse(
  fs
    .readFileSync(path.join(__dirname, "upgrade-fresh.json"), "utf8")
    .replace(/^\uFEFF/, ""),
) as { kind: string; message: string; intent: string | null }[];
const results = cases.map((c) => {
  const actual =
    c.kind === "guide"
      ? matchGuide(c.message)
        ? "guide_" + matchGuide(c.message)!.id
        : null
      : c.kind === "limitation"
        ? serviceCostQuestion(c.message)
          ? "service_cost_unavailable"
          : null
        : understand(c.message, fixture, undefined, undefined, NOW).intent;
  return { ...c, actual, pass: actual === c.intent };
});
const result = {
  passed: results.filter((r) => r.pass).length,
  total: results.length,
  failures: results.filter((r) => !r.pass),
};
const first = path.join(__dirname, "upgrade-first-result.json");
if (!fs.existsSync(first))
  fs.writeFileSync(
    first,
    JSON.stringify(
      {
        ...result,
        note: "Fresh locally authored phrasings, first measured before vocabulary fixes. Not an independent production accuracy estimate.",
      },
      null,
      2,
    ),
  );
console.log(JSON.stringify(result, null, 2));
assert.equal(
  result.passed,
  result.total,
  "Upgrade language regression failures",
);
const limited = {
  ...admin,
  role: "Sales reader",
  branchId: 1,
  permissions: new Set(["sales_invoice:view"]),
};
assert(
  guideAnswer(
    "How do I create an AMC contract?",
    limited,
    features,
  )?.text.includes("does not allow"),
);
assert(
  !guideAnswer("How do I create an AMC contract?", admin, {
    ...features,
    amc: false,
  })?.link,
);
assert(!matchGuide("How do I create a quotation and send it?"));
const low = suggestions(limited, features, "amc-contracts");
assert(
  low.every((q) => !/(amc|service|employee|stock|profit|purchase)/i.test(q)),
);
for (const screen of [
  "products",
  "sales-invoices",
  "purchase-orders",
  "amc-contracts",
  "hr-employees",
  "equipment-register",
])
  for (const q of suggestions(admin, features, screen)) {
    const guide = matchGuide(q),
      u = understand(q, fixture, undefined, undefined, NOW);
    assert(guide || u.intent, q);
  }
const scoped = answerDetails(
  "gross_profit",
  { productId: 4, branchId: 1 },
  admin,
  fixture,
  NOW,
);
assert(scoped.branch.includes("Dubai"));
assert(scoped.period.includes("2026-11-01"));
assert(scoped.filters.some((s) => s.includes("GX-15300")));
assert(scoped.calculation.includes("overhead"));
assert.equal(
  answerDetails("stock_summary", {}, admin, fixture, NOW).period,
  "Current records",
);
console.log(
  "Guide permission/feature checks, suggestion classification and scope metadata passed.",
);

const newQuestion = understand(
  "sales this month",
  fixture,
  undefined,
  { type: "detail", intent: "stock_summary", entities: { branchId: 2 } },
  NOW,
);
assert.equal(newQuestion.intent, "sales_summary");
assert.equal(newQuestion.entities.branchId, undefined);
console.log(
  "Complete new question replaces pending clarification without inheriting filters.",
);
