-- NOTE: Prisma's diff wanted to DROP the pg_trgm GIN indexes
-- "Guest_companyName_trgm_idx" and "Guest_fullName_trgm_idx" because they were
-- created out-of-band (migration 20260722120000_guest_search_index) and aren't
-- representable in schema.prisma. Those DROPs were removed by hand — the fast
-- fuzzy-search indexes MUST stay (04/15, AC-10). This migration is purely additive.

-- CreateTable
CREATE TABLE "GuestAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "email" TEXT,
    "emailHash" TEXT,
    "mobile" TEXT NOT NULL,
    "mobileHash" TEXT NOT NULL,
    "passwordHash" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "GuestAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestSession" (
    "id" TEXT NOT NULL,
    "guestAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ip" TEXT,
    "device" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestOtp" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guestAccountId" TEXT,
    "mobileHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestAccount_orgId_idx" ON "GuestAccount"("orgId");

-- CreateIndex
CREATE INDEX "GuestAccount_guestId_idx" ON "GuestAccount"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestAccount_orgId_mobileHash_key" ON "GuestAccount"("orgId", "mobileHash");

-- CreateIndex
CREATE UNIQUE INDEX "GuestAccount_orgId_emailHash_key" ON "GuestAccount"("orgId", "emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSession_tokenHash_key" ON "GuestSession"("tokenHash");

-- CreateIndex
CREATE INDEX "GuestSession_guestAccountId_idx" ON "GuestSession"("guestAccountId");

-- CreateIndex
CREATE INDEX "GuestOtp_orgId_mobileHash_idx" ON "GuestOtp"("orgId", "mobileHash");

-- CreateIndex
CREATE INDEX "GuestOtp_guestAccountId_idx" ON "GuestOtp"("guestAccountId");

-- AddForeignKey
ALTER TABLE "GuestAccount" ADD CONSTRAINT "GuestAccount_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestAccount" ADD CONSTRAINT "GuestAccount_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_guestAccountId_fkey" FOREIGN KEY ("guestAccountId") REFERENCES "GuestAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestOtp" ADD CONSTRAINT "GuestOtp_guestAccountId_fkey" FOREIGN KEY ("guestAccountId") REFERENCES "GuestAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
