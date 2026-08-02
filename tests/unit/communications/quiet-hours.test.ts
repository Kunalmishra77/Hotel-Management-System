/** 12 T-6 — nextAllowedSendTime + inQuietWindow (FR-21, AC-10). */
import { describe, expect, it } from "vitest";
import { inQuietWindow, nextAllowedSendTime } from "@/features/communications/domain/quiet-hours";
import { localMinutesOfDay } from "@/features/communications/domain/tz";

const TZ = "Asia/Kolkata"; // IST +5:30, no DST
const QH = { start: "21:00", end: "08:00" }; // wraps midnight

/** UTC instant for a given IST wall time (subtract 5h30m). */
function ist(iso: string): Date {
  return new Date(new Date(`${iso}Z`).getTime() - 330 * 60_000);
}

describe("inQuietWindow", () => {
  it("handles a midnight-wrapping window", () => {
    expect(inQuietWindow(22 * 60, 21 * 60, 8 * 60)).toBe(true); // 22:00
    expect(inQuietWindow(2 * 60, 21 * 60, 8 * 60)).toBe(true); // 02:00
    expect(inQuietWindow(12 * 60, 21 * 60, 8 * 60)).toBe(false); // 12:00
  });
  it("handles a same-day window", () => {
    expect(inQuietWindow(3 * 60, 1 * 60, 5 * 60)).toBe(true);
    expect(inQuietWindow(6 * 60, 1 * 60, 5 * 60)).toBe(false);
  });
});

describe("nextAllowedSendTime", () => {
  it("defers a MARKETING send at 22:00 to the next 08:00 (AC-10)", () => {
    const now = ist("2026-08-01T22:00:00"); // 22:00 IST
    const out = nextAllowedSendTime(now, QH, "MARKETING", TZ);
    expect(out.getTime()).toBeGreaterThan(now.getTime());
    expect(localMinutesOfDay(out, TZ)).toBe(8 * 60); // 08:00 local
  });

  it("sends a TRANSACTIONAL message at 22:00 immediately (AC-10)", () => {
    const now = ist("2026-08-01T22:00:00");
    expect(nextAllowedSendTime(now, QH, "BEFORE_ARRIVAL", TZ).getTime()).toBe(now.getTime());
  });

  it("does not defer MARKETING outside the window", () => {
    const now = ist("2026-08-01T12:00:00");
    expect(nextAllowedSendTime(now, QH, "MARKETING", TZ).getTime()).toBe(now.getTime());
  });

  it("does not defer when no window is configured", () => {
    const now = ist("2026-08-01T22:00:00");
    expect(nextAllowedSendTime(now, { start: null, end: null }, "MARKETING", TZ).getTime()).toBe(now.getTime());
  });
});
