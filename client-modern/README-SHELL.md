# SmartSpare ERP - Client shell contract (read before writing any screen)

Stack: React 18 + Vite + TypeScript (strict) + Tailwind 3 + lucide-react + @tanstack/react-query/table + zustand + react-hook-form + zod + axios + recharts.
Path alias: `@/` = `client/src/`.

```
cd client
npm install
npm run dev      # http://localhost:5173  (proxy /api -> http://localhost:4000)
npm run build    # tsc --noEmit + vite build  (must stay green)
```
Server: `cd server && npm run dev` (port 4000). Login `admin` / `admin123`.

## 1. How the shell works

Title bar (company, global search Ctrl+K, user menu) -> module tab strip (HOME / FINANCE / INVENTORY / REPORTS / DIMENSIONS / ADMIN) -> ribbon (data-driven, `src/ribbon/ribbonConfig.ts`, collapsible) -> workspace tab bar -> breadcrumb -> screen area -> status bar.

* Every ribbon button opens a **screen id** in a workspace tab. List screens open once (`instanceKey = screenId`); **document** screens (`*-form`) open one tab per document (`screenId:id`) or one per "new" draft.
* All open tabs stay mounted (hidden with `display:none`) so unsaved form state survives tab switches. Tabs are persisted in localStorage and restored on reload (screens must therefore re-fetch from `params`, never rely on in-memory state passed at open time).
* Each tab is wrapped in an error boundary; a crashing screen never breaks the shell.
* A ribbon id without a registered screen renders `PlaceholderScreen` ("Screen not available yet"), so the app works at every stage.

## 2. Screen registry: `*.screen.tsx`

Any file matching `src/screens/**/*.screen.tsx` is auto-collected (`import.meta.glob`, eager). It **must** `export default` an array:

```tsx
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { ShoppingCart } from 'lucide-react';

function PurchaseOrdersScreen(props: ScreenProps) { ... }

export default [
  { id: 'purchase-orders', title: 'Purchase Orders', icon: ShoppingCart, component: PurchaseOrdersScreen, permission: 'purchase_order' },
  { id: 'purchase-order-form', title: 'Purchase Order', component: PurchaseOrderForm, multiInstance: true, permission: 'purchase_order' },
] satisfies ScreenDef[];
```

```ts
interface ScreenProps { params: { id?: number | string; [k: string]: unknown }; tabId: string; instanceKey: string }
interface ScreenDef { id: string; title: string; icon?: LucideIcon; component: ComponentType<ScreenProps>;
                      multiInstance?: boolean;   // default: true for ids ending in "-form"
                      permission?: string }      // 'purchase_order' => needs purchase_order:view ; or 'module:action'
```
Duplicate ids log a console warning (last one wins) - keep ids unique. **Use only your own `src/screens/<area>/` folder** to avoid merge clashes (purchase/, sales/, inventory/, finance/, reports/).

Id conventions: list screen `purchase-orders`, document screen `purchase-order-form` (params `{ id? }`; `copyFrom` is set when a tab was duplicated). Convert-from-source: open the form with extra params, e.g. `{ fromId: 12, fromType: 'PURCHASE_ORDER' }` - or call the server conversion endpoint, then open the created document.

Screens root element should fill the tab: use `h-full` / `flex flex-col` (the tab container is `absolute inset-0 overflow-auto`). DataTable and DocumentLayout already do this.

## 3. Workspace API (`src/store/workspace.ts`)

```ts
const ws = useWorkspace();
ws.open({ screenId: 'purchase-order-form', params: { id: 12 }, title: 'PO-2026-00012' }) // returns tabId; activates existing instance if present
ws.close(tabId) ; ws.closeAll() ; ws.reopenLast() ; ws.pin(tabId) ; ws.refresh(tabId) /* remounts */ ; ws.duplicate(tabId)
ws.setTitle(tabId, 'PO-2026-00012')      // after load
ws.setDirty(tabId, true)                 // shows an amber dot + confirm on close
ws.retarget(tabId, { id: 99, title: 'PO-2026-00099' }) // after creating a new document: rebinds the tab to the saved record
const openScreen = useOpenScreen(); openScreen('purchase-order-form', { id: 12 }, 'PO-2026-00012');
import { openScreen } from '@/store/workspace'  // imperative version outside React
```
`useDocument(..., { tabId })` already calls `setTitle`/`retarget` for you.

## 4. Auth / permissions

