/**
 * Reservation queries — 03 T-27. Property-scoped, cursor-paginated reads. Callers
 * pass claims explicitly (as in 01/02/04). No PII beyond the guest's name (which
 * front desk must see to run the board).
 */
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { resolveStorageAdapter } from "@/lib/storage";
import { NotFoundError } from "@/lib/errors";
import { getGuestProfile } from "@/features/guests/queries";
import { getBalance } from "@/features/billing";
import { priceReservation } from "./domain/pricing";
import { utcEpochDay } from "./internal";
import type { SessionClaims } from "@/lib/auth/claims";

export type ReservationListItem = {
  id: string;
  code: string;
  status: string;
  guestName: string;
  checkInDate: Date;
  checkOutDate: Date;
  nights: number;
  roomNumbers: string[];
  needsAttention: string | null;
};

const LIST_SELECT = {
  id: true,
  code: true,
  status: true,
  checkInDate: true,
  checkOutDate: true,
  nights: true,
  needsAttention: true,
  guest: { select: { fullName: true } },
  allocations: { select: { room: { select: { number: true } } } },
} as const;

type Row = {
  id: string;
  code: string;
  status: string;
  checkInDate: Date;
  checkOutDate: Date;
  nights: number;
  needsAttention: string | null;
  guest: { fullName: string };
  allocations: { room: { number: string } }[];
};

function toItem(r: Row): ReservationListItem {
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    guestName: r.guest.fullName,
    checkInDate: r.checkInDate,
    checkOutDate: r.checkOutDate,
    nights: r.nights,
    roomNumbers: r.allocations.map((a) => a.room.number),
    needsAttention: r.needsAttention,
  };
}

