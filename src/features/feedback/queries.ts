/**
 * Guest feedback & reviews — the manager-facing surface over the `Feedback` model
 * that AI sentiment (18) labels and guest-history (05) shows per guest. Property
 * scoped, `guest:view` (feedback carries a guest name + comment; same gate as the
 * guest list). Sentiment is AI-labelled POSITIVE | NEUTRAL | NEGATIVE (nullable
 * until classified).
 */
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import type { SessionClaims } from "@/lib/auth/claims";

export type FeedbackOverview = {
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  unlabelled: number;
  avgRating: number | null;
};

export async function feedbackOverview(user: SessionClaims, propertyId: string): Promise<FeedbackOverview> {
  authorize(user, "guest:view", propertyId);
  const scoped = db.scoped(user);
  const where = { propertyId };
  const [groups, agg, total] = await Promise.all([
    scoped.feedback.groupBy({ by: ["sentiment"], where, _count: { _all: true } }),
    scoped.feedback.aggregate({ where: { ...where, rating: { not: null } }, _avg: { rating: true } }),
    scoped.feedback.count({ where }),
  ]);
  const c = (s: string | null) => groups.find((g) => g.sentiment === s)?._count._all ?? 0;
  return {
    total,
    positive: c("POSITIVE"),
    neutral: c("NEUTRAL"),
    negative: c("NEGATIVE"),
    unlabelled: c(null),
    avgRating: agg._avg.rating,
  };
}

export type FeedbackItem = {
  id: string;
  guestId: string;
  guestName: string;
  rating: number | null;
  comment: string | null;
  sentiment: string | null;
  sentimentScore: number | null;
  source: string | null;
  createdAt: Date;
};

export async function listFeedback(
  user: SessionClaims,
  input: { propertyId: string; sentiment?: string; cursor?: string; limit?: number },
): Promise<{ feedback: FeedbackItem[]; nextCursor: string | null }> {
  authorize(user, "guest:view", input.propertyId);
  const limit = input.limit ?? 25;
  const rows = await db.scoped(user).feedback.findMany({
    where: {
      propertyId: input.propertyId,
      ...(input.sentiment ? { sentiment: input.sentiment } : {}),
    },
    select: {
      id: true,
      guestId: true,
      rating: true,
      comment: true,
      sentiment: true,
      sentimentScore: true,
      source: true,
      createdAt: true,
      guest: { select: { fullName: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    feedback: page.map((r) => ({
      id: r.id,
      guestId: r.guestId,
      guestName: r.guest.fullName,
      rating: r.rating,
      comment: r.comment,
      sentiment: r.sentiment,
      sentimentScore: r.sentimentScore,
      source: r.source,
      createdAt: r.createdAt,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}
