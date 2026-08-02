-- =============================================================================
-- 06-billing · T-1/T-2 — money-integrity guards
--
-- The Folio/FolioLine/Payment/InvoiceSeries/Invoice tables already exist in the
-- baseline. This migration adds the DB-level guarantees the money core depends
-- on — the ones application discipline alone cannot promise (business-rules.md
-- §7 append-only; §13 gap-free numbering; data-model.md non-negative amounts):
--
--  1. Append-only on FolioLine and Payment — no UPDATE/DELETE, ever. Corrections
--     are new REVERSAL lines / refund rows, never edits (FR-7/FR-2).
--  2. Invoice is append-only EXCEPT `pdfObjectKey`, which is written once after
--     commit when the PDF finishes rendering (FR-12/FR-14). A void is a NEW
--     CREDIT_NOTE row, never an edit of the original (FR-21).
--  3. Payment.amountPaise > 0 — direction is carried by `isRefund`, never a sign
--     (FR-10/FR-23). FolioLine amounts may be negative (discounts/reversals), so
--     no positivity check there.
--  4. Partial-unique index making night-audit room-night posting idempotent: at
--     most one ROOM line per (folio, business date). A re-run's duplicate insert
--     conflicts and is skipped (FR-5, AC-18).
--
-- `enforce_append_only()` is the shared function from the platform migration.
-- Invoice(propertyId, number) UNIQUE already exists (gap-free numbering guard).
--
-- Reversal (documented; Prisma migrations are forward-only):
--   DROP TRIGGER folioline_append_only ON "FolioLine";
--   DROP TRIGGER payment_append_only ON "Payment";
--   DROP TRIGGER invoice_immutable ON "Invoice";
--   DROP FUNCTION enforce_invoice_immutable;
--   DROP INDEX "FolioLine_room_night_unique";
--   ALTER TABLE "Payment" DROP CONSTRAINT "Payment_amount_positive";
-- =============================================================================

-- 1 · FolioLine + Payment are fully append-only.
CREATE TRIGGER folioline_append_only
  BEFORE UPDATE OR DELETE ON "FolioLine"
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

CREATE TRIGGER payment_append_only
  BEFORE UPDATE OR DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

-- 2 · Invoice: block DELETE; allow UPDATE only when it touches `pdfObjectKey`
--     (the post-commit PDF attach). Every other column is immutable.
CREATE OR REPLACE FUNCTION enforce_invoice_immutable()
  RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'APPEND_ONLY: Invoice rows are never deleted (void issues a CREDIT_NOTE)';
  END IF;
  -- UPDATE: everything except pdfObjectKey must be unchanged.
  IF ( ROW(NEW."id", NEW."propertyId", NEW."folioId", NEW."number", NEW."financialYear",
           NEW."type", NEW."cancelsInvoiceId", NEW."customerName", NEW."customerGstin",
           NEW."placeOfSupply", NEW."taxableValuePaise", NEW."cgstPaise", NEW."sgstPaise",
           NEW."igstPaise", NEW."totalPaise", NEW."issuedAt", NEW."issuedById")
     IS DISTINCT FROM
       ROW(OLD."id", OLD."propertyId", OLD."folioId", OLD."number", OLD."financialYear",
           OLD."type", OLD."cancelsInvoiceId", OLD."customerName", OLD."customerGstin",
           OLD."placeOfSupply", OLD."taxableValuePaise", OLD."cgstPaise", OLD."sgstPaise",
           OLD."igstPaise", OLD."totalPaise", OLD."issuedAt", OLD."issuedById") ) THEN
    RAISE EXCEPTION 'APPEND_ONLY: only pdfObjectKey may be updated on Invoice';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_immutable
  BEFORE UPDATE OR DELETE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION enforce_invoice_immutable();

-- 3 · Payments are stored positive; direction is `isRefund`.
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive" CHECK ("amountPaise" > 0);

-- 4 · One ROOM line per folio per business date → night audit is idempotent.
CREATE UNIQUE INDEX "FolioLine_room_night_unique"
  ON "FolioLine" ("folioId", "businessDate")
  WHERE "type" = 'ROOM';
