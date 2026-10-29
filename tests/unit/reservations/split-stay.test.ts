/** Split stay — one guest, different rooms on different nights (client: "partly free rooms stay empty"). */
import { describe, expect, it } from "vitest";
import { segmentsFromPicks, stayNightKeys, suggestSplit, validateSegments } from "@/features/reservations/domain/split-stay";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("stayNightKeys", () => {
  it("lists check-in inclusive to check-out exclusive", () => {
    expect(stayNightKeys("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(stayNightKeys("2026-10-30", "2026-10-30")).toEqual([]);
  });
});

describe("segmentsFromPicks", () => {
  const nights = ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"];
  it("collapses consecutive nights in a room into one half-open segment", () => {
    expect(segmentsFromPicks(nights, { "2026-10-24": "R3", "2026-10-25": "R3", "2026-10-26": "R1", "2026-10-27": "R1" })).toEqual([
      { roomId: "R3", startDate: "2026-10-24", endDate: "2026-10-26" },
      { roomId: "R1", startDate: "2026-10-26", endDate: "2026-10-28" },
    ]);
  });
  it("returns to a room later as a separate segment", () => {
    expect(segmentsFromPicks(nights, { "2026-10-24": "A", "2026-10-25": "B", "2026-10-26": "A", "2026-10-27": "A" })).toHaveLength(3);
  });
  it("is null while any night has no room", () => {
    expect(segmentsFromPicks(nights, { "2026-10-24": "A" })).toBeNull();
  });
});

describe("suggestSplit", () => {
  const nights = ["n1", "n2", "n3", "n4"];
  it("stays in one room while it is free, then moves to the longest-free room", () => {
    const free = new Map([
      ["A", new Set(["n1", "n2"])],
      ["B", new Set(["n2", "n3"])],
      ["C", new Set(["n3", "n4"])],
    ]);
    expect(suggestSplit(nights, free, ["A", "B", "C"])).toEqual({ n1: "A", n2: "A", n3: "C", n4: "C" });
  });
  it("prefers a room free for the whole stay (no change at all)", () => {
    const free = new Map([["A", new Set(["n1"])], ["B", new Set(nights)]]);
    expect(suggestSplit(nights, free, ["A", "B"])).toEqual({ n1: "B", n2: "B", n3: "B", n4: "B" });
  });
  it("is null when a night has no free room", () => {
    expect(suggestSplit(nights, new Map([["A", new Set(["n1", "n2", "n4"])]]), ["A"])).toBeNull();
  });
});

describe("validateSegments", () => {
  const ci = d("2026-10-24");
  const co = d("2026-10-28");
  const seg = (roomId: string, a: string, b: string) => ({ roomId, startDate: d(a), endDate: d(b) });
  it("accepts segments that tile the stay exactly (any order)", () => {
    expect(validateSegments([seg("R1", "2026-10-26", "2026-10-28"), seg("R3", "2026-10-24", "2026-10-26")], ci, co)).toBeNull();
  });
  it("rejects a gap, an overlap, a wrong start or end, an empty segment", () => {
    expect(validateSegments([seg("R3", "2026-10-24", "2026-10-25"), seg("R1", "2026-10-26", "2026-10-28")], ci, co)).toMatch(/gaps/);
    expect(validateSegments([seg("R3", "2026-10-24", "2026-10-27"), seg("R1", "2026-10-26", "2026-10-28")], ci, co)).toMatch(/overlaps/);
    expect(validateSegments([seg("R3", "2026-10-25", "2026-10-28")], ci, co)).toMatch(/check-in/);
    expect(validateSegments([seg("R3", "2026-10-24", "2026-10-27")], ci, co)).toMatch(/check-out/);
    expect(validateSegments([seg("R3", "2026-10-24", "2026-10-24"), seg("R1", "2026-10-24", "2026-10-28")], ci, co)).toMatch(/at least one night/);
    expect(validateSegments([], ci, co)).toMatch(/every night/);
  });
});
