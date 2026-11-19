You are a Senior ERP Software Architect, Senior React.js Developer, Senior Node.js/Express Developer, MySQL Database Architect, Accounting System Architect, Inventory Management Expert, and Enterprise UI/UX Designer.

Your task is to design and build a complete production-ready ERP system for a SPARE PARTS TRADING COMPANY.

IMPORTANT:
I have attached reference screenshots from an existing ERP system called PACT Revenu.

Use the screenshots ONLY as a UX/workflow/reference for:
- Ribbon-style navigation
- ERP module organization
- Toolbar grouping
- Purchase flow
- Sales flow
- Finance flow
- Inventory flow
- Dimensions/master data
- Document workflow
- Dashboard organization
- Desktop ERP interaction

DO NOT copy the old application's branding, logo, exact graphics, proprietary styling, or source code.

Create a modern, clean, professional React ERP inspired by the workflow and information architecture shown in the screenshots.

==================================================
1. TECHNOLOGY STACK
==================================================

Frontend:
- React.js
- Vite
- TypeScript
- Tailwind CSS
- Lucide React icons
- React Router
- TanStack Query
- Zustand
- React Hook Form
- Zod
- Axios
- Recharts
- TanStack Table

Backend:
- Node.js
- Express.js
- TypeScript
- REST API
- JWT authentication
- Refresh tokens
- RBAC
- Zod validation

Database:
- MySQL 8+
- Prisma ORM

Other:
- PDF generation
- Excel export
- CSV export
- Printing
- File/document attachments
- Audit logs

Development:
- ESLint
- Prettier
- Environment variables
- Docker-ready
- Production-ready structure

==================================================
2. PRIMARY OBJECTIVE
==================================================

Build an end-to-end ERP where:

PURCHASE
→ INVENTORY
→ SALES
→ ACCOUNTS

are fully integrated.

Do NOT build isolated CRUD pages.

Every transaction must be connected to the next transaction.

Example:

Purchase Order
→ Goods Receipt
→ Inventory Increase
→ Purchase Invoice
→ Supplier Payable
→ Supplier Payment
→ Accounting Entry

Sales Order
→ Stock Reservation
→ Picking
→ Delivery
→ Inventory Reduction
→ Sales Invoice
→ Customer Receivable
→ Customer Receipt
→ Accounting Entry

==================================================
3. ERP MODULES
==================================================

Create the following main modules:

HOME
FINANCE
INVENTORY
REPORTS
DIMENSIONS
ADMIN

Top navigation must look like a professional desktop ERP ribbon.

Example:

---------------------------------------------------------
ERP LOGO / COMPANY NAME

HOME | FINANCE | INVENTORY | REPORTS | DIMENSIONS | ADMIN
---------------------------------------------------------

Under each tab, show grouped ribbon buttons.

The interface should resemble a modern enterprise desktop ERP.

Avoid:
- Huge modern SaaS cards
- Excessive rounded corners
- Excessive gradients
- Mobile-app style navigation
- Excessive animations

Use:
- Compact professional controls
- Light gray/white background
- Blue enterprise accent
- Thin borders
- Small professional icons
- Dense but readable tables
- Desktop-oriented layouts

==================================================
4. RIBBON NAVIGATION
==================================================

HOME ribbon:

Groups:

Dashboard
Favorites
Quick Actions
Pending Approvals
Recent Documents

FINANCE ribbon:

Chart of Accounts
Receipts
Payments
Journal Entries
General Ledger
Registers
Receivables
Payables
Final Reports

INVENTORY ribbon:

Products
Sales
Purchase
Stock
Reports
Order Management

REPORTS ribbon:

Report Builder
Report List
Dashboard
Widgets
Financial Reports
Inventory Reports
Sales Reports
Purchase Reports

DIMENSIONS ribbon:

Company
Business Unit
Branch
Warehouse
Category
Area
Salesman
Territory
Brands
Product Groups
Product Types
Customers
Suppliers
Payment Terms
Currencies
VAT

ADMIN ribbon:

Users
Roles
Permissions
Document Numbering
Approval Workflows
System Settings
Audit Logs
Email
SMS
Import
Export
Backup

==================================================
5. WORKSPACE / MULTI-TAB SYSTEM
==================================================

Under the ribbon create a desktop ERP workspace.

Example:

Favorites | Dashboard | Purchase Orders | Sales Invoice | Bank Book

Each opened screen becomes a tab.

