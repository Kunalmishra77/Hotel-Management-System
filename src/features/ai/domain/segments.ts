/**
 * 18 T-8 — guest segmentation rules (FR-8, AC-9). PURE and deterministic.
 *
 * Segments are ADVISORY groupings for 12 marketing. The baseline is a
 * transparent rule engine (city, repeat-visit count, corporate); embeddings can
 * refine membership when a live provider is configured, but the rules are what
 * make dev/CI deterministic. Each segment carries a `ruleJson` so 12/humans can
 * see WHY a guest is in it.
 */

export type GuestFacts = {
  guestId: string;
  city: string | null;
  visitCount: number;
  isCorporate: boolean;
};

export type SegmentRule =
  | { kind: "city"; city: string }
  | { kind: "repeat"; minVisits: number }
  | { kind: "corporate" };

export type ComputedSegment = {
  name: string;
  rule: SegmentRule;
  guestIds: string[];
};

const REPEAT_MIN_VISITS = 3;

/** Which rules a single guest matches — used for both building segments and testing. */
export function matchesRule(guest: GuestFacts, rule: SegmentRule): boolean {
  switch (rule.kind) {
    case "city":
      return (guest.city ?? "").toLowerCase() === rule.city.toLowerCase();
    case "repeat":
      return guest.visitCount >= rule.minVisits;
    case "corporate":
      return guest.isCorporate;
  }
}

/**
 * Build the advisory segments from a guest population. Deterministic ordering
 * (segment name asc, guest id asc) so repeated runs produce stable membership.
 */
export function computeSegments(guests: GuestFacts[]): ComputedSegment[] {
  const cities = new Set<string>();
  for (const g of guests) if (g.city) cities.add(g.city);

  const rules: { name: string; rule: SegmentRule }[] = [
    { name: "Repeat Guests", rule: { kind: "repeat", minVisits: REPEAT_MIN_VISITS } },
    { name: "Corporate Guests", rule: { kind: "corporate" } },
    ...[...cities].sort().map((city) => ({ name: `${city} Guests`, rule: { kind: "city", city } as SegmentRule })),
  ];

  const segments: ComputedSegment[] = [];
  for (const { name, rule } of rules) {
    const guestIds = guests
      .filter((g) => matchesRule(g, rule))
      .map((g) => g.guestId)
      .sort();
    if (guestIds.length > 0) segments.push({ name, rule, guestIds });
  }
  return segments.sort((a, b) => a.name.localeCompare(b.name));
}
