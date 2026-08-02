/** 13 T-4 — availabilityDelta from events (FR-9/10). Pure. */
import { describe, expect, it } from "vitest";
import { availabilityDelta } from "@/features/channels/domain/availability-delta";

const from = new Date("2027-05-01T00:00:00.000Z");
const to = new Date("2027-05-04T00:00:00.000Z");

describe("availabilityDelta (FR-9/10)", () => {
  it("emits an availability push for reservation + room-status events", () => {
    for (const type of ["ReservationCreated", "ReservationModified", "ReservationCancelled", "RoomStatusChanged"] as const) {
      const d = availabilityDelta({ type, propertyId: "p", categoryId: "cat", from, to });
      expect(d?.push).toBe("availability");
      expect(d?.categoryId).toBe("cat");
    }
  });

  it("emits a rate push for DynamicRateApproved with a rate", () => {
    const d = availabilityDelta({ type: "DynamicRateApproved", propertyId: "p", categoryId: "cat", from, to, ratePaise: 500_000 });
    expect(d?.push).toBe("rate");
    expect(d?.ratePaise).toBe(500_000);
  });

  it("skips when category, range, or (for rate) the amount is missing", () => {
    expect(availabilityDelta({ type: "ReservationCreated", propertyId: "p", categoryId: null, from, to })).toBeNull();
    expect(availabilityDelta({ type: "ReservationCreated", propertyId: "p", categoryId: "cat", from: null, to })).toBeNull();
    expect(availabilityDelta({ type: "DynamicRateApproved", propertyId: "p", categoryId: "cat", from, to, ratePaise: null })).toBeNull();
  });

  it("skips an inverted or empty range", () => {
    expect(availabilityDelta({ type: "ReservationCreated", propertyId: "p", categoryId: "cat", from: to, to: from })).toBeNull();
  });
});
