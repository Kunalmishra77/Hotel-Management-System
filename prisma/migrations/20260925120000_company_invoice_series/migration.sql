-- Company-wide (org-level) gap-free invoice series — one running number across all
-- properties per financial year (client's single "WASPL" series format).
CREATE TABLE "CompanyInvoiceSeries" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "financialYear" TEXT NOT NULL,
  "prefix" TEXT NOT NULL DEFAULT 'WASPL',
  "nextNumber" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "CompanyInvoiceSeries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyInvoiceSeries_orgId_financialYear_key"
  ON "CompanyInvoiceSeries"("orgId", "financialYear");
