-- Optional ID for accompanying guests on a stay (name/ID captured per person).
ALTER TABLE "ReservationGuest" ADD COLUMN "idType" TEXT;
ALTER TABLE "ReservationGuest" ADD COLUMN "idNumber" TEXT;
