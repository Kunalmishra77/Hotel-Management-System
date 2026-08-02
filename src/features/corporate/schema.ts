/** Corporate CRM input schemas (zod) — 25. Every action parses at the boundary. */
import { z } from "zod";

/** GSTIN is 15 chars when present; kept loose (format checked by billing/GST layer). */
const gstin = z.string().trim().min(1).max(15).optional();

export const createCorporateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  gstin,
  contactName: z.string().trim().max(200).optional(),
  contactPhone: z.string().trim().max(20).optional(),
  contactEmail: z.string().trim().email().max(200).optional(),
  /** Accumulating money → BigInt paise (data-model.md). Coerced from the form. */
  creditLimitPaise: z.coerce.bigint().nonnegative(),
});
export type CreateCorporateInput = z.infer<typeof createCorporateSchema>;

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** Commission in basis points (1000 = 10%); capped at 100%. */
  commissionBps: z.coerce.number().int().min(0).max(10_000),
  contactPhone: z.string().trim().max(20).optional(),
});
export type CreateAgentInput = z.infer<typeof createAgentSchema>;

export const setNegotiatedRateSchema = z.object({
  corporateId: z.string().min(1),
  roomCategoryId: z.string().min(1),
  /** Per-night contract rate in paise — a small bounded value → Int. */
  ratePaise: z.coerce.number().int().positive(),
});
export type SetNegotiatedRateInput = z.infer<typeof setNegotiatedRateSchema>;
