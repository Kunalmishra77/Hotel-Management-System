/**
 * Zod boundary schemas for the accounting-sync actions — 22 (api-conventions.md).
 * Every server action `.parse`s its input before doing any work.
 */
import { z } from "zod";

/** GL mappings are free-form JSON but shape-checked so a bad config can't crash a push. */
const glMappingsSchema = z
  .object({
    invoice: z.string().min(1).optional(),
    creditNote: z.string().min(1).optional(),
    payment: z.string().min(1).optional(),
    refund: z.string().min(1).optional(),
    payroll: z.string().min(1).optional(),
    expense: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .optional();

export const configureAccountingSchema = z.object({
  /** Known adapters today; kept a string enum so adding one is config, not schema churn. */
  provider: z.enum(["zoho", "tally"]),
  mode: z.enum(["sandbox", "live"]),
  /** Reference to the secret in the vault — never the secret bytes (security.md). */
  credentialsRef: z.string().min(1).max(200).optional(),
  glMappings: glMappingsSchema,
});
export type ConfigureAccountingInput = z.infer<typeof configureAccountingSchema>;

export const retrySyncSchema = z.object({
  logId: z.string().min(1),
});
export type RetrySyncInput = z.infer<typeof retrySyncSchema>;
