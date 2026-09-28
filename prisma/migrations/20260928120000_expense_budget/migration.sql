-- 07 budget-vs-actual: monthly expense budget per property + head.
CREATE TABLE "ExpenseBudget" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "head" "ExpenseHead" NOT NULL,
    "month" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseBudget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpenseBudget_propertyId_head_month_key" ON "ExpenseBudget"("propertyId", "head", "month");
CREATE INDEX "ExpenseBudget_propertyId_month_idx" ON "ExpenseBudget"("propertyId", "month");

ALTER TABLE "ExpenseBudget" ADD CONSTRAINT "ExpenseBudget_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
