/**
 * Zod schemas for 01-property-management — api-conventions.md
 * ("every input boundary validated"; schemas live in features/*​/schema.ts").
 *
 * Covers AC-10: missing required fields are rejected with field messages and
 * nothing persists.
 */
import { z } from "zod";
import { validateGstin } from "./domain/gstin";

/** IANA zone; the property's business-date maths depends on it (data-model.md). */
const timezoneSchema = z
  .string()
  .trim()
  .min(1, "Timezone is required.")
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "That isn't a recognised timezone (e.g. Asia/Kolkata).");

/**
 * GSTIN is optional (FR-1) but must be well-formed AND checksum-valid when
 * present (FR-3). Transformed to the normalised upper-case form so the stored
 * value is canonical.
 */
const gstinSchema = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v === undefined || v === null || v === "" ? null : v))
  .superRefine((value, ctx) => {
    if (value === null) return;
    const result = validateGstin(value);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error });
    }
  })
  .transform((v) => (v === null ? null : v.trim().toUpperCase()));

/** Indian PIN: exactly 6 digits, never starting 0. */
const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, "Enter a valid 6-digit PIN code.");

/**
 * The invoice-numbering code. Uppercase alphanumeric and short, because it is
 * embedded in gap-free invoice numbers per property/FY (06 FR-13) — a code with
 * punctuation or spaces would make those numbers ambiguous.
 */
const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, "Code must be at least 2 characters.")
  .max(8, "Code must be 8 characters or fewer.")
  .regex(/^[A-Z0-9]+$/, "Code may contain only letters and numbers.");

export const createPropertySchema = z.object({
  name: z.string().trim().min(1, "Property name is required.").max(120),
  code: codeSchema,
  addressLine1: z.string().trim().min(1, "Address line 1 is required.").max(200),
  addressLine2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(1, "City is required.").max(80),
  state: z.string().trim().min(1, "State is required.").max(80),
  country: z.string().trim().min(1).max(80).default("India"),
  pincode: pincodeSchema,
  timezone: timezoneSchema.default("Asia/Kolkata"),
  gstin: gstinSchema,
  ownerName: z.string().trim().max(120).optional().nullable(),
  ownerContact: z.string().trim().max(40).optional().nullable(),
});

/** Update takes the id plus any subset of the editable fields. */
export const updatePropertySchema = createPropertySchema
  .partial()
  .extend({ id: z.string().min(1) });

export const deactivatePropertySchema = z.object({
  id: z.string().min(1),
  /** `property:manage` is 🔒 for Manager, so the audit row wants a reason. */
  reason: z.string().trim().max(500).optional().nullable(),
});

export const addFloorSchema = z.object({
  propertyId: z.string().min(1),
  name: z.string().trim().min(1, "Floor name is required.").max(40),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export const reorderFloorsSchema = z.object({
  propertyId: z.string().min(1),
  /** Floor ids in their new display order. */
  floorIds: z.array(z.string().min(1)).min(1, "At least one floor is required."),
});

export type CreatePropertyInput = z.input<typeof createPropertySchema>;
export type UpdatePropertyInput = z.input<typeof updatePropertySchema>;
export type AddFloorInput = z.input<typeof addFloorSchema>;
