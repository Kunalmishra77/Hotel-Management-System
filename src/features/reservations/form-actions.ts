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
import { searchGuests } from "@/features/guests/queries";

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

  const result = await createReservation({
    propertyId,
    guestId,
    source: "DIRECT",
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
  });

  if (!result.ok) return { status: "error", message: result.error.message };
  redirect("/bookings");
}

export type GuestPick = { id: string; name: string; maskedMobile: string | null };

/** Masked guest search for the booking form's guest picker (reuses 04). */
export async function searchGuestsForBooking(query: string): Promise<GuestPick[]> {
  const user = await requireUser();
  if (!query.trim()) return [];
  const { guests } = await searchGuests(user, { query, limit: 8 });
  return guests.map((g) => ({ id: g.id, name: g.fullName, maskedMobile: g.maskedMobile }));
}
