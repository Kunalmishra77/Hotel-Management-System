

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "isFieldStaff" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trackingToken" TEXT;

-- CreateTable
CREATE TABLE "FieldStaffPing" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldStaffPing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FieldStaffPing_staffId_capturedAt_idx" ON "FieldStaffPing"("staffId", "capturedAt");

-- CreateIndex
CREATE INDEX "FieldStaffPing_propertyId_capturedAt_idx" ON "FieldStaffPing"("propertyId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_trackingToken_key" ON "Staff"("trackingToken");

-- AddForeignKey
ALTER TABLE "FieldStaffPing" ADD CONSTRAINT "FieldStaffPing_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

