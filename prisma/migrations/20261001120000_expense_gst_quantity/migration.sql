-- Expenses restructure (#12–20): a new "Only GST Bills" head + quantity and GSTIN
-- capture. Additive & idempotent (PG12+ allows ADD VALUE outside a value-using txn).
ALTER TYPE "ExpenseHead" ADD VALUE IF NOT EXISTS 'GST_BILLS';
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "quantity" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "gstNumber" TEXT;
