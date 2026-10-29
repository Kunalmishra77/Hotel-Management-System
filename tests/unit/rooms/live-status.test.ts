/** Rooms board status derived from bookings, not the drifting stored field. */
import { describe, expect, it } from "vitest";
import { liveRoomStatus, roomDay, type RoomAllocationFact } from "@/features/rooms/domain/live-status";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const fact = (status: string, start: string, end: string, checkOut = end): RoomAllocationFact => ({
  roomId: "r1",
  startDate: d(start),
  endDate: d(end),
  reservation: { id: `res-${status}-${start}`, code: "BK-1", status, checkOutDate: d(checkOut), guestName: "Asha Rao" },
});
const today = d("2026-10-30");

describe("liveRoomStatus", () => {
  it("an in-house guest wins over any stored status", () => {
    expect(liveRoomStatus({ stored: "VACANT", blockedToday: false, occupiedToday: true, arrivingToday: false })).toBe("OCCUPIED");
  });
  it("a stale stored Reserved/Occupied with no booking today reads as vacant", () => {
    expect(liveRoomStatus({ stored: "RESERVED", blockedToday: false, occupiedToday: false, arrivingToday: false })).toBe("VACANT");
    expect(liveRoomStatus({ stored: "OCCUPIED", blockedToday: false, occupiedToday: false, arrivingToday: false })).toBe("VACANT");
  });
  it("keeps cleaning and out-of-order, which bookings can't know", () => {
    expect(liveRoomStatus({ stored: "HOUSEKEEPING", blockedToday: false, occupiedToday: false, arrivingToday: true })).toBe("HOUSEKEEPING");
    expect(liveRoomStatus({ stored: "VACANT", blockedToday: true, occupiedToday: false, arrivingToday: false })).toBe("UNDER_MAINTENANCE");
  });
  it("an arrival due today is reserved", () => {
    expect(liveRoomStatus({ stored: "VACANT", blockedToday: false, occupiedToday: false, arrivingToday: true })).toBe("RESERVED");
  });
});

describe("roomDay", () => {
  it("in-house allocation covering today → occupant", () => {
    const r = roomDay([fact("IN_HOUSE", "2026-10-28", "2026-11-01")], today);
    expect(r.occupant?.reservation.status).toBe("IN_HOUSE");
    expect(r.departingToday).toBe(false);
  });
  it("due out today but not yet checked out → still occupied, leaving today", () => {
    const r = roomDay([fact("IN_HOUSE", "2026-10-28", "2026-10-30")], today);
    expect(r.occupant).not.toBeNull();
    expect(r.departingToday).toBe(true);
  });
  it("a finished segment of a moved stay is NOT occupancy (the guest moved on)", () => {
    // Allocation ended today, but the booking continues in another room.
    const r = roomDay([fact("IN_HOUSE", "2026-10-28", "2026-10-30", "2026-11-02")], today);
    expect(r.occupant).toBeNull();
  });
  it("a future booking is 'next', not a reservation for tonight", () => {
    const r = roomDay([fact("CONFIRMED", "2026-11-03", "2026-11-05")], today);
    expect(r.arrival).toBeNull();
    expect(r.next?.startDate).toEqual(d("2026-11-03"));
  });
  it("a confirmed arrival covering today → arrival", () => {
    expect(roomDay([fact("CONFIRMED", "2026-10-30", "2026-11-01")], today).arrival).not.toBeNull();
  });
});
