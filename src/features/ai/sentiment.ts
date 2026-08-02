/**
 * 18 T-5 — feedback sentiment (FR-5, AC-6). NOT "use server".
 *
 * Classify → write the label back via **12.recordSentiment** (12 owns `Feedback`;
 * 18 NEVER writes it directly) → emit `SentimentClassified`. The label is
 * surfaced, never auto-acted on (no message is sent, no discount applied) — that
 * is a human/other-module decision.
 *
 * DEPENDENCY: `recordSentiment` is owned by module 12 (communications), built
 * concurrently. The import path + call signature match its contract; if 12 has
 * not merged yet this reference resolves only once the parent reconciles.
 */
import { db } from "@/lib/db";
import { emitEvent } from "@/lib/events";
import { completeStructured, redactText } from "@/lib/ai";
// 12 (communications) owns Feedback + this write-back action (contracts.md).
import { recordSentiment } from "@/features/communications/actions";
import { sentimentOutputSchema } from "./schema";
import { logInteraction } from "./internal";

const SYSTEM = "Classify the sentiment of a hotel guest's feedback as POSITIVE, NEUTRAL, or NEGATIVE with a confidence score.";

export type SentimentLabel = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

/** Classify feedback text via the provider (mock is deterministic). PII-redacted prompt. */
export async function classifyFeedbackText(text: string): Promise<{ label: SentimentLabel; score: number; provider: string }> {
  const { data, provider } = await completeStructured({
    system: SYSTEM,
    messages: [{ role: "user", content: redactText(text) }],
    feature: "sentiment",
    schema: sentimentOutputSchema,
  });
  return { label: data.label, score: data.score, provider };
}

/**
 * Full write-back path. Must run inside a request/system context (it emits an
 * event). Classifies, writes the label via 12, emits `SentimentClassified`, logs.
 */
export async function recordFeedbackSentiment(input: {
  feedbackId: string;
  text: string;
  propertyId: string | null;
  userId: string | null;
}): Promise<{ label: SentimentLabel; score: number }> {
  const { label, score, provider } = await classifyFeedbackText(input.text);

  // 12 owns the Feedback row — 18 never writes it directly (FR-5).
  await recordSentiment({ feedbackId: input.feedbackId, label, score });

  // Notify downstream (14 analytics). Surfaced, not auto-acted.
  await db.unscoped().$transaction(async (tx) => {
    await emitEvent(tx, {
      type: "SentimentClassified",
      aggregateId: input.feedbackId,
      propertyId: input.propertyId,
      payload: { label, score },
    });
  });

  await logInteraction({
    userId: input.userId,
    feature: "sentiment",
    provider,
    rawInput: { feedbackId: input.feedbackId, text: input.text },
    outputRef: `${label}:${score}`,
  });

  return { label, score };
}
