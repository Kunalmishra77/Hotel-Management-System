/**
 * Bill parts — one stay, separate bills per channel (client, 10 Nov 2026).
 *
 * A guest who booked on an OTA (MakeMyTrip, Booking.com…) and then extended
 * directly at the desk has ONE folio, but two bills: the OTA's nights are billed
 * to/through the OTA (the hotel keeps that copy — it never goes to the guest),
 * and everything the guest pays the hotel for is the DIRECT bill (the only one
 * handed to the guest). Each part gets its own GST tax invoice and number.
 *
 * Lines, kept pure so billing, invoices and reports all split the same way:
 *  - a ROOM night belongs to the source of that night: the booking's own source,
 *    or the source of the extension covering it (`StayExtension`);
 *  - every other charge (food, laundry, transfers, extra bed, discounts…) is paid
 *    at the hotel → DIRECT, even on an all-OTA booking;
 *  - the whole-rupee "Round off" line is not a charge of its own: it rides on the
 *    DIRECT bill when that bill has real charges, else on the OTA bill (so a
 *    plain OTA stay never sprouts a ₹0.40 "direct bill");
 *  - a REVERSAL follows the line it reverses.
 * Money: payments can't be told apart reliably (a Booking.com guest often pays
 *  at the hotel), so they are ALLOCATED, not tagged: OTA prepayments (the
 *  booking's advance on an OTA booking, "Online / OTA prepaid", an extension
 *  prepaid "via" an OTA) pay their OTA bill; money taken at the hotel pays the
 *  DIRECT bill first and any surplus pays the OTA bills; an OTA overpayment
 *  spills onto the DIRECT bill. So a fully paid stay shows ₹0 on every bill.
 * An OTA "part" is the OTA source itself (MAKEMYTRIP…); every non-OTA source
 * (Direct, Walk-in, Phone, Website, Corporate, Travel agent) is the DIRECT part.
 */
export const DIRECT_PART = "DIRECT";
export const OTA_SOURCES: ReadonlySet<string> = new Set(["AIRBNB", "BOOKING_COM", "AGODA", "MAKEMYTRIP", "GOIBIBO", "EXPEDIA"]);

const OTA_LABEL: Record<string, string> = {
  AIRBNB: "Airbnb", BOOKING_COM: "Booking.com", AGODA: "Agoda", MAKEMYTRIP: "MakeMyTrip", GOIBIBO: "Goibibo", EXPEDIA: "Expedia",
};

export type StaySpan = { fromDate: Date; toDate: Date; source: string };
/** What decides the split: the booking's own source + its extensions. Null source = no reservation (direct sale). */
export type PartContext = { bookingSource: string | null; extensions: readonly StaySpan[] };
export type PartLine = { id: string; type: string; description?: string; businessDate: Date | null; reversalOfId: string | null; amountPaise: number | bigint; cgstPaise: number; sgstPaise: number; igstPaise: number };
export type PartPayment = { mode: string; reference: string | null; amountPaise: number | bigint; isRefund: boolean };

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const gross = (l: PartLine) => Number(l.amountPaise) + l.cgstPaise + l.sgstPaise + l.igstPaise;
const isRoundOff = (l: PartLine) => l.type === "MISC" && l.description === "Round off";

export const partOfSource = (source: string | null): string => (source && OTA_SOURCES.has(source) ? source : DIRECT_PART);
export const isGuestBill = (part: string | null): boolean => part === null || part === DIRECT_PART;
export const billPartLabel = (part: string | null): string => (part === null ? "Whole stay" : part === DIRECT_PART ? "Direct" : (OTA_LABEL[part] ?? part));

/** The booking source a given night was sold through. */
export function sourceForNight(bookingSource: string, extensions: readonly StaySpan[], night: Date | null): string {
  if (!night) return bookingSource;
  const k = dayKey(night);
  for (const e of extensions) if (k >= dayKey(e.fromDate) && k < dayKey(e.toDate)) return e.source;
  return bookingSource;
}

/**
 * The SOURCE a folio line's revenue belongs to (reports): a room night → its
 * night's source; anything else → the booking's source, except on an OTA
 * booking, where it was paid at the hotel → DIRECT. A reversal follows the line
 * it reverses.
 */
export function lineSource(line: PartLine, byId: ReadonlyMap<string, PartLine>, ctx: PartContext): string {
  if (!ctx.bookingSource) return DIRECT_PART;
  const base = line.type === "REVERSAL" && line.reversalOfId ? (byId.get(line.reversalOfId) ?? line) : line;
  if (base.type === "ROOM") return sourceForNight(ctx.bookingSource, ctx.extensions, base.businessDate);
  return OTA_SOURCES.has(ctx.bookingSource) ? DIRECT_PART : ctx.bookingSource;
}

/** The bill every folio line goes on (id → part), round-off placed per the rule above. */
export function assignParts(lines: readonly PartLine[], ctx: PartContext): Map<string, string> {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const out = new Map<string, string>();
  const roundOffs: PartLine[] = [];
  for (const l of lines) {
    const base = l.type === "REVERSAL" && l.reversalOfId ? (byId.get(l.reversalOfId) ?? l) : l;
    if (isRoundOff(base)) { roundOffs.push(l); continue; }
    out.set(l.id, partOfSource(lineSource(l, byId, ctx)));
  }
  if (roundOffs.length) {
    const totals = new Map<string, number>();
    for (const l of lines) { const p = out.get(l.id); if (p) totals.set(p, (totals.get(p) ?? 0) + gross(l)); }
    const directHasCharges = (totals.get(DIRECT_PART) ?? 0) !== 0;
    const biggestOta = [...totals.entries()].filter(([k]) => k !== DIRECT_PART).sort((a, b) => b[1] - a[1])[0]?.[0];
    const home = directHasCharges || !biggestOta ? DIRECT_PART : biggestOta;
    for (const l of roundOffs) out.set(l.id, home);
  }
  return out;
}

