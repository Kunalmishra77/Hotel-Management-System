/**
 * Accounting-sync domain-event names — 22 (design.md § Events).
 *
 * The names themselves live in the shared catalog (`lib/events/catalog.ts`);
 * this re-exports them as typed constants so call sites don't hand-write the
 * strings. 22 EMITS these (both drive an admin alert) and CONSUMES the five
 * settled-finance events listed in `consumer.ts` — never raw `FolioCharged`.
 */
export const AccountingEvents = {
  /** A document was pushed (or sandbox-logged) to the accounting system. */
  Synced: "AccountingSynced",
  /** A push failed and the row is dead-lettered for retry + admin alert. */
  Failed: "AccountingSyncFailed",
} as const;

export type AccountingEvent = (typeof AccountingEvents)[keyof typeof AccountingEvents];
