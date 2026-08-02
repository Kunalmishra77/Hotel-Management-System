/**
 * Zod schemas for 02-room-inventory — api-conventions.md.
 */
import { z } from "zod";

/**
 * Money in PAISE, integer (data-model.md). The form collects rupees; the
 * boundary converts once, here, so no downstream code ever sees a float.
 */
const paiseSchema = z
  .number()
  .int("Amount must be a whole number of paise.")
  .min(0, "Amount cannot be negative.")
  .max(100_000_000, "That rate looks wrong (over ₹10,00,000).");

/** HSN/SAC for GST on room tariff — 6-8 digits when present. */
const hsnSacSchema = z
  .string()
  .trim()
  .regex(/^\d{4,8}$/, "HSN/SAC should be 4–8 digits (room tariff is usually 996311).")
  .optional()
  .nullable()
  .or(z.literal("").transform(() => null));

export const createCategorySchema = z.object({
  propertyId: z.string().min(1),
  name: z.string().trim().min(1, "Category name is required.").max(60),
  baseRatePaise: paiseSchema,
  maxAdults: z.number().int().min(1, "At least one adult.").max(20).default(2),
  maxChildren: z.number().int().min(0).max(20).default(1),
  hsnSac: hsnSacSchema,
  /** Dynamic-pricing guardrails (24); optional at creation. */
  floorPaise: paiseSchema.optional().nullable(),
  ceilPaise: paiseSchema.optional().nullable(),
  /** Room GST slab in basis points; 1200 = 12%. */
  gstBps: z.number().int().min(0).max(10_000).default(1200),
});

export const updateCategorySchema = createCategorySchema
  .partial()
  .extend({ id: z.string().min(1) });

export const createRoomSchema = z.object({
  propertyId: z.string().min(1),
  categoryId: z.string().min(1, "A category is required."),
  floorId: z.string().min(1).optional().nullable(),
  number: z
    .string()
    .trim()
    .min(1, "Room number is required.")
    .max(10, "Room number must be 10 characters or fewer."),
});

export const updateRoomSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1).optional(),
  floorId: z.string().min(1).optional().nullable(),
  number: z.string().trim().min(1).max(10).optional(),
});

export const changeRoomStatusSchema = z.object({
  roomId: z.string().min(1),
  to: z.enum(["VACANT", "OCCUPIED", "RESERVED", "UNDER_MAINTENANCE", "HOUSEKEEPING"]),
  /** Recorded on the audit row; useful when a transition is unusual. */
  note: z.string().trim().max(200).optional().nullable(),
});

export const deactivateRoomSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().max(200).optional().nullable(),
});

/**
 * A block range is half-open [startDate, endDate) — see domain/blocks.ts.
 * Dates are property-local calendar days (`@db.Date`), never instants.
 */
export const blockRoomSchema = z
  .object({
    roomId: z.string().min(1),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    reason: z.string().trim().min(1, "A reason is required.").max(200),
    /** Set when 11.blockRoom raises the block for a maintenance job. */
    maintenanceJobId: z.string().min(1).optional().nullable(),
  })
  .refine((v) => v.endDate.getTime() > v.startDate.getTime(), {
    message: "The block must end after it starts.",
    path: ["endDate"],
  });

export const unblockRoomSchema = z.object({ blockId: z.string().min(1) });

export const roomBoardFilterSchema = z.object({
  propertyId: z.string().min(1),
  floorId: z.string().min(1).optional().nullable(),
  categoryId: z.string().min(1).optional().nullable(),
  status: z
    .enum(["VACANT", "OCCUPIED", "RESERVED", "UNDER_MAINTENANCE", "HOUSEKEEPING"])
    .optional()
    .nullable(),
});

export type CreateCategoryInput = z.input<typeof createCategorySchema>;
export type CreateRoomInput = z.input<typeof createRoomSchema>;
export type RoomBoardFilter = z.output<typeof roomBoardFilterSchema>;
