/**
 * 18 AI — zod boundary schemas (api-conventions.md). Every action input is
 * parsed here; the structured-output schema is what the provider's JSON is
 * re-validated against before use (AC-2).
 */
import { z } from "zod";
import { ENTITY_KINDS } from "@/features/search/types";

/** Chatbot / NL-search free-text input. */
export const askSchema = z.object({
  text: z.string().trim().min(1).max(500),
});

export const chatSchema = z.object({
  message: z.string().trim().min(1).max(500),
});

/**
 * The shape the LLM must emit for NL-search — mirrors 15's `StructuredQuery`.
 * This is only the FIRST gate: the object is then passed to
 * `15.validateStructuredQuery`, the authoritative field allow-list (FR-4).
 */
const filterOp = z.enum(["eq", "contains", "gte", "lte", "in"]);
export const structuredQueryOutputSchema = z.object({
  entity: z.enum(ENTITY_KINDS),
  filters: z
    .array(
      z.object({
        field: z.string().min(1).max(60),
        op: filterOp,
        value: z.union([z.string(), z.number(), z.array(z.string())]),
      }),
    )
    .max(20),
  dateRange: z
    .object({ field: z.string().min(1).max(60), from: z.coerce.date(), to: z.coerce.date() })
    .optional(),
  sort: z.object({ field: z.string().min(1).max(60), dir: z.enum(["asc", "desc"]) }).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

/** The shape the LLM must emit for sentiment classification (FR-5). */
export const sentimentOutputSchema = z.object({
  label: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
  score: z.number().min(0).max(1),
});

export const forecastSchema = z.object({
  propertyId: z.string().min(1),
  metric: z.enum(["revenue", "occupancy", "expense", "profit"]).default("revenue"),
  horizonDays: z.number().int().min(1).max(90).default(14),
});

export const suggestRatesSchema = z.object({
  propertyId: z.string().min(1),
  categoryId: z.string().min(1),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export const classifyFeedbackSchema = z.object({
  feedbackId: z.string().min(1),
});

export type AskInput = z.infer<typeof askSchema>;
export type ChatInput = z.infer<typeof chatSchema>;
export type ForecastInput = z.infer<typeof forecastSchema>;
export type SuggestRatesInput = z.infer<typeof suggestRatesSchema>;
