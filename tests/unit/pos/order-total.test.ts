/** orderTotal — unit (19 T-3, FR-2, AC-1). Subtotal is DERIVED from lines. */
import { describe, expect, it } from "vitest";
import { orderTotal, lineAmountPaise } from "@/features/pos/domain/order-total";

describe("orderTotal (AC-1)", () => {
  it("derives subtotal = Σ(quantity × unit): 2×₹120 + 1×₹60 = ₹300", () => {
    expect(orderTotal([
      { quantity: 2, unitPaise: 12_000 },
      { quantity: 1, unitPaise: 6_000 },
    ])).toEqual({ subtotalPaise: 30_000 });
  });

  it("an empty order is ₹0", () => {
    expect(orderTotal([])).toEqual({ subtotalPaise: 0 });
  });

  it("lineAmountPaise is quantity × unit", () => {
    expect(lineAmountPaise({ quantity: 3, unitPaise: 5_000 })).toBe(15_000);
  });
});
