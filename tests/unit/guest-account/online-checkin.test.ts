/**
 * Traceability: Wave 2 — online check-in eligibility.
 *
 * A guest may self-check-in only a CONFIRMED, upcoming stay. Every other status
 * (enquiry not yet confirmed, already in-house/checked-out, cancelled, no-show)
 * must be refused — the guest can't skip the desk's confirmation or re-open a
 * terminal booking. Pure and load-bearing, so it gets a direct unit test.
 */
import { describe, expect, it } from "vitest";
import { canOnlineCheckIn } from "@/features/guest-account/domain/online-checkin";

describe("canOnlineCheckIn", () => {
  it("allows only a CONFIRMED reservation", () => {
    expect(canOnlineCheckIn("CONFIRMED")).toBe(true);
  });

  it("refuses every non-confirmed status", () => {
    for (const s of ["ENQUIRY", "IN_HOUSE", "CHECKED_OUT", "CANCELLED", "NO_SHOW", "", "confirmed"]) {
      expect(canOnlineCheckIn(s)).toBe(false);
    }
  });
});
