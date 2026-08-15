/**
 * Assets & equipment registry (architecture v2 · Phase 5) — zod boundary.
 */
import { z } from "zod";

export const ASSET_CATEGORIES = ["AC", "TV", "FRIDGE", "HEATER", "ELEVATOR", "GENERATOR", "KITCHEN", "OTHER"] as const;
export const ASSET_STATUSES = ["OPERATIONAL", "UNDER_REPAIR", "OUT_OF_SERVICE"] as const;

export const createAssetSchema = z.object({
  name: z.string().trim().min(1, "Name the asset.").max(120),
  category: z.enum(ASSET_CATEGORIES),
  location: z.string().trim().max(80).optional(),
  serialNo: z.string().trim().max(80).optional(),
  warrantyUntil: z.string().trim().max(20).optional(), // yyyy-mm-dd
  notes: z.string().trim().max(500).optional(),
});
export type CreateAssetInput = z.input<typeof createAssetSchema>;

export const updateAssetStatusSchema = z.object({
  assetId: z.string().min(1),
  status: z.enum(ASSET_STATUSES),
});
