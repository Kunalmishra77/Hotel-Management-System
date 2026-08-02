/**
 * Outbound-push retry classification — 13 (FR-13). Pure: no I/O.
 *
 * The `ChannelSyncLog` row IS the outbound outbox. A push that fails is retried
 * by the next drain cycle (the pg-boss cron cadence provides the backoff spacing)
 * until it has been failing for longer than `maxAgeMs`, at which point it is
 * dead-lettered and an administrator is alerted — the front desk is never
 * blocked by a channel that stays down (FR-13). Time-window rather than an
 * attempt counter because the row has no attempts column; the effect is the same
 * bounded, honest give-up.
 */

/** Give up retrying a failing push after this long. */
export const MAX_PUSH_AGE_MS = 30 * 60_000; // 30 minutes

export type RetryDecision = "RETRY" | "DEAD_LETTER";

export function classifyRetry(
  createdAt: Date,
  now: Date,
  maxAgeMs: number = MAX_PUSH_AGE_MS,
): RetryDecision {
  return now.getTime() - createdAt.getTime() >= maxAgeMs ? "DEAD_LETTER" : "RETRY";
}
