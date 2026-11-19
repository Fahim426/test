# Fortune 7 demo setup

The local demo uses **Fortune 7 Printing Equipment Trading LLC**, UAE / AED, with a blank company TRN. The address and contact details came from the Fortune 7 contact page; the company spelling follows the customer's confirmation.

## Catalogue

- Ten supplied machine photographs are retained in the root products folder. Compact WebP files and JPEG print copies are in server/assets/products; catalog.json maps codes to files.
- GX-1530AB is one product. GX-6020AB is its searchable alternate code.
- The base catalogue starts with zero prices and stock. The separately authorized working demo now supplies clearly labelled fictional costs, selling prices, stock and transactions. Warranties and detailed specifications remain unconfirmed. See fortune7-demo-walkthrough.md for the presentation figures.
- Masters cover printing machines, finishing equipment, industrial machinery, inks, materials, printheads and equipment spare parts. The ten sample machines are under Industrial Machinery / Fiber Laser Machines.
- Internal vehicle compatibility field names and endpoints remain for compatibility; both interfaces display equipment terminology. Link compatible consumables/parts to equipment as required.

## Photos and invoices

Open Inventory > Products, open a saved product, and use Choose / replace photo. JPEG, PNG and WebP inputs up to 5 MB are decoded, resized and converted on the server. Uploads are saved immediately and attributed to the signed-in employee in the audit log. The product edit permission controls uploads; the view permission controls photo access.

Sales and purchase invoice PDFs include a photo per product line and repeat the table heading across pages. Existing PDF / print actions use this renderer. Missing photos display a placeholder. Keep server/assets/products and server/uploads/product-photos with the application and include uploads with database backups. Draft PDFs use the current product photos. The first PDF generated for a posted invoice is archived; subsequent downloads preserve that original copy. See fortune7-upgrades.md.

The PDF under output/pdf is a draft layout preview with sample amounts, not actual pricing or a posted invoice. Temporary verification records have been removed.

## Repeatable setup

Run server commands from the server directory. Node must support the installed sharp version (Node 20.9+ or a compatible newer LTS).

The existing seed now creates the Fortune 7 catalogue for a fresh database and does not create the old automotive products or sample AMC contracts. Re-running the catalogue helper skips existing products and preserves prices and stock. Follow the repository migration contract; no schema changes are required for photos.

The one-time scripts/setup-fortune7-demo.ts script is restricted to the isolated local demo database on port 3307. It refuses to replace a catalogue after trading, inventory or ledger activity begins, verifies the original demo products and AMC records, writes a JSON backup under .local-run, then replaces only the original demo catalogue and maintenance samples. It intentionally refuses a second run after conversion.

The original demo customers, suppliers, employees and branch configuration remain sample records; they are not the customer's migrated data. Real opening balances, stock, customer/supplier records, branch details and AMC contracts still need the verified customer backup and agreed migration mapping. Fictional activity for the working demo is documented in fortune7-demo-walkthrough.md.
