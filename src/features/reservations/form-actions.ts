"use server";

/**
 * `useActionState` + picker adapters for the booking UI — 03 T-28/T-30.
 *
 * The booking form gathers dates → room → guest → amounts and submits here; this
 * translates the FormData to `createReservation` and redirects to the board on
 * success. Guest lookup for the picker reuses 04's masked search.
 */
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createReservation } from "./actions";
import { createGuest } from "@/features/guests/actions";
import { searchGuests } from "@/features/guests/queries";

const BOOKING_SOURCES = ["WALK_IN", "DIRECT", "PHONE", "CORPORATE", "WEBSITE"] as const;
type BookingSourceValue = (typeof BOOKING_SOURCES)[number];

const SETTLEMENT_INTENTS = ["PAY_AT_HOTEL", "ALREADY_PAID", "UNPAID_ONLINE"] as const;
type SettlementIntentValue = (typeof SETTLEMENT_INTENTS)[number];

export type BookingFormState = { status: "idle" } | { status: "error"; message: string };

function num(formData: FormData, name: string): number {
  const v = formData.get(name);
  return typeof v === "string" && v.trim() !== "" ? Number(v) : 0;
}
function str(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/** Create a booking from the stepper (AC-1/2). Amounts arrive already in paise. */
export async function createReservationFormAction(
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const propertyId = str(formData, "propertyId");
  const roomId = str(formData, "roomId");
  const guestId = str(formData, "guestId");
  if (!propertyId || !roomId || !guestId) {
    return { status: "error", message: "Pick a room and a guest before confirming." };
  }

  const sourceRaw = str(formData, "source");
  const source: BookingSourceValue = (BOOKING_SOURCES as readonly string[]).includes(sourceRaw)
    ? (sourceRaw as BookingSourceValue)
    : "WALK_IN";
  const notes = str(formData, "notes");

  const settlementRaw = str(formData, "settlementIntent");
  const settlementIntent: SettlementIntentValue = (SETTLEMENT_INTENTS as readonly string[]).includes(settlementRaw)
    ? (settlementRaw as SettlementIntentValue)
    : "PAY_AT_HOTEL";

  const result = await createReservation({
    propertyId,
    guestId,
    source,
    roomIds: [roomId],
    checkInDate: str(formData, "checkInDate"),
    checkOutDate: str(formData, "checkOutDate"),
    adults: num(formData, "adults") || 1,
    children: num(formData, "children"),
    extraBed: formData.get("extraBed") === "on",
    ratePaise: num(formData, "ratePaise"),
    discountPaise: num(formData, "discountPaise"),
    extraBedPaise: num(formData, "extraBedPaise"),
    taxPaise: num(formData, "taxPaise"),
    advancePaise: num(formData, "advancePaise"),
    settlementIntent,
    notes: notes || undefined,
  });

  if (!result.ok) return { status: "error", message: result.error.message };
  // "Book & check in now" (walk-in) jumps straight into the guided check-in;
  // otherwise land on the board.
  const checkInNow = formData.get("checkInNow") === "true";
  redirect(checkInNow ? `/bookings/${result.data.id}/check-in` : "/bookings");
}

/**
 * Create a guest inline from the booking stepper (walk-in). Creates even on a
 * probable duplicate (`confirmDuplicate`) so the front desk is never blocked;
 * full duplicate resolution lives on the Guests screen.
 */
export async function createGuestForBooking(input: {
  fullName: string;
  mobile: string;
  city?: string;
}): Promise<{ ok: true; guest: GuestPick } | { ok: false; message: string }> {
  const r = await createGuest({
    fullName: input.fullName,
    mobile: input.mobile,
    city: input.city?.trim() || undefined,
    confirmDuplicate: true,
  });
  if (!r.ok) return { ok: false, message: r.error.message };
  return { ok: true, guest: { id: r.data.id, name: r.data.fullName, maskedMobile: null } };
}

export type GuestPick = { id: string; name: string; maskedMobile: string | null };

/** Masked guest search for the booking form's guest picker (reuses 04). */
export async function searchGuestsForBooking(query: string): Promise<GuestPick[]> {
  const user = await requireUser();
  if (!query.trim()) return [];
  const { guests } = await searchGuests(user, { query, limit: 8 });
  return guests.map((g) => ({ id: g.id, name: g.fullName, maskedMobile: g.maskedMobile }));
}
