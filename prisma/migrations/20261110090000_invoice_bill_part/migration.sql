-- Separate bills per channel on one stay (client, 10 Nov 2026). Additive and
-- nullable: existing invoices keep NULL (= whole folio). New invoices record the
-- bill they cover ("DIRECT" or the OTA source) so one folio can carry one live
-- tax invoice per bill. The invoice_immutable trigger guards UPDATEs only, so
-- adding a column and inserting it are unaffected.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "billPart" TEXT;
CREATE INDEX IF NOT EXISTS "Invoice_folioId_billPart_idx" ON "Invoice"("folioId", "billPart");

-- billPart is as immutable as the rest of the invoice: re-create the guard with
-- it in the compared row (only pdfObjectKey may still change).
CREATE OR REPLACE FUNCTION enforce_invoice_immutable()
  RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'APPEND_ONLY: Invoice rows are never deleted (void issues a CREDIT_NOTE)';
  END IF;
  IF ( ROW(NEW."id", NEW."propertyId", NEW."folioId", NEW."number", NEW."financialYear",
           NEW."type", NEW."cancelsInvoiceId", NEW."customerName", NEW."customerGstin",
           NEW."placeOfSupply", NEW."taxableValuePaise", NEW."cgstPaise", NEW."sgstPaise",
           NEW."igstPaise", NEW."totalPaise", NEW."issuedAt", NEW."issuedById", NEW."billPart")
     IS DISTINCT FROM
       ROW(OLD."id", OLD."propertyId", OLD."folioId", OLD."number", OLD."financialYear",
           OLD."type", OLD."cancelsInvoiceId", OLD."customerName", OLD."customerGstin",
           OLD."placeOfSupply", OLD."taxableValuePaise", OLD."cgstPaise", OLD."sgstPaise",
           OLD."igstPaise", OLD."totalPaise", OLD."issuedAt", OLD."issuedById", OLD."billPart") ) THEN
    RAISE EXCEPTION 'APPEND_ONLY: only pdfObjectKey may be updated on Invoice';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
