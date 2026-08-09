-- AlterEnum
ALTER TYPE "RoleName" ADD VALUE 'OWNER';



-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "managementFeeBps" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PropertyDocument" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedByRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PropertyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyImportantDate" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PropertyImportantDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerPayout" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "periodMonth" DATE NOT NULL,
    "grossRevenuePaise" BIGINT NOT NULL,
    "expensePaise" BIGINT NOT NULL,
    "managementFeeBps" INTEGER NOT NULL,
    "managementFeePaise" BIGINT NOT NULL,
    "netPayablePaise" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPUTED',
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropertyDocument_propertyId_deletedAt_idx" ON "PropertyDocument"("propertyId", "deletedAt");

-- CreateIndex
CREATE INDEX "PropertyImportantDate_propertyId_dueDate_idx" ON "PropertyImportantDate"("propertyId", "dueDate");

-- CreateIndex
CREATE INDEX "OwnerPayout_propertyId_periodMonth_idx" ON "OwnerPayout"("propertyId", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerPayout_propertyId_periodMonth_key" ON "OwnerPayout"("propertyId", "periodMonth");

-- AddForeignKey
ALTER TABLE "PropertyDocument" ADD CONSTRAINT "PropertyDocument_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyImportantDate" ADD CONSTRAINT "PropertyImportantDate_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerPayout" ADD CONSTRAINT "OwnerPayout_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

