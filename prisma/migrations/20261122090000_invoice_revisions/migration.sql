-- One bill, one number (client, 22 Nov 2026 — specs/06 FR-RV-1..4, FR-MB-2).
-- Additive: a correction is a new REVISION row of the same number; the previous
-- one is marked superseded (write-once). Nothing is deleted or edited.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "supersededById" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "customerAddress" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "customerState" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "guestName" TEXT;

-- A number now repeats across revisions of the same bill.
DROP INDEX IF EXISTS "Invoice_propertyId_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_propertyId_number_revision_key" ON "Invoice"("propertyId", "number", "revision");
CREATE INDEX IF NOT EXISTS "Invoice_number_idx" ON "Invoice"("number");

-- Every column stays immutable except pdfObjectKey and the write-once
-- superseded pair (NULL → value, never changed again).
CREATE OR REPLACE FUNCTION enforce_invoice_immutable()
  RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'APPEND_ONLY: Invoice rows are never deleted (void issues a CREDIT_NOTE)';
  END IF;
  IF ( ROW(NEW."id", NEW."propertyId", NEW."folioId", NEW."number", NEW."financialYear",
           NEW."type", NEW."cancelsInvoiceId", NEW."customerName", NEW."customerGstin",
           NEW."placeOfSupply", NEW."taxableValuePaise", NEW."cgstPaise", NEW."sgstPaise",
           NEW."igstPaise", NEW."totalPaise", NEW."issuedAt", NEW."issuedById", NEW."billPart",
           NEW."revision", NEW."customerAddress", NEW."customerState", NEW."customerPhone", NEW."guestName")
     IS DISTINCT FROM
       ROW(OLD."id", OLD."propertyId", OLD."folioId", OLD."number", OLD."financialYear",
           OLD."type", OLD."cancelsInvoiceId", OLD."customerName", OLD."customerGstin",
           OLD."placeOfSupply", OLD."taxableValuePaise", OLD."cgstPaise", OLD."sgstPaise",
           OLD."igstPaise", OLD."totalPaise", OLD."issuedAt", OLD."issuedById", OLD."billPart",
           OLD."revision", OLD."customerAddress", OLD."customerState", OLD."customerPhone", OLD."guestName") ) THEN
    RAISE EXCEPTION 'APPEND_ONLY: only pdfObjectKey / supersededBy may be updated on Invoice';
  END IF;
  IF (OLD."supersededById" IS NOT NULL AND NEW."supersededById" IS DISTINCT FROM OLD."supersededById")
     OR (OLD."supersededAt" IS NOT NULL AND NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt") THEN
    RAISE EXCEPTION 'APPEND_ONLY: an invoice is superseded once, never re-pointed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
