

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "addonModules" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'CORE',
ADD COLUMN     "planRenewsAt" TIMESTAMP(3),
ADD COLUMN     "planStatus" TEXT NOT NULL DEFAULT 'TRIAL';
