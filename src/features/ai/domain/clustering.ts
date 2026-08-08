/**
 * 18 T-8 (embeddings refinement) — deterministic k-means over guest embeddings
 * (FR-8, AC-9). PURE and deterministic.
 *
 * The rule engine in `./segments` is the transparent baseline; this refines it
 * with "look-alike" groups derived from profile embeddings. Determinism matters:
 * with the mock provider's stable pseudo-embeddings, the same population must
 * always yield the same clusters so dev/CI never flake. That rules out random
 * seeding — we use k-means++ with deterministic tie-breaks and a fixed iteration
 * cap, all resolved by index/id order.
 */

export type EmbeddedGuest = { guestId: string; vector: number[] };

export type GuestCluster = {
  /** 0-based cluster index, stable across runs. */
  index: number;
  guestIds: string[];
};

const DEFAULT_ITERATIONS = 12;

function squaredDistance(a: number[], b: number[]): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return sum;
}

/** k-means++ style seeding, but deterministic: farthest point wins, ties by index. */
function seedCentroids(items: EmbeddedGuest[], k: number): number[][] {
  const centroids: number[][] = [items[0]!.vector.slice()];
  while (centroids.length < k) {
    let bestIdx = -1;
    let bestDist = -1;
    for (let i = 0; i < items.length; i++) {
      const v = items[i]!.vector;
      let nearest = Infinity;
      for (const c of centroids) nearest = Math.min(nearest, squaredDistance(v, c));
      // Strictly-greater keeps the LOWEST index on ties → deterministic.
      if (nearest > bestDist) {
        bestDist = nearest;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestDist <= 0) break; // no distinct point left to seed from
    centroids.push(items[bestIdx]!.vector.slice());
  }
  return centroids;
}

function nearestCentroid(vector: number[], centroids: number[][]): number {
  let best = 0;
  let bestDist = Infinity;
  for (let c = 0; c < centroids.length; c++) {
    const d = squaredDistance(vector, centroids[c]!);
    if (d < bestDist) {
      // Strict `<` keeps the LOWEST cluster index on ties → deterministic.
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/**
 * Partition embedded guests into at most `k` look-alike clusters. Deterministic:
 * inputs are sorted by guestId, seeding and assignment tie-break by index, and
 * empty clusters are dropped. Returns clusters ordered by index with sorted
 * membership. `k` is clamped to the population size; fewer than 2 guests or k<2
 * yields no clusters (nothing to look alike to).
 */
export function clusterGuests(items: EmbeddedGuest[], k: number, iterations = DEFAULT_ITERATIONS): GuestCluster[] {
  const sorted = [...items].sort((a, b) => a.guestId.localeCompare(b.guestId));
  const kk = Math.min(k, sorted.length);
  if (kk < 2 || sorted.length < 2) return [];

  let centroids = seedCentroids(sorted, kk);
  const assignment = new Array<number>(sorted.length).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    let changed = false;
    for (let i = 0; i < sorted.length; i++) {
      const c = nearestCentroid(sorted[i]!.vector, centroids);
      if (c !== assignment[i]) {
        assignment[i] = c;
        changed = true;
      }
    }

    // Recompute centroids as the mean of their members; an emptied centroid
    // keeps its previous position so the cluster can still attract a point.
    const dim = centroids[0]!.length;
    const sums = centroids.map(() => new Array<number>(dim).fill(0));
    const counts = new Array<number>(centroids.length).fill(0);
    for (let i = 0; i < sorted.length; i++) {
      const c = assignment[i]!;
      const v = sorted[i]!.vector;
      counts[c] = (counts[c] ?? 0) + 1;
      for (let d = 0; d < dim; d++) sums[c]![d] = (sums[c]![d] ?? 0) + (v[d] ?? 0);
    }
    centroids = centroids.map((prev, c) => {
      const n = counts[c] ?? 0;
      if (n === 0) return prev;
      return sums[c]!.map((s) => s / n);
    });

    if (!changed) break;
  }

  const buckets = new Map<number, string[]>();
  for (let i = 0; i < sorted.length; i++) {
    const c = assignment[i]!;
    if (!buckets.has(c)) buckets.set(c, []);
    buckets.get(c)!.push(sorted[i]!.guestId);
  }

  // Re-index so surviving (non-empty) clusters are 0..m-1, ordered by original index.
  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((originalIndex, newIndex) => ({
      index: newIndex,
      guestIds: buckets.get(originalIndex)!.sort((a, b) => a.localeCompare(b)),
    }));
}
