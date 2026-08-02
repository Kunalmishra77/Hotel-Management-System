/**
 * 15 search & export — shared types (contracts.md).
 *
 * Two DISTINCT query contracts live here (do not conflate — design.md §):
 *  - UnifiedSearchQuery → search(): human, multi-entity keyword fan-out.
 *  - StructuredQuery    → runStructuredQuery(): the 18-ai single-entity typed path.
 */

export const ENTITY_KINDS = ["guest", "reservation", "invoice", "expense", "staff"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Opaque per-entity continuation token. `null` = that shard is exhausted (FR-2). */
export type FederatedCursor = Partial<Record<EntityKind, string | null>>;

export type UnifiedSearchQuery = {
  keyword?: string;
  entities?: EntityKind[];
  filters?: {
    propertyId?: string;
    bookingSource?: string;
    dateRange?: { field: string; from: Date; to: Date };
  };
  cursor?: FederatedCursor;
  limit?: number;
};

/** One normalized, masked result card (FR-3). `sortAt` drives recency tie-breaks. */
export type SearchResult = {
  entity: EntityKind;
  id: string;
  title: string;
  subtitle?: string;
  /** Relevance 0..1 — exact-token hits rank above trigram/text hits. */
  score: number;
  /** Recency key for stable rank-merge tie-breaking (FR-2/AC-9). */
  sortAt: Date;
  /** Already-masked display fields for the card + export (FR-3/5). */
  fields: Record<string, string | number | null>;
};

export type SearchPage = { results: SearchResult[]; nextCursor: FederatedCursor };

// ---------------------------------------------------------------------------
// Structured query (18-ai path, FR-7)
// ---------------------------------------------------------------------------

export type FilterOp = "eq" | "contains" | "gte" | "lte" | "in";
export type StructuredFilter = { field: string; op: FilterOp; value: string | number | string[] };

export type StructuredQuery = {
  entity: EntityKind;
  filters: StructuredFilter[];
  dateRange?: { field: string; from: Date; to: Date };
  sort?: { field: string; dir: "asc" | "desc" };
  cursor?: string;
  limit?: number;
};
