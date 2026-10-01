-- #1 "Other" off-site booking: record a stay at a property not run by us.
-- Additive, nullable columns — safe to deploy with no backfill. A normal booking
-- leaves both NULL; an off-site booking stores just the hotel name + address and
-- has no room allocation / folio.
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "externalHotelName" TEXT;
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "externalHotelAddress" TEXT;
