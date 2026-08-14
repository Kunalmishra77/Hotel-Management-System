-- NOTE: the two pg_trgm GIN index DROPs Prisma re-proposes (out-of-band indexes
-- it can't represent) are removed by hand — the fuzzy-search indexes MUST stay.
-- This migration is purely additive.

-- AlterTable
ALTER TABLE "MaintenanceJob" ADD COLUMN     "vendor" TEXT;

-- CreateTable
CREATE TABLE "LostAndFoundItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomId" TEXT,
    "description" TEXT NOT NULL,
    "foundOn" DATE NOT NULL,
    "foundByStaffId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'STORED',
    "claimantName" TEXT,
    "resolvedOn" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LostAndFoundItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LostAndFoundItem_propertyId_status_idx" ON "LostAndFoundItem"("propertyId", "status");
