/**
 * GST rate configuration — 06 T-3 (FR-11, business-rules.md §10–11).
 *
 * Config-driven, in one place, so a rate change is a data edit not a code hunt.
 * Two dimensions:
 *  - Room accommodation GST depends on the per-night tariff BAND (§11).
 *  - Other on-premise services carry their SAC's rate.
 *
 * Rates are basis points (1200 = 12%). HSN/SAC codes are carried on the folio
 * line and printed on the invoice.
 *
 * NOTE: place of supply / intra-vs-inter-state is decided in the domain
 * (`placeOfSupply`), NOT here — this file only says "what rate".
 */

/**
 * Room-tariff GST bands (per-night tariff → rate) — the CURRENT India regime,
 * effective 22 Sep 2025 (56th GST Council):
 *   - up to ₹7,500/night  → 5%  (no input-tax-credit)
 *   - above ₹7,500/night  → 18% (with ITC)
 * Config-driven so a future rate change is a one-line edit here, never hard-coded
 * elsewhere. Woodpecker's serviced-apartment tariffs sit in the 5% band today; the
 * 18% band only ever applies if a room is priced above ₹7,500/night.
 */
export const ROOM_TARIFF_BANDS: readonly { uptoPaise: number; bps: number }[] = [
  { uptoPaise: 750_000, bps: 500 }, // ≤ ₹7,500/night → 5% (2.5% + 2.5%), no ITC
  { uptoPaise: Number.POSITIVE_INFINITY, bps: 1800 }, // > ₹7,500/night → 18% (9% + 9%), with ITC
];

/** GST rate for a room-night given its tariff (§11 — band-driven, not hard-coded).
 *  Fallback 500 keeps a mis-config safe at the lower, no-ITC rate. */
export function roomGstBps(tariffPaise: number): number {
  return ROOM_TARIFF_BANDS.find((b) => tariffPaise <= b.uptoPaise)?.bps ?? 500;
}

/** SAC GST rate per on-premise charge type — flat 5% across the board (client setup). */
const CHARGE_GST_BPS: Record<string, number> = {
  ROOM: 500,
  FOOD: 500,
  KITCHEN: 500,
  LAUNDRY: 500,
  AIRPORT_TRANSFER: 500,
  TAXI: 500,
  EXTRA_BED: 500,
  POS: 500,
  MISC: 500,
};

/** SAC/HSN codes per charge type (printed on the GST invoice; client-provided). */
export const HSN_SAC: Record<string, string> = {
  ROOM: "996311", // room / unit accommodation
  FOOD: "996331", // food / restaurant service
  KITCHEN: "996331",
  LAUNDRY: "999711",
  AIRPORT_TRANSFER: "996412",
  TAXI: "996601", // car rent / vehicle hire
  EXTRA_BED: "996311",
  POS: "996311",
  MISC: "999799",
};

/**
 * GST rate (bps) for a charge. ROOM uses the tariff band when the tariff is
 * given; everything else uses its SAC default. Unknown types default to 18%.
 */
export function gstBpsForCharge(type: string, tariffPaise?: number): number {
  if (type === "ROOM" && tariffPaise != null) return roomGstBps(tariffPaise);
  return CHARGE_GST_BPS[type] ?? 1800;
}

export function hsnSacForCharge(type: string): string {
  return HSN_SAC[type] ?? "999799";
}
