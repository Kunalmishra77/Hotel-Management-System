/**
 * 23 T-4 — validateStayConstraints (FR-14, AC-14). LOS, lead-time, max rooms,
 * occupancy (extra bed relaxes the adult cap by one). Nothing persists on a
 * violation — this pure gate runs before any write.
 */
import { describe, expect, it } from "vitest";
import { validateStayConstraints } from "@/features/booking-engine/domain/constraints";

const cfg = { minLos: 1, maxLos: 14, leadTimeDays: 0, maxRoomsPerBooking: 5 };
const category = { maxAdults: 2, maxChildren: 1 };
const base = { nights: 3, leadDays: 5, rooms: 1, adults: 2, children: 1, extraBed: false, category };

describe("validateStayConstraints", () => {
  it("accepts a valid stay", () => {
    expect(validateStayConstraints(base, cfg).ok).toBe(true);
  });

  it("rejects below minimum length-of-stay", () => {
    const r = validateStayConstraints({ ...base, nights: 0 }, { ...cfg, minLos: 2 });
    expect(r.ok).toBe(false);
  });

  it("rejects above maximum length-of-stay", () => {
    expect(validateStayConstraints({ ...base, nights: 20 }, cfg).ok).toBe(false);
  });

  it("rejects inside the lead-time window", () => {
    const r = validateStayConstraints({ ...base, leadDays: 1 }, { ...cfg, leadTimeDays: 3 });
    expect(r.ok).toBe(false);
  });

  it("rejects a past check-in (negative lead days)", () => {
    expect(validateStayConstraints({ ...base, leadDays: -1 }, cfg).ok).toBe(false);
  });

  it("rejects more rooms than allowed", () => {
    expect(validateStayConstraints({ ...base, rooms: 6 }, cfg).ok).toBe(false);
  });

  it("rejects occupancy over the category max without an extra bed", () => {
    expect(validateStayConstraints({ ...base, adults: 3, extraBed: false }, cfg).ok).toBe(false);
  });

  it("allows one adult over the cap with an extra bed", () => {
    expect(validateStayConstraints({ ...base, adults: 3, extraBed: true }, cfg).ok).toBe(true);
  });

  it("rejects too many children", () => {
    expect(validateStayConstraints({ ...base, children: 3 }, cfg).ok).toBe(false);
  });
});
