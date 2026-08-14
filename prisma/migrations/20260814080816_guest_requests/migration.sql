-- NOTE: the two pg_trgm GIN index DROPs Prisma re-proposes (out-of-band indexes
-- it can't represent) are removed by hand — the fuzzy-search indexes MUST stay.
-- This migration is purely additive.

-- CreateTable
CREATE TABLE "GuestRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "roomId" TEXT,
    "guestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "GuestRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestRequest_propertyId_status_idx" ON "GuestRequest"("propertyId", "status");

-- CreateIndex
CREATE INDEX "GuestRequest_guestId_idx" ON "GuestRequest"("guestId");

-- CreateIndex
CREATE INDEX "GuestRequest_reservationId_idx" ON "GuestRequest"("reservationId");
