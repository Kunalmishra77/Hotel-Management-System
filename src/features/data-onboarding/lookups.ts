/**
 * Cross-module existence/identity lookups the import needs — 26. Read-only.
 *
 * Guest matching reuses 04's EXACT identity mechanism (the keyed `mobileHash`
 * token), resolving many mobiles in one query rather than N calls to
 * `searchGuests` — the same tokenised lookup 04 performs internally, so the two
 * always agree on who is a duplicate. Master-data existence is a scoped read
 * used only to REFUSE a row that references a property/category/room that does
 * not exist (FR-10) — 26 never creates master data.
 */
import { db } from "@/lib/db";
import { keyedHash } from "@/lib/crypto/encryption";
import type { SessionClaims } from "@/lib/auth/claims";

/** Map normalised mobile → live guestId, for every guest that exists in the org. */
export async function lookupGuestsByMobile(
  orgId: string,
  mobiles: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(mobiles.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const hashToMobile = new Map<string, string>();
  for (const m of unique) hashToMobile.set(keyedHash(m), m);

  const rows = await db.unscoped().guest.findMany({
    where: { orgId, deletedAt: null, mobileHash: { in: [...hashToMobile.keys()] } },
    select: { id: true, mobileHash: true },
  });

  const byMobile = new Map<string, string>();
  for (const row of rows) {
    const mobile = row.mobileHash ? hashToMobile.get(row.mobileHash) : undefined;
    if (mobile && !byMobile.has(mobile)) byMobile.set(mobile, row.id);
  }
  return byMobile;
}

export type MasterData = {
  /** lower-cased category name → categoryId (in the batch's property). */
  categoriesByName: Map<string, string>;
  /** room number → roomId (in the batch's property). */
  roomsByNumber: Map<string, string>;
};

/** Load the property's categories + rooms so a reservation/room row can be checked. */
export async function loadMasterData(user: SessionClaims, propertyId: string): Promise<MasterData> {
  const client = db.scoped(user);
  const [categories, rooms] = await Promise.all([
    client.roomCategory.findMany({ where: { propertyId }, select: { id: true, name: true } }),
    client.room.findMany({ where: { propertyId }, select: { id: true, number: true } }),
  ]);
  return {
    categoriesByName: new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id])),
    roomsByNumber: new Map(rooms.map((r) => [String(r.number).trim().toLowerCase(), r.id])),
  };
}
