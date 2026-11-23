-- A second fee some OTAs take on top of commission (Expedia "Accelerator 7%", client
-- 23 Nov 2026), on the same base as the commission.
ALTER TABLE "ChannelDeduction" ADD COLUMN IF NOT EXISTS "extraFeeBps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChannelDeduction" ADD COLUMN IF NOT EXISTS "extraFeeLabel" TEXT;
