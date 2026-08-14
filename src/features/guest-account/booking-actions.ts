"use server";
/**
 * Signed-in guest booking (Phase 2 T-5). The ONLY caller allowed to choose a
 * payment preference (pay now / at hotel / partial) — identity comes from the
 * guest session, never the client, so an anonymous bot can't reach pay-at-hotel.
 *
 * It reuses the booking engine wholesale: availability is 03's single truth,
 * pricing is 24's resolved rate, GST is inclusive, and the no-overbooking
 * transaction is `placeHold`'s. We add only the guest's identity + the payment
 * choice; the guest's own contact dedupes onto their existing CRM `Guest`, so
 * the booking appears in My Bookings automatically.
 */
import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { NotFoundError } from "@/lib/errors";
import { type Result, toResult } from "@/lib/result";
import { db } from "@/lib/db";
import { decryptString, decryptOptional } from "@/lib/crypto/encryption";
import { resolveGuestSession } from "@/lib/guest-auth";
import { loadPublishedConfig } from "@/features/booking-engine/queries";
import { placeHold, cancelWebBooking, type HoldResult } from "@/features/booking-engine/public";
import { guestBookingSchema } from "./schema";

const CONSENT_VERSION = "2026-01-terms-v1";

export type GuestBookingResult = {
  reservationCode: string;
  amountPaise: number;
  totalPaise: number;
  paymentPreference: HoldResult["paymentPreference"];
  confirmed: boolean;
};

export async function createGuestBooking(raw: unknown): Promise<Result<GuestBookingResult>> {
  return toResult(async () => {
    const input = guestBookingSchema.parse(raw);

    const principal = await resolveGuestSession();
    if (!principal) throw new NotFoundError("Please sign in to book.");

    // The site the guest is booking must belong to the guest's own org.
    const cfg = await loadPublishedConfig(input.slug);
    if (!cfg || cfg.orgId !== principal.orgId) throw new NotFoundError("That property isn't available.");

    // Identity from the account (never the client). Decrypt to the plaintext the
    // booking engine hashes — same hash ⇒ dedupes onto this guest's CRM record.
    const account = await db.unscoped().guestAccount.findUnique({
      where: { id: principal.accountId },
      select: { mobile: true, email: true, guest: { select: { fullName: true } } },
    });
    if (!account) throw new NotFoundError("Account not found.");

    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "0.0.0.0";

    const result = await placeHold(
      cfg,
      {
        roomCategoryId: input.roomCategoryId,
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        adults: input.adults,
        children: input.children,
        rooms: input.rooms,
        extraBed: false,
        guest: {
          fullName: account.guest.fullName,
          mobile: decryptString(account.mobile),
          email: decryptOptional(account.email) ?? undefined,
        },
        couponCode: input.couponCode,
        consentAccepted: input.consentAccepted,
        consentVersion: CONSENT_VERSION,
        idempotencyKey: randomUUID(),
        honeypot: "",
        paymentPreference: input.paymentPreference,
      },
      { ip, allowPaymentPreference: true },
    );

    return {
      reservationCode: result.reservationCode,
      amountPaise: result.amountPaise,
      totalPaise: result.totalPaise,
      paymentPreference: result.paymentPreference,
      confirmed: result.confirmed,
    };
  });
}

export type CancelResult = { status: string; refundPaise: number };

/**
 * Cancel one of the signed-in guest's OWN bookings (within the property's free
 * window). Ownership is enforced against the session's guestId before the
 * booking-engine cancel runs — a guest can never cancel a booking that isn't
 * theirs (IDOR-safe).
 */
export async function cancelMyBooking(reservationId: string): Promise<Result<CancelResult>> {
  return toResult(async () => {
    const principal = await resolveGuestSession();
    if (!principal) throw new NotFoundError("Please sign in.");

    const owned = await db
      .unscoped()
      .reservation.findFirst({ where: { id: reservationId, guestId: principal.guestId }, select: { id: true } });
    if (!owned) throw new NotFoundError("Booking not found.");

    return cancelWebBooking(reservationId);
  });
}
