# Fortune 7 traceability, reminders and edit history

These upgrades are available in Classic and Modern. Sample serials and reminder examples are fictional demo records; the existing stock and accounting figures are unchanged.

## Machine Serial Register

Open Inventory > Machine Serial Register. Five demo machines show a new receipt, an installed/delivered machine with its invoice and AMC, two legacy installations supported by their AMC records, and a completed Dubai-to-Sharjah transfer.

Register a serial against a posted goods receipt or opening stock document. For an existing installed machine, choose the matching AMC. For a machine already sold, choose its posted delivery note during registration. Serial numbers are normalized and unique. Source document quantities, warehouse stock quantities, delivery quantities and completed transfer quantities limit the number of assignments.

Open View / Trace to record a completed transfer, posted delivery, installation/warranty dates or a matching AMC. Product, customer and serial must match when linking AMC. Events record the signed-in employee and notes. Concurrent stale updates are rejected and must be refreshed.

This register adds serial assignments to existing posted transactions; it does not post a second stock movement. Serial enrollment remains optional. Mandatory serial scanning inside receipt/dispatch posting, customer returns/repairs, and automatic reversal of serial assignments on cancelled source documents are separate workflow extensions. Review source documents when reversing a transaction already used in the register.

## Reminder Centre

Open Home > Reminder Centre or the alarm-clock icon at the top. Reminders refresh every minute while the application is open and are computed from current source records.

- AMC renewal: active contracts ending within the user's notice period, including overdue active contracts.
- Service visits: scheduled or in-progress visits on active contracts within the service notice period.
- Customer/supplier payments: dated, unpaid or partly paid invoices within the payment notice period. An invoice without a due date cannot generate a due-date reminder.

Only source modules the user can view contribute alerts. Personal notice periods, acknowledgement and snooze states are stored per user. Changed due dates or outstanding amounts generate a fresh occurrence. Show acknowledged / snoozed to restore a reminder. Acknowledgement does not settle an invoice or complete a service visit; perform those actions on the source document.

Delivery is in-app. Email, SMS and WhatsApp dispatch are not connected; provider details, recipients, templates and scheduling would be needed for those channels. No external messages were sent.

## Detailed edit history

Edit History panels are included on supported business forms. Admin > Audit Logs > View details also shows Field / Previous value / New value alongside employee, time and optional reason.

Captured editable records: products (including alternate numbers and compatibility), customers, suppliers, sales enquiries, quotations, proformas, orders, delivery notes, sales invoices, local purchase orders, goods receipts, purchase invoices, stock adjustments/transfers, AMC contracts/visits, employee records, attendance, leave and payroll. Machine-unit events and reminder preference changes have structured audit entries too.

Snapshots and revision entries are captured in the same transaction as the update, with record locking to preserve the before/after chain during concurrent edits. No-op field saves do not generate fake changes. Earlier audit entries cannot reconstruct past values, and modules outside this list retain their existing audit behavior. Generic master/configuration changes and the remaining import/RFQ workflows need a separate extension for equivalent field history.

## Issued PDF archives

The first PDF generation for a posted sales or purchase invoice creates an archived original, including the product photographs used in that copy. Subsequent downloads return the same bytes even when the company/product/photo later changes. Drafts continue to render dynamically. Cancellation of a document does not rewrite its archived original issued copy; check the current document status separately.

Back up server/uploads/issued-invoices and product-photos together with the database. A missing original is reported as an error rather than silently recreated with different content. New copies cannot reconstruct what an invoice looked like before this upgrade if it was never archived.

## Implementation and checks

The repository contract freezes the database schema. This demo stores versioned machine records, reminder preferences/state and archive pointers as namespaced SystemSetting records, and revisions in AuditLog. Generic settings edits reject these reserved namespaces. Files use generated filenames under the upload directory. A production rollout should migrate the registry to dedicated indexed relational tables, add serial enforcement/reversal to stock posting, and extend audit coverage to remaining modules.

Run server/scripts/seed-fortune7-traceability.ts from the server directory to install the demo serials and employee-attributed price-change example. The original sample selling price is restored after that example. Existing examples are reused on subsequent runs.

Verified: duplicate serial normalization; source quantity caps; invalid/stale events; delivery/invoice/AMC links; role-filtered reminders; snooze/acknowledge/restore; preferences; concurrent field edit history; concurrent first PDF downloads; PDF immutability after product edits; unchanged and reconciled inventory and accounting; both client builds; both interfaces' register/reminder/history flows.

A repeatable backend regression check is available from the server directory: `node scripts/verify-fortune7-upgrades.cjs`. It is guarded to localhost database port 3307, uses temporary QA masters/users and removes them afterwards. Existing demo transactions are not reposted.
