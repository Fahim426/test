# Fortune 7 working demo

The costs, prices, stock, customer names and transactions added for this presentation are fictional. Both interfaces display a DEMO DATA badge. The company TRN remains blank. Existing records were preserved; this is not migrated Tally data.

Open Modern at http://localhost:5174 or Classic at http://localhost:5173. Local demo login: admin / admin123.

## Presentation walkthrough

1. Home > Dashboard: show sales, stock, receivables, trends and pending workflow stages.
2. Inventory > Products: 10 machines with photos and sample cost/selling prices. Open Stock by Warehouse and History on a product.
3. Reports > Sales Reports > Branch Performance: use From 2026-10-20 and To 2026-11-19 to see the complete demonstration period. Revenue and gross profit exclude VAT. Stock value is a current snapshot, independent of the transaction date filter.
4. Inventory > Sales Invoice: 8 posted invoices: 3 fully paid, 3 partially paid, 2 unpaid. The first demo Dubai invoice has a complete quotation > order > picking > packing > delivery > invoice chain. Print it to show the machine photographs.
5. Finance > Receipts / Payments: six customer receipts and two supplier payments, allocated to their invoices.
6. Inventory > Quotation / Sales Order: progress a draft quote, sent quote, order awaiting approval, reserved order or draft delivery through the usual actions.
7. Inventory > Stock Transfer: one completed Dubai-to-Sharjah machine transfer.
8. AMC > AMC Contracts: active, expiring within 30 days and expired examples, each with a sample serial number and four service visits. Contract fees are AMC commercial values; they are not posted service invoices or actual service-cost entries.

## Verified figures

All values below are fictional AED amounts. Sales and gross profit exclude VAT.

| Branch | Sales invoices | Sales revenue | Cost of goods sold | Gross profit |
| --- | ---: | ---: | ---: | ---: |
| Abu Dhabi | 2 | 500,000 | 380,000 | 120,000 |
| Dubai | 2 | 496,650 | 377,000 | 119,650 |
| Ajman | 2 | 437,000 | 325,000 | 112,000 |
| Sharjah | 2 | 325,000 | 243,000 | 82,000 |
| Total | 8 | 1,758,650 | 1,325,000 | 433,650 |

- 10 catalogue products; 10 machine units sold; 70 units remain across branches.
- Stock value: AED 9,175,000.
- Customer outstanding: AED 788,891.25.
- Supplier outstanding: AED 866,775.
- Five purchase orders, five goods receipts, five purchase invoices. Four are dated in the preceding month; the current-month example PI-2026-00005 is dated 2026-11-19 for AED 188,000 plus AED 9,400 VAT. Today's Purchase and Monthly Purchase show AED 197,400 including VAT.
- 38 balanced journals and 52 stock movements.

## Checks and repeatability

Every journal balances. Stock quantities match their movement ledger. Reservations match active orders. Inventory asset value matches stock valuation. AR/AP control accounts match unpaid invoice balances. Branch totals reconcile and branch filtering works.

From the server directory, run:

    node -r dotenv/config node_modules/tsx/dist/cli.mjs scripts/seed-fortune7-activity.ts

The script is restricted to the isolated local database on port 3307. It saves a business-data snapshot and step checkpoint under .local-run, uses the real REST posting/approval workflows, and records demo.fortune7.activity.v1 when complete. Re-running a completed seed does nothing; there is no force/reset flag. Do not run the older automotive seed-demo.ts for this customer.

## Implemented upgrades and next development

Machine Serial Register, in-app Reminder Centre, employee-attributed field history for supported records, and issued PDF archives are now available in both interfaces. See [fortune7-upgrades.md](fortune7-upgrades.md) for usage, coverage and practical limits.

The next substantial business feature is service-job costing: technician time, travel, stock-issued parts and subcontract charges, with actual AMC profit per machine. Mandatory serial scanning, returns/reversal integration, external email/WhatsApp delivery and field history for the remaining modules are further extensions.

Tally migration, real opening balances and stock, branch access review, tax/accounting validation and customer acceptance remain separate go-live work.
