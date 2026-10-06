-- Property.isCostCenter: a non-hotel cost-centre (office / head-office / "Other")
-- used only to attribute overhead EXPENSES. Additive, defaults false, so every
-- existing property stays a hotel. Hidden from hotel-facing surfaces; its expenses
-- show as a separate "Overheads" line in Profit reports.
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "isCostCenter" BOOLEAN NOT NULL DEFAULT false;
