/** Expense input schemas (zod) — 07. */
import { z } from "zod";

export const createExpenseSchema = z.object({
  propertyId: z.string().min(1),
  head: z.enum(["HOUSEKEEPING", "KITCHEN", "MAINTENANCE", "UTILITIES", "STAFF", "ADMINISTRATION", "MISC", "GST_BILLS"]),
  subCategory: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  quantity: z.string().max(60).optional(),
  amountPaise: z.number().int().positive(),
  spentOn: z.coerce.date(),
  paidVia: z.enum(["CASH", "CREDIT_CARD", "DEBIT_CARD", "UPI", "BANK_TRANSFER", "ONLINE", "CORPORATE_CREDIT"]).optional(),
  vendor: z.string().max(200).optional(),
  gstNumber: z.string().max(20).optional(),
  billBase64: z.string().optional(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

/**
 * Batch entry (#multi-item): record several expense line items in one go — e.g. a
 * single grocery/kitchen run of milk, bread, eggs. Each item is still its own
 * Expense row (its own head/sub/amount/status, so rollups + approval + GST are
 * unchanged); the batch just writes them atomically. Capped so one submit can't
 * flood the transaction.
 */
export const createExpensesSchema = z.object({
  items: z.array(createExpenseSchema).min(1).max(50),
});
export type CreateExpensesInput = z.infer<typeof createExpensesSchema>;

export const approveExpenseSchema = z.object({ expenseId: z.string().min(1) });
export const rejectExpenseSchema = z.object({ expenseId: z.string().min(1), reason: z.string().min(1).max(300) });

/** Set/clear a monthly budget for one property + head. amountPaise 0 clears it. */
export const setExpenseBudgetSchema = z.object({
  propertyId: z.string().min(1),
  head: z.enum(["HOUSEKEEPING", "KITCHEN", "MAINTENANCE", "UTILITIES", "STAFF", "ADMINISTRATION", "MISC", "GST_BILLS"]),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amountPaise: z.number().int().min(0),
});
