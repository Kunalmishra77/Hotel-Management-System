/**
 * Reservation input schemas (zod) — 03. Validated at every action boundary
 * (api-conventions.md). Cross-field/date rules that need property config
 * (day-use, past-date — FR-22) live in the actions, not here.
 */
import { z } from "zod";

const paise = z.number().int().min(0);
const dateInput = z.coerce.date();

export const searchAvailabilitySchema = z.object({
  propertyId: z.string().min(1),
  checkInDate: dateInput,
  checkOutDate: dateInput,
  categoryId: z.string().min(1).optional(),
  adults: z.number().int().min(1).default(1),
  children: z.number().int().min(0).default(0),
});
export type SearchAvailabilityInput = z.infer<typeof searchAvailabilitySchema>;

/** Money + occupancy fields shared by create / hold / channel. */
const bookingFields = {
  propertyId: z.string().min(1),
  guestId: z.string().min(1),
  source: z.enum([
    "DIRECT", "WEBSITE", "PHONE", "WALK_IN",
    "AIRBNB", "BOOKING_COM", "AGODA", "MAKEMYTRIP", "GOIBIBO",
    "CORPORATE", "TRAVEL_AGENT",
  ]),
  checkInDate: dateInput,
  checkOutDate: dateInput,
  adults: z.number().int().min(1).default(1),
  children: z.number().int().min(0).default(0),
  extraBed: z.boolean().default(false),
  ratePaise: paise,
  discountPaise: paise.default(0),
  extraBedPaise: paise.default(0),
  taxPaise: paise.default(0),
  otherChargesPaise: paise.default(0),
  advancePaise: paise.default(0),
  settlementIntent: z.enum(["PAY_AT_HOTEL", "ALREADY_PAID", "UNPAID_ONLINE"]).default("PAY_AT_HOTEL"),
  corporateId: z.string().min(1).optional(),
  travelAgentId: z.string().min(1).optional(),
  expectedArrival: z.string().max(40).optional(),
  notes: z.string().max(1000).optional(),
};

export const createReservationSchema = z.object({
  ...bookingFields,
  // One or more rooms — a group booking allocates all atomically (FR-15).
  roomIds: z.array(z.string().min(1)).min(1),
});
export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const holdReservationSchema = z.object({
  ...bookingFields,
  roomIds: z.array(z.string().min(1)).min(1),
});
export type HoldReservationInput = z.infer<typeof holdReservationSchema>;

export const confirmReservationSchema = z.object({ reservationId: z.string().min(1) });

export const modifyReservationSchema = z.object({
  reservationId: z.string().min(1),
  checkInDate: dateInput.optional(),
  checkOutDate: dateInput.optional(),
  roomId: z.string().min(1).optional(),
});
export type ModifyReservationInput = z.infer<typeof modifyReservationSchema>;

export const cancelReservationSchema = z.object({
  reservationId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

/** Add an accompanying guest (occupant) to an existing booking — no new booking. */
export const addReservationGuestSchema = z.object({
  reservationId: z.string().min(1),
  fullName: z.string().trim().min(1, "Name is required.").max(120),
  age: z.coerce.number().int().min(0).max(120).optional().nullable(),
  gender: z.string().trim().max(20).optional().nullable().or(z.literal("").transform(() => null)),
  relation: z.string().trim().max(40).optional().nullable().or(z.literal("").transform(() => null)),
});
export type AddReservationGuestInput = z.infer<typeof addReservationGuestSchema>;

export const removeReservationGuestSchema = z.object({
  reservationGuestId: z.string().min(1),
});

/** Adjust occupancy counts on a booking (post-booking / during stay). */
export const updateOccupancySchema = z.object({
  reservationId: z.string().min(1),
  adults: z.coerce.number().int().min(1).max(30),
  children: z.coerce.number().int().min(0).max(30),
});

export const reallocateRoomSchema = z.object({
  reservationId: z.string().min(1),
  toRoomId: z.string().min(1).optional(),
});

export const checkInSchema = z.object({ reservationId: z.string().min(1) });
export const checkOutSchema = z.object({
  reservationId: z.string().min(1),
  defer: z.boolean().default(false),
});

/** Registration card + e-signature captured during check-in (03 T6). The
 *  signature is a base64 PNG (uploaded to encrypted storage server-side); the
 *  guest snapshot is built server-side from the reservation, never trusted input. */
export const saveRegistrationCardSchema = z.object({
  reservationId: z.string().min(1),
  signatureBase64: z.string().min(1).optional(),
  keyCardRef: z.string().max(60).optional(),
});
export type SaveRegistrationCardInput = z.infer<typeof saveRegistrationCardSchema>;

/** FRRO / Form C for a foreign guest (03 T7). Dates are property-local calendar
 *  dates; passport/visa numbers are NOT sent here (they live on GuestId). */
const optDate = z.coerce.date().optional();
const optStr = z.string().max(120).optional();
export const saveCFormSchema = z.object({
  reservationId: z.string().min(1),
  nationality: z.string().min(1).max(60),
  passportPlaceOfIssue: optStr,
  passportIssueDate: optDate,
  passportExpiryDate: optDate,
  visaType: optStr,
  visaIssueDate: optDate,
  visaExpiryDate: optDate,
  arrivalFromCity: optStr,
  arrivalFromCountry: optStr,
  arrivalInIndiaDate: optDate,
  nextDestination: optStr,
  purposeOfVisit: optStr,
});
export type SaveCFormInput = z.infer<typeof saveCFormSchema>;

// FRRO submission tracking (03 FR-26). The reference is the e-FRRO portal ack the
// staff paste back after submitting there — a short opaque string, not PII.
export const markCFormSubmittedSchema = z.object({
  cformId: z.string().min(1),
  submissionRef: z.string().trim().min(1).max(64),
});
export type MarkCFormSubmittedInput = z.infer<typeof markCFormSubmittedSchema>;

export const markNoShowsSchema = z.object({
  propertyId: z.string().min(1),
  businessDate: dateInput,
});

export const createFromChannelSchema = z.object({
  ...bookingFields,
  channelRef: z.string().min(1),
  channelAccountId: z.string().min(1).optional(),
  // The channel's room-type maps to a local category; missing → needsAttention.
  categoryId: z.string().min(1).optional(),
  roomIds: z.array(z.string().min(1)).default([]),
});
export type CreateFromChannelInput = z.infer<typeof createFromChannelSchema>;
