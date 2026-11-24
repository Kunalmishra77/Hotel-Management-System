/**
 * Read an OTA voucher / booking email that reception pastes in (client, 24 Nov
 * 2026: "online bookings come from MMT, Booking.com, Expedia… — no retyping").
 * Pure: text in → the booking's fields out, or why it couldn't be read.
 *
 * Works on whitespace-flattened text, so it doesn't matter whether the text came
 * from the PDF (columns interleaved) or the email body. Dates are derived from the
 * check-out date and the night count — the one pair every layout keeps together.
 *
 * Formats read so far: the Go-MMT "Host Voucher" (MakeMyTrip, Goibibo — same
 * layout). Other OTAs return `unsupported` until their samples are added.
 */
import Decimal from "decimal.js";

export type OtaVoucher = {
  source: "MAKEMYTRIP" | "GOIBIBO";
  channelRef: string;
  pnr: string | null;
  guestName: string | null;
  checkInDate: string; // yyyy-mm-dd, property-local calendar day
  checkOutDate: string;
  nights: number;
  adults: number;
  children: number;
  /** Room + extra-adult charges before GST, whole stay. */
  roomChargesPaise: number;
  taxPaise: number;
  grossPaise: number;
  /** What the OTA says it will remit, when the voucher shows it. */
  payablePaise: number | null;
  /** "Paid Online" — the OTA collected it; nothing due at the hotel. */
  prepaid: boolean;
  /** Pre-GST rate per night = room charges ÷ nights, rounded to the paisa. */
  ratePaise: number;
};

export type VoucherParse = { ok: true; voucher: OtaVoucher } | { ok: false; reason: string };

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "06 Dec '26" → "2026-12-06". */
function shortDate(d: string, m: string, y: string): string | null {
  const month = MONTHS[m.toLowerCase().slice(0, 3)];
  if (!month) return null;
  return `20${y}-${String(month).padStart(2, "0")}-${d.padStart(2, "0")}`;
}
function minusDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}
/** "₹ 8,330.94" → 833094 paise (Decimal, never float). */
function rupeesToPaise(s: string): number {
  return new Decimal(s.replace(/,/g, "")).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}
function amountAfter(text: string, label: RegExp): number | null {
  const m = text.match(new RegExp(`${label.source}[^₹]{0,30}₹\\s*([\\d,]+(?:\\.\\d+)?)`, "i"));
  return m ? rupeesToPaise(m[1]!) : null;
}

export function parseOtaVoucher(raw: string): VoucherParse {
  const text = raw.replace(/[ \s]+/g, " ").replace(/[’‘]/g, "'").trim();
  if (text.length < 40) return { ok: false, reason: "Paste the whole voucher or booking email." };

  const isGoMmt = /Go-?MMT|MakeMyTrip|Goibibo/i.test(text) && /Host Voucher|BOOKING ID/i.test(text);
  if (!isGoMmt) {
    const which = /booking\.com/i.test(text) ? "Booking.com" : /expedia/i.test(text) ? "Expedia" : /agoda/i.test(text) ? "Agoda" : /airbnb/i.test(text) ? "Airbnb" : null;
    return { ok: false, reason: `${which ? `${which} bookings` : "This format"} can't be read yet — so far MakeMyTrip and Goibibo vouchers are read. Fill the form by hand for now.` };
  }

  const ref = text.match(/BOOKING ID\b[\s\S]{0,80}?\b([A-Z]{2}\d{8,})\b/);
  if (!ref) return { ok: false, reason: "Couldn't find the MakeMyTrip booking ID (e.g. NH7303…)." };
  const out = text.match(/(\d{1,2}) ([A-Za-z]{3}) '(\d{2}) \((\d+) Nights?\)/);
  if (!out) return { ok: false, reason: "Couldn't find the check-out date and number of nights." };
  const checkOutDate = shortDate(out[1]!, out[2]!, out[3]!);
  const nights = Number(out[4]);
  if (!checkOutDate || nights < 1) return { ok: false, reason: "The stay dates on the voucher couldn't be read." };

  const room = amountAfter(text, /\bRoom Charges/);
  const extra = amountAfter(text, /Extra Adult\/ ?Child Charges/) ?? 0;
  const tax = amountAfter(text, /Property Taxes/);
  const gross = amountAfter(text, /Property Gross Charges(?: \(1\+2\+3\+4\))?/);
  if (room === null || tax === null || gross === null) return { ok: false, reason: "Couldn't find the room charges, taxes and gross amount (the voucher's Final Calculation)." };

  const via = text.match(/BOOKED VIA\b[\s\S]{0,60}?\b(MakeMyTrip|Goibibo|MyBiz)\b/i)?.[1] ?? "MakeMyTrip";
  const guest = text.match(/PRIMARY GUEST DETAILS (?:BOOKING ID (?:BOOKED ON )?)?([A-Za-z][A-Za-z.' ]{1,60}?) (?=CHECK-IN|[A-Z]{2}\d{8,}|BOOKING ID)/);
  const roomCharges = room + extra;
  return {
    ok: true,
    voucher: {
      source: /goibibo/i.test(via) ? "GOIBIBO" : "MAKEMYTRIP",
      channelRef: ref[1]!,
      pnr: text.match(/\bPNR\b[\s\S]{0,40}?\b(\d{6,})\b/)?.[1] ?? null,
      guestName: guest?.[1]?.trim() || null,
      checkInDate: minusDays(checkOutDate, nights),
      checkOutDate,
      nights,
      adults: Number(text.match(/(\d+) Adults?\b/)?.[1] ?? 1) || 1,
      children: Number(text.match(/(\d+) Child(?:ren)?\b/)?.[1] ?? 0),
      roomChargesPaise: roomCharges,
      taxPaise: tax,
      grossPaise: gross,
      payablePaise: amountAfter(text, /Payable to Property \(A-B-C\)/),
      prepaid: /Paid Online/i.test(text) && !/Pay at Hotel/i.test(text),
      ratePaise: new Decimal(roomCharges).div(nights).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
    },
  };
}
