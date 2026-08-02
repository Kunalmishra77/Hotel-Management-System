/**
 * Zod boundary schemas for 15 (api-conventions.md). The cursor arrives from the
 * client as the opaque encoded string; the action decodes it. Structured-query
 * values stay literal (validated further against the allow-list in the domain).
 */
import { z } from "zod";
import { ENTITY_KINDS } from "./types";

const entityKind = z.enum(ENTITY_KINDS);

const dateRange = z.object({
  field: z.string().min(1).max(40),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export const unifiedSearchSchema = z.object({
  keyword: z.string().trim().max(200).optional(),
  entities: z.array(entityKind).max(ENTITY_KINDS.length).optional(),
  filters: z
    .object({
      propertyId: z.string().min(1).optional(),
      bookingSource: z.string().min(1).max(40).optional(),
      dateRange: dateRange.optional(),
    })
    .optional(),
  cursor: z.string().max(2000).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type UnifiedSearchInput = z.infer<typeof unifiedSearchSchema>;

export const exportSchema = z.object({
  keyword: z.string().trim().max(200).optional(),
  entities: z.array(entityKind).max(ENTITY_KINDS.length).optional(),
  filters: unifiedSearchSchema.shape.filters,
  format: z.enum(["csv", "xlsx", "pdf"]),
});
export type ExportInput = z.infer<typeof exportSchema>;

const filterOp = z.enum(["eq", "contains", "gte", "lte", "in"]);

export const structuredQuerySchema = z.object({
  entity: entityKind,
  filters: z
    .array(
      z.object({
        field: z.string().min(1).max(60),
        op: filterOp,
        value: z.union([z.string(), z.number(), z.array(z.string())]),
      }),
    )
    .max(20),
  dateRange: dateRange.optional(),
  sort: z.object({ field: z.string().min(1).max(60), dir: z.enum(["asc", "desc"]) }).optional(),
  cursor: z.string().max(2000).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export type StructuredQueryInput = z.infer<typeof structuredQuerySchema>;
