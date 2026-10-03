-- InvoiceLine: a frozen snapshot of the folio lines an invoice was issued for, so
-- the PDF renders from the invoice's own lines (never the live folio) and can never
-- be stale or self-contradictory. Additive; existing invoices simply have none and
-- fall back to the live-folio render until re-issued.
CREATE TABLE IF NOT EXISTS "InvoiceLine" (
  "id"          TEXT NOT NULL,
  "invoiceId"   TEXT NOT NULL,
  "type"        TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity"    INTEGER NOT NULL DEFAULT 1,
  "unitPaise"   INTEGER NOT NULL DEFAULT 0,
  "amountPaise" BIGINT NOT NULL,
  "taxRateBps"  INTEGER NOT NULL DEFAULT 0,
  "cgstPaise"   INTEGER NOT NULL DEFAULT 0,
  "sgstPaise"   INTEGER NOT NULL DEFAULT 0,
  "igstPaise"   INTEGER NOT NULL DEFAULT 0,
  "hsnSac"      TEXT,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

ALTER TABLE "InvoiceLine"
  ADD CONSTRAINT "InvoiceLine_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
