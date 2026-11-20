# Reusing the ERP for customers

This is one maintained codebase with configuration per deployment. Each customer needs a separate database, upload directory, JWT secrets, hosting configuration and backups. This work does not introduce shared-database multi-tenant SaaS or per-customer source forks. The Fortune 7 demo records remain in the current database.

## Switch features on and off

1. Sign in with settings edit permission.
2. Open **ADMIN > Company & Modules**. There is also a Company & Modules shortcut in System Settings.
3. Check/uncheck Part numbers, Compatibility, AMC and service, HR, Machine serial tracking, Chat assistant or Product images.
4. Click **Save configuration**. The current interface updates immediately; other open sessions poll configuration every 30 seconds. Refresh to pick up changes sooner.
5. Switch a feature on again to use its existing records. Turning it off does not delete records, reverse invoices or alter inventory/ledger entries.

Screens, restored tabs and direct module APIs respect these switches. Optional part/compatibility fields are omitted from product saves while off, preserving their stored values. Permissions are still required when a feature is on. The modules are company/deployment switches, not per-user entitlements; continue using Roles for individual access.

Core sales, purchases, inventory and accounting stay enabled because their posting and document workflows depend on one another. Existing general reports and searches may still include historical information from a disabled module; switches are product configuration, not a substitute for authorization or data deletion.

## Branding and terminology

In Company & Modules, set the company name, address, contacts, TRN (optional), application name and product/compatibility labels. Save these fields first, then Upload company logo (JPEG/PNG/WebP, up to 5 MB). Logo uploads are saved immediately. New PDFs, report prints and Excel reports use that deployment's company logo; the app header and assistant use configured branding. Already archived issued invoices stay byte-for-byte originals.

Equipment trading, Spare parts and General trading preset buttons change the draft terminology and switches. Review the draft and save to apply. They do not replace products or create transactions. HR and assistant choices remain individually configurable. Product label changes the product form title; standard transaction/report fields continue using generic Product/Description headings.

Signed-in branding comes from the authenticated, whitelisted /api/product-config endpoint (it does not expose general settings or secrets). A browser remembers only public branding for the next login. For a first visit before login, configure each frontend's .env.local using .env.example (VITE_APP_NAME, VITE_COMPANY_NAME and optional VITE_LOGO_URL), and restart Vite/rebuild. These are public display values, not secrets. The current demo's .env.local retains Fortune 7 branding. Company settings are stored in the existing Company and SystemSetting models; no schema change is required.

The base accounting currency is intentionally read-only here. Changing a name/logo must not relabel existing ledger balances. Existing master, role, numbering and approval screens remain the places to configure branches/warehouses, permissions, sequences and approvals.

## New customer setup (developer/operator)

1. Provision a NEW empty database using the reviewed existing ERP schema. Do not run the Fortune 7/demo seed scripts for a customer, and do not point setup at the demo database.
2. Use a separate server environment with DATABASE_URL, unique JWT_SECRET/JWT_REFRESH_SECRET, UPLOAD_DIR, ports and CLIENT_ORIGIN. Do not share live upload/storage folders between customers. Generate the matching Prisma client and install locked dependencies.
3. Copy server/scripts/customer.example.json to a customer-specific file outside the public web folders. Set the company identity, app name, industry, base currency and reviewed VAT rate. Country and accounting configuration require customer/accountant confirmation.
4. Set CUSTOMER_ADMIN_PASSWORD to a unique password of at least 12 characters through your normal secret provisioning; do not commit it.
5. From server run:

```powershell
node -r dotenv/config node_modules/tsx/dist/cli.mjs scripts/setup-customer.ts --config <path-to-customer.json>
```

Setup checks EVERY existing Prisma table and refuses a non-empty database. There is no force/reset option. It creates one admin, company, main branch/warehouse, basic units/payment terms/VAT, a starting chart of accounts, document numbering and industry flags. It creates no demo products, parties, AMC contracts, employees, stock or transactions. Provision the schema before running; this is data onboarding, not a schema migration runner.

6. Configure frontend first-visit branding, build/deploy both desired interfaces and sign in. Use Company & Modules to upload the logo and review the switches. Create branch-specific user roles and review accounting masters, VAT, numbering and approval rules. No approval thresholds are invented during generic setup; configure the customer's approval policy before use.
7. Import reviewed customer data and opening balances, reconcile accounting/stock and perform acceptance tests before go-live.

Fresh setup refuses existing data and is not an automated Tally migration. Historical transaction imports, jurisdiction-specific accounting validation, subscriptions/licensing and shared SaaS tenant isolation are separate work.

## Implementation and checks

- server/src/services/product-config.ts: typed defaults, safe configuration DTO, local logo and API feature mapping.
- server/src/modules/00-product-config.ts: authenticated configuration routes and first-mounted feature guard; writes require settings edit permission and are audited.
- client*/src/screens/admin/company-configuration.screen.tsx: matching administrator controls.
- client*/src/hooks/useProductConfig.ts: whitelisted shared configuration and screen checks.
- server/scripts/setup-customer.ts: empty-database-only onboarding.

For a new optional module, add a key/default, strict validation, UI option, screen mapping, backend route mapping and assistant query checks together. Keep backend checks even when the UI hides a feature. Use one deployment per customer until a separately tested tenant-isolation architecture is built.

## Verified in the demo

- `cd server; node scripts/verify-product-config.cjs`: configuration permissions, validation, route guards (including case variants), assistant module restrictions, custom logo/report rendering and safe refusal to initialise an existing database. The test restores the original company/settings.
- Server typecheck, both frontend builds and existing assistant language/live checks.
