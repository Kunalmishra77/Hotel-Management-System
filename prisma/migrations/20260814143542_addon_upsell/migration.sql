-- NOTE: the two trgm GIN index DROPs Prisma re-proposes (Guest_companyName_trgm_idx,
-- Guest_fullName_trgm_idx) were removed by hand — they are created out-of-band and must stay.
-- Purely additive below.

-- CreateEnum
CREATE TYPE "AddOnRequestStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "AddOn" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pricePaise" INTEGER NOT NULL,
    "chargeType" "ChargeType" NOT NULL,
    "hsnSac" TEXT,
    "taxRateBps" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOnRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "addOnId" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "unitPaise" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "chargeType" "ChargeType" NOT NULL,
    "note" TEXT,
    "status" "AddOnRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "folioLineId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AddOnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AddOn_propertyId_active_idx" ON "AddOn"("propertyId", "active");

-- CreateIndex
CREATE INDEX "AddOnRequest_propertyId_status_idx" ON "AddOnRequest"("propertyId", "status");

-- CreateIndex
CREATE INDEX "AddOnRequest_reservationId_idx" ON "AddOnRequest"("reservationId");

-- AddForeignKey
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOnRequest" ADD CONSTRAINT "AddOnRequest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOnRequest" ADD CONSTRAINT "AddOnRequest_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOnRequest" ADD CONSTRAINT "AddOnRequest_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOnRequest" ADD CONSTRAINT "AddOnRequest_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
