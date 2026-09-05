/**
 * Zod schemas for 04-guest-crm — api-conventions.md.
 *
 * Contact validation is FR-6: a missing/invalid mobile, or a malformed
 * email/GSTIN, is rejected at the boundary and nothing persists.
 */
import { z } from "zod";
import { isValidIndianMobile, normalizeEmail } from "./domain/normalize";

const optionalString = (max: number) =>
  z.string().trim().max(max).optional().nullable().or(z.literal("").transform(() => null));

/** FR-6: mobile is required and must be a valid Indian mobile. */
const mobileSchema = z
  .string()
  .trim()
  .min(1, "Mobile number is required.")
  .refine(isValidIndianMobile, "Enter a valid 10-digit Indian mobile number.");

const emailSchema = z
  .string()
  .trim()
  .optional()
  .nullable()
  .superRefine((value, ctx) => {
    if (!value) return;
    if (normalizeEmail(value) === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid email address." });
    }
  });

const gstinSchema = z
  .string()
  .trim()
  .optional()
  .nullable()
  .superRefine((value, ctx) => {
    if (!value) return;
    if (!/^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test(value.replace(/\s/g, ""))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "That doesn't look like a GSTIN." });
    }
  });

export const createGuestSchema = z.object({
  fullName: z.string().trim().min(1, "Guest name is required.").max(120),
  mobile: mobileSchema,
  whatsapp: z.string().trim().optional().nullable(),
  email: emailSchema,
  gender: optionalString(20),
  dob: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 1990-05-01.")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  nationality: optionalString(60),
  occupation: optionalString(60),
  addressLine: optionalString(200),
  city: optionalString(80),
  state: optionalString(80),
  country: optionalString(80),
  pincode: optionalString(10),
  companyName: optionalString(120),
  gstNumber: gstinSchema,
  purposeOfVisit: optionalString(120),
  specialRequests: optionalString(500),
  foodPreference: optionalString(60),
  medicalNotes: optionalString(500),
  preferredRoomCategoryId: z.string().min(1).optional().nullable(),
  preferredFloor: optionalString(40),
  /** Explicit "yes, create despite a probable duplicate" (FR-5). */
  confirmDuplicate: z.boolean().optional().default(false),
});

export const updateGuestSchema = createGuestSchema
  .partial()
  .extend({ id: z.string().min(1) });

export const addGuestIdSchema = z.object({
  guestId: z.string().min(1),
  type: z.enum(["AADHAAR", "PASSPORT", "DRIVING_LICENCE", "PAN", "VOTER_ID", "VISA"]),
  /** The ID number — OPTIONAL. The finalized front-desk workflow captures the
   *  document as an IMAGE; a typed number is no longer required (and for Aadhaar
   *  we deliberately don't force one). */
  value: z.string().trim().max(60).optional().nullable(),
  /** FRONT / primary document image (base64), optional. */
  scanBase64: z.string().optional().nullable(),
  scanContentType: z.string().optional().nullable(),
  /** BACK image (base64) — e.g. the Aadhaar reverse. Optional. */
  backScanBase64: z.string().optional().nullable(),
  backScanContentType: z.string().optional().nullable(),
});

export const revealPiiSchema = z.object({
  guestId: z.string().min(1),
  field: z.enum(["mobile", "whatsapp", "email", "id"]),
  /** The ID row, when field === "id". */
  guestIdRowId: z.string().min(1).optional().nullable(),
  reason: z.string().trim().min(1, "A reason is required to reveal PII.").max(300),
});

export const mergeGuestsSchema = z
  .object({
    survivorId: z.string().min(1),
    loserId: z.string().min(1),
    reason: z.string().trim().max(300).optional().nullable(),
  })
  .refine((v) => v.survivorId !== v.loserId, {
    message: "A guest cannot be merged into itself.",
    path: ["loserId"],
  });

export const guestActionSchema = z.object({
  guestId: z.string().min(1),
  reason: z.string().trim().max(300).optional().nullable(),
});

export const searchGuestsSchema = z.object({
  query: z.string().trim().max(120).optional().default(""),
  cursor: z.string().min(1).optional().nullable(),
  limit: z.number().int().min(1).max(50).optional().default(20),
});

export type CreateGuestInput = z.input<typeof createGuestSchema>;
export type AddGuestIdInput = z.input<typeof addGuestIdSchema>;
export type SearchGuestsInput = z.output<typeof searchGuestsSchema>;
