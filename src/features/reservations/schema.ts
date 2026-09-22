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

/** Historical stay import (go-live data entry) — a past guest stay for a property. */
const histDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-01.");
export const historicalStaySchema = z
  .object({
    propertyId: z.string().min(1, "Select the property where the guest stayed."),
    roomId: z.string().optional().nullable(),
    // A returning guest — reuse this existing guest instead of creating a duplicate.
    guestId: z.string().optional().nullable(),
    // Where the booking came from (Direct, MakeMyTrip, Booking.com, …).
    source: z
      .enum([
        "DIRECT", "WEBSITE", "PHONE", "WALK_IN",
        "AIRBNB", "BOOKING_COM", "AGODA", "MAKEMYTRIP", "GOIBIBO",
        "CORPORATE", "TRAVEL_AGENT",
      ])
      .optional()
      .default("DIRECT"),
    checkInDate: histDate,
    checkOutDate: histDate,
    fullName: z.string().trim().min(1, "Guest name is required.").max(120),
    mobile: z.string().trim().min(1, "Mobile number is required."),
    email: z.string().trim().max(120).optional().nullable(),
    gender: z.string().trim().max(20).optional().nullable(),
    nationality: z.string().trim().max(60).optional().nullable(),
    address: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().max(80).optional().nullable(),
    country: z.string().trim().max(80).optional().nullable(),
    dob: histDate.optional().nullable().or(z.literal("").transform(() => null)),
    idType: z.enum(["AADHAAR", "PASSPORT", "DRIVING_LICENCE", "VOTER_ID", "PAN", "VISA"]).optional().nullable(),
    idNumber: z.string().trim().max(60).optional().nullable(),
    scanBase64: z.string().optional().nullable(),
    scanContentType: z.string().optional().nullable(),
    // Multiple ID documents (one per person sharing the room) — each becomes a
    // GuestId with its own type/number and optional photo.
    ids: z
      .array(
        z.object({
          type: z.enum(["AADHAAR", "PASSPORT", "DRIVING_LICENCE", "VOTER_ID", "PAN", "VISA"]),
          value: z.string().trim().max(60).optional().nullable(),
          scanBase64: z.string().optional().nullable(),
          scanContentType: z.string().optional().nullable(),
        }),
      )
      .max(10)
      .optional()
      .default([]),
    ratePaise: z.coerce.number().int().min(0).max(100_000_000).optional().default(0),
    amountPaidPaise: z.coerce.number().int().min(0).max(100_000_000).optional().default(0),
    // Multiple payments — a guest may pay in parts, each by a different method
    // (e.g. part cash + part UPI), on different dates.
    payments: z
      .array(
        z.object({
          mode: z.enum(["CASH", "UPI", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "ONLINE", "CORPORATE_CREDIT"]),
          amountPaise: z.coerce.number().int().min(1).max(100_000_000),
          reference: z.string().trim().max(80).optional().nullable(),
          receivedAt: histDate.optional().nullable().or(z.literal("").transform(() => null)),
        }),
      )
      .max(20)
      .optional()
      .default([]),
    // Whether the rate/charges the staff enter already include GST (all-in price
    // the guest paid) or GST is added on top. Applies to the room + every extra.
    gstMode: z.enum(["inclusive", "exclusive"]).optional().default("inclusive"),
    // Extra services on the same bill — meals, laundry, cab, etc. Each posts its
    // own GST-correct folio line. Amount follows the same gstMode as the room.
    extraCharges: z
      .array(
        z.object({
          type: z.enum(["FOOD", "LAUNDRY", "AIRPORT_TRANSFER", "TAXI", "EXTRA_BED", "MISC"]),
          description: z.string().trim().max(80).optional().nullable(),
          amountPaise: z.coerce.number().int().min(1).max(100_000_000),
        }),
      )
      .max(20)
      .optional()
      .default([]),
    // Accompanying guests sharing the SAME room + bill (each with their own details).
    accompanyingGuests: z
      .array(
        z.object({
          fullName: z.string().trim().min(1).max(120),
          age: z.coerce.number().int().min(0).max(120).optional().nullable(),
          gender: z.string().trim().max(20).optional().nullable(),
          relation: z.string().trim().max(40).optional().nullable(),
          idType: z.string().trim().max(30).optional().nullable(),
          idNumber: z.string().trim().max(60).optional().nullable(),
        }),
      )
      .max(15)
      .optional()
      .default([]),
  })
  .refine((d) => d.checkOutDate >= d.checkInDate, {
    message: "Check-out must be the same day or after check-in.",
    path: ["checkOutDate"],
  });
export type HistoricalStayInput = z.input<typeof historicalStaySchema>;

/** Correct free-text booking details (notes, expected arrival) any time. */
export const updateReservationDetailsSchema = z.object({
  reservationId: z.string().min(1),
  notes: z.string().trim().max(1000).optional().nullable().or(z.literal("").transform(() => null)),
  expectedArrival: z.string().trim().max(40).optional().nullable().or(z.literal("").transform(() => null)),
});

export const reallocateRoomSchema = z.object({
  reservationId: z.string().min(1),
  toRoomId: z.string().min(1).optional(),
});

/** Extend an in-house guest's stay to a later check-out date (03 FR-8). */
export const extendStaySchema = z.object({
  reservationId: z.string().min(1),
  newCheckOutDate: dateInput,
});
export type ExtendStayInput = z.infer<typeof extendStaySchema>;

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
