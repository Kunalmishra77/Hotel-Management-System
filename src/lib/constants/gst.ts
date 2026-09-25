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
 * Room-tariff GST bands (per-night tariff → rate).
 *
 * Woodpecker bills accommodation + all on-premise services at a FLAT 5% GST
 * (2.5% CGST + 2.5% SGST) per the client's tax setup and their invoice format —
 * not the post-2022 12/18% slabs. Config-driven: change the bps here to change it
 * everywhere (never hard-coded elsewhere).
 */
export const ROOM_TARIFF_BANDS: readonly { uptoPaise: number; bps: number }[] = [
  { uptoPaise: Number.POSITIVE_INFINITY, bps: 500 }, // flat 5% (2.5% + 2.5%)
];

/** GST rate for a room-night given its tariff (§11 — band-driven, not hard-coded). */
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
