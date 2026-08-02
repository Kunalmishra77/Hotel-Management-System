/**
 * Shared internals for the reservation actions. NOT a "use server" module.
 *
 * Holds the scoped-db accessor, the request-context wrapper, the error
 * classifiers the concurrency-safe booking path depends on (serialization
 * failure → retry; exclusion-constraint violation → ROOM_UNAVAILABLE), the
 * human booking-code generator, and the availability overlap `where` builder so
 * search and the booking transaction check inventory identically.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import { DomainError, ErrorCode } from "@/lib/errors";
import type { SessionClaims } from "@/lib/auth/claims";

/** Reservations/allocations are property-scoped — the scoped client filters them. */
export function reservationDb(user: SessionClaims) {
  return db.scoped(user);
}

export function withReservationContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
  return runWithContext(
    {
      orgId: user.orgId,
      userId: user.userId,
      propertyScope: user.propertyScope,
      activePropertyId: user.activePropertyId,
      requestId: newRequestId(),
      ip: null,
      device: null,
    },
    fn,
  );
}

/**
 * A serialization failure (40001) or deadlock (40P01): the transaction touched
 * data another concurrent transaction changed. Safe to retry once — the retry
 * re-reads and either succeeds or sees the winner's allocation (AC-6).
 */
export function isSerializationError(e: unknown): boolean {
  const code = pgCode(e);
  return code === "40001" || code === "40P01";
}

/**
 * The `room_no_overlap` EXCLUSION constraint fired (Postgres 23P01): a race
 * slipped past the app re-check and the DB refused the overlapping allocation.
 * This is overbooking being made impossible by construction — surface it as
 * ROOM_UNAVAILABLE, do not retry (the room genuinely is taken).
 */
export function isExclusionViolation(e: unknown): boolean {
  if (pgCode(e) === "23P01") return true;
  // Prisma may wrap it; the constraint name is the reliable signal.
  const msg = e instanceof Error ? e.message : "";
  return msg.includes("room_no_overlap");
}

/** Extract the underlying Postgres SQLSTATE from a Prisma error, if present. */
function pgCode(e: unknown): string | undefined {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = e.meta as { code?: string } | undefined;
    return meta?.code ?? (e.code === "P2002" ? "23505" : undefined);
  }
  return undefined;
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * A human, per-property-unique booking code (FR-1). Not gap-free (that rule is
 * for invoices, not bookings) — just short, unique, and mildly informative. The
 * `@@unique([propertyId, code])` constraint + a retry are the collision guard.
 */
export function generateReservationCode(now: Date = new Date()): string {
  const stamp = now.getTime().toString(36).toUpperCase().slice(-6);
  const rand = Math.floor(Math.random() * 36 ** 2)
    .toString(36)
    .toUpperCase()
    .padStart(2, "0");
  return `BK-${stamp}${rand}`;
}

/**
 * The overlap `where` for a room over a half-open `[start, end)` range — the one
 * definition search and the booking tx both use, so they can never disagree.
 * Matches `overlaps()` and the DB `daterange('[)')`: `start < end AND end > start`.
 */
export function overlapWhere(start: Date, end: Date) {
  return { startDate: { lt: end }, endDate: { gt: start } };
}

/** Epoch day number of a `@db.Date`-style value from its UTC calendar parts. */
export function utcEpochDay(date: Date): number {
  return Math.round(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000,
  );
}

/** Today's epoch day as seen in the property timezone (for the past-date rule). */
export function todayLocalEpochDay(tz: string, now: Date = new Date()): number {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

/**
 * FR-22 date validation. Throws VALIDATION_FAILED (nothing persists) when the
 * range is inverted, or same-day without day-use, or starts in the past. Channel
 * back-fill passes `allowPast` since 13 may ingest a historical record.
 */
export function assertBookingDatesValid(input: {
  checkInDate: Date;
  checkOutDate: Date;
  dayUseEnabled: boolean;
  tz: string;
  allowPast?: boolean;
}): void {
  const ci = utcEpochDay(input.checkInDate);
  const co = utcEpochDay(input.checkOutDate);

  if (co < ci) {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, "Check-out cannot be before check-in.");
  }
  if (co === ci && !input.dayUseEnabled) {
    throw new DomainError(
      ErrorCode.VALIDATION_FAILED,
      "Check-out must be after check-in (day-use is not enabled for this property).",
    );
  }
  if (!input.allowPast && ci < todayLocalEpochDay(input.tz)) {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, "Check-in date is in the past.");
  }
}

/**
 * Run a booking transaction with the concurrency policy: retry ONCE on a
 * serialization failure (the honest "someone else touched this — try again"),
 * and translate the `room_no_overlap` exclusion-constraint violation into a clean
 * `ROOM_UNAVAILABLE` (overbooking refused by the database — never retried, the
 * room really is taken). Any other error propagates.
 */
export async function bookingAttempt<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (isExclusionViolation(e)) {
        throw new DomainError(ErrorCode.ROOM_UNAVAILABLE);
      }
      if (attempt === 0 && isSerializationError(e)) continue;
      throw e;
    }
  }
}

export const RESERVATION_SELECT = {
  id: true,
  propertyId: true,
  code: true,
  guestId: true,
  status: true,
  source: true,
  channelRef: true,
  corporateId: true,
  travelAgentId: true,
  checkInDate: true,
  checkOutDate: true,
  checkInAt: true,
  checkOutAt: true,
  nights: true,
  adults: true,
  children: true,
  holdExpiresAt: true,
  needsAttention: true,
  ratePaise: true,
  discountPaise: true,
  extraBedPaise: true,
  taxPaise: true,
  otherChargesPaise: true,
  advancePaise: true,
} as const;
