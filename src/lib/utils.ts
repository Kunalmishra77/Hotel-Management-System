/**
 * Shared UI utilities (docs/architecture/ui-foundation.md).
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes so a later class reliably wins over an earlier one. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format integer paise as Indian Rupees.
 *
 * ui-foundation.md: "Money: always via MoneyInput/formatINR — never raw number
 * formatting; internal paise, display ₹." Takes bigint or number because
 * accumulating totals are BigInt columns (data-model.md).
 */
export function formatINR(paise: bigint | number, options: { showPaise?: boolean } = {}): string {
  const asNumber = typeof paise === "bigint" ? Number(paise) : paise;
  const rupees = asNumber / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: options.showPaise ? 2 : 0,
    maximumFractionDigits: options.showPaise ? 2 : 0,
  }).format(rupees);
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "02 Aug" — DETERMINISTIC across server and client (no `toLocale*`, no runtime
 * timezone). Business/booking dates are `@db.Date` (midnight UTC = the intended
 * calendar day), so reading UTC parts gives the right day with no shift. Using a
 * locale/timezone-dependent formatter here would render differently on the UTC
 * server vs the IST browser and trip React hydration error #418.
 */
export function formatDayMonth(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${String(dt.getUTCDate()).padStart(2, "0")} ${MONTHS_SHORT[dt.getUTCMonth()]}`;
}

/**
 * "02 Aug 2026, 14:30" in IST — DETERMINISTIC across server and client. India is
 * a fixed UTC+5:30 with no DST, so we shift the instant by that offset and read
 * UTC parts. Same reason as above: `new Date(x).toLocaleString()` renders in the
 * runtime's timezone (UTC on the server, IST in the browser) and breaks hydration.
 */
export function formatIstDateTime(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const ist = new Date(dt.getTime() + 5.5 * 3_600_000);
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${String(ist.getUTCDate()).padStart(2, "0")} ${MONTHS_SHORT[ist.getUTCMonth()]} ${ist.getUTCFullYear()}, ${hh}:${mm}`;
}