export async function listReservations(
  user: SessionClaims,
  input: { propertyId: string; status?: string; cursor?: string; limit?: number },
): Promise<{ reservations: ReservationListItem[]; nextCursor: string | null }> {
  const limit = input.limit ?? 25;
  const rows = (await db.scoped(user).reservation.findMany({
    where: {
      propertyId: input.propertyId,
      ...(input.status ? { status: input.status as never } : {}),
    },
    select: LIST_SELECT,
    orderBy: [{ checkInDate: "desc" }, { id: "asc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  })) as Row[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    reservations: page.map(toItem),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/**
 * Reservation search — the 15-search federation shard for bookings (15 FR-1/2).
 * Keyword matches the booking `code` OR the guest's name; optional filters on
 * booking `source` and a check-in date range. Property-scoped, cursor-paginated,
 * indexed (code + checkInDate). No PII beyond the guest name (front-desk need).
 */
export async function searchReservations(
  user: SessionClaims,
  input: {
    keyword?: string;
    source?: string;
    propertyId?: string;
    dateRange?: { from: Date; to: Date };
    cursor?: string;
    limit?: number;
  },
): Promise<{ reservations: ReservationListItem[]; nextCursor: string | null }> {
  const limit = input.limit ?? 25;
  const kw = input.keyword?.trim();
  const rows = (await db.scoped(user).reservation.findMany({
    where: {
      ...(input.propertyId ? { propertyId: input.propertyId } : {}),
      ...(input.source ? { source: input.source as never } : {}),
      ...(input.dateRange ? { checkInDate: { gte: input.dateRange.from, lte: input.dateRange.to } } : {}),
      ...(kw
        ? {
            OR: [
              { code: { contains: kw, mode: "insensitive" } },
              { guest: { fullName: { contains: kw, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    select: LIST_SELECT,
    orderBy: [{ checkInDate: "desc" }, { id: "asc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  })) as Row[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    reservations: page.map(toItem),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Form C / FRRO register (03 T-36, FR-25). Property-scoped, cursor-paginated.
// Exposes NO passport/visa numbers — only nationality (compliance.md). Full ID
// numbers never live on CForm; they stay encrypted on GuestId.
// ---------------------------------------------------------------------------

export type CFormListItem = {
  id: string;
  reservationCode: string;
  guestName: string;
  nationality: string;
  status: string;
  submissionRef: string | null;
  checkInDate: Date;
  checkOutDate: Date;
  hasPdf: boolean;
  createdAt: Date;
};

export async function listCForms(
  user: SessionClaims,
  input: { propertyId: string; status?: "GENERATED" | "SUBMITTED"; cursor?: string; limit?: number },
): Promise<{ cforms: CFormListItem[]; nextCursor: string | null }> {
  authorize(user, "reservation:view", input.propertyId);
  const limit = input.limit ?? 25;
  const rows = await db.scoped(user).cForm.findMany({
    where: {
      propertyId: input.propertyId,
      ...(input.status ? { status: input.status } : {}),
    },
    select: {
      id: true,
      nationality: true,
      status: true,
      submissionRef: true,
      pdfObjectKey: true,
      createdAt: true,
      reservation: { select: { code: true, checkInDate: true, checkOutDate: true, guest: { select: { fullName: true } } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    cforms: page.map((r) => ({
      id: r.id,
      reservationCode: r.reservation.code,
      guestName: r.reservation.guest.fullName,
      nationality: r.nationality,
      status: r.status,
      submissionRef: r.submissionRef,
      checkInDate: r.reservation.checkInDate,
      checkOutDate: r.reservation.checkOutDate,
      hasPdf: Boolean(r.pdfObjectKey),
      createdAt: r.createdAt,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Fetch a Form C PDF's bytes (authorized, non-public — like a payslip). */
export async function getCFormBytes(
  user: SessionClaims,
  cformId: string,
): Promise<{ filename: string; contentType: string; bytes: Buffer }> {
  const cform = await db.scoped(user).cForm.findFirst({
    where: { id: cformId },
    select: { id: true, propertyId: true, pdfObjectKey: true, reservation: { select: { code: true } } },
  });
  if (!cform) throw new NotFoundError("Form C not found.");
  authorize(user, "reservation:view", cform.propertyId);
  if (!cform.pdfObjectKey) throw new NotFoundError("Form C PDF not generated.");
  const bytes = await resolveStorageAdapter().get(cform.pdfObjectKey);
  return { filename: `form-c-${cform.reservation.code}.pdf`, contentType: "application/pdf", bytes };
}

export async function getReservation(
  user: SessionClaims,
  id: string,
): Promise<ReservationListItem | null> {
  const r = (await db.scoped(user).reservation.findFirst({
    where: { id },
    select: LIST_SELECT,
  })) as Row | null;
  return r ? toItem(r) : null;
}

// ---------------------------------------------------------------------------
// Check-in wizard context (03 T6) — the richer read the guided flow needs:
// booking + occupancy + settlement intent + live folio balance + the guest's
// masked IDs (so the Identity step knows what's already on file). Composed from
// the guest (04) and billing (06) query surfaces, never a foreign SELECT.
// ---------------------------------------------------------------------------

export type CheckInIdSummary = { id: string; type: string; maskedValue: string; hasScan: boolean };

export type CheckInContext = {
  id: string;
  code: string;
  status: string;
  guestId: string;
  guestName: string;
  guestMaskedMobile: string | null;
  guestNationality: string | null;
  roomNumbers: string[];
  checkInDate: Date;
  checkOutDate: Date;
  nights: number;
  adults: number;
  children: number;
  settlementIntent: string;
  folioId: string | null;
  balancePaise: number | null;
  /** Booking-estimate figures (paise) for the payment step — the folio is empty
   *  until room-nights accrue, so collection at check-in works off the estimate. */
  advancePaise: number;
  estimatedTotalPaise: number;
  estimatedBalancePaise: number;
  ids: CheckInIdSummary[];
};

type CheckInRow = {
  id: string;
  code: string;
  status: string;
  guestId: string;
  checkInDate: Date;
  checkOutDate: Date;
  nights: number;
  adults: number;
  children: number;
  settlementIntent: string;
  ratePaise: number;
  discountPaise: number;
  extraBedPaise: number;
  otherChargesPaise: number;
  taxPaise: number;
  advancePaise: number;
  guest: { fullName: string; nationality: string | null };
  allocations: { room: { number: string } }[];
  folio: { id: string } | null;
};

export async function getCheckInContext(user: SessionClaims, id: string): Promise<CheckInContext | null> {
  const r = (await db.scoped(user).reservation.findFirst({
    where: { id },
    select: {
      id: true,
      code: true,
      status: true,
      guestId: true,
      checkInDate: true,
      checkOutDate: true,
      nights: true,
      adults: true,
      children: true,
      settlementIntent: true,
      ratePaise: true,
      discountPaise: true,
      extraBedPaise: true,
      otherChargesPaise: true,
      taxPaise: true,
      advancePaise: true,
      guest: { select: { fullName: true, nationality: true } },
      allocations: { select: { room: { select: { number: true } } } },
      folio: { select: { id: true } },
    },
  })) as CheckInRow | null;
  if (!r) return null;

  const [profile, balancePaise] = await Promise.all([
    getGuestProfile(user, r.guestId),
    getBalance(user, id),
  ]);

  const bill = priceReservation({
    ratePaise: r.ratePaise,
    nights: r.nights,
    discountPaise: r.discountPaise,
    extraBedPaise: r.extraBedPaise,
    otherChargesPaise: r.otherChargesPaise,
    taxPaise: r.taxPaise,
    advancePaise: r.advancePaise,
  });

  return {
    id: r.id,
    code: r.code,
    status: r.status,
    guestId: r.guestId,
    guestName: r.guest.fullName,
    guestMaskedMobile: profile?.maskedMobile ?? null,
    guestNationality: r.guest.nationality,
    roomNumbers: r.allocations.map((a) => a.room.number),
    checkInDate: r.checkInDate,
    checkOutDate: r.checkOutDate,
    nights: r.nights,
    adults: r.adults,
    children: r.children,
    settlementIntent: r.settlementIntent,
    folioId: r.folio?.id ?? null,
    balancePaise,
    advancePaise: r.advancePaise,
    estimatedTotalPaise: bill.totalPaise,
    estimatedBalancePaise: bill.balancePaise,
    ids: profile?.ids ?? [],
  };
}

/** Today's arrivals (due to check in) and departures (due to check out) (dashboard). */
export async function arrivalsDepartures(
  user: SessionClaims,
  input: { propertyId: string; date: Date },
): Promise<{ arrivals: ReservationListItem[]; departures: ReservationListItem[] }> {
  const day = utcEpochDay(input.date);
  const dayStart = new Date(day * 86_400_000);
  const dayEnd = new Date((day + 1) * 86_400_000);

  const [arrivals, departures] = await Promise.all([
    db.scoped(user).reservation.findMany({
      where: {
        propertyId: input.propertyId,
        status: "CONFIRMED",
        checkInDate: { gte: dayStart, lt: dayEnd },
      },
      select: LIST_SELECT,
      orderBy: { code: "asc" },
    }) as Promise<Row[]>,
    db.scoped(user).reservation.findMany({
      where: {
        propertyId: input.propertyId,
        status: "IN_HOUSE",
        checkOutDate: { gte: dayStart, lt: dayEnd },
      },
      select: LIST_SELECT,
      orderBy: { code: "asc" },
    }) as Promise<Row[]>,
  ]);

  return { arrivals: arrivals.map(toItem), departures: departures.map(toItem) };
}

/** Allocations overlapping a range — the reservation calendar/board feed. */
export async function reservationCalendar(
  user: SessionClaims,
  input: { propertyId: string; from: Date; to: Date },
): Promise<{ roomId: string; roomNumber: string; reservationId: string; startDate: Date; endDate: Date; status: string }[]> {
  const rows = await db.scoped(user).roomAllocation.findMany({
    where: {
      propertyId: input.propertyId,
      startDate: { lt: input.to },
      endDate: { gt: input.from },
    },
    select: {
      roomId: true,
      startDate: true,
      endDate: true,
      room: { select: { number: true } },
      reservation: { select: { id: true, status: true } },
    },
    orderBy: [{ roomId: "asc" }, { startDate: "asc" }],
  });

  return rows.map((a) => ({
    roomId: a.roomId,
    roomNumber: a.room.number,
    reservationId: a.reservation.id,
    startDate: a.startDate,
    endDate: a.endDate,
    status: a.reservation.status,
  }));
}
