/**
 * 18 T-5 — sentiment consumer (FR-5, AC-6). Reacts to `FeedbackReceived` (12):
 * classify the new feedback and write the label back via 12.recordSentiment,
 * then emit `SentimentClassified`. Idempotency is handled by the dispatcher's
 * dedupe ledger; re-running only re-labels (no side effect beyond the label).
 *
 * The comment is taken from the event payload when present; otherwise it is read
 * read-only. 18 never WRITES `Feedback` — that stays with 12.
 */
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { logger } from "@/lib/logger";
import { registerConsumer, type EventConsumer, type EventEnvelope } from "@/lib/events/dispatch";
import { recordFeedbackSentiment } from "./sentiment";

async function handle(envelope: EventEnvelope): Promise<void> {
  const feedbackId = envelope.aggregateId;
  const payload = (envelope.payload ?? {}) as { comment?: string; rating?: number };

  let text = payload.comment ?? "";
  let propertyId = envelope.propertyId;
  if (!text) {
    // Read-only fallback to fetch the comment (12 owns the table; we only read).
    const fb = await db.unscoped().feedback.findUnique({
      where: { id: feedbackId },
      select: { comment: true, propertyId: true },
    });
    text = fb?.comment ?? "";
    propertyId = propertyId ?? fb?.propertyId ?? null;
  }
  if (!text) {
    logger.info("ai.sentiment.skipped_no_text", { feedbackId });
    return;
  }

  await runWithSystemContext(envelope.orgId, () =>
    recordFeedbackSentiment({ feedbackId, text, propertyId, userId: null }),
  );
}

export const aiSentimentConsumer: EventConsumer = {
  name: "ai-sentiment",
  types: ["FeedbackReceived"],
  handle,
};

let registered = false;
export function registerAiSentimentConsumer(): void {
  if (registered) return;
  registerConsumer(aiSentimentConsumer);
  registered = true;
}
