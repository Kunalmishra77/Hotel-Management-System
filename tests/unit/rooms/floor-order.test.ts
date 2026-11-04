/** Floors in building order — "Ground Floor" first, not alphabetical. */
import { describe, expect, it } from "vitest";
import { compareFloors, floorHeading, floorLevel } from "@/features/rooms/domain/floor-order";

describe("floor order", () => {
  it("sorts the client's real floor names Ground → 1st → 2nd → 3rd", () => {
    const names = ["3rd Floor", "2nd Floor", "Ground Floor", "1st Floor", "Terrace", "Basement"];
    expect([...names].sort((a, b) => compareFloors({ name: a }, { name: b }))).toEqual(["Basement", "Ground Floor", "1st Floor", "2nd Floor", "3rd Floor", "Terrace"]);
  });
  it("reads bare numbers and 'Ground'", () => {
    expect(floorLevel("Ground")).toBe(0);
    expect(floorLevel("2")).toBe(2);
    expect(floorLevel(null)).toBeGreaterThan(floorLevel("Terrace"));
  });
  it("an explicit sortOrder wins", () => {
    expect(compareFloors({ name: "3rd Floor", sortOrder: 1 }, { name: "Ground Floor", sortOrder: 2 })).toBeLessThan(0);
  });
  it("headings don't repeat 'Floor'", () => {
    expect(floorHeading("2nd Floor")).toBe("2nd Floor");
    expect(floorHeading("2")).toBe("Floor 2");
    expect(floorHeading(null)).toBe("No floor");
  });
});
