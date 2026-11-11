-- The name of an "Other" ID document (client, 11 Nov 2026), e.g. "Company ID".
-- Additive + nullable: existing rows keep NULL.
ALTER TABLE "GuestId" ADD COLUMN IF NOT EXISTS "documentName" TEXT;
