-- How a booking's advance / prepayment was paid (client, 31 Oct 2026). Nullable — additive.
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "advanceMode" "PaymentMode";
