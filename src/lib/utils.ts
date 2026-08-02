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
