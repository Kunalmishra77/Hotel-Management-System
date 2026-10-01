"use server";

/**
 * Public feedback submission (#26) — the guest scans the in-room/reception QR and
 * submits a short review with NO session. The token (not the raw id) identifies the
 * stay, so the Feedback row is attached to the right guest + property. Validated,
 * bounded, and append-only via createFeedback (which emits FeedbackReceived →
 * sentiment classification downstream).
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { toResult, type Result } from "@/lib/result";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { createFeedback } from "@/features/communications/webhook";
import { verifyReviewToken } from "./review-token";

const schema = z.object({
  token: z.string().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional().nullable().or(z.literal("").transform(() => null)),
  recommend: z.coerce.number().int().min(1).max(5).optional().nullable(),
});

export async function submitPublicReview(input: unknown): Promise<Result<{ ok: true }>> {
  return toResult(async () => {
    const data = schema.parse(input);
    const reservationId = verifyReviewToken(data.token);
    if (!reservationId) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "This feedback link is not valid.", {
        publicMessage: "This feedback link is not valid or has expired.",
      });
    }
    const r = await db.unscoped().reservation.findFirst({
      where: { id: reservationId },
      select: { guestId: true, propertyId: true },
    });
    if (!r) throw new NotFoundError("Booking not found.");

    // Fold the optional "recommend" score into the comment (no schema change needed).
    const parts = [data.comment, data.recommend ? `Would recommend: ${data.recommend}/5` : null].filter(Boolean);
    const comment = parts.length ? parts.join(" · ") : null;

    await db.unscoped().$transaction(async (tx) => {
      await createFeedback(tx, {
        guestId: r.guestId,
        propertyId: r.propertyId,
        rating: data.rating,
        comment,
        source: "qr-review",
      });
    });
    return { ok: true as const };
  });
}