`useAuth()` (`src/store/auth.ts`, persisted): `user {id, username, fullName, role, branchId, permissions[]}`, `login`, `logout`. `permissions` is `['*']` for Admin, else `"module:action"` strings (module keys = server `lib/permissions.ts`: `purchase_order`, `sales_invoice`, `stock`, `receipts`, `journal`, `users`, ...; actions: view create edit delete approve reject post cancel print export).
```ts
const can = usePermission();  can('purchase_order', 'create')  // '*' => true
```
Use it to hide/disable buttons. The server is the authority (403 -> toast with server message).

## 5. API layer (`src/lib/api.ts`)

* `api` axios instance (baseURL `/api`, Bearer token, **401 -> refresh-token flow with request queue -> logout on failure**).
* `unwrap(api.get(...))` -> data. `apiError(e)` -> string for toasts (server `error` + zod field errors). `apiFieldErrors(e)` -> `{field: msg}` to feed `setError`.
* `Paged<T> = { rows, total, page, pageSize }` for list endpoints.
* `saveBlob(blob, filename)` for downloads. `downloadExport({title, columns, rows, format})` + `printRows(...)` in `src/lib/export.ts` (POST `/api/export/rows`).
* Toasts: `import { toast } from '@/store/toast'; toast.success('Saved'); toast.error(apiError(e))`.

## 6. Formatting (`src/lib/format.ts`, `src/lib/calc.ts`)

`fmt.money(v, 'AED'?)` -> `1,234.50`; `fmt.qty(v)` (<=3dp, no trailing zeros); `fmt.num(v, dp)`; `fmt.percent`; `fmt.date(v)` -> `05-Mar-2026`; `fmt.dateTime`; `fmt.isoDate(v)` -> `yyyy-MM-dd` for `<input type=date>`; `fmt.status('PARTIALLY_RECEIVED')` -> `Partially Received`; `today()` -> iso; `r2()`.
`calcLine({qty, rate, discount, vatRate})` -> `{gross, net, vatAmount, amount}`; `calcTotals(lines, roundOff)` -> `{subtotal, discount, vatAmount, roundOff, total}` (identical maths to the server: `discount` is an absolute amount per line, VAT rate comes from the line). The server recomputes authoritatively.

## 7. UI kit (`@/components/ui`)

