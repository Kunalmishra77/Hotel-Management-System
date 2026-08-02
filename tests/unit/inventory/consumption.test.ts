/** 20 T-4 — consumptionFor: POS order → stock deductions (FR-3, AC-4/10). */
import { describe, expect, it } from "vitest";
import { consumptionFor } from "@/features/inventory/domain/consumption";

const COFFEE_RECIPE = [{ menuItemId: "coffee", itemId: "beans", qtyPerUnit: 0.02 }];

describe("consumptionFor (T-4, FR-3)", () => {
  it("deducts qtyPerUnit × quantity (AC-4: 50 cups × 0.02 = 1.0 kg beans)", () => {
    const { deductions, skippedMenuItemIds } = consumptionFor(
      { items: [{ menuItemId: "coffee", quantity: 50 }] },
      COFFEE_RECIPE,
    );
    expect(skippedMenuItemIds).toHaveLength(0);
    expect(deductions).toEqual([{ itemId: "beans", qty: 1 }]);
  });

  it("aggregates multiple menu lines drawing on the same item into ONE deduction", () => {
    const recipes = [
      { menuItemId: "coffee", itemId: "beans", qtyPerUnit: 0.02 },
      { menuItemId: "espresso", itemId: "beans", qtyPerUnit: 0.01 },
    ];
    const { deductions } = consumptionFor(
      { items: [{ menuItemId: "coffee", quantity: 50 }, { menuItemId: "espresso", quantity: 100 }] },
      recipes,
    );
    // 50*0.02 + 100*0.01 = 1.0 + 1.0 = 2.0, as a single beans deduction.
    expect(deductions).toEqual([{ itemId: "beans", qty: 2 }]);
  });

  it("skips a menu item with no recipe but still deducts the others (AC-10)", () => {
    const { deductions, skippedMenuItemIds } = consumptionFor(
      { items: [{ menuItemId: "coffee", quantity: 10 }, { menuItemId: "sandwich", quantity: 3 }] },
      COFFEE_RECIPE,
    );
    expect(skippedMenuItemIds).toEqual(["sandwich"]);
    expect(deductions).toEqual([{ itemId: "beans", qty: 0.2 }]);
  });

  it("returns nothing for an order with no recipes at all", () => {
    const { deductions, skippedMenuItemIds } = consumptionFor(
      { items: [{ menuItemId: "sandwich", quantity: 3 }] },
      COFFEE_RECIPE,
    );
    expect(deductions).toHaveLength(0);
    expect(skippedMenuItemIds).toEqual(["sandwich"]);
  });
});
