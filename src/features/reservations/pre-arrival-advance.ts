/**
 * Advance taken at booking, before check-in (client, 26 Nov 2026: "₹2,000 advance
 * liya, show kyu nahi kar raha"). The advance lives on the booking and becomes a
 * folio PAYMENT only at check-in (`lifecycle-actions` T4, reference
 * `ADVANCE:<id>`), so until then the folio reads ₹0. This read lets the booking
 * page show what was taken and what is still due — figures come from the booking
 * snapshot via `priceReservation`, the same math the check-in payment step uses.
 */
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import type { SessionClaims } from "@/lib/auth/claims";
import { priceReservation } from "./domain/pricing";

export type PreArrivalAdvance = {
  advancePaise: number;
  mode: string | null;
  /** Booked stay total incl. GST, from the booking snapshot. */
  estimatedTotalPaise: number;
  /** Still to collect at check-in = total − advance (never below 0). */
  dueAtCheckInPaise: number;
};

export async function getPreArrivalAdvance(user: SessionClaims, reservationId: string): Promise<PreArrivalAdvance | null> {
  if (!hasPermission(user, "folio:view")) return null;
  const r = await db.scoped(user).reservation.findFirst({
    where: { id: reservationId },
    select: {
      status: true, ratePaise: true, nights: true, discountPaise: true, extraBedPaise: true,
      otherChargesPaise: true, taxPaise: true, advancePaise: true, advanceMode: true, settlementIntent: true,
      folio: { select: { payments: { where: { isRefund: false }, select: { id: true } } } },
    },
  });
  // Only before check-in, and only while no payment is on the folio yet (one
  // entered by hand is the advance — the folio balance then already shows it).
  if (!r || !["ENQUIRY", "CONFIRMED"].includes(r.status) || r.advancePaise <= 0) return null;
  if ((r.folio?.payments.length ?? 0) > 0) return null;
  const bill = priceReservation({
    ratePaise: r.ratePaise, nights: r.nights, discountPaise: r.discountPaise, extraBedPaise: r.extraBedPaise,
    otherChargesPaise: r.otherChargesPaise, taxPaise: r.taxPaise, advancePaise: r.advancePaise,
  });
  return {
    advancePaise: r.advancePaise,
    mode: r.advanceMode ?? (r.settlementIntent === "ALREADY_PAID" ? "ONLINE" : null),
    estimatedTotalPaise: bill.totalPaise,
    dueAtCheckInPaise: Math.max(0, bill.balancePaise),
  };
}
