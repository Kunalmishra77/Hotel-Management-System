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

/** Room-tariff GST bands (per-night tariff → rate). Post-2022 hotel slabs. */
export const ROOM_TARIFF_BANDS: readonly { uptoPaise: number; bps: number }[] = [
  { uptoPaise: 750_000, bps: 1200 }, // ≤ ₹7,500/night → 12%
  { uptoPaise: Number.POSITIVE_INFINITY, bps: 1800 }, // > ₹7,500 → 18%
];

/** GST rate for a room-night given its tariff (§11 — band-driven, not hard-coded). */
export function roomGstBps(tariffPaise: number): number {
  return ROOM_TARIFF_BANDS.find((b) => tariffPaise <= b.uptoPaise)?.bps ?? 1800;
}

/** Default SAC GST rate for each on-premise charge type (bps). */
const CHARGE_GST_BPS: Record<string, number> = {
  ROOM: 1200, // overridden by roomGstBps when a tariff is known
  FOOD: 500, // restaurant service 5% (no ITC)
  KITCHEN: 500,
  LAUNDRY: 1800,
  AIRPORT_TRANSFER: 500,
  TAXI: 500,
  EXTRA_BED: 1200, // follows the room slab
  POS: 1800,
  MISC: 1800,
};

/** SAC/HSN codes per charge type (printed on the GST invoice). */
export const HSN_SAC: Record<string, string> = {
  ROOM: "996311",
  FOOD: "996331",
  KITCHEN: "996331",
  LAUNDRY: "999711",
  AIRPORT_TRANSFER: "996412",
  TAXI: "996412",
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
