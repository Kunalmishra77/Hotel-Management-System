/**
 * 18 T-8 — guest segmentation (FR-8, AC-9). NOT "use server".
 *
 * Computes advisory `GuestSegment` rows (rules + optional embeddings) for 12
 * marketing and emits `SegmentUpdated` per segment. Segments are advisory — they
 * drive campaigns in 12, they do not act on their own.
 *
 * `GuestSegment` is ORG-scoped (not property-scoped), so it is read/written via
 * the unscoped client filtered by `orgId`, exactly like guest search in 15.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import type { SessionClaims } from "@/lib/auth/claims";
import { computeSegments, type GuestFacts } from "./domain/segments";
import { withAiContext, logInteraction } from "./internal";

export type SegmentSummary = { id: string; name: string; size: number };

/** Rebuild the org's advisory segments. Requires `ai:use`. */
export async function updateSegments(user: SessionClaims): Promise<SegmentSummary[]> {
  authorize(user, "ai:use");
  const prisma = db.unscoped();

  const guests = await prisma.guest.findMany({
    where: { orgId: user.orgId, deletedAt: null },
    select: { id: true, city: true, companyName: true },
  });

  // Visit counts are DERIVED from reservations (never hand-maintained), scoped to
  // the properties the caller can access.
  const grouped = await prisma.reservation.groupBy({
    by: ["guestId"],
    where: { propertyId: { in: user.accessiblePropertyIds }, status: { in: ["IN_HOUSE", "CHECKED_OUT"] } },
    _count: { _all: true },
  });
  const visits = new Map<string, number>();
  for (const g of grouped) visits.set(g.guestId, g._count._all);

  const facts: GuestFacts[] = guests.map((g) => ({
    guestId: g.id,
    city: g.city,
    visitCount: visits.get(g.id) ?? 0,
    isCorporate: Boolean(g.companyName),
  }));

  const computed = computeSegments(facts);

  const summaries = await withAiContext(user, async () => {
    const out: SegmentSummary[] = [];
    for (const seg of computed) {
      const existing = await prisma.guestSegment.findFirst({
        where: { orgId: user.orgId, name: seg.name },
        select: { id: true },
      });
      // Write the segment and emit its event in ONE transaction (business-rules §20).
      const row = await prisma.$transaction(async (tx) => {
        const saved = existing
          ? await tx.guestSegment.update({
              where: { id: existing.id },
              data: { ruleJson: seg.rule as unknown as Prisma.InputJsonValue, guestIds: seg.guestIds },
              select: { id: true, name: true },
            })
          : await tx.guestSegment.create({
              data: { orgId: user.orgId, name: seg.name, ruleJson: seg.rule as unknown as Prisma.InputJsonValue, guestIds: seg.guestIds },
              select: { id: true, name: true },
            });
        await emitEvent(tx, {
          type: "SegmentUpdated",
          aggregateId: saved.id,
          propertyId: null,
          payload: { name: saved.name, size: seg.guestIds.length },
        });
        return saved;
      });

      out.push({ id: row.id, name: row.name, size: seg.guestIds.length });
    }
    return out;
  });

  await logInteraction({
    userId: user.userId,
    feature: "generic",
    provider: "grounded",
    rawInput: { guests: guests.length },
    outputRef: `${summaries.length} segments`,
  });

  return summaries;
}
