-- NOTE: the two pg_trgm GIN index DROPs Prisma re-proposes are removed by hand —
-- the fuzzy-search indexes MUST stay. This migration is purely additive.

-- AlterTable
ALTER TABLE "RoomCategory" ADD COLUMN     "amenities" TEXT[],
ADD COLUMN     "description" TEXT,
ADD COLUMN     "imageUrls" TEXT[];
