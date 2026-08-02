/**
 * 15 T-3b — mergeFederated + cursor packing (FR-2, AC-9).
 *
 * Unified search fans out to each entity's OWN indexed query layer, each with
 * its own continuation token. This pure function rank-merges the shards' slices
 * into one normalized stream and packs the next FederatedCursor so the following
 * page resumes each shard exactly where it stopped — no re-scan, no cross-entity
 * join, and stable + non-duplicated paging.
 *
 * The invariant that makes paging correct: a shard's continuation token only
 * advances past rows that were actually EMITTED on this page. Rows that were
 * fetched but lost the rank race are left for the next page (their shard resumes
 * from the same point), so nothing is skipped and nothing repeats.
 */
import type { EntityKind, FederatedCursor, SearchResult } from "../types";

export type Shard = {
  entity: EntityKind;
  /** This shard's fetched slice (already scored + masked), in the shard's own order. */
  rows: SearchResult[];
  /** The shard's OWN next token if it had more beyond `rows`; null if exhausted. */
  moduleNextCursor: string | null;
  /** The token this shard was fetched from (undefined = fetched from the beginning). */
  incomingCursor?: string | null;
};

/** Rank order: higher score first, then more recent, then id for a stable tie-break. */
function rank(a: SearchResult, b: SearchResult): number {
  if (b.score !== a.score) return b.score - a.score;
  const t = b.sortAt.getTime() - a.sortAt.getTime();
  if (t !== 0) return t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function mergeFederated(
  shards: Shard[],
  limit: number,
): { results: SearchResult[]; nextCursor: FederatedCursor } {
  const merged = shards.flatMap((s) => s.rows).sort(rank);
  const results = merged.slice(0, limit);

  const nextCursor: FederatedCursor = {};
  for (const s of shards) {
    const included = results.filter((r) => r.entity === s.entity);

    if (included.length === 0) {
      // Nothing from this shard made the page.
      if (s.rows.length === 0) {
        // Shard offered nothing → exhausted for this run; drop it (null).
        nextCursor[s.entity] = null;
      } else if (s.incomingCursor !== undefined) {
        // Resume from the same point next page (don't advance past unemitted rows).
        nextCursor[s.entity] = s.incomingCursor;
      }
      // else: fetched-from-beginning and none emitted → omit (restart from beginning).
      continue;
    }

    if (included.length === s.rows.length) {
      // Every fetched row was emitted → continue from the shard's own next token.
      nextCursor[s.entity] = s.moduleNextCursor;
    } else {
      // Some fetched rows were held back → resume right after the last emitted one.
      nextCursor[s.entity] = included[included.length - 1]!.id;
    }
  }

  return { results, nextCursor };
}

/** True once every shard's token is null (all entities exhausted). */
export function isExhausted(cursor: FederatedCursor): boolean {
  const values = Object.values(cursor);
  return values.length > 0 && values.every((v) => v === null);
}

// --- opaque cursor codec (base64 JSON; tokens are ids, no PII) -----------------

export function encodeCursor(cursor: FederatedCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined | null): FederatedCursor | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as FederatedCursor) : undefined;
  } catch {
    return undefined; // a malformed cursor just restarts from the beginning
  }
}
