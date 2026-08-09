/** Inventory input schemas (zod) — 20. Quantities are Float (kg/litre/cup). */
import { z } from "zod";

/** Movement reasons persisted on `InventoryMovement.reason`. */
export const MOVEMENT_REASONS = ["PURCHASE", "CONSUMPTION", "ADJUST"] as const;

/** The 6 MoM inventory domains. */
export const INVENTORY_DOMAINS = ["GENERAL", "HOUSEKEEPING", "LAUNDRY", "KITCHEN", "MAINTENANCE", "STORE"] as const;

export const createItemSchema = z.object({
  propertyId: z.string().min(1),
  name: z.string().min(1).max(120),
  unit: z.string().min(1).max(24),
  domain: z.enum(INVENTORY_DOMAINS).default("GENERAL"),
  category: z.string().min(1).max(60),
  reorderLevel: z.number().nonnegative().default(0),
  lastCostPaise: z.number().int().nonnegative().optional(),
});
export type CreateItemInput = z.infer<typeof createItemSchema>;

export const updateItemSchema = z.object({
  itemId: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  unit: z.string().min(1).max(24).optional(),
  domain: z.enum(INVENTORY_DOMAINS).optional(),
  category: z.string().min(1).max(60).optional(),
  reorderLevel: z.number().nonnegative().optional(),
  lastCostPaise: z.number().int().nonnegative().optional(),
});
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

// --- Laundry reconciliation (FR-8/9) ---
export const createLaundryBatchSchema = z.object({
  propertyId: z.string().min(1),
  sentOn: z.coerce.date(),
  vendor: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        itemName: z.string().trim().min(1).max(120),
        sentQty: z.number().int().positive(),
        toleranceQty: z.number().int().nonnegative().default(0),
      }),
    )
    .min(1),
});
export type CreateLaundryBatchInput = z.infer<typeof createLaundryBatchSchema>;

export const recordLaundryReturnsSchema = z.object({
  batchId: z.string().min(1),
  returns: z
    .array(z.object({ itemId: z.string().min(1), returnedQty: z.number().int().nonnegative() }))
    .min(1),
});
export type RecordLaundryReturnsInput = z.infer<typeof recordLaundryReturnsSchema>;

export const recordMovementSchema = z.object({
  itemId: z.string().min(1),
  /** + for purchase/receipt, − for consumption. Non-zero. */
  delta: z.number().refine((n) => n !== 0, "Delta must be non-zero."),
  reason: z.enum(MOVEMENT_REASONS),
  /** Optional source reference, e.g. an 07 expense: refType "Expense", refId <id>. */
  refType: z.string().max(40).optional(),
  refId: z.string().max(60).optional(),
});
export type RecordMovementInput = z.infer<typeof recordMovementSchema>;

/** Stock-take: reconcile on-hand to a physically counted quantity (AC-9). */
export const adjustStockSchema = z.object({
  itemId: z.string().min(1),
  countedQuantity: z.number().nonnegative(),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
