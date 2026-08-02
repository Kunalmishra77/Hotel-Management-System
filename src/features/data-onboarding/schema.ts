/**
 * Zod schemas for 26-data-onboarding — validated at every action boundary
 * (api-conventions.md). Aadhaar/PII arrive INSIDE the uploaded file, never as a
 * top-level field, so nothing sensitive is in these action inputs or logs.
 */
import { z } from "zod";

export const importKindSchema = z.enum(["GUESTS", "RESERVATIONS", "BALANCES", "ROOMS", "STAFF"]);
export type ImportKindInput = z.infer<typeof importKindSchema>;

export const getTemplateSchema = z.object({ kind: importKindSchema });

export const createBatchSchema = z.object({
  kind: importKindSchema,
  /** Required for property-owned kinds (RESERVATIONS/BALANCES/ROOMS); optional
   *  for org-level GUESTS/STAFF. Scope is enforced in the action. */
  propertyId: z.string().min(1).optional().nullable(),
  fileName: z.string().min(1).max(255),
  /** The uploaded file as base64. Stored to object storage; only its key is kept. */
  fileBase64: z.string().min(1),
  /** canonical field → source column header. Omitted ⇒ auto-mapped from headers. */
  mapping: z.record(z.string(), z.string()).optional(),
});
export type CreateBatchInput = z.infer<typeof createBatchSchema>;

export const validateBatchSchema = z.object({ batchId: z.string().min(1) });
export const commitBatchSchema = z.object({ batchId: z.string().min(1) });
export const rollbackBatchSchema = z.object({
  batchId: z.string().min(1),
  reason: z.string().trim().max(300).optional().nullable(),
});
export const downloadErrorsSchema = z.object({ batchId: z.string().min(1) });
export const getBatchSchema = z.object({ batchId: z.string().min(1) });
export const listBatchesSchema = z.object({
  status: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
});
