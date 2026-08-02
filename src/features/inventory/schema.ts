/** Inventory input schemas (zod) — 20. Quantities are Float (kg/litre/cup). */
import { z } from "zod";

/** Movement reasons persisted on `InventoryMovement.reason`. */
export const MOVEMENT_REASONS = ["PURCHASE", "CONSUMPTION", "ADJUST"] as const;

export const createItemSchema = z.object({
  propertyId: z.string().min(1),
  name: z.string().min(1).max(120),
  unit: z.string().min(1).max(24),
  category: z.string().min(1).max(60),
  reorderLevel: z.number().nonnegative().default(0),
  lastCostPaise: z.number().int().nonnegative().optional(),
});
export type CreateItemInput = z.infer<typeof createItemSchema>;

export const updateItemSchema = z.object({
  itemId: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  unit: z.string().min(1).max(24).optional(),
  category: z.string().min(1).max(60).optional(),
  reorderLevel: z.number().nonnegative().optional(),
  lastCostPaise: z.number().int().nonnegative().optional(),
});
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

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
