/**
 * Stay facts for guest messages — pure. Reservation events carry only the booking
 * code, so the consumer loads the stay and merges these human-readable fields into
 * the template context ({{checkInDate}}, {{checkOutDate}}, {{nights}},
 * {{bookingCode}}, {{roomNumber}}).
 */

/** Booking dates are property-local calendar days stored at UTC midnight. */
export function formatStayDate(d: Date): string {
  // Assembled from parts: en-IN's own pattern ("10 Mar, 2028") varies by ICU build.
  const parts = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).formatToParts(d);
  const p = (t: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("weekday")}, ${p("day")} ${p("month")} ${p("year")}`;
}

/**
 * A stay that ended well before the event — a back-dated entry (Data Entry
 * backfill of a past stay, a late correction). Such events must not mail the
 * guest "booking confirmed" / "welcome" / "thank you" for a stay long over. Two
 * days of slack keeps a real overstay checkout (departure yesterday) messaging.
 */
export function isPastStay(checkOutDate: Date, eventAt: Date): boolean {
  return eventAt.getTime() - checkOutDate.getTime() > 2 * 86_400_000;
}

export type StayFacts = { code: string; checkInDate: Date; checkOutDate: Date; roomNumbers: string[] };

export function stayContext(s: StayFacts): Record<string, string | number> {
  const nights = Math.max(1, Math.round((s.checkOutDate.getTime() - s.checkInDate.getTime()) / 86_400_000));
  return {
    bookingCode: s.code,
    checkInDate: formatStayDate(s.checkInDate),
    checkOutDate: formatStayDate(s.checkOutDate),
    nights,
    ...(s.roomNumbers.length ? { roomNumber: s.roomNumbers.join(", ") } : {}),
  };
}
