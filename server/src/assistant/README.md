# Fortune 7 read-only assistant

Available through the floating chat button in Classic and Modern. This is a finite, rule-based English assistant, with no model, outside API or heavy NLP dependency. Unsupported or ambiguous questions ask for clarification. It does not execute actions.

## Questions and source data

| Intent | Data read |
| --- | --- |
| sales_summary | Posted sales invoices and lines: before VAT, VAT and inclusive totals |
| sales_invoices | Sales invoices, dates, customers, status and balances |
| sales_orders | Sales orders and customers |
| quotations | Sales quotations, expiry and status |
| pending_deliveries | Sales orders with outstanding delivery quantities |
| purchase_summary | Posted purchase invoices and lines |
| purchase_invoices | Supplier invoices and unpaid balances |
| purchase_orders | Purchase orders and suppliers |
| goods_receipts | Receipt documents and suppliers |
| stock_summary | Current stock by product and permitted warehouse/branch |
| low_stock | Current stock against recorded reorder levels |
| product_lookup | Product catalogue prices, codes and recorded warranty |
| top_products | Ranked posted sales invoice lines |
| top_customers | Ranked posted sales invoices by customer |
| customer_dues | Current unpaid posted customer invoices |
| supplier_dues | Current unpaid posted supplier invoices |
| branch_performance | Posted sales, purchases and recorded cost by branch |
| gross_profit | Sales less recorded cost of goods sold |
| machine_trace | Equipment serial registry and recorded customer/branch links |
| amc_contracts | AMC contracts, dates and recorded fees |
| amc_expiring | AMC contracts expiring in a selected window (default 30 days) |
| service_due | Recorded service due dates (default next 7 days, including overdue) |
| employees | Active employee directory |
| employee_lookup | One employee's permitted directory information |
| audit_history | Audit events for one visible record, including recorded before/after values |

Examples: `sales this month`, `and last month?`, `purchases in Dubai this year`, `show purchase invoices`, `stock for GX-15300`, `top five customers`, `customer dues above 50k`, `AMCs expiring next month`, `who edited SI-2026-00005`.

## Interface

One authenticated route: `POST /api/assistant/message` (the application mounts the requested `/assistant/message` below `/api`).

```json
{
  "message": "and last month?",
  "context": { "awaiting": {}, "screenId": "optional-current-screen" },
  "memory": { "intent": "sales_summary", "entities": {} }
}
```

Omit `awaiting` when no clarification is pending; send back the exact returned object when present. All incoming fields, including memory and choices, are validated and rechecked against current access. Responses contain `intent`, `text`, and optional `table`, `link`, `chips`, `awaiting`, `memory`, `responseId`. Table targets open the existing workspace screen and highlight the matching document/row. The component keeps memory in this conversation only and clears it on identity/access changes.

Feedback uses the same endpoint with an empty message and `context.feedback: { responseId, rating: "up" | "down" }`. Response ownership is checked.

## Processing and security

Normalisation, accents, typo correction, synonyms and number words precede entity extraction. Real visible names/codes resolve entities; ambiguous names or numeric document references produce choices. TF-IDF cosine matching uses eight examples per intent, core-word gates, a minimum score and runner-up margin. Follow-ups merge validated entities into a previous intent. Exactly one fixed parameterised SELECT handler runs for a resolved intent; separate read-only record indexing supports name matching. No user text becomes SQL code. No assistant handler writes business tables.

Each intent checks existing role/module permissions. An assigned branch always limits results, including for an assigned Admin. Only a global Admin can query all branches. Other users without an assigned branch are refused until an administrator assigns one. Shared product catalogue and branch names are lookup metadata; transactions and employee/customer/supplier records remain scoped. Branch-specific AMC access requires an explicit unit registry/AMC branch link; unlinked contracts are visible only to a global Admin. Audit queries also enforce the underlying record permission and visibility. Broad navigation links are omitted where existing destination screens cannot guarantee the same scope.

Action requests are refused. The route accepts 30 requests per user per minute and returns HTTP 429 with Retry-After. The limiter, lookup cache and feedback ownership registry are process-local; a deployment with multiple API instances needs a shared limiter/cache strategy. Telemetry is appended to `server/uploads/assistant-logs/assistant.log`. It records intent, score, timing and feedback metadata. Message text is logged only for questions not understood; recognised and refused action text is omitted. Configure retention/rotation for deployment.

## Meaning and limitations

Sales and purchase totals show amounts before VAT, VAT and inclusive amounts. Credit notes/returns are not deducted from these invoice summaries. Dues represent unpaid posted invoices, excluding opening balances and unallocated advances. A period filter on dues selects invoice dates; it does not reconstruct historical balances. Gross profit is before overheads, not net profit. Stock is current; historical "as of" stock/balances and forecasts are unsupported. AMC fees are available, but actual service profitability cannot be inferred without complete linked service-cost records. Missing serial/service dates are not invented. The employee directory excludes payroll, bank and identity-document information. Audit before/after details depend on what existing events recorded.

The assistant supports defined English questions rather than arbitrary conversation. It asks one question at a time; combined requests should be separated. No Arabic language support is claimed. The held-out wording `show the reorder shortage report` currently requests clarification; `show low stock` works.

## Verification and measured results

Run from `server`:

```powershell
npm run assistant:test
npm run assistant:test:live
npm run assistant:test:http
npm run typecheck
```

Live tests require the existing local demo database. HTTP tests require the running local API and demo logins; they deliberately test the rate limit. They compare business data before and after. Browser checks exercised both frontends: conversation follow-ups, ambiguity choices, document navigation, feedback, minimise/maximise, reset, HR privacy and no outside requests. Both frontend production builds were checked.

Results: 200/200 tuned examples, 26/26 entity checks, all follow-up and clarification checks. Fifty fresh phrases first scored 35/50 (70%); vocabulary fixes brought those regression cases to 50/50. A separate subsequently held-out positive set first scored 49/50 (98%). That single positive miss was not tuned. Ten held-out negatives initially scored 8/10; creation-command and prediction refusals were corrected, and all ten now pass, with nine additional safety regressions. These are locally authored test sets, not an independent production accuracy estimate. Later numeric-document disambiguation, inclusive amount filtering and safety fixes are documented in evaluation metadata.

`evaluation.json` preserves initial scores/hashes; `fresh-baseline.json` and `held-out-first-result.json` preserve first results. `language-final-result.json` records the latest run. The language command exits non-zero on any required regression failure or positive held-out accuracy below 90%; it still prints the known held-out miss when passing that threshold. Live checks exercise all 25 intents and access boundaries against the demo data; HTTP checks include JWT, malformed input, feedback ownership, read-only state, privacy logging and rate limits.

## Removal and layout

All backend implementation and tests are in this folder, with one auto-discovered mount in `server/src/modules/assistant.ts`. Each independently built frontend has one `components/AssistantChat.tsx` and a single import/render in its `App.tsx`. To remove, remove those imports/renders, the two components, the mount, this folder and the three assistant package scripts. No schema migration or new dependency was added. The referenced external assistant repository was unavailable; the supplied design was followed in this repository's TypeScript/Express/Prisma/React stack.
