/** Expense input schemas (zod) — 07. */
import { z } from "zod";

export const createExpenseSchema = z.object({
  propertyId: z.string().min(1),
  head: z.enum(["HOUSEKEEPING", "KITCHEN", "MAINTENANCE", "UTILITIES", "STAFF", "ADMINISTRATION", "MISC"]),
  subCategory: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  amountPaise: z.number().int().positive(),
  spentOn: z.coerce.date(),
  paidVia: z.enum(["CASH", "CREDIT_CARD", "DEBIT_CARD", "UPI", "BANK_TRANSFER", "ONLINE", "CORPORATE_CREDIT"]).optional(),
  vendor: z.string().max(200).optional(),
  billBase64: z.string().optional(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const approveExpenseSchema = z.object({ expenseId: z.string().min(1) });
export const rejectExpenseSchema = z.object({ expenseId: z.string().min(1), reason: z.string().min(1).max(300) });
