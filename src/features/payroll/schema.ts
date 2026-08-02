/** Payroll input schemas (zod) — 21. Every action boundary validates here. */
import { z } from "zod";

/** "YYYY-MM" property-local month. */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM");

export const generateRunSchema = z.object({
  propertyId: z.string().min(1),
  month: monthSchema,
});
export type GenerateRunInput = z.infer<typeof generateRunSchema>;

export const generateAdjustmentRunSchema = generateRunSchema;
export type GenerateAdjustmentRunInput = z.infer<typeof generateAdjustmentRunSchema>;

/**
 * Draft line edit. `bonusPaise`/`deductionPaise` are non-negative amounts;
 * `advancePaise` is the DESIRED advance-recovery amount (capped server-side by
 * the actual outstanding balance). Overriding a derived component (base/OT)
 * requires a reason (FR-13) — enforced in the action, since only an override
 * makes the reason mandatory.
 */
export const adjustLineSchema = z.object({
  lineId: z.string().min(1),
  bonusPaise: z.number().int().min(0).optional(),
  deductionPaise: z.number().int().min(0).optional(),
  advancePaise: z.number().int().min(0).optional(),
  overrideBasePaise: z.number().int().min(0).optional(),
  overrideOvertimePaise: z.number().int().min(0).optional(),
  reason: z.string().trim().min(1).max(300).optional(),
});
export type AdjustLineInput = z.infer<typeof adjustLineSchema>;

export const finalizeRunSchema = z.object({ runId: z.string().min(1) });
export type FinalizeRunInput = z.infer<typeof finalizeRunSchema>;
