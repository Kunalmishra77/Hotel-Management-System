import { describe, expect, it } from "vitest";
import { addRevenueBySource } from "@/features/reports/domain/source-split";
import { lineSource, type PartLine } from "@/features/billing/domain/bill-parts";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
// Tarun's stay: MMT for 5 Nov, extended directly for 6–8 Nov (check-out 9 Nov).
const ctx = { bookingSource: "MAKEMYTRIP", extensions: [{ fromDate: d("2026-11-06"), toDate: d("2026-11-09"), source: "DIRECT" }] };
let n = 0;
const l = (type: string, amountPaise: number, date: string, reversalOfId: string | null = null): PartLine => ({ id: `x${++n}`, type, amountPaise, businessDate: d(date), reversalOfId, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 });

function revenue(lines: PartLine[], c = ctx) {
  const byId = new Map(lines.map((x) => [x.id, x]));
  const m = new Map<string, number>();
  addRevenueBySource(m, lines.map((x) => ({ source: lineSource(x, byId, c), type: x.type, amountPaise: x.amountPaise })));
  return Object.fromEntries(m);
}

describe("revenue by source splits an extended stay per night", () => {
  it("₹8,400 of rooms → MMT ₹2,100 + Direct ₹6,300; tax excluded; food on an OTA stay is Direct", () => {
    const night8 = l("ROOM", 210_000, "2026-11-08");
    expect(revenue([
      l("ROOM", 210_000, "2026-11-05"),
      l("ROOM", 210_000, "2026-11-06"),
      l("ROOM", 210_000, "2026-11-07"),
      night8,
      l("TAX", 99_999, "2026-11-06"),
      l("FOOD", 50_000, "2026-11-05"),
      // An early check-out reverses 8 Nov — dated the day of the correction, still nets out on Direct.
      l("REVERSAL", -210_000, "2026-11-20", night8.id),
    ])).toEqual({ MAKEMYTRIP: 210_000, DIRECT: 470_000 });
  });

  it("a booking with no extension keeps its rooms on its own source; a walk-in's food stays walk-in", () => {
    expect(revenue([l("ROOM", 100, "2026-11-01")], { bookingSource: "AGODA", extensions: [] })).toEqual({ AGODA: 100 });
    expect(revenue([l("ROOM", 100, "2026-11-01"), l("FOOD", 50, "2026-11-01")], { bookingSource: "WALK_IN", extensions: [] })).toEqual({ WALK_IN: 150 });
  });
});
