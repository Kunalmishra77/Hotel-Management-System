/** 12 T-7 — dueScheduledSends idempotent per (reservation, automation) (FR-13, AC-11). */
import { describe, expect, it } from "vitest";
import { dueScheduledSends } from "@/features/communications/domain/schedule";

const now = new Date("2026-08-10T00:00:00Z");

const reservations = [
  { reservationId: "r1", guestId: "g1", anchor: new Date("2026-08-10T12:00:00Z") }, // check-in in 12h
  { reservationId: "r2", guestId: "g2", anchor: new Date("2026-08-20T12:00:00Z") }, // check-in in 10d
];

describe("dueScheduledSends", () => {
  it("returns a send when anchor + offset <= now (pre-arrival −24h)", () => {
    // r1 anchor is +12h; with a −24h offset the send time is now−12h ⇒ due.
    const due = dueScheduledSends({ reservations, offsetMinutes: -24 * 60, now });
    expect(due.map((d) => d.reservationId)).toEqual(["r1"]);
  });

  it("excludes reservations whose send time is still in the future", () => {
    // r2 anchor is +10d; −24h offset ⇒ due in ~9d ⇒ not yet.
    const due = dueScheduledSends({ reservations: [reservations[1]!], offsetMinutes: -24 * 60, now });
    expect(due).toEqual([]);
  });

  it("is idempotent: an already-sent reservation is never produced again (AC-11)", () => {
    const due = dueScheduledSends({ reservations, offsetMinutes: -24 * 60, now, alreadySent: new Set(["r1"]) });
    expect(due).toEqual([]);
  });
});
