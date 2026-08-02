/**
 * Consent / purpose-limitation — 12 T-5 (FR-10, AC-8). PURE.
 *
 * DPDP purpose-limitation: a MARKETING message needs marketing consent for the
 * channel; a TRANSACTIONAL service message (confirmation, receipt, invoice,
 * reminder) is exempt — it is necessary to deliver the stay. Default when a guest
 * has NO consent row is GRANTED (schema default): consent is only ever removed by
 * an explicit STOP/opt-out, which writes an OPTED_OUT row (FR-11).
 */
import type { AutomationCategory, ConsentStatus } from "@prisma/client";

/** True for the one category that requires marketing opt-in. */
export function isMarketingCategory(category: AutomationCategory): boolean {
  return category === "MARKETING";
}

/**
 * May a message of `category` be sent to a recipient whose marketing consent for
 * the channel is `status` (or `null` when no row exists)?
 */
export function isMarketingAllowed(
  category: AutomationCategory,
  status: ConsentStatus | null | undefined,
): boolean {
  if (!isMarketingCategory(category)) return true; // transactional: always allowed
  return status !== "OPTED_OUT"; // missing row ⇒ GRANTED (schema default)
}