Support:
- Open
- Close
- Refresh
- Pin
- Multiple instances where appropriate
- Close all
- Reopen recent
- Breadcrumbs

The user should be able to work on multiple documents without losing the current screen.

==================================================
6. HOME DASHBOARD
==================================================

Create a professional ERP dashboard.

Top KPI cards:

- Today's Sales
- Monthly Sales
- Today's Purchase
- Monthly Purchase
- Receivables
- Payables
- Stock Value
- Low Stock
- Pending Quotations
- Pending Purchase Orders
- Pending Deliveries
- Pending Payments

Add:

Sales chart
Purchase chart
Cash flow chart
Top selling products
Low stock products
Outstanding customers
Outstanding suppliers
Recent transactions

Also create visual document workflows.

==================================================
7. PURCHASE FLOW
==================================================

The purchase module must support LOCAL PURCHASE and IMPORT PURCHASE.

LOCAL PURCHASE FLOW:

Material Request
↓
Purchase Requisition
↓
Purchase Enquiry
↓
Supplier Quotation
↓
Comparative Statement
↓
Local Purchase Order
↓
Goods Receipt
↓
Local Purchase Invoice
↓
Supplier Payment

IMPORT PURCHASE FLOW:

Import Request
↓
Supplier Proforma Invoice
↓
Import Purchase Order
↓
Advance / LC / Payment
↓
Goods in Transit
↓
Shipment
↓
Import Goods Receipt
↓
Landed Cost
↓
Import Purchase Invoice
↓
Supplier Payment

==================================================
8. MATERIAL REQUEST
==================================================

Fields:

Request Number
Date
Requested By
Department
Business Unit
Warehouse
Required Date
Priority
Remarks
Items

Item fields:

Product
OEM Number
Description
Requested Quantity
Unit
Required Date
Remarks

Statuses:

Draft
Submitted
Approved
Rejected
Closed
Cancelled

==================================================
9. PURCHASE REQUISITION
==================================================

Purchase Requisition can be generated from Material Request.

Fields:

PR Number
Date
Department
Warehouse
Requested By
Priority
Items
Quantity
Required Date
Remarks

Allow:
- Approval
- Reject
- Convert to Purchase Enquiry

==================================================
10. PURCHASE ENQUIRY / RFQ
==================================================

Create supplier enquiry.

One enquiry can be sent to multiple suppliers.

Fields:

RFQ Number
Date
Required Date
Warehouse
Products
Quantities
Suppliers
Remarks

Supplier response must be recordable.

==================================================
11. SUPPLIER QUOTATION
==================================================

Supplier quotation fields:

Quotation Number
Supplier
Date
Validity
Currency
Payment Terms
Delivery Terms
Items
Unit Price
Discount
VAT
Total
Expected Delivery

Allow multiple supplier quotations for the same enquiry.

==================================================
12. COMPARATIVE STATEMENT
==================================================

Create a powerful supplier comparison screen.

Example:

Product | Qty | Supplier A | Supplier B | Supplier C

Compare:

Unit Price
Discount
VAT
Delivery Time
Payment Terms
Currency
Total Cost

Allow user to select supplier.

Selected quotation can be converted to Purchase Order.

==================================================
13. LOCAL PURCHASE ORDER
==================================================

PO fields:

PO Number
PO Date
Supplier
Quotation Reference
Warehouse
Currency
Payment Terms
Delivery Terms
Expected Delivery Date
Remarks
Terms & Conditions

Items:

Product
Internal Code
OEM Number
Description
Qty
Unit
Rate
Discount
VAT
Amount

Totals:

Subtotal
Discount
VAT
Round Off
Grand Total

Statuses:

Draft
Submitted
Pending Approval
Approved
Partially Received
Fully Received
Closed
Cancelled

==================================================
14. GOODS RECEIPT / GRN
==================================================

GRN must be generated from PO.

Never force users to re-enter PO information.

Show:

Ordered Qty
Previously Received
Current Receipt
Pending Qty

Example:

PO = 100

GRN 1 = 60

Status:
Partially Received

GRN 2 = 40

Status:
Fully Received

Upon posting GRN:

INVENTORY MUST INCREASE.

Create stock transaction automatically.

==================================================
15. IMPORT PURCHASE
==================================================

Import purchase requires additional fields:

Supplier Country
Currency
Incoterms
Port of Loading
Port of Destination
Shipping Method
Container Number
Bill of Lading
AWB
Shipment Number
ETD
ETA
Shipping Agent
Clearing Agent

