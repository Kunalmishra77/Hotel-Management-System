/**
 * 15 T-3b — mergeFederated rank-merge + federated cursor (FR-2, AC-9).
 */
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, isExhausted, mergeFederated, type Shard } from "@/features/search/domain/federate";
import type { SearchResult } from "@/features/search/types";

const r = (entity: SearchResult["entity"], id: string, score: number, at: string): SearchResult => ({
  entity,
  id,
  title: id,
  score,
  sortAt: new Date(at),
  fields: {},
});

describe("mergeFederated — rank order", () => {
  it("interleaves shards by score, then recency", () => {
    const shards: Shard[] = [
      { entity: "guest", rows: [r("guest", "g1", 0.9, "2026-01-01"), r("guest", "g2", 0.5, "2026-02-01")], moduleNextCursor: null },
      { entity: "reservation", rows: [r("reservation", "b1", 0.7, "2026-03-01")], moduleNextCursor: null },
    ];
    const { results } = mergeFederated(shards, 10);
    expect(results.map((x) => x.id)).toEqual(["g1", "b1", "g2"]); // 0.9 > 0.7 > 0.5
  });

  it("breaks a score tie by recency (newer first)", () => {
    const shards: Shard[] = [
      { entity: "guest", rows: [r("guest", "g1", 0.8, "2026-01-01")], moduleNextCursor: null },
      { entity: "invoice", rows: [r("invoice", "i1", 0.8, "2026-06-01")], moduleNextCursor: null },
    ];
    const { results } = mergeFederated(shards, 10);
    expect(results.map((x) => x.id)).toEqual(["i1", "g1"]);
  });
});

describe("mergeFederated — federated cursor (AC-9: stable, non-duplicated)", () => {
  it("advances only shards whose rows were emitted; holds the rest", () => {
    // limit 2: g1 + b1 emitted; g2 held back (guest partially consumed).
    const shards: Shard[] = [
      { entity: "guest", rows: [r("guest", "g1", 0.9, "2026-01-01"), r("guest", "g2", 0.5, "2026-01-01")], moduleNextCursor: "g2next" },
      { entity: "reservation", rows: [r("reservation", "b1", 0.7, "2026-01-01")], moduleNextCursor: null },
    ];
    const { results, nextCursor } = mergeFederated(shards, 2);
    expect(results.map((x) => x.id)).toEqual(["g1", "b1"]);
    // guest: partial → resume right after the last EMITTED guest row (g1), not g2next.
    expect(nextCursor.guest).toBe("g1");
    // reservation: fully consumed + module exhausted → null.
    expect(nextCursor.reservation).toBe(null);
  });

  it("uses the module's own next token when every fetched row was emitted", () => {
    const shards: Shard[] = [
      { entity: "guest", rows: [r("guest", "g1", 0.9, "2026-01-01")], moduleNextCursor: "gNEXT" },
    ];
    const { nextCursor } = mergeFederated(shards, 10);
    expect(nextCursor.guest).toBe("gNEXT");
  });

  it("a second page starting from the returned cursor does not repeat page-1 rows", () => {
    const page1: Shard[] = [
      { entity: "guest", rows: [r("guest", "g1", 0.9, "2026-01-01"), r("guest", "g2", 0.8, "2026-01-01")], moduleNextCursor: null },
      { entity: "reservation", rows: [r("reservation", "b1", 0.85, "2026-01-01")], moduleNextCursor: null },
    ];
    const { results: p1, nextCursor } = mergeFederated(page1, 2);
    expect(p1.map((x) => x.id)).toEqual(["g1", "b1"]); // g2 held
    // Page 2: guest resumes after g1 → the module would return g2; reservation exhausted (dropped).
    expect(nextCursor.guest).toBe("g1");
    expect(nextCursor.reservation).toBe(null);
    const page2: Shard[] = [
      { entity: "guest", rows: [r("guest", "g2", 0.8, "2026-01-01")], moduleNextCursor: null, incomingCursor: "g1" },
    ];
    const { results: p2 } = mergeFederated(page2, 2);
    expect(p2.map((x) => x.id)).toEqual(["g2"]);
    const p1ids = new Set(p1.map((x) => x.id));
    expect(p2.every((x) => !p1ids.has(x.id))).toBe(true); // no duplication
  });

  it("marks an empty shard exhausted (null)", () => {
    const shards: Shard[] = [{ entity: "staff", rows: [], moduleNextCursor: null }];
    const { nextCursor } = mergeFederated(shards, 10);
    expect(nextCursor.staff).toBe(null);
    expect(isExhausted(nextCursor)).toBe(true);
  });
});

describe("cursor codec", () => {
  it("round-trips a federated cursor", () => {
    const c = { guest: "g1", reservation: null };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it("a malformed cursor decodes to undefined (restart), not a throw", () => {
    expect(decodeCursor("!!!not-base64-json")).toBeUndefined();
    expect(decodeCursor(undefined)).toBeUndefined();
  });
});
