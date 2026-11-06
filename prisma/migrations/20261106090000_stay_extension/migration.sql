-- Per-extension booking source (client, 6 Nov 2026). Additive: a new table, no
-- change to existing rows. Revenue-by-source splits nights in [fromDate, toDate)
-- to this row's source instead of the booking's original source.
CREATE TABLE IF NOT EXISTS "StayExtension" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "source" "BookingSource" NOT NULL,
    "ratePaise" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StayExtension_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StayExtension_range_check" CHECK ("toDate" > "fromDate")
);
CREATE INDEX IF NOT EXISTS "StayExtension_reservationId_idx" ON "StayExtension"("reservationId");
CREATE INDEX IF NOT EXISTS "StayExtension_propertyId_idx" ON "StayExtension"("propertyId");
DO $$ BEGIN
  ALTER TABLE "StayExtension" ADD CONSTRAINT "StayExtension_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
