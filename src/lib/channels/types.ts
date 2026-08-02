/**
 * The provider-agnostic channel-manager contract — 13 (integrations.md golden
 * rule + `ChannelManager` contract).
 *
 * Application/domain code depends ONLY on `ChannelManager`, never on a concrete
 * OTA/aggregator SDK. Swapping a provider or going live is a config change (a
 * different adapter is resolved), never a code change (FR-2). A
 * `MockChannelManager` is the default so the whole inbound/outbound flow runs
 * end-to-end with ZERO external accounts (FR-3).
 *
 * HONEST NOTE (integrations.md): two-way OTA connectivity is NOT an open API.
 * Each OTA grants machine access only through a certified connectivity
 * partnership (Booking.com Connectivity Partner, Agoda YCS, MMT/Goibibo
 * Connectivity, Airbnb API partner) or a channel-manager aggregator
 * (SiteMinder/STAAH/eZee/Djubo/RateGain). No code path here makes an uncertified
 * channel go live — that is a client/business step (FR-17).
 */

/** The canonical inbound message kinds an OTA sends (FR-6/8). */
export type ChannelMessageType = "NEW" | "MODIFY" | "CANCEL";

/**
 * A raw inbound message as delivered by a provider (webhook body or a pull
 * result). Kept opaque (`payload: unknown`) — it is normalized by the pure
 * `normalizeInbound` domain function, never trusted as-is.
 */
export type RawInboundMessage = {
  provider: string;
  /** The OTA's own reservation id — the inbox dedupe key AND the `channelRef`. */
  externalId: string;
  /** Provider message type discriminator, e.g. "reservation.new". */
  type: string;
  payload: unknown;
};

/**
 * The provider-neutral shape every inbound OTA reservation is normalized into
 * before it touches 03 (`normalizeInbound`). Money is integer paise
 * (data-model.md); dates are property-local calendar dates (ISO `yyyy-mm-dd`).
 */
export type CanonicalReservation = {
  provider: string;
  externalId: string;
  messageType: ChannelMessageType;
  propertyId: string;
  /** Resolved 03 `BookingSource` (e.g. "BOOKING_COM") — provider mapping applied. */
  source: string;
  externalRoomType: string;
  externalRatePlan: string | null;
  guest: { fullName: string; mobile: string; email: string | null };
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  ratePaise: number;
  taxPaise: number;
  extraBedPaise: number;
  otherChargesPaise: number;
  discountPaise: number;
  advancePaise: number;
};

/** A push to an OTA/aggregator carries only what the channel needs. */
export type AvailabilityPush = {
  propertyId: string;
  categoryId: string;
  externalRoomType: string | null;
  from: Date;
  to: Date;
  /** Rooms sellable for the range (the single availability truth from 03). */
  available: number;
};

export type RatePush = {
  propertyId: string;
  categoryId: string;
  externalRoomType: string | null;
  from: Date;
  to: Date;
  ratePaise: number;
};

/** Never throws to the caller — always a result, so retry/dead-letter stays in control. */
export type PushResult = { ok: true; ref: string } | { ok: false; error: string };

export interface ChannelManager {
  /** e.g. "mock:booking_com", "siteminder:booking_com". */
  readonly name: string;
  readonly provider: string;
  /** True only when live credentials AND a certified connectivity partnership exist. */
  readonly isLive: boolean;

  /** Push sellable availability for a category/date range to the channel. */
  pushAvailability(input: AvailabilityPush): Promise<PushResult>;
  /** Push an already-approved rate (24 → 13; 13 never computes rates). */
  pushRates(input: RatePush): Promise<PushResult>;
  /** Pull queued inbound reservations (sandbox: deterministic fixtures). */
  pullReservations(): Promise<RawInboundMessage[]>;
  /** Acknowledge an inbound message so the channel does not re-send it (FR-15). */
  ack(externalId: string): Promise<void>;
  /** Provider-side normalization of an external room-type key (contract method). */
  mapRoomType(externalRoomType: string): string;
  /** Verify an inbound webhook signature BEFORE trusting the body (FR-14). */
  verifyWebhook(params: { rawBody: string; signature: string; secret: string }): boolean;
}

/** Persisted `ChannelAccount.config` shape (untrusted JSON). */
export type ChannelAccountConfig = {
  /** HMAC secret used to verify this provider's inbound webhooks. */
  webhookSecret?: string;
  /** Non-secret provider endpoint / aggregator hints. Never the secret bytes. */
  apiBase?: string;
  /** Deterministic fixtures for the mock adapter (sandbox pull). */
  fixtures?: RawInboundMessage[];
};

/** The external prerequisite a provider needs before it can go live (be honest). */
export const LIVE_BLOCKERS: Record<string, string> = {
  booking_com: "Booking.com Connectivity Partner Programme certification",
  agoda: "Agoda YCS connectivity certification",
  makemytrip: "MakeMyTrip Connectivity partnership",
  goibibo: "Goibibo Connectivity partnership",
  airbnb: "Airbnb API partner approval",
  channel_manager: "A channel-manager aggregator account (SiteMinder/STAAH/eZee/Djubo/RateGain)",
};

export function liveBlockerFor(provider: string): string {
  return LIVE_BLOCKERS[provider] ?? "A certified OTA connectivity partnership or aggregator account";
}
