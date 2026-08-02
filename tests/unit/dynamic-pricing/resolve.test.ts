/**
 * 24 T-4 — resolveRate fallback chain (FR-5, AC-6). Pure. This is the exact
 * order 03/23 rely on: negotiated → dynamic(approved) → plan → base.
 */
import { describe, expect, it } from "vitest";
import { resolveRate } from "@/features/dynamic-pricing/domain/resolve";

describe("resolveRate — priority order (AC-6)", () => {
  const all = {
    negotiatedRatePaise: 500_000,
    dynamicApprovedPaise: 650_000,
    ratePlanPaise: 450_000,
    basePaise: 400_000,
  };

  it("negotiated wins over everything (corporate contract)", () => {
    expect(resolveRate(all)).toEqual({ ratePaise: 500_000, source: "NEGOTIATED" });
  });

  it("dynamic-approved wins when there is no negotiated rate", () => {
    expect(resolveRate({ ...all, negotiatedRatePaise: null })).toEqual({
      ratePaise: 650_000,
      source: "DYNAMIC",
    });
  });

  it("rate plan wins when neither negotiated nor dynamic is set", () => {
    expect(
      resolveRate({ ...all, negotiatedRatePaise: null, dynamicApprovedPaise: null }),
    ).toEqual({ ratePaise: 450_000, source: "PLAN" });
  });

  it("falls back to base — booking never fails for a missing dynamic rate", () => {
    expect(resolveRate({ basePaise: 400_000 })).toEqual({ ratePaise: 400_000, source: "BASE" });
  });
});

describe("resolveRate — unusable candidates fall through (AC-6)", () => {
  it("treats null/undefined/zero/negative as 'not set'", () => {
    expect(
      resolveRate({
        negotiatedRatePaise: 0,
        dynamicApprovedPaise: -1,
        ratePlanPaise: null,
        basePaise: 400_000,
      }),
    ).toEqual({ ratePaise: 400_000, source: "BASE" });
  });

  it("skips a zero negotiated rate but still uses a valid dynamic rate", () => {
    expect(
      resolveRate({ negotiatedRatePaise: 0, dynamicApprovedPaise: 650_000, basePaise: 400_000 }),
    ).toEqual({ ratePaise: 650_000, source: "DYNAMIC" });
  });
});
