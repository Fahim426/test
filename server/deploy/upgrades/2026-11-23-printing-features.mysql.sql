-- AlterTable
ALTER TABLE `amccontract` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `approvalrequest` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `businessunit` ADD COLUMN `address` VARCHAR(191) NULL,
    ADD COLUMN `legalName` VARCHAR(191) NULL,
    ADD COLUMN `trn` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `company` ADD COLUMN `logo` LONGTEXT NULL,
    ADD COLUMN `tagline` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `customer` ADD COLUMN `photo` LONGTEXT NULL,
    ADD COLUMN `photoThumb` LONGTEXT NULL,
    ADD COLUMN `website` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `deliverynote` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `goodsreceipt` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `importrequest` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `importshipment` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `journalentry` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `journalline` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `landedcost` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `materialrequest` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `note` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `packinglist` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `paymentterm` ADD COLUMN `basis` VARCHAR(191) NOT NULL DEFAULT 'INVOICE_DATE';

-- AlterTable
ALTER TABLE `pickinglist` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `product` ADD COLUMN `imageUrl` VARCHAR(191) NULL,
    ADD COLUMN `lastPurchaseAt` DATETIME(3) NULL,
    ADD COLUMN `stockNumber` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `productpartnumber` ADD COLUMN `brand` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `proformainvoice` ADD COLUMN `buId` INTEGER NULL,
    ADD COLUMN `salesmanId` INTEGER NULL;

-- AlterTable
ALTER TABLE `purchaseenquiry` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `purchaseinvoice` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `purchaseorder` ADD COLUMN `buId` INTEGER NULL,
    ADD COLUMN `supplierProformaId` INTEGER NULL;

-- AlterTable
ALTER TABLE `purchaserequisition` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `purchasereturn` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `salesenquiry` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `salesinvoice` ADD COLUMN `buId` INTEGER NULL,
    ADD COLUMN `einvStatus` VARCHAR(191) NOT NULL DEFAULT 'NONE',
    ADD COLUMN `einvUuid` VARCHAR(191) NULL,
    ADD COLUMN `vatExempt` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `salesorder` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `salesquotation` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `salesreturn` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `stockadjustment` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `stocktransaction` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `stocktransfer` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `supplier` ADD COLUMN `website` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `supplierproforma` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `supplierquotation` ADD COLUMN `buId` INTEGER NULL;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `businessUnitId` INTEGER NULL;

-- AlterTable
ALTER TABLE `voucher` ADD COLUMN `buId` INTEGER NULL;

