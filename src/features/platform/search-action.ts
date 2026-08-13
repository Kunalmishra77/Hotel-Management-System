"use server";

/**
 * Command-palette search — the ⌘K quick-jump. Resolves the session and searches
 * guests + bookings through the existing scoped queries, honouring the caller's
 * permissions and active property. Read-only; returns the minimum the palette
 * needs (no PII beyond the name front desk already sees).
 */
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { searchGuests } from "@/features/guests/queries";
import { searchReservations } from "@/features/reservations/queries";

export type CommandResults = {
  guests: { id: string; name: string; sub: string | null }[];
  bookings: { id: string; code: string; guestName: string; status: string }[];
};

export async function commandSearch(query: string): Promise<CommandResults> {
  const q = query.trim();
  if (q.length < 2) return { guests: [], bookings: [] };

  const user = await requireUser();
  const propertyId = user.activePropertyId;

  const [guests, bookings] = await Promise.all([
    can(user, "guest:view", propertyId)
      ? searchGuests(user, { query: q, limit: 5 }).then((r) =>
          r.guests.map((g) => ({ id: g.id, name: g.fullName, sub: g.companyName ?? g.city ?? null })),
        )
      : Promise.resolve([] as CommandResults["guests"]),
    can(user, "reservation:view", propertyId) && propertyId
      ? searchReservations(user, { keyword: q, propertyId, limit: 5 }).then((r) =>
          r.reservations.map((b) => ({ id: b.id, code: b.code, guestName: b.guestName, status: b.status })),
        )
      : Promise.resolve([] as CommandResults["bookings"]),
  ]);

  return { guests, bookings };
}
