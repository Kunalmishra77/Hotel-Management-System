/** Room swap rules — like for like, B not in-house, no split stay, no charges. */
import { describe, expect, it } from "vitest";
import { swapProblem as rawSwapProblem, type SwapSide } from "@/features/reservations/domain/swap";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const TODAY = d("2027-01-11");
const swapProblem = (a: SwapSide, b: SwapSide) => rawSwapProblem(a, b, TODAY);
const side = (o: Partial<SwapSide> & { rooms?: string[] }): SwapSide => {
  const ci = o.checkInDate ?? d("2027-01-10");
  const co = o.checkOutDate ?? d("2027-01-12");
  return {
    id: o.id ?? "a", code: o.code ?? "BK-A", status: o.status ?? "CONFIRMED", propertyId: o.propertyId ?? "p1",
    checkInDate: ci, checkOutDate: co, chargesPosted: o.chargesPosted ?? false,
    allocations: o.allocations ?? (o.rooms ?? ["r1"]).map((roomId) => ({ roomId, startDate: ci, endDate: co })),
  };
};

describe("swapProblem — in-house guest A", () => {
  it("an in-house guest may swap with a not-arrived booking in the SAME property (current unit)", () => {
    // A stayed in r0 on the 10th, moved to r1 from the 11th (a move) — current unit = r1.
    const a = side({ status: "IN_HOUSE", chargesPosted: true, allocations: [
      { roomId: "r0", startDate: d("2027-01-10"), endDate: d("2027-01-11") },
      { roomId: "r1", startDate: d("2027-01-11"), endDate: d("2027-01-12") },
    ] });
    expect(swapProblem(a, side({ id: "b", code: "BK-B", rooms: ["r9"] }))).toBeNull();
  });
  it("…but not across properties (that is a Transfer), nor with no nights left", () => {
    const a = side({ status: "IN_HOUSE", chargesPosted: true });
    expect(swapProblem(a, side({ id: "b", code: "BK-B", rooms: ["r9"], propertyId: "p2" }))).toMatch(/Transfer/);
    const done = side({ status: "IN_HOUSE", checkInDate: d("2027-01-08"), checkOutDate: d("2027-01-11") });
    expect(swapProblem(done, side({ id: "b", code: "BK-B", rooms: ["r9"] }))).toMatch(/no nights left/);
  });
});

describe("swapProblem", () => {
  it("allows single ↔ single and 2-room unit ↔ 2-room unit, across properties and different dates", () => {
    expect(swapProblem(side({ rooms: ["gf1"] }), side({ id: "b", code: "BK-B", rooms: ["3f2"], propertyId: "p2", checkInDate: d("2027-01-11"), checkOutDate: d("2027-01-15") }))).toBeNull();
    expect(swapProblem(side({ rooms: ["r1", "r2"] }), side({ id: "b", code: "BK-B", rooms: ["r3", "r4"] }))).toBeNull();
  });
  it("refuses when the OTHER guest is in-house", () => {
    expect(swapProblem(side({}), side({ id: "b", code: "BK-B", status: "IN_HOUSE", rooms: ["r9"] }))).toMatch(/in-house/);
  });
  it("refuses unlike units (single ↔ 2 BHK)", () => {
    expect(swapProblem(side({ rooms: ["r1"] }), side({ id: "b", code: "BK-B", rooms: ["r3", "r4"] }))).toMatch(/like for like/);
  });
  it("refuses a split stay, a booking with charges, no room, the same booking or a shared room", () => {
    const split = side({ id: "b", code: "BK-B", allocations: [{ roomId: "x", startDate: d("2027-01-10"), endDate: d("2027-01-11") }, { roomId: "y", startDate: d("2027-01-11"), endDate: d("2027-01-12") }] });
    expect(swapProblem(side({ rooms: ["r1", "r2"] }), split)).toMatch(/split stay/);
    expect(swapProblem(side({}), side({ id: "b", code: "BK-B", rooms: ["r9"], chargesPosted: true }))).toMatch(/charges/);
    expect(swapProblem(side({}), side({ id: "b", code: "BK-B", allocations: [] }))).toMatch(/no room/);
    expect(swapProblem(side({}), side({}))).toMatch(/different booking/);
    expect(swapProblem(side({ rooms: ["r1"] }), side({ id: "b", code: "BK-B", rooms: ["r1"] }))).toMatch(/share a room/);
  });
});