const LABEL_TO_OTA = new Map(Object.entries(OTA_LABEL).map(([k, v]) => [v.toLowerCase(), k]));

/** The OTA bill a payment was prepaid to, or null when it was taken at the hotel. */
export function otaPaymentPart(p: PartPayment, ctx: PartContext, otaParts: readonly string[]): string | null {
  if (otaParts.length === 0) return null;
  const ref = p.reference ?? "";
  const own = ctx.bookingSource && OTA_SOURCES.has(ctx.bookingSource) && otaParts.includes(ctx.bookingSource) ? ctx.bookingSource : null;
  // An extension paid "via" a channel: "Extension 2026-11-06→2026-11-09 · Agoda".
  const via = /^Extension .*· (.+)$/.exec(ref)?.[1]?.trim().toLowerCase();
  if (via !== undefined) {
    const ota = LABEL_TO_OTA.get(via);
    return ota && otaParts.includes(ota) ? ota : null;
  }
  if (ref.startsWith("ADVANCE:") && own) return own;
  if (p.mode === "ONLINE") return own ?? otaParts[0]!;
  return null;
}

export type BillPart = {
  part: string;
  label: string;
  /** The bill handed to the guest (DIRECT); an OTA part is the hotel's copy. */
  guestBill: boolean;
  lineIds: string[];
  chargesPaise: number; // incl. tax
  paidPaise: number; // allocated, net of refunds
  balancePaise: number;
  /** Modes of the payments that paid this bill (for its invoice). */
  paymentModes: string[];
};

/** Split a folio into its bills. OTA parts first, DIRECT last; a part with no lines is left out unless it holds money. */
export function billParts(lines: readonly PartLine[], payments: readonly PartPayment[], ctx: PartContext): BillPart[] {
  const assigned = assignParts(lines, ctx);
  const groups = new Map<string, PartLine[]>();
  for (const l of lines) {
    const p = assigned.get(l.id)!;
    groups.set(p, [...(groups.get(p) ?? []), l]);
  }
  const otaParts = [...groups.keys()].filter((k) => k !== DIRECT_PART).sort();
  const parts = [...otaParts, ...(groups.has(DIRECT_PART) ? [DIRECT_PART] : [])];
  const charges = new Map(parts.map((p) => [p, (groups.get(p) ?? []).reduce((s, l) => s + gross(l), 0)]));
  const paid = new Map(parts.map((p) => [p, 0]));
  const modes = new Map(parts.map((p) => [p, new Set<string>()]));
  const room = (p: string) => (charges.get(p) ?? 0) - (paid.get(p) ?? 0);
  const give = (p: string, amt: number, mode: string) => {
    if (!paid.has(p)) { paid.set(p, 0); charges.set(p, 0); modes.set(p, new Set()); parts.push(p); }
    paid.set(p, paid.get(p)! + amt);
    if (amt > 0) modes.get(p)!.add(mode);
  };

  // 1 · OTA prepayments → their OTA bill.
  const atHotel: { amt: number; mode: string }[] = [];
  for (const p of payments) {
    const amt = p.isRefund ? -Number(p.amountPaise) : Number(p.amountPaise);
    const ota = otaPaymentPart(p, ctx, otaParts);
    if (ota) give(ota, amt, p.mode); else atHotel.push({ amt, mode: p.mode });
  }
  // 2 · Money taken at the hotel → DIRECT first, surplus to the OTA bills, any rest to DIRECT.
  const fill = [DIRECT_PART, ...otaParts];
  for (const { amt, mode } of atHotel) {
    let left = amt;
    if (left > 0) {
      for (const p of fill) {
        if (!charges.has(p) || left <= 0) continue;
        const take = Math.min(left, Math.max(0, room(p)));
        if (take > 0) { give(p, take, mode); left -= take; }
      }
    }
    if (left !== 0) give(groups.has(DIRECT_PART) || otaParts.length === 0 ? DIRECT_PART : otaParts[0]!, left, mode);
  }
  // 3 · An OTA bill paid beyond its charges spills its surplus onto DIRECT.
  if (groups.has(DIRECT_PART)) {
    for (const p of otaParts) {
      const extra = -room(p);
      const move = Math.min(extra, Math.max(0, room(DIRECT_PART)));
      if (move > 0) {
        paid.set(p, paid.get(p)! - move);
        paid.set(DIRECT_PART, paid.get(DIRECT_PART)! + move);
        for (const m of modes.get(p)!) modes.get(DIRECT_PART)!.add(m);
      }
    }
  }

  return parts.map((part) => {
    const c = charges.get(part) ?? 0;
    const pd = paid.get(part) ?? 0;
    return {
      part, label: billPartLabel(part), guestBill: isGuestBill(part),
      lineIds: (groups.get(part) ?? []).map((l) => l.id),
      chargesPaise: c, paidPaise: pd, balancePaise: c - pd, paymentModes: [...modes.get(part)!],
    };
  });
}
