

-- AlterTable
ALTER TABLE "GuestId" ADD COLUMN     "backChecksum" TEXT,
ADD COLUMN     "backObjectKey" TEXT,
ALTER COLUMN "maskedValue" DROP NOT NULL;
