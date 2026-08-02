/**
 * Provider → 03 `BookingSource` mapping — 13 (FR-6, glossary Booking Source).
 * Pure. Keeps the OTA-provider vocabulary ("booking_com") separate from the
 * domain enum ("BOOKING_COM"), so 03 always receives a valid source.
 *
 * Re-exports the canonical inbound types from the transport layer so the domain
 * has one shape to normalize into.
 */
export type {
  CanonicalReservation,
  ChannelMessageType,
} from "@/lib/channels/types";

/** The 03 BookingSource values a channel may resolve to. */
export type BookingSourceLike =
  | "BOOKING_COM"
  | "AGODA"
  | "MAKEMYTRIP"
  | "GOIBIBO"
  | "AIRBNB"
  | "WEBSITE";

const PROVIDER_SOURCE: Record<string, BookingSourceLike> = {
  booking_com: "BOOKING_COM",
  bookingcom: "BOOKING_COM",
  agoda: "AGODA",
  makemytrip: "MAKEMYTRIP",
  mmt: "MAKEMYTRIP",
  goibibo: "GOIBIBO",
  airbnb: "AIRBNB",
};

/**
 * Map a provider id to its `BookingSource`. An unknown provider (e.g. an
 * aggregator forwarding a channel we don't enumerate) falls back to `WEBSITE`
 * rather than throwing — the booking is still ingested, never dropped (FR-12).
 */
export function providerToBookingSource(provider: string): BookingSourceLike {
  return PROVIDER_SOURCE[provider.toLowerCase()] ?? "WEBSITE";
}
