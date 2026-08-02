/**
 * Room-type mapping — 13 T-3 (FR-4/7, AC-2/6). Pure: no I/O.
 *
 * Every external OTA room type maps to exactly one internal `RoomCategory` via a
 * `RoomTypeMapping`. An external type WITHOUT a mapping resolves to `null` — the
 * caller must NOT ingest it (FR-7: dead-letter + alert, never guess a category).
 */

export type RoomTypeMappingRow = {
  externalRoomType: string;
  roomCategoryId: string;
  externalRatePlan?: string | null;
};

/** Normalize an external room-type key so casing/whitespace never causes a miss. */
export function normalizeExternalType(externalRoomType: string): string {
  return externalRoomType.trim().toUpperCase();
}

/**
 * Resolve the internal category for an external room type, or `null` when
 * unmapped. Matching is case/whitespace-insensitive so "dlx-bb", "DLX-BB " and
 * "DLX-BB" all resolve identically.
 */
export function mapRoomType(
  mappings: readonly RoomTypeMappingRow[],
  externalRoomType: string,
): string | null {
  const key = normalizeExternalType(externalRoomType);
  const hit = mappings.find((m) => normalizeExternalType(m.externalRoomType) === key);
  return hit ? hit.roomCategoryId : null;
}
