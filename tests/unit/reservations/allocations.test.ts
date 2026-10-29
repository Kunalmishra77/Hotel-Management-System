/**
 * Room-allocation segments after a mid-stay move — the rule that extend /
 * overstay / check-out act only on the room the guest is in at the end of the stay.
 */
import { describe, expect, it } from "vitest";
import { allocationsOn, earlyCheckoutPlan, tailAllocations } from "@/features/reservations/domain/allocations";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
// Sayan: R3 26→29, moved to R1 29→30.
const moved = [
  { id: "a3", roomId: "R3", startDate: D("2026-10-26"), endDate: D("2026-10-29") },
  { id: "a1", roomId: "R1", startDate: D("2026-10-29"), endDate: D("2026-10-30") },
];
// Group: two rooms for the whole stay.
const group = [
  { id: "g1", roomId: "GF-2", startDate: D("2026-10-24"), endDate: D("2026-10-26") },
  { id: "g2", roomId: "GF-3", startDate: D("2026-10-24"), endDate: D("2026-10-26") },
];

describe("tailAllocations", () => {
  it("after a move: only the current room", () => {
    expect(tailAllocations(moved, D("2026-10-30")).map((a) => a.roomId)).toEqual(["R1"]);
  });
  it("group: every room (all run to check-out)", () => {
    expect(tailAllocations(group, D("2026-10-26")).map((a) => a.roomId)).toEqual(["GF-2", "GF-3"]);
  });
  it("falls back to the latest-ending segment when nothing ends at check-out", () => {
    expect(tailAllocations(moved, D("2026-11-05")).map((a) => a.roomId)).toEqual(["R1"]);
    expect(tailAllocations(moved).map((a) => a.roomId)).toEqual(["R1"]);
  });
  it("empty in, empty out", () => {
    expect(tailAllocations([], D("2026-10-30"))).toEqual([]);
  });
});

describe("allocationsOn", () => {
  it("knows which room the guest was in each night (end is exclusive)", () => {
    expect(allocationsOn(moved, D("2026-10-28")).map((a) => a.roomId)).toEqual(["R3"]);
    expect(allocationsOn(moved, D("2026-10-29")).map((a) => a.roomId)).toEqual(["R1"]);
    expect(allocationsOn(moved, D("2026-10-30"))).toEqual([]);
  });
});

describe("earlyCheckoutPlan", () => {
  it("leaving on the move day: the not-yet-started room is removed, the old one kept", () => {
    const plan = earlyCheckoutPlan(moved, D("2026-10-29"));
    expect(plan.remove.map((a) => a.roomId)).toEqual(["R1"]);
    expect(plan.shorten).toEqual([]);
  });
  it("leaving mid-segment shortens only that segment", () => {
    const plan = earlyCheckoutPlan(moved, D("2026-10-28"));
    expect(plan.shorten.map((a) => a.roomId)).toEqual(["R3"]);
    expect(plan.remove.map((a) => a.roomId)).toEqual(["R1"]);
  });
  it("group leaving a night early shortens every room", () => {
    const plan = earlyCheckoutPlan(group, D("2026-10-25"));
    expect(plan.shorten.map((a) => a.roomId)).toEqual(["GF-2", "GF-3"]);
    expect(plan.remove).toEqual([]);
  });
});
