/**
 * 15 T-5 — unified search (FR-1/2/3, AC-1/2/3/8/9/12).
 *
 * Fans out a keyword + filters across every entity the caller is PERMITTED to
 * see, each through its owning module's INDEXED query (no full scans → p95<500ms),
 * rank-merges into one normalized, MASKED stream, and paginates with a federated
 * cursor (per-entity continuation tokens — stable, non-duplicated). Injection is
 * a non-issue: every shard uses parameterised Prisma queries, so a term with
 * `' ; -- %` is matched literally (AC-12).
 */
import { hasPermission } from "@/lib/permissions";
import { isExhausted, mergeFederated, type Shard } from "./domain/federate";
import { SHARDS } from "./shards";
import { ENTITY_KINDS, type EntityKind, type SearchPage, type UnifiedSearchQuery } from "./types";
import type { Permission } from "@/lib/permissions/permission-map";
import type { SessionClaims } from "@/lib/auth/claims";

/** The permission that gates each entity in search results (deny-by-default). */
const ENTITY_PERMISSION: Record<EntityKind, Permission> = {
  guest: "guest:view",
  reservation: "reservation:view",
  invoice: "folio:view",
  expense: "expense:create",
  staff: "staff:manage",
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Entities the caller may see, intersected with any explicit `entities` filter. */
function permittedEntities(user: SessionClaims, requested?: EntityKind[]): EntityKind[] {
  const base = requested?.length ? requested : [...ENTITY_KINDS];
  return base.filter((e) => hasPermission(user, ENTITY_PERMISSION[e]));
}

export async function search(user: SessionClaims, query: UnifiedSearchQuery): Promise<SearchPage> {
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const cursor = query.cursor;

  // Which shards to fan out: permitted, and not already exhausted (token === null).
  const entities = permittedEntities(user, query.entities).filter((e) => cursor?.[e] !== null);
  if (entities.length === 0) return { results: [], nextCursor: {} };

  const shards: Shard[] = await Promise.all(
    entities.map((e) => SHARDS[e]({ user, query, token: cursor?.[e], limit })),
  );

  const { results, nextCursor } = mergeFederated(shards, limit);
  // Carry forward already-exhausted shards as null so the next page keeps skipping them.
  if (cursor) for (const e of ENTITY_KINDS) if (cursor[e] === null) nextCursor[e] = null;
  return { results, nextCursor: isExhausted(nextCursor) ? {} : nextCursor };
}