Statuses:

Draft
Confirmed
Payment Pending
In Transit
Arrived
Customs
Received
Completed

==================================================
16. GOODS IN TRANSIT
==================================================

Create a dedicated Goods-in-Transit screen.

Show:

Import PO
Supplier
Shipment
Container
BL/AWB
ETD
ETA
Current Status
Expected Arrival
Product Quantity
Received Quantity
Pending Quantity

==================================================
17. LANDED COST
==================================================

This is critical for imported spare parts.

Support:

Product Cost
Freight
Insurance
Customs Duty
Port Charges
Clearing Charges
Transport
Handling
Other Charges

Landed cost allocation methods:

- By Quantity
- By Value
- By Weight
- By Volume

Calculate:

Actual Landed Cost =
Purchase Cost + Allocated Additional Costs

Update inventory cost accordingly.

Keep complete landed-cost audit history.

==================================================
18. PURCHASE INVOICE
==================================================

Purchase invoice can be created from:

GRN
Purchase Order
Import GRN

Prevent duplicate invoicing.

Calculate:

Subtotal
Discount
VAT
Round Off
Grand Total

Posting invoice must create:

Dr Inventory / Expense
Dr Input VAT
Cr Supplier Payable

==================================================
19. PURCHASE RETURN
==================================================

Flow:

Purchase Invoice / GRN
↓
Purchase Return
↓
Stock Reduction
↓
Supplier Credit Note

Allow partial returns.

Return reasons:

Damaged
Wrong Item
Excess Quantity
Quality Issue
Warranty
Other

==================================================
20. SALES MODULE
==================================================

Sales flow:

Sales Enquiry
↓
Sales Quotation
↓
Proforma Invoice
↓
Stock Reservation
↓
Sales Order
↓
Picking
↓
Packing List
↓
Delivery Note
↓
Sales Invoice
↓
Customer Receipt

==================================================
21. SALES ENQUIRY
==================================================

Fields:

Enquiry Number
Customer
Date
Salesman
Required Date
Items
Quantity
Remarks

Allow conversion to quotation.

==================================================
22. SALES QUOTATION
==================================================

Fields:

Quotation Number
Customer
Salesman
Date
Valid Until
Currency
Payment Terms
Items

Show:

Product
OEM Number
Available Stock
Reserved Stock
Available to Sell
Quantity
Rate
Discount
VAT
Total

Allow:

Quotation → Sales Order
Quotation → Proforma Invoice

==================================================
23. STOCK RESERVATION
==================================================

When Sales Order is approved:

Physical stock must NOT immediately decrease.

Instead:

Physical Stock = 100
Reserved = 20
Available = 80

Reservation must be tracked by:

Sales Order
Customer
Product
Warehouse
Quantity

==================================================
24. PICKING
==================================================

Create picking list from Sales Order.

Warehouse staff should see:

Product
OEM
Rack
Shelf
Bin
Ordered Qty
Reserved Qty
Picked Qty
Pending Qty

Allow partial picking.

==================================================
25. PACKING LIST
==================================================

Create packing list after picking.

Include:

Packing Number
Sales Order
Customer
Boxes
Items
Quantity
Weight
Dimensions
Remarks

==================================================
26. DELIVERY NOTE
==================================================

Create Delivery Note from Sales Order / Picking.

Support partial delivery.

On posting delivery:

Physical stock decreases.

Reserved stock decreases.

Stock transaction created.

==================================================
27. SALES INVOICE
==================================================

Invoice can be generated from:

Sales Order
Delivery Note
Proforma Invoice

Prevent duplicate billing.

Fields:

Invoice Number
Date
Customer
TRN
Address
Payment Terms
Due Date
Items
VAT
Discount
Total

Posting creates:

Dr Customer Receivable
Cr Sales
Cr Output VAT

Also create COGS:

Dr COGS
Cr Inventory

==================================================
28. SALES RETURN
==================================================

Flow:

Sales Invoice
↓
Sales Return
↓
Return Receipt
↓
Inspection
↓
Resalable / Damaged
↓
Inventory Update
↓
Credit Note

==================================================
29. INVENTORY MODULE
==================================================

Inventory must be transaction based.

Never directly modify stock quantities.

Every movement must create stock transactions.

Support:

Opening Stock
Purchase Receipt
Sales Delivery
Sales Return
Purchase Return
Stock Transfer
Stock Adjustment
Stock Count
Damage
Scrap
Warehouse Receipt

