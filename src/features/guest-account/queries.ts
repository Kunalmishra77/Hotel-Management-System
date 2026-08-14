import "server-only";
/**
 * Guest-area reads (Phase 2). Only ever return the signed-in guest's OWN data —
 * scoped by the resolved principal, never by a client-supplied id. Contact is
 * decrypted then masked for display (compliance.md).
 */
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { decryptOptional, maskEmail, maskMobile } from "@/lib/crypto/encryption";
import { resolveGuestSession, type GuestPrincipal } from "@/lib/guest-auth";
import { canOnlineCheckIn } from "./domain/online-checkin";

/** The current guest principal, or redirect to sign-in preserving the destination. */
export async function requireGuest(next?: string): Promise<GuestPrincipal> {
  const principal = await resolveGuestSession();
  if (!principal) {
    redirect(next ? `/account/sign-in?next=${encodeURIComponent(next)}` : "/account/sign-in");
  }
  return principal;
}

export type GuestSummary = {
  fullName: string;
  emailMasked: string | null;
  mobileMasked: string | null;
};

/** Name + masked contact for the signed-in guest. Never exposes raw PII. */
export async function getGuestSummary(principal: GuestPrincipal): Promise<GuestSummary> {
  const account = await db.unscoped().guestAccount.findUnique({
    where: { id: principal.accountId },
    select: { email: true, mobile: true, guest: { select: { fullName: true } } },
  });
  return {
    fullName: account?.guest.fullName ?? "Guest",
    emailMasked: maskEmail(decryptOptional(account?.email ?? null)),
    mobileMasked: maskMobile(decryptOptional(account?.mobile ?? null)),
  };
}

const ACTIVE_STATUSES = ["ENQUIRY", "CONFIRMED", "IN_HOUSE"] as const;

export type MyBooking = {
  reservationId: string;
  code: string;
  status: string;
  propertyName: string;
  checkInDate: Date;
  checkOutDate: Date;
  nights: number;
  totalPaise: number;
  advancePaise: number;
  upcoming: boolean;
  /** Only meaningful in the detail view; false in the list. */
  cancellable: boolean;
  onlineCheckInAt: Date | null;
  onlineCheckInEligible: boolean;
  expectedArrival: string | null;
};

function bookingTotal(r: { ratePaise: number; nights: number; taxPaise: number; discountPaise: number }): number {
  return r.ratePaise * r.nights + r.taxPaise - r.discountPaise;
}

/** Every booking for the signed-in guest (scoped by the session's guestId, never
 *  a client-supplied id), newest first. */
export async function listMyBookings(principal: GuestPrincipal): Promise<MyBooking[]> {
  const rows = await db.unscoped().reservation.findMany({
    where: { guestId: principal.guestId },
    orderBy: { checkInDate: "desc" },
    select: {
      id: true, code: true, status: true, checkInDate: true, checkOutDate: true,
      nights: true, ratePaise: true, taxPaise: true, discountPaise: true, advancePaise: true, propertyId: true,
      onlineCheckInAt: true, expectedArrival: true,
    },
  });
  if (rows.length === 0) return [];

  const propIds = [...new Set(rows.map((r) => r.propertyId))];
  const props = await db.unscoped().property.findMany({ where: { id: { in: propIds } }, select: { id: true, name: true } });
  const nameById = new Map(props.map((p) => [p.id, p.name]));

  return rows.map((r) => ({
    reservationId: r.id,
    code: r.code,
    status: r.status,
    propertyName: nameById.get(r.propertyId) ?? "—",
    checkInDate: r.checkInDate,
    checkOutDate: r.checkOutDate,
    nights: r.nights,
    totalPaise: bookingTotal(r),
    advancePaise: r.advancePaise,
    upcoming: (ACTIVE_STATUSES as readonly string[]).includes(r.status),
    cancellable: false,
    onlineCheckInAt: r.onlineCheckInAt,
    onlineCheckInEligible: canOnlineCheckIn(r.status),
    expectedArrival: r.expectedArrival,
  }));
}

/** One booking, ONLY if it belongs to the signed-in guest (else null → 404). */
export async function getMyBooking(principal: GuestPrincipal, reservationId: string): Promise<MyBooking | null> {
  const r = await db.unscoped().reservation.findFirst({
    where: { id: reservationId, guestId: principal.guestId },
    select: {
      id: true, code: true, status: true, checkInDate: true, checkOutDate: true,
      nights: true, ratePaise: true, taxPaise: true, discountPaise: true, advancePaise: true,
      propertyId: true, property: { select: { name: true } },
      onlineCheckInAt: true, expectedArrival: true,
    },
  });
  if (!r) return null;

  const cfg = await db
    .unscoped()
    .bookingEngineConfig.findUnique({ where: { propertyId: r.propertyId }, select: { cancelWindowHours: true } });
  const hoursToCheckIn = (r.checkInDate.getTime() - Date.now()) / 3_600_000;
  const cancellable =
    (r.status === "CONFIRMED" || r.status === "ENQUIRY") && hoursToCheckIn >= (cfg?.cancelWindowHours ?? 48);

  return {
    reservationId: r.id,
    code: r.code,
    status: r.status,
    propertyName: r.property.name,
    checkInDate: r.checkInDate,
    checkOutDate: r.checkOutDate,
    nights: r.nights,
    totalPaise: bookingTotal(r),
    advancePaise: r.advancePaise,
    upcoming: (ACTIVE_STATUSES as readonly string[]).includes(r.status),
    cancellable,
    onlineCheckInAt: r.onlineCheckInAt,
    onlineCheckInEligible: canOnlineCheckIn(r.status),
    expectedArrival: r.expectedArrival,
  };
}
