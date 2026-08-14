-- NOTE: trgm GIN index DROPs Prisma re-proposes removed by hand (indexes must stay).
-- Purely additive.

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "onlineCheckInAt" TIMESTAMP(3);
