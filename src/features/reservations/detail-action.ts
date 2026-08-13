"use server";

/**
 * Reservation quick-view detail — powers the slide-in drawer on the bookings
 * board (open a booking without leaving the list). One scoped read of the
 * reservation + its folio; balance comes from billing's public surface so the
 * money figure never diverges. `reservation:view`.
 */
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { getBalance } from "@/features/billing";

export type ReservationDetail = {
  id: string;
  code: string;
  status: string;
  guestId: string;
  guestName: string;
  source: string;
  checkInDate: Date;
  checkOutDate: Date;
  nights: number;
  adults: number;
  children: number;
  roomNumbers: string[];
  needsAttention: string | null;
  balancePaise: number | null;
  lines: { type: string; description: string; amountPaise: number; taxPaise: number }[];
  payments: { mode: string; amountPaise: number; isRefund: boolean }[];
};

export async function getReservationDetail(id: string): Promise<ReservationDetail | null> {
  const user = await requireUser();
  const r = await db.scoped(user).reservation.findFirst({
    where: { id },
    select: {
      id: true,
      code: true,
      status: true,
      guestId: true,
      source: true,
      checkInDate: true,
      checkOutDate: true,
      nights: true,
      adults: true,
      children: true,
      needsAttention: true,
      propertyId: true,
      guest: { select: { fullName: true } },
      allocations: { select: { room: { select: { number: true } } } },
      folio: {
        select: {
          lines: { select: { type: true, description: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } },
          payments: { select: { mode: true, amountPaise: true, isRefund: true } },
        },
      },
    },
  });
  if (!r) return null;
  authorize(user, "reservation:view", r.propertyId);

  const balancePaise = await getBalance(user, id);

  return {
    id: r.id,
    code: r.code,
    status: r.status,
    guestId: r.guestId,
    guestName: r.guest.fullName,
    source: r.source,
    checkInDate: r.checkInDate,
    checkOutDate: r.checkOutDate,
    nights: r.nights,
    adults: r.adults,
    children: r.children,
    roomNumbers: r.allocations.map((a) => a.room.number),
    needsAttention: r.needsAttention,
    balancePaise,
    lines: (r.folio?.lines ?? []).map((l) => ({
      type: l.type,
      description: l.description,
      amountPaise: Number(l.amountPaise),
      taxPaise: l.cgstPaise + l.sgstPaise + l.igstPaise,
    })),
    payments: (r.folio?.payments ?? []).map((p) => ({ mode: p.mode, amountPaise: Number(p.amountPaise), isRefund: p.isRefund })),
  };
}