==================================================
30. STOCK LEDGER
==================================================

Example:

Opening Stock +100
Purchase GRN +50
Sales Delivery -20
Purchase Return -5
Sales Return +2
Transfer Out -10
Transfer In +10
Adjustment -3

Current Stock = 124

Create a complete stock ledger.

==================================================
31. MULTI-WAREHOUSE
==================================================

Support multiple warehouses.

Example:

Dubai Main
Dubai Branch
Sharjah
Abu Dhabi
Ajman

Warehouse structure:

Warehouse
→ Zone
→ Rack
→ Shelf
→ Bin

Stock transfer:

Transfer Request
↓
Approval
↓
Dispatch
↓
In Transit
↓
Receiving
↓
Completed

==================================================
32. PRODUCT MASTER
==================================================

Create a powerful spare-parts product master.

Fields:

Product Code
Product Name
Arabic Name
Description
OEM Part Number
Alternate Part Numbers
Barcode
Brand
Category
Sub Category
Product Group
Product Type

Vehicle Make
Vehicle Model
Vehicle Variant
Year
Engine
Fuel Type

Purchase Unit
Sales Unit

Cost Price
Average Cost
Last Purchase Price
Retail Price
Wholesale Price

Minimum Stock
Maximum Stock
Reorder Level

Weight
Length
Width
Height

Country of Origin
Warranty
VAT Rate

Primary Supplier

Warehouse
Rack
Shelf
Bin

Active / Inactive

==================================================
33. OEM / ALTERNATE PART NUMBER SYSTEM
==================================================

One product can have multiple part numbers.

Example:

Internal Code:
BP-00125

OEM:
04465-60210

Alternate:
04465-60220
04465-0K240

All numbers must be searchable.

Search by:

Internal Code
OEM
Alternate Number
Barcode
Description
Vehicle
Brand

==================================================
34. VEHICLE COMPATIBILITY
==================================================

Support:

Make
Model
Variant
Year From
Year To
Engine
Fuel
Transmission

Example:

Toyota
Land Cruiser
2020-2024
3.5L
Petrol

Link compatible products.

==================================================
35. FINANCE MODULE
==================================================

Create a proper double-entry accounting system.

Ribbon:

Chart of Accounts

Receipts & Payments:
- Bank Receipt
- Cash Receipt Voucher
- Bank Payment Voucher
- Cash Payment Voucher

Journal Entries:
- Journal Voucher
- Debit Note
- Credit Note
- Opening Balance

Reports:
- General Ledger
- Registers
- Receivables
- Payables
- Final Reports

==================================================
36. CHART OF ACCOUNTS
==================================================

Create hierarchical accounts.

Assets
- Cash
- Bank
- Accounts Receivable
- Inventory
- Fixed Assets

Liabilities
- Accounts Payable
- VAT Payable
- Other Liabilities

Equity

Revenue
- Spare Parts Sales
- Other Revenue

COGS

Expenses
- Rent
- Salaries
- Freight
- Utilities
- Insurance
- Vehicle
- Bank Charges
- Other Expenses

==================================================
37. AUTOMATIC ACCOUNTING
==================================================

Normal users should not manually create journal entries for normal transactions.

Purchase:

Dr Inventory
Dr Input VAT
Cr Supplier

Sales:

Dr Customer
Cr Sales
Cr Output VAT

Customer Receipt:

Dr Bank/Cash
Cr Customer

Supplier Payment:

Dr Supplier
Cr Bank/Cash

Sales COGS:

Dr COGS
Cr Inventory

==================================================
38. RECEIVABLES
==================================================

Customer account should show:

Opening Balance
Invoices
Receipts
Credit Notes
Debit Notes
Adjustments
Closing Balance

Create:

Customer Statement
AR Aging
Outstanding Invoices
Due Today
Overdue

Aging:

0-30
31-60
61-90
91-120
120+

==================================================
39. PAYABLES
==================================================

Supplier account should show:

Opening Balance
Purchase Invoices
Payments
Credit Notes
Debit Notes
Adjustments
Closing Balance

Create AP Aging.

==================================================
40. VAT
==================================================

Build configurable VAT.

Support:

VAT Rate
Tax Code
Taxable
Zero Rated
Exempt
Out of Scope

VAT should flow automatically into:

Sales Invoice
Purchase Invoice
Credit Note
Debit Note

Create VAT reports.

Do not hard-code tax assumptions throughout the system.

