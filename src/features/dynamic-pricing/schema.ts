/** Dynamic-pricing input schemas (zod) — 24. Validated at every action boundary. */
import { z } from "zod";

/** Approve a suggestion at a concrete applied rate (paise). */
export const approveRateSchema = z.object({
  dynamicRateId: z.string().min(1),
  /** The rate the approver publishes; must sit inside the category guardrail. */
  appliedPaise: z.number().int().positive(),
});
export type ApproveRateInput = z.infer<typeof approveRateSchema>;

/** Reject a suggestion with an auditable reason. */
export const rejectRateSchema = z.object({
  dynamicRateId: z.string().min(1),
  reason: z.string().min(1).max(300),
});
export type RejectRateInput = z.infer<typeof rejectRateSchema>;

/** Run the suggestion engine over a category (or all categories) for a range. */
export const runPricingEngineSchema = z.object({
  propertyId: z.string().min(1),
  /** Omit to run every active category in the property. */
  roomCategoryId: z.string().min(1).optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
});
export type RunPricingEngineInput = z.infer<typeof runPricingEngineSchema>;
