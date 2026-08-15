-- NOTE: the two trgm GIN index DROPs Prisma re-proposes were removed by hand
-- (created out-of-band, must stay). Purely additive below.

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT,
    "serialNo" TEXT,
    "warrantyUntil" DATE,
    "status" TEXT NOT NULL DEFAULT 'OPERATIONAL',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomInspection" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "defectNotes" TEXT,
    "inspectedById" TEXT,
    "inspectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomInspection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Asset_propertyId_category_idx" ON "Asset"("propertyId", "category");

-- CreateIndex
CREATE INDEX "RoomInspection_propertyId_status_idx" ON "RoomInspection"("propertyId", "status");

-- CreateIndex
CREATE INDEX "RoomInspection_roomId_idx" ON "RoomInspection"("roomId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomInspection" ADD CONSTRAINT "RoomInspection_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
