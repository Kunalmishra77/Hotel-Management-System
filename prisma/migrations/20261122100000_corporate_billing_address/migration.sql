-- Company bills (client, 22 Nov 2026): a saved company carries its billing
-- address + state so staff pick it instead of typing it on every GST bill.
ALTER TABLE "Corporate" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "Corporate" ADD COLUMN IF NOT EXISTS "state" TEXT;
CREATE INDEX IF NOT EXISTS "Corporate_orgId_gstin_idx" ON "Corporate"("orgId", "gstin");
