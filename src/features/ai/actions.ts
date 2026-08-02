"use server";

/**
 * 18 AI — server-action boundary (api-conventions.md). Thin wrappers: parse →
 * resolve session → delegate to the capability (which authorizes `ai:use` +
 * property scope) → typed Result. The capabilities take explicit claims so they
 * are unit/integration-testable without cookies (like 15's search).
 *
 * There is NO public entry point — every action requires an authenticated staff
 * session (`ai:use`). The guest-site chatbot is module 23.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { toResult, type Result } from "@/lib/result";
import {
  askSchema,
  chatSchema,
  forecastSchema,
  suggestRatesSchema,
  classifyFeedbackSchema,
} from "./schema";
import { nlSearch, type NlSearchResult } from "./nl-search";
import { chat, type ChatResult } from "./chat";
import { forecast, type ForecastOutput } from "./forecast";
import { suggestRates } from "./pricing";
import { updateSegments, type SegmentSummary } from "./segments";
import { recordFeedbackSentiment, type SentimentLabel } from "./sentiment";
import { withAiContext } from "./internal";
import { db } from "@/lib/db";
import type { RateSuggestion } from "./domain/pricing";

/** NL search: compile → validate (15) → run, masked (AC-4/5). */
export async function askPms(input: unknown): Promise<Result<NlSearchResult>> {
  return toResult(async () => {
    const { text } = askSchema.parse(input);
    const user = await requireUser();
    return nlSearch(user, { text });
  });
}

/** Staff chatbot with read-only tools (AC-3). */
export async function chatWithPms(input: unknown): Promise<Result<ChatResult>> {
  return toResult(async () => {
    const { message } = chatSchema.parse(input);
    const user = await requireUser();
    return chat(user, { message });
  });
}

/** Revenue/occupancy forecast — numbers grounded, LLM phrases only (AC-7). */
export async function forecastMetric(input: unknown): Promise<Result<ForecastOutput>> {
  return toResult(async () => {
    const data = forecastSchema.parse(input);
    const user = await requireUser();
    return forecast(user, data);
  });
}

/** Rate suggestions (also called directly by 24 with claims) (AC-8). */
export async function suggestRatesAction(input: unknown): Promise<Result<RateSuggestion[]>> {
  return toResult(async () => {
    const data = suggestRatesSchema.parse(input);
    const user = await requireUser();
    return suggestRates(user, data);
  });
}

/** Rebuild advisory guest segments (AC-9). */
export async function updateSegmentsAction(): Promise<Result<SegmentSummary[]>> {
  return toResult(async () => {
    const user = await requireUser();
    return updateSegments(user);
  });
}

/** Manually (re)classify a feedback's sentiment via 12.recordSentiment (AC-6). */
export async function classifyFeedback(input: unknown): Promise<Result<{ label: SentimentLabel; score: number }>> {
  return toResult(async () => {
    const { feedbackId } = classifyFeedbackSchema.parse(input);
    const user = await requireUser();
    // Read-only fetch of the comment (12 owns the row; 18 only reads here).
    const fb = await db.scoped(user).feedback.findFirst({
      where: { id: feedbackId },
      select: { comment: true, propertyId: true },
    });
    authorize(user, "ai:use", fb?.propertyId ?? null);
    const text = fb?.comment ?? "";
    return withAiContext(user, () =>
      recordFeedbackSentiment({ feedbackId, text, propertyId: fb?.propertyId ?? null, userId: user.userId }),
    );
  });
}
