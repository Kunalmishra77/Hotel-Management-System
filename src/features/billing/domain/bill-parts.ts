/**
 * Bill parts — one stay, separate bills per channel (client, 10 Nov 2026).
 *
 * A guest who booked on an OTA (MakeMyTrip, Booking.com…) and then extended
 * directly at the desk has ONE folio, but two bills: the OTA's nights are billed
 * to/through the OTA (the hotel keeps that copy — it never goes to the guest),
 * and everything the guest pays the hotel for is the DIRECT bill (the only one
 * handed to the guest). Each part gets its own GST tax invoice and number.
 *
 * The rule, kept pure so billing, invoices and reports all split the same way:
 *  - a ROOM night belongs to the source of that night: the booking's own source,
 *    or the source of the extension covering it (`StayExtension`);
 *  - every non-room charge (food, laundry, transfers, extra bed, round-off,
 *    discounts…) is paid at the hotel → DIRECT, even on an all-OTA booking;
 *  - a REVERSAL follows the line it reverses, so a correction nets out in the
 *    bill it was made on;
 *  - payments: the booking's advance on an OTA booking and any "Online / OTA
 *    prepaid" payment are the OTA's money; an extension prepaid "via" an OTA is
 *    that OTA's; everything else was paid at the hotel → DIRECT.
 * An OTA "part" is the OTA source itself (MAKEMYTRIP…); every non-OTA source
 * (Direct, Walk-in, Phone, Website, Corporate, Travel agent) is the DIRECT part.
 */
import { folioBalance } from "./balance";

export const DIRECT_PART = "DIRECT";
export const OTA_SOURCES: ReadonlySet<string> = new Set(["AIRBNB", "BOOKING_COM", "AGODA", "MAKEMYTRIP", "GOIBIBO", "EXPEDIA"]);

const OTA_LABEL: Record<string, string> = {
  AIRBNB: "Airbnb", BOOKING_COM: "Booking.com", AGODA: "Agoda", MAKEMYTRIP: "MakeMyTrip", GOIBIBO: "Goibibo", EXPEDIA: "Expedia",
};

export type StaySpan = { fromDate: Date; toDate: Date; source: string };
/** What decides the split: the booking's own source + its extensions. Null source = no reservation (direct sale). */
export type PartContext = { bookingSource: string | null; extensions: readonly StaySpan[] };
export type PartLine = { id: string; type: string; businessDate: Date | null; reversalOfId: string | null; amountPaise: number | bigint; cgstPaise: number; sgstPaise: number; igstPaise: number };
export type PartPayment = { mode: string; reference: string | null; amountPaise: number | bigint; isRefund: boolean };

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

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
 * The SOURCE a folio line's revenue belongs to: a room night → its night's
 * source; anything else → the booking's source, except on an OTA booking, where
 * it was paid at the hotel → DIRECT. A reversal follows the line it reverses.
 */
export function lineSource(line: PartLine, byId: ReadonlyMap<string, PartLine>, ctx: PartContext): string {
  if (!ctx.bookingSource) return DIRECT_PART;
  const base = line.type === "REVERSAL" && line.reversalOfId ? (byId.get(line.reversalOfId) ?? line) : line;
  if (base.type === "ROOM") return sourceForNight(ctx.bookingSource, ctx.extensions, base.businessDate);
  return OTA_SOURCES.has(ctx.bookingSource) ? DIRECT_PART : ctx.bookingSource;
}

/** The bill a folio line goes on. */
export const linePart = (line: PartLine, byId: ReadonlyMap<string, PartLine>, ctx: PartContext): string =>
  partOfSource(lineSource(line, byId, ctx));

const LABEL_TO_OTA = new Map(Object.entries(OTA_LABEL).map(([k, v]) => [v.toLowerCase(), k]));

/** The bill a payment belongs to, given the OTA parts this stay actually has. */
export function paymentPart(p: PartPayment, ctx: PartContext, otaParts: readonly string[]): string {
  if (otaParts.length === 0) return DIRECT_PART;
  const ref = p.reference ?? "";
  const own = ctx.bookingSource && OTA_SOURCES.has(ctx.bookingSource) ? ctx.bookingSource : null;
  // An extension prepaid on an OTA: "Extension 2026-11-06→2026-11-09 · Agoda".
  const via = /^Extension .*· (.+)$/.exec(ref)?.[1]?.trim().toLowerCase();
  if (via !== undefined) {
    const ota = LABEL_TO_OTA.get(via);
    return ota && otaParts.includes(ota) ? ota : DIRECT_PART;
  }
  if (ref.startsWith("ADVANCE:") && own && otaParts.includes(own)) return own;
  if (p.mode === "ONLINE") return own && otaParts.includes(own) ? own : otaParts[0]!;
  return DIRECT_PART;
}

export type BillPart = {
  part: string;
  label: string;
  /** The bill handed to the guest (DIRECT); an OTA part is the hotel's copy. */
  guestBill: boolean;
  lineIds: string[];
  chargesPaise: number; // incl. tax
  paidPaise: number; // net of refunds
  balancePaise: number;
};

/** Split a folio into its bills. OTA parts first, DIRECT last; a part with no lines and no money is left out. */
export function billParts(lines: readonly PartLine[], payments: readonly PartPayment[], ctx: PartContext): BillPart[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const groups = new Map<string, { lines: PartLine[]; payments: PartPayment[] }>();
  const at = (k: string) => groups.get(k) ?? (groups.set(k, { lines: [], payments: [] }), groups.get(k)!);
  for (const l of lines) at(linePart(l, byId, ctx)).lines.push(l);
  const otaParts = [...groups.keys()].filter((k) => k !== DIRECT_PART);
  for (const p of payments) at(paymentPart(p, ctx, otaParts)).payments.push(p);

  const order = (k: string) => (k === DIRECT_PART ? 1 : 0);
  return [...groups.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([part, g]) => {
      const charges = g.lines.reduce((s, l) => s + Number(l.amountPaise) + l.cgstPaise + l.sgstPaise + l.igstPaise, 0);
      const balance = Number(folioBalance(g.lines, g.payments));
      return { part, label: billPartLabel(part), guestBill: isGuestBill(part), lineIds: g.lines.map((l) => l.id), chargesPaise: charges, paidPaise: charges - balance, balancePaise: balance };
    })
    .filter((p) => p.lineIds.length > 0 || p.paidPaise !== 0);
}
