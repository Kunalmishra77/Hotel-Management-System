-- CreateEnum
CREATE TYPE "PosOrderSource" AS ENUM ('STAFF', 'GUEST_QR');

-- CreateEnum
CREATE TYPE "KitchenTicketStatus" AS ENUM ('QUEUED', 'PREPARING', 'READY', 'SERVED');

-- AlterEnum
ALTER TYPE "PosOrderStatus" ADD VALUE 'REQUESTED';

-- NOTE: `migrate diff` also proposed dropping Guest_fullName_trgm_idx /
-- Guest_companyName_trgm_idx. Those are the pg_trgm GIN search indexes owned by
-- 04's raw-SQL migration (20260722120000_guest_search_index) and are NOT
-- representable in schema.prisma — dropping them would break guest search. They
-- are intentionally preserved (the DROP statements were removed from this file).

-- AlterTable
ALTER TABLE "PosOrder" ADD COLUMN     "guestNote" TEXT,
ADD COLUMN     "source" "PosOrderSource" NOT NULL DEFAULT 'STAFF';

-- AlterTable
ALTER TABLE "PosOutlet" ADD COLUMN     "isRoomDining" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "orderToken" TEXT;

-- CreateTable
CREATE TABLE "KitchenTicket" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "status" "KitchenTicketStatus" NOT NULL DEFAULT 'QUEUED',
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "servedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KitchenTicket_orderId_key" ON "KitchenTicket"("orderId");

-- CreateIndex
CREATE INDEX "KitchenTicket_propertyId_status_idx" ON "KitchenTicket"("propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Room_orderToken_key" ON "Room"("orderToken");

-- AddForeignKey
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PosOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

