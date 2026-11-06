/**
 * Revenue by booking source, split per night (client, 6 Nov 2026).
 *
 * A booking has ONE source, but an extension's added nights may come through a
 * different channel (an MMT booking extended directly at the desk). Each
 * extension records its own [fromDate, toDate) + source; a folio line whose
 * business date falls in that range belongs to the extension's source, anything
 * else to the booking's own source. Reversals carry the reversed night's date,
 * so an early check-out nets out in the same bucket it was billed to.
 */
export type ExtensionSpan = { fromDate: Date; toDate: Date; source: string };
export type SourcedLine = { amountPaise: number | bigint; type: string; businessDate: Date | null };

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The source a given night belongs to. */
export function sourceForNight(bookingSource: string, extensions: readonly ExtensionSpan[], night: Date | null): string {
  if (!night) return bookingSource;
  const k = day(night);
  for (const e of extensions) if (k >= day(e.fromDate) && k < day(e.toDate)) return e.source;
  return bookingSource;
}

/** Adds one booking's tax-excluded folio revenue into `into`, keyed by source. */
export function addRevenueBySource(
  into: Map<string, number>,
  booking: { source: string; extensions: readonly ExtensionSpan[]; lines: readonly SourcedLine[] },
): void {
  for (const l of booking.lines) {
    if (l.type === "TAX") continue;
    const src = sourceForNight(booking.source, booking.extensions, l.businessDate);
    into.set(src, (into.get(src) ?? 0) + Number(l.amountPaise));
  }
}
