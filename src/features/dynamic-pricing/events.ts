/**
 * 24's domain-event surface. The names live in the central catalogue
 * (`@/lib/events/catalog`); this re-exports the two 24 emits so consumers (13
 * OTA push, 03/23 rate resolution) and tests reference one constant rather than
 * a string literal.
 *
 * NOTE: `RateSuggested` is 18's event (emitted by `ai.suggestRates`), NOT 24's —
 * 24 persists the `DynamicRate(SUGGESTED)` row but does not emit `RateSuggested`.
 */
import type { DomainEventType } from "@/lib/events/catalog";

export const DYNAMIC_PRICING_EVENTS = {
  approved: "DynamicRateApproved",
  rejected: "DynamicRateRejected",
} as const satisfies Record<string, DomainEventType>;
