# SmartSpare ERP — Build Contract (read before writing any code)

Source requirements: `prompt.md` (the spec). This file defines the shared conventions so independently-built parts fit together.

Stack: server = Node/Express/TS/Prisma(MySQL, MariaDB 10.4 locally, DB `smartspare_erp`); client = React/Vite/TS/Tailwind.
Run: server `cd server && npm run dev` (port 4000). Login `admin` / `admin123`. DB already pushed + seeded (`npx tsx prisma/seed.ts`).

## Backend rules

1. **Schema is frozen** (`server/prisma/schema.prisma`). Do NOT edit it or run `prisma db push` (parallel agents). If you truly need a field, work around it (e.g. JSON in `remarks`) and mention it in your final report.
2. **Only write files in your assigned `server/src/modules/<name>.ts` files** (plus new helper files under `server/src/services/<yourarea>-*.ts`). Never edit `lib/*`, `middleware/*`, `services/{stock,accounting,approval,numbering,audit,docLink}.ts`, `app.ts`. If you find a bug there, report it, don't patch (exception: obvious compile bug – make minimal fix and report).
3. **Module registration**: each file in `src/modules/` does `export default [{ path: '/purchase-orders', router }, ...]` (type `ModuleDef` from `../app`). They are auto-mounted at `/api<path>` after JWT auth. Use unique paths.
4. **Core services (use them, never reimplement):**
   - `services/stock.ts` → `postStock`, `revalueStock`, `reserveStock`, `releaseOrderReservations`, `fulfillReservation`, `getAvailability`. **Never** write `StockTransaction`/`StockBalance`/`StockReservation` rows anywhere else, never edit quantities directly.
   - `services/accounting.ts` → `postJournal` (balanced, account by `accountKey`), `reverseJournal`, `customerBalance`, `supplierBalance`. System account keys: CASH, BANK, AR, INVENTORY, AP, GRNI, VAT_INPUT, VAT_OUTPUT, SALES, SALES_RETURNS, COGS, STOCK_ADJUSTMENT, FREIGHT, BANK_CHARGES, ROUND_OFF, OPENING_EQUITY, ADVANCE_TO_SUPPLIERS. Subledger lines carry `partyType`/`partyId` (AR lines → CUSTOMER, AP lines → SUPPLIER).
   - `services/numbering.ts` → `nextNumber(tx, 'SALES_ORDER')`. docType keys = keys of `DOC_DEFAULTS`.
   - `services/docLink.ts` → `linkDocs(tx, {type,id,no}, {type,id,no})` on every conversion/creation-from. Doc type strings are the UPPER_SNAKE names used in numbering (e.g. `PURCHASE_ORDER`, `GOODS_RECEIPT`, `SALES_INVOICE`).
   - `services/approval.ts` → `submitForApproval`, `actOnApproval`, `registerApprovalHandler(docType, handler)`. Rules are DB-configured (no hard-coded thresholds). If no rule matches → auto-approve.
   - `services/audit.ts` → `audit(tx, req.user, 'POST', 'PurchaseOrder', id, details)` on create/update/status changes/postings.
   - `lib/calc.ts` → `calcLine`, `calcTotals`, `r2/r3/r4`, `num`. VAT rate always comes from the line (default from Product.vatRate / VatCode), never hard-coded.
   - `lib/enrich.ts` → `enrich(rows, {customerId:'customer', supplierId:'supplier', warehouseId:'warehouse', productId:'product', ...})` to attach names. Item arrays: enrich each item list too (`productId:'product'`).
   - `lib/http.ts` → `ah` (async handler), `parse(zodSchema, body)`, `intParam`, `listQuery`, `paged`. `lib/crud.ts` → `crudRouter` for master data.
   - `middleware/auth.ts` → `can(module, action)` per route. Permission module keys are in `lib/permissions.ts` (`PERMISSION_MODULES`); actions: view create edit delete approve reject post cancel print export.
5. **REST shape (all document modules):**
   - `GET /` → `{rows,total,page,pageSize}`; supports `page,pageSize,search,sort,dir,status,from,to` (+ party/warehouse filters). Rows are enriched (party/warehouse objects) and include aggregate fields useful for lists (e.g. PO `receivedQty`/`orderedQty`, `receivedPct`).
   - `GET /:id` → full document with `items` (each enriched with `product`), enriched parties, plus `links: {createdFrom, convertedTo}` (from `getLinks`), and `approval` (latest ApprovalRequest with actions, if any).
   - `POST /` create (status DRAFT, doc number from `nextNumber`, totals recomputed server-side from lines with `calcTotals`), `PUT /:id` edit only while DRAFT (otherwise 400), `DELETE /:id` only DRAFT.
   - State transitions: `POST /:id/submit | approve | reject | post | cancel | close` and conversions `POST /:id/create-<target>` (e.g. `POST /sales-orders/:id/create-picking`). Conversions pre-fill from the source (never make the user re-enter), validate remaining qty, prevent duplicates, and call `linkDocs`.
   - All multi-table writes inside `prisma.$transaction(async tx => {...}, { timeout: 30000 })`.
   - Errors: throw `badRequest/notFound/conflict` from `lib/errors`; the global handler formats them as `{error, details}`.
6. **Statuses** are the UPPER_SNAKE values documented in schema comments (e.g. `PARTIALLY_RECEIVED`).
7. Dates arrive as ISO strings (`z.coerce.date()`); money/qty come as numbers.
8. Typecheck with `cd server && npx tsc --noEmit -p .` — must be clean before you finish. Smoke-test your endpoints against the running API with curl (start your own server on a different port: `PORT=40xx npx tsx src/index.ts`, log in via `/api/auth/login`). Clean up any test data you create or clearly name it `TEST-…`; do not leave the stock/finance data inconsistent.
9. Posting semantics are specified in `prompt.md` sections 14, 17-19, 23-28, 29-31, 37. Follow them exactly (GRN → stock increase + (Dr Inventory / Cr GRNI); purchase invoice → Dr GRNI(or Inventory/Expense) + Dr Input VAT / Cr AP; delivery → stock decrease + reservation consumption + COGS captured on the delivery item; sales invoice → Dr AR / Cr Sales / Cr Output VAT and Dr COGS / Cr Inventory; receipts/payments allocate to invoices and update `receivedAmount`/`paidAmount` + status).
   Base currency is AED; foreign-currency documents store `exchangeRate` and post journals in base currency (`amount * exchangeRate`).

## Frontend rules (client/)
Defined by the shell agent in `client/README-SHELL.md` after it builds the shell.
