-- CreateEnum
CREATE TYPE "InventoryDomain" AS ENUM ('GENERAL', 'HOUSEKEEPING', 'LAUNDRY', 'KITCHEN', 'MAINTENANCE', 'STORE');



-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "domain" "InventoryDomain" NOT NULL DEFAULT 'GENERAL';

-- CreateTable
CREATE TABLE "LaundryBatch" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "sentOn" DATE NOT NULL,
    "vendor" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciledAt" TIMESTAMP(3),

    CONSTRAINT "LaundryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaundryBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "sentQty" INTEGER NOT NULL,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "toleranceQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LaundryBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LaundryBatch_propertyId_sentOn_idx" ON "LaundryBatch"("propertyId", "sentOn");

-- CreateIndex
CREATE INDEX "LaundryBatchItem_batchId_idx" ON "LaundryBatchItem"("batchId");

-- CreateIndex
CREATE INDEX "InventoryItem_propertyId_domain_idx" ON "InventoryItem"("propertyId", "domain");

-- AddForeignKey
ALTER TABLE "LaundryBatchItem" ADD CONSTRAINT "LaundryBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LaundryBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

