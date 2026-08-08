/**
 * 18 T-8 — guest segmentation (FR-8, AC-9). NOT "use server".
 *
 * Computes advisory `GuestSegment` rows for 12 marketing and emits `SegmentUpdated`
 * per segment. Two layers, both grounded:
 *   1. a transparent RULE engine (city, repeat-visit, corporate) — deterministic,
 *      always runs, and each row carries a `ruleJson` so humans see WHY;
 *   2. an embeddings REFINEMENT (`domain/clustering`) that adds "look-alike" groups
 *      from guest-profile embeddings. It degrades to rules-only if the provider has
 *      no embeddings endpoint, so dev/CI/no-key still works end-to-end.
 *
 * Segments are ADVISORY — they drive campaigns in 12, they never act on their own.
 *
 * `GuestSegment` is ORG-scoped (not property-scoped), so it is read/written via the
 * unscoped client filtered by `orgId`, exactly like guest search in 15.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import { getLLMProvider, currentProviderName } from "@/lib/ai";
import { isDomainError } from "@/lib/errors";
import type { SessionClaims } from "@/lib/auth/claims";
import { computeSegments, type GuestFacts } from "./domain/segments";
import { clusterGuests, type EmbeddedGuest } from "./domain/clustering";
import { withAiContext, logInteraction } from "./internal";

export type SegmentSummary = { id: string; name: string; size: number };

/** A segment ready to persist — rule-derived or look-alike, same write shape. */
type WritableSegment = { name: string; rule: unknown; guestIds: string[] };

const LOOKALIKE_PREFIX = "Look-alike Group ";
/** Only bother clustering once there are enough guests for groups to be meaningful. */
const LOOKALIKE_MIN_GUESTS = 6;

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

  const ruleSegments: WritableSegment[] = computeSegments(facts).map((s) => ({ name: s.name, rule: s.rule, guestIds: s.guestIds }));

  // Layer 2: embeddings refinement (best-effort, grounded, deterministic on mock).
  const lookalikeSegments = await buildLookalikeSegments(
    guests.map((g) => ({ id: g.id, city: g.city, companyName: g.companyName, visitCount: visits.get(g.id) ?? 0 })),
  );

  const toWrite = [...ruleSegments, ...lookalikeSegments];
  const currentNames = new Set(toWrite.map((s) => s.name));

  const summaries = await withAiContext(user, async () => {
    const out: SegmentSummary[] = [];
    for (const seg of toWrite) {
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

    // Prune stale look-alike groups: cluster COUNT shrinks run-to-run as the guest
    // population shifts, so an old "Look-alike Group D" must not linger with stale
    // membership and mislead a campaign. Rule segments are stable-by-name and left as-is.
    await prisma.guestSegment.deleteMany({
      where: { orgId: user.orgId, name: { startsWith: LOOKALIKE_PREFIX, notIn: [...currentNames] } },
    });

    return out;
  });

  await logInteraction({
    userId: user.userId,
    feature: "generic",
    provider: lookalikeSegments.length > 0 ? currentProviderName() : "grounded",
    rawInput: { guests: guests.length },
    outputRef: `${summaries.length} segments (${lookalikeSegments.length} look-alike)`,
  });

  return summaries;
}

type LookalikeGuest = { id: string; city: string | null; companyName: string | null; visitCount: number };

/**
 * Embed each guest's non-PII profile and cluster into look-alike groups. Returns
 * `[]` (rules-only) when the population is too small OR the provider has no usable
 * embeddings endpoint — the caller still produces the rule segments.
 */
async function buildLookalikeSegments(guests: LookalikeGuest[]): Promise<WritableSegment[]> {
  if (guests.length < LOOKALIKE_MIN_GUESTS) return [];

  // PROFILE TEXT is deliberately non-PII: city, company (a business name, not a
  // person), and a coarse visit band — never name/phone/email/ID (compliance.md).
  const texts = guests.map((g) => profileText(g));

  let vectors: number[][];
  try {
    vectors = await getLLMProvider().embed(texts);
  } catch (e) {
    // A provider with no embeddings endpoint (e.g. Anthropic) must not break
    // segmentation — degrade to rules-only.
    if (!isDomainError(e)) throw e;
    return [];
  }
  if (vectors.length !== guests.length || vectors.some((v) => v.length === 0)) return [];

  const embedded: EmbeddedGuest[] = guests.map((g, i) => ({ guestId: g.id, vector: vectors[i]! }));
  // Aim for ~one group per 3 guests, capped at 4 to keep segments actionable.
  const k = Math.min(4, Math.floor(guests.length / 3));
  const clusters = clusterGuests(embedded, k);

  return clusters.map((c) => ({
    name: `${LOOKALIKE_PREFIX}${String.fromCharCode(65 + c.index)}`, // A, B, C, D
    rule: { kind: "lookalike", cluster: c.index, size: c.guestIds.length },
    guestIds: c.guestIds,
  }));
}

function profileText(g: LookalikeGuest): string {
  const band = g.visitCount >= 3 ? "frequent" : g.visitCount >= 1 ? "returning" : "new";
  return [`city:${g.city ?? "unknown"}`, `company:${g.companyName ?? "individual"}`, `visits:${band}`].join(" ");
}
