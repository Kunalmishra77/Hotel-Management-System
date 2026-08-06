-- 3C T2 — booking payment state (MoM). Additive: existing rows default to
-- PAY_AT_HOTEL. CREATE TYPE + ADD COLUMN are transaction-safe (unlike ALTER TYPE
-- ADD VALUE), so this runs as a single migration transaction.
CREATE TYPE "SettlementIntent" AS ENUM ('PAY_AT_HOTEL', 'ALREADY_PAID', 'UNPAID_ONLINE');

ALTER TABLE "Reservation"
  ADD COLUMN "settlementIntent" "SettlementIntent" NOT NULL DEFAULT 'PAY_AT_HOTEL';
