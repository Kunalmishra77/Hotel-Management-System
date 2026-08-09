/** 27 owner-portal — zod input schemas. */
import { z } from "zod";

export const DOC_CATEGORIES = ["AGREEMENT", "LICENCE", "TAX", "STATEMENT", "OTHER"] as const;

export const uploadOwnerDocumentSchema = z.object({
  propertyId: z.string().min(1),
  category: z.enum(DOC_CATEGORIES),
  title: z.string().trim().min(1).max(200),
  contentType: z.string().min(1).max(120),
  // The document, base64-encoded (same convention as ID scans / signatures).
  fileBase64: z.string().min(1),
});
export type UploadOwnerDocumentInput = z.infer<typeof uploadOwnerDocumentSchema>;

export const deleteOwnerDocumentSchema = z.object({ documentId: z.string().min(1) });

export const IMPORTANT_DATE_KINDS = ["LICENCE", "GST", "AMC", "INSURANCE", "OTHER"] as const;

export const createImportantDateSchema = z.object({
  propertyId: z.string().min(1),
  kind: z.enum(IMPORTANT_DATE_KINDS),
  label: z.string().trim().min(1).max(160),
  dueDate: z.coerce.date(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateImportantDateInput = z.infer<typeof createImportantDateSchema>;

export const deleteImportantDateSchema = z.object({ dateId: z.string().min(1) });

export const setManagementFeeSchema = z.object({
  propertyId: z.string().min(1),
  feeBps: z.number().int().min(0).max(10000), // 0–100%
});

export const recordOwnerPayoutSchema = z.object({
  propertyId: z.string().min(1),
  // Any date within the target month; normalized to the month's first day.
  periodMonth: z.coerce.date(),
});

export const markPayoutPaidSchema = z.object({
  payoutId: z.string().min(1),
  paymentRef: z.string().trim().min(1).max(80),
});
