-- OTA deductions per channel (client, 22 Nov 2026): what each OTA keeps from a
-- booking — commission, GST on it, TCS, TDS. Org-level settings; reports compute
-- the per-booking breakdown from these. No row = no commission entered yet.
CREATE TABLE IF NOT EXISTS "ChannelDeduction" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "commissionBps" INTEGER NOT NULL DEFAULT 0,
  "commissionOnGross" BOOLEAN NOT NULL DEFAULT false,
  "gstOnCommissionBps" INTEGER NOT NULL DEFAULT 1800,
  "tcsBps" INTEGER NOT NULL DEFAULT 50,
  "tdsBps" INTEGER NOT NULL DEFAULT 10,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelDeduction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChannelDeduction_bps_check" CHECK ("commissionBps" BETWEEN 0 AND 10000 AND "gstOnCommissionBps" BETWEEN 0 AND 10000 AND "tcsBps" BETWEEN 0 AND 10000 AND "tdsBps" BETWEEN 0 AND 10000)
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelDeduction_orgId_source_key" ON "ChannelDeduction"("orgId", "source");
