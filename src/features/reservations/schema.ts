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