-- CreateTable
CREATE TABLE `PendingClosure` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `stage` VARCHAR(20) NOT NULL,
    `sourceType` VARCHAR(40) NOT NULL,
    `sourceId` INTEGER NOT NULL,
    `itemKey` VARCHAR(300) NOT NULL,
    `qty` DECIMAL(18, 3) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PendingClosure_stage_sourceId_idx`(`stage`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesTargetDefault` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesmanId` INTEGER NOT NULL,
    `fromPeriod` VARCHAR(7) NOT NULL,
    `target` DECIMAL(18, 2) NOT NULL,

    UNIQUE INDEX `SalesTargetDefault_salesmanId_fromPeriod_key`(`salesmanId`, `fromPeriod`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesTarget` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesmanId` INTEGER NOT NULL,
    `period` VARCHAR(7) NOT NULL,
    `target` DECIMAL(18, 2) NOT NULL,

    INDEX `SalesTarget_period_idx`(`period`),
    UNIQUE INDEX `SalesTarget_salesmanId_period_key`(`salesmanId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IncentiveSlab` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fromPct` DECIMAL(9, 2) NOT NULL,
    `ratePct` DECIMAL(6, 2) NOT NULL,

    UNIQUE INDEX `IncentiveSlab_fromPct_key`(`fromPct`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EInvoiceSettings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `mode` VARCHAR(191) NOT NULL DEFAULT 'SANDBOX',
    `peppolId` VARCHAR(191) NULL,
    `aspName` VARCHAR(191) NULL,
    `baseUrl` VARCHAR(191) NULL,
    `clientId` VARCHAR(191) NULL,
    `clientSecret` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EInvoiceQueue` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `invoiceId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastAttempt` DATETIME(3) NULL,
    `aspUuid` VARCHAR(191) NULL,
    `lastError` VARCHAR(2000) NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EInvoiceQueue_invoiceId_key`(`invoiceId`),
    INDEX `EInvoiceQueue_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EInvoiceLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `invoiceId` INTEGER NULL,
    `level` VARCHAR(191) NOT NULL DEFAULT 'INFO',
    `message` VARCHAR(2000) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EInvoiceLog_createdAt_idx`(`createdAt`),
    INDEX `EInvoiceLog_invoiceId_idx`(`invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `AmcContract_buId_idx` ON `AmcContract`(`buId`);

-- CreateIndex
CREATE INDEX `ApprovalRequest_buId_idx` ON `ApprovalRequest`(`buId`);

-- CreateIndex
CREATE INDEX `DeliveryNote_salesOrderId_idx` ON `DeliveryNote`(`salesOrderId`);

-- CreateIndex
CREATE INDEX `DeliveryNote_buId_idx` ON `DeliveryNote`(`buId`);

-- CreateIndex
CREATE INDEX `GoodsReceipt_orderId_idx` ON `GoodsReceipt`(`orderId`);

-- CreateIndex
CREATE INDEX `GoodsReceipt_shipmentId_idx` ON `GoodsReceipt`(`shipmentId`);

-- CreateIndex
CREATE INDEX `GoodsReceipt_buId_idx` ON `GoodsReceipt`(`buId`);

-- CreateIndex
CREATE INDEX `ImportRequest_buId_idx` ON `ImportRequest`(`buId`);

-- CreateIndex
CREATE INDEX `ImportShipment_buId_idx` ON `ImportShipment`(`buId`);

-- CreateIndex
CREATE INDEX `JournalEntry_buId_idx` ON `JournalEntry`(`buId`);

-- CreateIndex
CREATE INDEX `JournalLine_buId_idx` ON `JournalLine`(`buId`);

-- CreateIndex
CREATE INDEX `LandedCost_buId_idx` ON `LandedCost`(`buId`);

-- CreateIndex
CREATE INDEX `MaterialRequest_status_idx` ON `MaterialRequest`(`status`);

-- CreateIndex
CREATE INDEX `MaterialRequest_buId_idx` ON `MaterialRequest`(`buId`);

-- CreateIndex
CREATE INDEX `Note_buId_idx` ON `Note`(`buId`);

-- CreateIndex
CREATE INDEX `PackingList_buId_idx` ON `PackingList`(`buId`);

-- CreateIndex
CREATE INDEX `PickingList_buId_idx` ON `PickingList`(`buId`);

-- CreateIndex
CREATE INDEX `Product_stockNumber_idx` ON `Product`(`stockNumber`);

-- CreateIndex
CREATE INDEX `Product_lastPurchaseAt_idx` ON `Product`(`lastPurchaseAt`);

-- CreateIndex
CREATE INDEX `ProformaInvoice_buId_idx` ON `ProformaInvoice`(`buId`);

-- CreateIndex
CREATE INDEX `PurchaseEnquiry_requisitionId_idx` ON `PurchaseEnquiry`(`requisitionId`);

-- CreateIndex
CREATE INDEX `PurchaseEnquiry_status_idx` ON `PurchaseEnquiry`(`status`);

-- CreateIndex
CREATE INDEX `PurchaseEnquiry_buId_idx` ON `PurchaseEnquiry`(`buId`);

-- CreateIndex
CREATE INDEX `PurchaseInvoice_receiptId_idx` ON `PurchaseInvoice`(`receiptId`);

-- CreateIndex
CREATE INDEX `PurchaseInvoice_orderId_idx` ON `PurchaseInvoice`(`orderId`);

-- CreateIndex
CREATE INDEX `PurchaseInvoice_buId_idx` ON `PurchaseInvoice`(`buId`);

-- CreateIndex
CREATE INDEX `PurchaseOrder_quotationId_idx` ON `PurchaseOrder`(`quotationId`);

-- CreateIndex
CREATE INDEX `PurchaseOrder_supplierProformaId_idx` ON `PurchaseOrder`(`supplierProformaId`);

-- CreateIndex
CREATE INDEX `PurchaseOrder_buId_idx` ON `PurchaseOrder`(`buId`);

-- CreateIndex
CREATE INDEX `PurchaseRequisition_materialRequestId_idx` ON `PurchaseRequisition`(`materialRequestId`);

-- CreateIndex
CREATE INDEX `PurchaseRequisition_status_idx` ON `PurchaseRequisition`(`status`);

-- CreateIndex
CREATE INDEX `PurchaseRequisition_buId_idx` ON `PurchaseRequisition`(`buId`);

-- CreateIndex
CREATE INDEX `PurchaseReturn_buId_idx` ON `PurchaseReturn`(`buId`);

-- CreateIndex
CREATE INDEX `SalesEnquiry_buId_idx` ON `SalesEnquiry`(`buId`);

-- CreateIndex
CREATE INDEX `SalesInvoice_salesOrderId_idx` ON `SalesInvoice`(`salesOrderId`);

-- CreateIndex
CREATE INDEX `SalesInvoice_deliveryId_idx` ON `SalesInvoice`(`deliveryId`);

-- CreateIndex
CREATE INDEX `SalesInvoice_einvStatus_status_idx` ON `SalesInvoice`(`einvStatus`, `status`);

-- CreateIndex
CREATE INDEX `SalesInvoice_buId_idx` ON `SalesInvoice`(`buId`);

-- CreateIndex
CREATE INDEX `SalesOrder_quotationId_idx` ON `SalesOrder`(`quotationId`);

-- CreateIndex
CREATE INDEX `SalesOrder_proformaId_idx` ON `SalesOrder`(`proformaId`);

-- CreateIndex
CREATE INDEX `SalesOrder_buId_idx` ON `SalesOrder`(`buId`);

-- CreateIndex
CREATE INDEX `SalesQuotation_enquiryId_idx` ON `SalesQuotation`(`enquiryId`);

-- CreateIndex
CREATE INDEX `SalesQuotation_buId_idx` ON `SalesQuotation`(`buId`);

-- CreateIndex
CREATE INDEX `SalesReturn_buId_idx` ON `SalesReturn`(`buId`);

-- CreateIndex
CREATE INDEX `StockAdjustment_buId_idx` ON `StockAdjustment`(`buId`);

-- CreateIndex
CREATE INDEX `StockTransaction_buId_idx` ON `StockTransaction`(`buId`);

-- CreateIndex
CREATE INDEX `StockTransfer_buId_idx` ON `StockTransfer`(`buId`);

-- CreateIndex
CREATE INDEX `SupplierProforma_buId_idx` ON `SupplierProforma`(`buId`);

-- CreateIndex
CREATE INDEX `SupplierQuotation_enquiryId_idx` ON `SupplierQuotation`(`enquiryId`);

-- CreateIndex
CREATE INDEX `SupplierQuotation_status_idx` ON `SupplierQuotation`(`status`);

-- CreateIndex
CREATE INDEX `SupplierQuotation_buId_idx` ON `SupplierQuotation`(`buId`);

-- CreateIndex
CREATE INDEX `Voucher_buId_idx` ON `Voucher`(`buId`);

-- RenameIndex
ALTER TABLE `deliverynoteitem` RENAME INDEX `DeliveryNoteItem_deliveryId_fkey` TO `DeliveryNoteItem_deliveryId_idx`;

-- RenameIndex
ALTER TABLE `goodsreceiptitem` RENAME INDEX `GoodsReceiptItem_receiptId_fkey` TO `GoodsReceiptItem_receiptId_idx`;

-- RenameIndex
ALTER TABLE `importrequestitem` RENAME INDEX `ImportRequestItem_requestId_fkey` TO `ImportRequestItem_requestId_idx`;

-- RenameIndex
ALTER TABLE `importshipment` RENAME INDEX `ImportShipment_orderId_fkey` TO `ImportShipment_orderId_idx`;

-- RenameIndex
ALTER TABLE `importshipmentitem` RENAME INDEX `ImportShipmentItem_shipmentId_fkey` TO `ImportShipmentItem_shipmentId_idx`;

-- RenameIndex
ALTER TABLE `materialrequestitem` RENAME INDEX `MaterialRequestItem_requestId_fkey` TO `MaterialRequestItem_requestId_idx`;

-- RenameIndex
ALTER TABLE `proformainvoiceitem` RENAME INDEX `ProformaInvoiceItem_proformaId_fkey` TO `ProformaInvoiceItem_proformaId_idx`;

-- RenameIndex
ALTER TABLE `purchaseenquiryitem` RENAME INDEX `PurchaseEnquiryItem_enquiryId_fkey` TO `PurchaseEnquiryItem_enquiryId_idx`;

-- RenameIndex
ALTER TABLE `purchaseenquirysupplier` RENAME INDEX `PurchaseEnquirySupplier_enquiryId_fkey` TO `PurchaseEnquirySupplier_enquiryId_idx`;

-- RenameIndex
ALTER TABLE `purchaseinvoiceitem` RENAME INDEX `PurchaseInvoiceItem_invoiceId_fkey` TO `PurchaseInvoiceItem_invoiceId_idx`;

-- RenameIndex
ALTER TABLE `purchaseorderitem` RENAME INDEX `PurchaseOrderItem_orderId_fkey` TO `PurchaseOrderItem_orderId_idx`;

-- RenameIndex
ALTER TABLE `purchaserequisitionitem` RENAME INDEX `PurchaseRequisitionItem_requisitionId_fkey` TO `PurchaseRequisitionItem_requisitionId_idx`;

-- RenameIndex
ALTER TABLE `salesenquiryitem` RENAME INDEX `SalesEnquiryItem_enquiryId_fkey` TO `SalesEnquiryItem_enquiryId_idx`;

-- RenameIndex
ALTER TABLE `salesinvoiceitem` RENAME INDEX `SalesInvoiceItem_invoiceId_fkey` TO `SalesInvoiceItem_invoiceId_idx`;

-- RenameIndex
ALTER TABLE `salesorderitem` RENAME INDEX `SalesOrderItem_orderId_fkey` TO `SalesOrderItem_orderId_idx`;

-- RenameIndex
ALTER TABLE `salesquotationitem` RENAME INDEX `SalesQuotationItem_quotationId_fkey` TO `SalesQuotationItem_quotationId_idx`;

-- RenameIndex
ALTER TABLE `supplierproforma` RENAME INDEX `SupplierProforma_importRequestId_fkey` TO `SupplierProforma_importRequestId_idx`;

-- RenameIndex
ALTER TABLE `supplierproformaitem` RENAME INDEX `SupplierProformaItem_proformaId_fkey` TO `SupplierProformaItem_proformaId_idx`;

-- RenameIndex
ALTER TABLE `supplierquotationitem` RENAME INDEX `SupplierQuotationItem_quotationId_fkey` TO `SupplierQuotationItem_quotationId_idx`;

CREATE UNIQUE INDEX Product_stockNumber_key ON Product(stockNumber);
ALTER TABLE PendingClosure MODIFY reason VARCHAR(500) NOT NULL;
