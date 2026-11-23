/**
 * Company credit on a booking — read side (client, 23 Nov 2026: "we have a few
 * credit companies — bill mode credit, details put on the bill as they come").
 * `Reservation.corporateId` marks the stay as billed to that company, paid later.
 */
import { db } from "@/lib/db";
import type { SessionClaims } from "@/lib/auth/claims";

export type CompanyCredit = { id: string; name: string; gstin: string | null; address: string | null; state: string | null };

export async function getCompanyCredit(user: SessionClaims, reservationId: string): Promise<CompanyCredit | null> {
  const r = await db.scoped(user).reservation.findFirst({
    where: { id: reservationId },
    select: { corporate: { select: { id: true, name: true, gstin: true, address: true, state: true } } },
  });
  return r?.corporate ?? null;
}
