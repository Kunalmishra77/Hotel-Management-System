/**
 * 20 addendum — laundry reconciliation math (FR-8). The MoM example + edges.
 */
import { describe, expect, it } from "vitest";
import { laundryLineStatus, laundryBatchTotals } from "@/features/inventory/domain/laundry";

describe("laundryLineStatus (FR-8)", () => {
  it("MoM example: 250 out / 149 back = 101 balance → SHORT (tolerance 0)", () => {
    const r = laundryLineStatus(250, 149, 0, true);
    expect(r.balance).toBe(101);
    expect(r.status).toBe("SHORT");
  });

  it("within tolerance is OK", () => {
    expect(laundryLineStatus(250, 248, 2, true).status).toBe("OK"); // balance 2 ≤ tol 2
    expect(laundryLineStatus(250, 247, 2, true).status).toBe("SHORT"); // balance 3 > tol 2
  });

  it("exact return is OK", () => {
    expect(laundryLineStatus(100, 100, 0, true)).toEqual({ balance: 0, status: "OK" });
  });

  it("more returned than sent is OK (never a shortage)", () => {
    expect(laundryLineStatus(100, 103, 0, true)).toEqual({ balance: -3, status: "OK" });
  });

  it("before returns are recorded it is PENDING, not a shortage", () => {
    expect(laundryLineStatus(250, 0, 0, false).status).toBe("PENDING");
  });
});

describe("laundryBatchTotals", () => {
  it("rolls up sent/returned/balance and flags any short line", () => {
    const t = laundryBatchTotals(
      [
        { sentQty: 250, returnedQty: 149, toleranceQty: 0 }, // short
        { sentQty: 50, returnedQty: 50, toleranceQty: 0 }, // ok
      ],
      true,
    );
    expect(t).toEqual({ sent: 300, returned: 199, balance: 101, anyShort: true });
  });

  it("no shortage flagged before returns recorded", () => {
    const t = laundryBatchTotals([{ sentQty: 250, returnedQty: 0, toleranceQty: 0 }], false);
    expect(t.anyShort).toBe(false);
  });
});