==================================================
41. REPORTS
==================================================

Sales:

Sales Register
Sales by Customer
Sales by Product
Sales by Brand
Salesman Sales
Gross Profit
Invoice Register
Sales Return

Purchase:

Purchase Register
Supplier Purchase
Product Purchase
Purchase by Brand
Pending PO
Pending GRN
Purchase Return
Import Purchase

Inventory:

Stock Summary
Stock Ledger
Stock Valuation
Warehouse Stock
Low Stock
Dead Stock
Fast Moving
Slow Moving
Stock Movement
Stock Aging

Finance:

General Ledger
Trial Balance
Profit & Loss
Balance Sheet
Cash Flow
Customer Statement
Supplier Statement
AR Aging
AP Aging
VAT Report

==================================================
42. REPORT BUILDER
==================================================

Create a configurable report builder.

Support:

Columns
Filters
Grouping
Sorting
Date Range
Warehouse
Branch
Customer
Supplier
Product
Brand
Category

Export:

PDF
Excel
CSV
Print

==================================================
43. DIMENSIONS
==================================================

Create master-data management.

Company
Business Unit
Branch
Warehouse
Warehouse Location
Category
Subcategory
Product Group
Product Type
Brand
Area
Salesman
Territory
Customer
Supplier
Payment Terms
Currency
VAT

==================================================
44. CUSTOMER MASTER
==================================================

Fields:

Customer Code
Customer Name
Arabic Name
TRN
Contact Person
Phone
Mobile
Email
Address
City
Country
Payment Terms
Credit Limit
Currency
Salesman
Territory
VAT Category
Opening Balance
Active

==================================================
45. SUPPLIER MASTER
==================================================

Fields:

Supplier Code
Supplier Name
Country
Contact Person
Phone
Email
Address
Currency
Payment Terms
VAT
Credit Limit
Opening Balance
Bank Details
Active

==================================================
46. USER MANAGEMENT
==================================================

Create:

Users
Roles
Permissions

Permissions:

View
Create
Edit
Delete
Approve
Reject
Post
Cancel
Print
Export

Permissions must be module-specific.

==================================================
47. APPROVAL WORKFLOW
==================================================

Build configurable approvals.

Example:

Purchase Order under AED 10,000
→ Manager

AED 10,000-50,000
→ Manager + Finance

Above AED 50,000
→ Management

Do not hard-code these values.

Create configurable approval rules.

==================================================
48. DOCUMENT NUMBERING
==================================================

Support configurable numbering:

SQ-2026-00001
SO-2026-00001
PO-2026-00001
GRN-2026-00001
SI-2026-00001
PI-2026-00001
DN-2026-00001

Allow:

Prefix
Year
Branch
Sequence
Reset rules

==================================================
49. DOCUMENT FLOW
==================================================

Every document must show a visual flow.

Example:

Quotation
✓
Sales Order
✓
Picking
✓
Delivery
●
Invoice
○
Receipt
○

Clicking each stage opens the linked document.

Also show:

Created From
Converted To
Related Documents

==================================================
50. GLOBAL SEARCH
==================================================

Create a global ERP search.

Search:

Products
OEM numbers
Barcode
Customers
Suppliers
Quotation
PO
GRN
Invoice
Delivery Note
Receipt
Payment

Searching:

04465-60210

should show:

Product
Current Stock
Warehouse Stock
Purchase History
Sales History
Supplier
Customer Transactions

==================================================
51. DATA TABLES
==================================================

All ERP list screens must use professional enterprise tables.

Features:

Search
Column Filters
Sorting
Pagination
Column Visibility
Export
Print
Bulk Actions
Row Selection
Double Click
Keyboard Navigation

Example:

PO No | Date | Supplier | Warehouse | Amount | Status | Received | Actions

==================================================
52. FORM DESIGN
==================================================

ERP forms should use:

Header section
Document information
Line-item table
Totals section
Notes
Attachments
Approval information
Audit information

Example:

Purchase Order:

--------------------------------------------
PO INFORMATION
--------------------------------------------
PO Number
Supplier
Date
Warehouse
Currency
Payment Terms

--------------------------------------------
ITEMS
--------------------------------------------
Product | OEM | Qty | Rate | Discount | VAT | Total

--------------------------------------------
TOTALS
--------------------------------------------

--------------------------------------------
TERMS & CONDITIONS
--------------------------------------------

--------------------------------------------
APPROVAL
--------------------------------------------