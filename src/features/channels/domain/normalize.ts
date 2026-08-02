/**
 * Inbound normalization — 13 T-5 (FR-6). Pure: no I/O.
 *
 * Turns a provider-specific raw OTA message into the provider-neutral
 * `CanonicalReservation` shape 03 understands. Every provider's quirks (field
 * names, money as rupees vs paise, source enum) are absorbed HERE so the rest of
 * the module is provider-agnostic. Unknown/garbled input throws a
 * `NormalizeError` — the caller dead-letters it rather than ingesting nonsense.
 *
 * Money crosses the provider boundary as rupees (a decimal string or number in
 * the raw); we convert to integer paise once, here, rounding half-up at the
 * boundary (data-model.md) so nothing downstream ever sees a float.
 */
import type {
  BookingSourceLike,
  CanonicalReservation,
  ChannelMessageType,
} from "./source-map";
import { providerToBookingSource } from "./source-map";

export class NormalizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NormalizeError";
  }
}

/** A loosely-typed record — raw provider JSON is untrusted until normalized. */
type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NormalizeError("Inbound payload is not an object.");
  }
  return value as Raw;
}

function reqString(raw: Raw, key: string): string {
  const v = raw[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new NormalizeError(`Missing required string field "${key}".`);
  }
  return v.trim();
}

function optString(raw: Raw, key: string): string | null {
  const v = raw[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function intOr(raw: Raw, key: string, fallback: number): number {
  const v = raw[key];
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Math.trunc(Number(v));
  }
  return fallback;
}

/** Rupees (number | decimal string) → integer paise, rounded half-up. */
export function rupeesToPaise(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new NormalizeError(`Invalid money value: ${String(value)}`);
  }
  return Math.round(n * 100);
}

/** Map a provider's message-type token to the canonical NEW|MODIFY|CANCEL. */
export function toMessageType(rawType: string): ChannelMessageType {
  const t = rawType.toLowerCase();
  if (t.includes("cancel")) return "CANCEL";
  if (t.includes("modif") || t.includes("amend") || t.includes("update")) return "MODIFY";
  if (t.includes("new") || t.includes("creat") || t.includes("reserv") || t.includes("book")) {
    return "NEW";
  }
  throw new NormalizeError(`Unrecognized message type "${rawType}".`);
}

/**
 * Normalize a raw inbound message into a `CanonicalReservation`.
 *
 * The default shape covers the common OTA fields (Booking.com/Agoda/MMT-style);
 * a provider needing a different wire shape adds a branch here — never in the
 * application layer.
 */
export function normalizeInbound(
  provider: string,
  rawType: string,
  rawPayload: unknown,
): CanonicalReservation {
  const raw = asRecord(rawPayload);
  const messageType = toMessageType(rawType);
  const source: BookingSourceLike = providerToBookingSource(provider);

  const guest = asRecord(raw.guest ?? {});
  const money = asRecord(raw.amounts ?? raw);

  return {
    provider,
    externalId: reqString(raw, "externalId"),
    messageType,
    propertyId: reqString(raw, "propertyId"),
    source,
    externalRoomType: reqString(raw, "roomType"),
    externalRatePlan: optString(raw, "ratePlan"),
    guest: {
      fullName: reqString(guest, "name"),
      mobile: reqString(guest, "phone"),
      email: optString(guest, "email"),
    },
    checkInDate: reqString(raw, "checkIn"),
    checkOutDate: reqString(raw, "checkOut"),
    adults: Math.max(1, intOr(raw, "adults", 1)),
    children: Math.max(0, intOr(raw, "children", 0)),
    ratePaise: rupeesToPaise(money.rate ?? raw.rate ?? 0),
    taxPaise: rupeesToPaise(money.tax ?? raw.tax ?? 0),
    extraBedPaise: rupeesToPaise(money.extraBed ?? 0),
    otherChargesPaise: rupeesToPaise(money.otherCharges ?? 0),
    discountPaise: rupeesToPaise(money.discount ?? 0),
    advancePaise: rupeesToPaise(money.advance ?? raw.prepaid ?? 0),
  };
}
