/**
 * 18 T-8 (embeddings refinement) — deterministic k-means (FR-8, AC-9).
 * Determinism is the whole point: same population → same clusters, no flake.
 */
import { describe, expect, it } from "vitest";
import { clusterGuests, type EmbeddedGuest } from "@/features/ai/domain/clustering";

// Two obvious groups in 2-D: a cluster near (0,0) and one near (10,10).
const separable: EmbeddedGuest[] = [
  { guestId: "a1", vector: [0, 0] },
  { guestId: "a2", vector: [0.5, 0.2] },
  { guestId: "a3", vector: [0.1, 0.4] },
  { guestId: "b1", vector: [10, 10] },
  { guestId: "b2", vector: [10.3, 9.8] },
  { guestId: "b3", vector: [9.7, 10.1] },
];

describe("clusterGuests (AC-9)", () => {
  it("separates two well-separated groups", () => {
    const clusters = clusterGuests(separable, 2);
    expect(clusters).toHaveLength(2);
    const groups = clusters.map((c) => c.guestIds).sort((x, y) => (x[0]! < y[0]! ? -1 : 1));
    expect(groups).toContainEqual(["a1", "a2", "a3"]);
    expect(groups).toContainEqual(["b1", "b2", "b3"]);
  });

  it("is deterministic — repeated runs give identical clusters", () => {
    expect(clusterGuests(separable, 2)).toEqual(clusterGuests(separable, 2));
  });

  it("is order-independent (sorts by guestId internally)", () => {
    const shuffled = [separable[3]!, separable[0]!, separable[5]!, separable[1]!, separable[4]!, separable[2]!];
    expect(clusterGuests(shuffled, 2)).toEqual(clusterGuests(separable, 2));
  });

  it("clamps k to the population size", () => {
    const clusters = clusterGuests(separable, 99);
    // At most one non-empty cluster per distinct point.
    expect(clusters.length).toBeLessThanOrEqual(separable.length);
    const total = clusters.reduce((n, c) => n + c.guestIds.length, 0);
    expect(total).toBe(separable.length);
  });

  it("returns no clusters when there is nothing to look alike to", () => {
    expect(clusterGuests([{ guestId: "solo", vector: [1, 2] }], 2)).toEqual([]);
    expect(clusterGuests(separable, 1)).toEqual([]);
    expect(clusterGuests([], 3)).toEqual([]);
  });

  it("assigns every guest exactly once (a partition)", () => {
    const clusters = clusterGuests(separable, 2);
    const seen = clusters.flatMap((c) => c.guestIds).sort();
    expect(seen).toEqual(["a1", "a2", "a3", "b1", "b2", "b3"]);
  });
});
