/** aggregatePrep — unit (19, FR-13, AC-12). One prep line per item, summed, sorted. */
import { describe, expect, it } from "vitest";
import { aggregatePrep } from "@/features/pos/domain/kot";

describe("aggregatePrep (AC-12)", () => {
  it("sums quantities by menu item across orders and sorts by name", () => {
    const prep = aggregatePrep([
      { name: "Masala Dosa", menuItemId: "m1", quantity: 2 },
      { name: "Coffee", menuItemId: "m2", quantity: 1 },
      { name: "Masala Dosa", menuItemId: "m1", quantity: 3 },
    ]);
    expect(prep).toEqual([
      { key: "m2", name: "Coffee", quantity: 1 },
      { key: "m1", name: "Masala Dosa", quantity: 5 },
    ]);
  });

  it("aggregates custom (menuItemId null) lines by name", () => {
    const prep = aggregatePrep([
      { name: "Special", menuItemId: null, quantity: 1 },
      { name: "Special", menuItemId: null, quantity: 2 },
    ]);
    expect(prep).toEqual([{ key: "name:Special", name: "Special", quantity: 3 }]);
  });
});
