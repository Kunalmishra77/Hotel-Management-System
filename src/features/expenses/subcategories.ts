/**
 * Expense head → subcategory map (#12–20). Drives the dynamic Daily-Expenses form:
 * pick a Head, the Subcategory options change. Heads with an empty list take a
 * free-typed subcategory (Utilities / Misc / GST Bills), and "Other" in any list
 * reveals a free text box too.
 *
 * NOTE on STAFF (#17): full salary/wages are recorded in PAYROLL (21), never as a
 * STAFF expense (reporting.md — counted once). So STAFF here is non-payroll staff
 * spend only: uniform, medical, advances, reimbursements.
 */
export const EXPENSE_HEADS = [
  "HOUSEKEEPING", "KITCHEN", "MAINTENANCE", "UTILITIES", "STAFF", "ADMINISTRATION", "MISC", "GST_BILLS",
] as const;
export type ExpenseHeadKey = (typeof EXPENSE_HEADS)[number];

export const EXPENSE_HEAD_LABEL: Record<ExpenseHeadKey, string> = {
  HOUSEKEEPING: "Housekeeping",
  KITCHEN: "Kitchen",
  MAINTENANCE: "Maintenance",
  UTILITIES: "Utilities",
  STAFF: "Staff",
  ADMINISTRATION: "Administration",
  MISC: "Miscellaneous",
  GST_BILLS: "Only GST Bills",
};

export const EXPENSE_SUBCATEGORIES: Record<ExpenseHeadKey, string[]> = {
  HOUSEKEEPING: ["Cleaning", "Toiletry"],
  KITCHEN: ["Milk", "Bread", "Vegetables", "Eggs", "Butter", "Oil", "Fruits", "Curd"],
  MAINTENANCE: ["Plumbing", "AC", "Carpenter", "Painter", "Goods", "Electrical"],
  STAFF: ["Uniform", "Medical", "Advance", "Reimbursement"],
  ADMINISTRATION: ["Stationery", "Computer", "Printer", "Other"],
  UTILITIES: [], // free text (e.g. Electricity, Water, Internet)
  MISC: [], // free text (Rent, Wi-Fi, owner travel, …)
  GST_BILLS: [], // free text (property work, large purchases with a GST invoice)
};

/** Heads whose subcategory is always a free-typed value (no fixed list). */
export const FREE_TEXT_SUBCATEGORY = new Set<ExpenseHeadKey>(["UTILITIES", "MISC", "GST_BILLS"]);
/** Heads that show a quantity field (e.g. "10 litres"). */
export const QUANTITY_HEADS = new Set<ExpenseHeadKey>(["KITCHEN"]);
/** The head that captures GST invoice details (GSTIN, vendor, bill). */
export const GST_BILLS_HEAD: ExpenseHeadKey = "GST_BILLS";
