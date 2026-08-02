/** 13 T-5 — normalizeInbound per-provider → canonical (FR-6). Pure. */
import { describe, expect, it } from "vitest";
import { normalizeInbound, NormalizeError, rupeesToPaise, toMessageType } from "@/features/channels/domain/normalize";

const rawBdc = {
  propertyId: "prop_wmg",
  externalId: "BDC-9001",
  roomType: "DLX-BB",
  ratePlan: "BB",
  guest: { name: "Otto Aggregator", phone: "9900112233", email: "otto@example.com" },
  checkIn: "2026-07-12",
  checkOut: "2026-07-15",
  adults: 2,
  children: 1,
  amounts: { rate: 4000, tax: 480, advance: 1000 },
};

describe("normalizeInbound (FR-6)", () => {
  it("maps a Booking.com message to the canonical shape with source + paise money", () => {
    const c = normalizeInbound("booking_com", "reservation.new", rawBdc);
    expect(c.messageType).toBe("NEW");
    expect(c.source).toBe("BOOKING_COM");
    expect(c.externalId).toBe("BDC-9001");
    expect(c.externalRoomType).toBe("DLX-BB");
    expect(c.guest.fullName).toBe("Otto Aggregator");
    expect(c.ratePaise).toBe(400_000); // 4000 rupees → paise
    expect(c.taxPaise).toBe(48_000);
    expect(c.advancePaise).toBe(100_000);
    expect(c.adults).toBe(2);
    expect(c.children).toBe(1);
  });

  it("maps unknown providers to WEBSITE rather than dropping (FR-12)", () => {
    const c = normalizeInbound("some_aggregator_ota", "new", rawBdc);
    expect(c.source).toBe("WEBSITE");
  });

  it("classifies message types", () => {
    expect(toMessageType("reservation.cancel")).toBe("CANCEL");
    expect(toMessageType("booking.amend")).toBe("MODIFY");
    expect(toMessageType("reservation.new")).toBe("NEW");
    expect(() => toMessageType("weird.thing")).toThrow(NormalizeError);
  });

  it("rounds rupees to paise half-up and rejects negatives", () => {
    expect(rupeesToPaise(4000.005)).toBe(400_001);
    expect(rupeesToPaise("100.5")).toBe(10_050);
    expect(() => rupeesToPaise(-1)).toThrow(NormalizeError);
  });

  it("throws NormalizeError on a garbled payload (caller dead-letters)", () => {
    expect(() => normalizeInbound("booking_com", "new", { externalId: "x" })).toThrow(NormalizeError);
    expect(() => normalizeInbound("booking_com", "new", null)).toThrow(NormalizeError);
  });
});
