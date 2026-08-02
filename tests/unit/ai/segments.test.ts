/**
 * 18 T-8 — segmentation rules (FR-8, AC-9). Deterministic, advisory.
 */
import { describe, expect, it } from "vitest";
import { computeSegments, matchesRule, type GuestFacts } from "@/features/ai/domain/segments";

const guests: GuestFacts[] = [
  { guestId: "g1", city: "Bangalore", visitCount: 4, isCorporate: false },
  { guestId: "g2", city: "Bangalore", visitCount: 1, isCorporate: true },
  { guestId: "g3", city: "Pune", visitCount: 3, isCorporate: false },
  { guestId: "g4", city: null, visitCount: 0, isCorporate: false },
];

describe("computeSegments (AC-9)", () => {
  it("groups repeat, corporate, and city segments", () => {
    const segs = computeSegments(guests);
    const byName = Object.fromEntries(segs.map((s) => [s.name, s.guestIds]));
    expect(byName["Repeat Guests"]).toEqual(["g1", "g3"]);
    expect(byName["Corporate Guests"]).toEqual(["g2"]);
    expect(byName["Bangalore Guests"]).toEqual(["g1", "g2"]);
  });

  it("is deterministic (stable membership ordering)", () => {
    expect(computeSegments(guests)).toEqual(computeSegments(guests));
  });

  it("matchesRule evaluates each rule kind", () => {
    expect(matchesRule(guests[0]!, { kind: "repeat", minVisits: 3 })).toBe(true);
    expect(matchesRule(guests[1]!, { kind: "corporate" })).toBe(true);
    expect(matchesRule(guests[2]!, { kind: "city", city: "pune" })).toBe(true);
  });
});
