-- Guaranteed late arrival (client, 12 Nov 2026): the night audit skips these
-- bookings in its no-show sweep. Additive, default false: no existing booking changes.
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "arrivalGuaranteed" BOOLEAN NOT NULL DEFAULT false;