`Button` (variant primary|default|danger|ghost, size sm|md|lg, `icon`, `loading`), `IconButton`, `Input`, `NumberInput` (right aligned), `DateInput`, `Textarea`, `Select` (`options`, `placeholder`), `Checkbox`, `Field` (label + error + hint + required), `Badge`, `StatusBadge status="PARTIALLY_RECEIVED"`, `Modal`, `ConfirmDialog`, `Toaster` (mounted once), `Tabs` (inner tabs, all panes stay mounted), `Toolbar`, `ToolbarSep`, `Spinner`, `Skeleton`, `LoadingBlock`, `EmptyState`, `ErrorState`, `SectionHeader` (the "-----PO INFORMATION-----" band), `Panel`. Global CSS helpers: `.ctl` (input look, h-7), `.tb-btn`, `.grid-th`, `.grid-td`.
Design rules: 12-13px text, h-7 controls, 1px borders, 2-4px radius, `brand` colour (#1f5fae) = `text-brand`, `bg-brand`, `bg-brand-light`, `bg-app-head`, `border-app-border`. No gradients/animations/big cards.

## 8. DataTable (`@/components/DataTable`) - THE list component (spec 51)

```tsx
<DataTable<PORow>
  tableKey="purchase-orders"            // persists column visibility + page size per table
  url="/purchase-orders"                // GET url?page&pageSize&search&sort&dir&<filters>  -> Paged<T>   (or fetcher={(params) => Promise<Paged<T>>})
  queryKey="purchase-orders"            // optional; invalidate with qc.invalidateQueries({ queryKey: ['table', 'purchase-orders'] })
  filters={{ status, from, to }}        // extra query params (page resets on change)
  columns={[ { key: 'docNo', header: 'PO No', filter: 'text' },
             { key: 'supplier.name', header: 'Supplier' },                 // nested path
             { key: 'total', header: 'Amount', type: 'money', total: 'sum' },
             { key: 'status', header: 'Status', type: 'status', filter: { type: 'select', options } },
             { key: 'x', header: 'Custom', cell: (r) => <b>{r.x}</b>, sortable: false } ]}
  rowActions={[{ label: 'Open', icon: ExternalLink, onClick: (r) => ..., hidden?, disabled?, danger? }]}   // or (row) => RowAction[]
  bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: (rows, clear) => ... }]}          // enables checkboxes
  onRowDoubleClick={(r) => open('purchase-order-form', { id: r.id }, r.docNo)}     // also Enter
  exportName="Purchase Orders"
  toolbarExtras={<Button .../>}          // after the search box (New button, status filter selects...)
  totals={{ total: 12345.5 }}            // optional server totals row (keyed by column key)
  zebra defaultPageSize={50} defaultSort={{ key: 'docDate', dir: 'desc' }} selectable getRowId height="h-full" noSearch searchPlaceholder
/>
```
Column: `type` = text|money|qty|number|percent|date|datetime|status|boolean (auto formatting + right alignment), `accessor`, `cell`, `width`, `align`, `sortable` (default true -> sends `sort=<key>&dir=asc|desc`), `hidden` (hidden by default), `total: 'sum' | (rows) => node`, `exportValue`, `noExport`, `filter` + `filterParam`:
`filter:'text'` filters the loaded page client-side (or sent as `?<filterParam>=` when `filterParam` is set); `filter:{type:'select',options}` sends `?<filterParam ?? key>=value`; `filter:'date'` sends `?from=&to=` (or `<filterParam>From/To`).
Keyboard (focus the table by clicking it): Up/Down active row, Enter = double-click action, Space toggles selection, PageUp/PageDown change page, Home/End, Ctrl+F focuses search. Export dropdown: CSV / Excel / PDF via `POST /api/export/rows` (currently loaded rows, visible columns) and Print (iframe print).

## 9. Document form kit (`@/components/doc`) - spec 52 / 49

Wrap the form body in react-hook-form's `<FormProvider {...form}>` (the grid reads the form from context).

* `DocumentLayout {title, docNo, status, actions, loading, error, aside?, icon?}` - title bar (doc no + status badge), toolbar slot, scrolling body. `DocAction` (toolbar Button with `hidden`), `DocActionSep`.
* `HeaderSection {title, columns=4}` field grid (put `Field` children inside), `DocSection {title, right?}` generic titled block, `TotalsSection {totals, currency?, extra?, roundOffInput?}`, `NotesSection {fields:[{label, props: register('remarks')}]}`.
* `LineItemsGrid {name='items', columns, newLine, readOnly, warehouseId, priceField, onProductPick, footerExtra}` - editable dense grid on `useFieldArray`. Column `{key, header, type: product|text|number|money|qty|percent|select|date|readonly|computed, width, options, compute(line,i), format, editable(line,i), total, required}`.
  `product` column = typeahead on `GET /api/products/lookup?q=` (code/OEM/alternate/barcode/name, shows stock). Default pick fills `productId, productCode, oemNumber, description, unit, rate(priceField), vatRate, available, onHand, reserved, product`. Override with `onProductPick(p, index, form)`.
  Keys: Enter = next cell (adds a line after the last cell), Shift+Enter previous, Ctrl+Enter add line, Ctrl+Del remove line, Tab natural. Numeric cells store numbers (empty -> 0), so zod: `z.number()`.
* `ProductPicker` standalone typeahead (`onPick(product)`), `ProductLookup` type.
* `AttachmentsSection {docType, docId}` (UPPER_SNAKE docType; `/api/attachments`), `ApprovalSection {approval, onChanged}` (`approval` = the `approval` object on `GET /<doc>/:id`; Approve/Reject shown when the user's role matches the pending step), `AuditSection {doc}` (createdAt/updatedAt/...), `DocumentFlow {docType, docId}` (`GET /api/doc-flow/:type/:id`; stages clickable -> opens the document via `lib/docRoutes.ts`; shows Created From / Converted To / Related).
* `useDocument<T>(url, id, { tabId })` (`@/hooks/useDocument`): `data` (GET `/:id`), `isNew`, `isLoading`, `error`, `save(body)` (POST or PUT; toast, invalidates tables/flow/dashboard, retargets the tab on create), `saving`, `transition('submit'|'approve'|'reject'|'post'|'cancel'|'close', body?)` -> `POST /:id/<action>`, `convert('create-goods-receipt')` -> returns the created document (then `ws.open({screenId:'goods-receipt-form', params:{id}})`), `remove()`, `refetch()`.
* Pattern: zod schema -> `useForm({ resolver: zodResolver(schema), values: doc.data, defaultValues })` -> `doc.save(values)`. Selects from `useQuery` of master endpoints. Lock inputs (`disabled`) unless `doc.isNew || status === 'DRAFT'`.
* **Reference implementation (list + form pair, compiles): `src/examples/ExamplePurchaseOrder.tsx`. Copy it.**
* `src/lib/docRoutes.ts`: `docRoutes[DOC_TYPE] -> {label, list, form}`; `formScreenOf('SALES_ORDER')` -> `'sales-order-form'`; `normalizeDocType`.

## 10. MasterDataScreen (`@/components/MasterDataScreen`)

Config-driven CRUD (DataTable + modal form + zod derived from the field config, delete confirm, active toggle):
```tsx
const cfg: MasterConfig = { tableKey: 'brands', title: 'Brand', url: '/brands', permission: 'dimensions',
  fields: [ { key: 'code', label: 'Code', required: true, readOnlyOnEdit: true }, { key: 'name', label: 'Name', required: true },
            { key: 'country', label: 'Country' }, { key: 'isActive', label: 'Active', type: 'checkbox' } ] };
export default [{ id: 'brands', title: 'Brands', component: masterScreen(cfg) }] satisfies ScreenDef[];
```
Field `type`: text|number|select|checkbox|textarea|date|email; selects take `options` or `optionsUrl` (+`optionLabel`, `optionsParams`, value = id as number), `listKey` for nested list display (`branch.name`), `span`, `hideInList`, `min/max`, `default`. Config also has `columns`, `extraColumns`, `renderExtra(row)` (sub-grid under the form when editing), `toPayload`, `rowActions`, `toolbarExtras`, `modalWidth`.

## 11. Global search & Part Lookup

Title-bar search (Ctrl+K), debounced `GET /api/search?q=` -> grouped results (`{groups:[{type,typeLabel,items:[{id,no,label,...}]}]}`); picking opens `formScreenOf(type)` with `{id}` (products -> `product-form`). Enter on an exact part number (or when nothing is highlighted) opens screen `part-lookup` with params `{ number }` -> `GET /api/search/part/:number`.

## 12. Screen id table (EVERY ribbon button)

Owner key: **SHELL** = implemented by the shell agent (this client scaffold); **PURCHASE / SALES / INVENTORY / FINANCE / REPORTS** = left for the agent building that area (placeholder shown until then). Form screens (`*-form`) are not on the ribbon; they are opened from lists/search/doc-flow with `{id}`.
"Form id" = the document screen the list opens.

### HOME (owner SHELL)
| screenId | Purpose | API |
|---|---|---|
| dashboard | KPI tiles, charts, tables, workflow strips | GET /dashboard |
| favorites | user's pinned screens | GET/POST/DELETE /favorites |
| quick-actions | shortcut grid (New SO, New PO...) | - |
| pending-approvals | my pending approvals, approve/reject | GET /approvals?status=PENDING&mine=1 ; POST /approvals/:id/approve\|reject |
| recent-documents | latest documents | GET /recent-documents |
| part-lookup | part drill-down (stock, history, suppliers, customers) | GET /search/part/:number |

### FINANCE (owner FINANCE)
| screenId (form id) | Purpose | API |
|---|---|---|
| chart-of-accounts | account tree + CRUD | /accounts |
| bank-receipts (bank-receipt-form) | bank receipt vouchers, allocate to invoices | /receipts (voucherType RECEIPT, mode BANK) |
| cash-receipts (cash-receipt-form) | cash receipt vouchers | /receipts |
| bank-payments (bank-payment-form) | bank payment vouchers | /payments |
| cash-payments (cash-payment-form) | cash payment vouchers | /payments |
| journal-vouchers (journal-voucher-form) | manual journals | /journals |
| debit-notes (debit-note-form) | debit notes | /notes |
| credit-notes (credit-note-form) | credit notes | /notes |
| opening-balances (opening-balance-form) | opening balances | /journals or /accounts (per backend) |
| general-ledger | account ledger report | /ledger |
| bank-book, cash-book, day-book | registers | /registers |
| customer-statement, ar-aging, outstanding-invoices, overdue-invoices | receivables | /receivables |
| supplier-statement, ap-aging, outstanding-bills | payables | /payables |
| trial-balance, profit-loss, balance-sheet, cash-flow | final reports | /finance/* |
| vat-report | VAT return report | /vat |
Also register generic `receipt-voucher-form` / `payment-voucher-form` (doc-flow & search link to these with `{id}`): they should render the matching bank/cash voucher form.

### INVENTORY > Products (owner INVENTORY)
| screenId | Purpose | API |
|---|---|---|
| products (product-form) | product master list/form (OEM + alternate numbers, vehicles, prices, stock) | /products |
| vehicle-compatibility | make/model/year compatibility maintenance | /products (vehicles) |

### INVENTORY > Sales (owner SALES)
| screenId (form id) | API |
|---|---|
| sales-enquiries (sales-enquiry-form) | /sales-enquiries |
| sales-quotations (sales-quotation-form) | /sales-quotations |
| proforma-invoices (proforma-invoice-form) | /proforma-invoices |
| sales-orders (sales-order-form) | /sales-orders |
| pickings (picking-form) | /picking-lists |
| packing-lists (packing-list-form) | /packing-lists |
| delivery-notes (delivery-note-form) | /delivery-notes |
| sales-invoices (sales-invoice-form) | /sales-invoices |
| sales-returns (sales-return-form) | /sales-returns |

### INVENTORY > Purchase (owner PURCHASE)
| screenId (form id) | API |
|---|---|
| material-requests (material-request-form) | /material-requests |
| purchase-requisitions (purchase-requisition-form) | /purchase-requisitions |
| purchase-enquiries (purchase-enquiry-form) | /purchase-enquiries |
| supplier-quotations (supplier-quotation-form) | /supplier-quotations |
| comparative-statements (comparative-statement-form) | /comparative-statements |
| purchase-orders (purchase-order-form) | /purchase-orders |
| goods-receipts (goods-receipt-form) | /goods-receipts |
| purchase-invoices (purchase-invoice-form) | /purchase-invoices |
| purchase-returns (purchase-return-form) | /purchase-returns |
| import-requests (import-request-form) | /import-requests |
| import-purchase-orders (import-purchase-order-form) | /import-orders (+ /supplier-proformas) |
| goods-in-transit (import-shipment-form) | /goods-in-transit, /import-shipments |
| landed-costs (landed-cost-form) | /landed-costs |

### INVENTORY > Stock (owner INVENTORY)
| screenId (form id) | API |
|---|---|
| stock-balances | /stock (balances) |
| stock-ledger | /stock (ledger) |
| stock-transfers (stock-transfer-form) | /stock-transfers |
| stock-adjustments (stock-adjustment-form) | /stock-adjustments |
| opening-stock (opening-stock-form) | /stock (opening) |
| stock-counts (stock-count-form) | /stock-adjustments or /stock (count) |

### INVENTORY > Reports & Order Management (owner INVENTORY / REPORTS)
stock-valuation, warehouse-stock, low-stock, stock-movement, stock-aging, dead-stock -> `/reports/run/:key` (GET `/reports/catalog` lists keys).
reservations, pending-sales-orders, pending-deliveries, pending-po, pending-grn -> list views over `/stock` reservations / `/sales-orders`, `/delivery-notes`, `/purchase-orders`, `/goods-receipts` with pending filters.

### REPORTS (owner REPORTS)
report-builder (`/report-builder`), report-list (`/reports/catalog`), report-widgets, dashboard (reuses the SHELL dashboard).
Financial: trial-balance, profit-loss, balance-sheet, cash-flow, general-ledger, customer-statement, supplier-statement, ar-aging, ap-aging, vat-report (shared with FINANCE ids - register each id once, FINANCE owns them).
Inventory: stock-balances (Stock Summary), stock-ledger, stock-valuation, warehouse-stock, low-stock, dead-stock, fast-moving, slow-moving, stock-movement, stock-aging.
Sales: sales-register, sales-by-customer, sales-by-product, sales-by-brand, salesman-sales, gross-profit, invoice-register, sales-return-report.
Purchase: purchase-register, supplier-purchase, product-purchase, purchase-by-brand, pending-po, pending-grn, purchase-return-report, import-purchase-report.
All via `GET /reports/run/:key` (see `server/src/services/report-registry.ts`).

### DIMENSIONS (owner SHELL)
companies (`/company`), business-units, branches, warehouses (+ locations zone/rack/shelf/bin sub-grid), categories (parent), brands, product-groups, product-types, units, areas, salesmen, territories, payment-terms, currencies, vat-codes, customers (+ `customer-form`), suppliers (+ `supplier-form`).

### ADMIN (owner SHELL)
users, roles, permissions (matrix), document-numbering, approval-workflows, system-settings, audit-logs, email-settings, sms-settings, data-import, data-export, backup.

## 13. Rules of the road

1. Never put fetch logic in global state; use react-query (`useQuery`/`useMutation`) and invalidate `['table']` (+ your keys) after mutations (`useDocument` does it).
2. Money = number in forms, formatted with `fmt.money` for display; dates = ISO strings (`yyyy-MM-dd` in inputs).
3. Open other documents via `useOpenScreen()` / `useWorkspace().open`, never with `<a href>` / router navigation.
4. Mark forms dirty with `ws.setDirty(tabId, form.formState.isDirty)` (effect) so closing a tab warns.
5. Show server errors with `toast.error(apiError(e))`; the DataTable already shows list errors.
6. Keep files in your own `src/screens/<area>/` folder; do not edit `components/`, `store/`, `lib/` without telling the shell owner (add new shared pieces under `src/components/<area>/`).
