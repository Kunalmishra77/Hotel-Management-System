/**
 * Quiet-hours deferral — 12 T-6 (FR-21, AC-10). PURE.
 *
 * MARKETING sends computed inside the property-local quiet window are deferred to
 * the next allowed time (the window's end). TRANSACTIONAL messages are never
 * deferred. A property with no configured window never defers.
 *
 * The window is expressed as property-local "HH:mm" strings and may wrap
 * midnight (21:00–08:00 means "quiet from 21:00 today to 08:00 tomorrow").
 */
import type { AutomationCategory } from "@prisma/client";
import { localEpochDay, localMinutesOfDay, parseHhMm, zonedWallTimeToUtc } from "./tz";

export type QuietHours = { start: string | null | undefined; end: string | null | undefined };

/** Is `minutes`-of-day inside the [start,end) window (possibly midnight-wrapping)? */
export function inQuietWindow(minutes: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false; // zero-width window = never quiet
  return startMin < endMin
    ? minutes >= startMin && minutes < endMin // same-day window
    : minutes >= startMin || minutes < endMin; // wraps midnight
}

/**
 * The instant a message may first be sent. `now` for anything not currently
 * deferred; the next window-end otherwise.
 */
export function nextAllowedSendTime(
  now: Date,
  quietHours: QuietHours,
  category: AutomationCategory,
  tz: string,
): Date {
  if (category !== "MARKETING") return now; // transactional is unaffected (FR-21)

  const startMin = parseHhMm(quietHours.start);
  const endMin = parseHhMm(quietHours.end);
  if (startMin === null || endMin === null) return now; // no configured window

  const localMin = localMinutesOfDay(now, tz);
  if (!inQuietWindow(localMin, startMin, endMin)) return now;

  // Deferred: send at the next occurrence of `end`. If we are in the evening
  // segment of a wrapping window (localMin >= start), end is tomorrow's `end`;
  // otherwise it is today's `end`.
  const day = localEpochDay(now, tz);
  const endTomorrow = startMin > endMin && localMin >= startMin;
  return zonedWallTimeToUtc(endTomorrow ? day + 1 : day, endMin, tz);
}
