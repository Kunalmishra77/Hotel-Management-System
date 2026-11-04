/** Stay facts for guest messages — date format, nights, past-stay guard. */
import { describe, expect, it } from "vitest";
import { isPastStay, stayContext } from "@/features/communications/domain/stay";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("stayContext", () => {
  it("formats local stay dates, counts nights, joins current rooms", () => {
    expect(stayContext({ code: "BK-1", checkInDate: d("2026-11-03"), checkOutDate: d("2026-11-05"), roomNumbers: ["GF-1"] })).toEqual({
      bookingCode: "BK-1", checkInDate: "Tue, 3 Nov 2026", checkOutDate: "Thu, 5 Nov 2026", nights: 2, roomNumber: "GF-1",
    });
    expect(stayContext({ code: "BK-2", checkInDate: d("2026-11-03"), checkOutDate: d("2026-11-04"), roomNumbers: [] })).not.toHaveProperty("roomNumber");
  });
});

describe("isPastStay", () => {
  it("a stay that ended days before the event is past; a same-day or overstay checkout is not", () => {
    expect(isPastStay(d("2026-10-01"), new Date("2026-11-04T08:00:00Z"))).toBe(true); // backfill
    expect(isPastStay(d("2026-11-04"), new Date("2026-11-04T08:00:00Z"))).toBe(false); // departure day
    expect(isPastStay(d("2026-11-03"), new Date("2026-11-04T18:00:00Z"))).toBe(false); // overstay, next day
    expect(isPastStay(d("2026-11-10"), new Date("2026-11-04T08:00:00Z"))).toBe(false); // future stay
  });
});
