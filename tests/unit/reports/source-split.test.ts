import { describe, expect, it } from "vitest";
import { addRevenueBySource, sourceForNight } from "@/features/reports/domain/source-split";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
// Tarun's stay: MMT for 5 Nov, extended directly for 6–8 Nov (check-out 9 Nov).
const ext = [{ fromDate: d("2026-11-06"), toDate: d("2026-11-09"), source: "DIRECT" }];

describe("revenue by source splits an extended stay per night", () => {
  it("nights inside an extension belong to its source; the rest to the booking's", () => {
    expect(sourceForNight("MAKEMYTRIP", ext, d("2026-11-05"))).toBe("MAKEMYTRIP");
    expect(sourceForNight("MAKEMYTRIP", ext, d("2026-11-06"))).toBe("DIRECT");
    expect(sourceForNight("MAKEMYTRIP", ext, d("2026-11-08"))).toBe("DIRECT");
    expect(sourceForNight("MAKEMYTRIP", ext, d("2026-11-09"))).toBe("MAKEMYTRIP"); // exclusive end
    expect(sourceForNight("MAKEMYTRIP", ext, null)).toBe("MAKEMYTRIP");
  });

  it("splits ₹8,400 as MMT ₹2,100 + Direct ₹6,300; tax excluded; reversals net out", () => {
    const m = new Map<string, number>();
    addRevenueBySource(m, {
      source: "MAKEMYTRIP",
      extensions: ext,
      lines: [
        { type: "ROOM", amountPaise: 210_000, businessDate: d("2026-11-05") },
        { type: "ROOM", amountPaise: 210_000, businessDate: d("2026-11-06") },
        { type: "ROOM", amountPaise: 210_000, businessDate: d("2026-11-07") },
        { type: "ROOM", amountPaise: 210_000n, businessDate: d("2026-11-08") },
        { type: "TAX", amountPaise: 99_999, businessDate: d("2026-11-06") },
        { type: "FOOD", amountPaise: 50_000, businessDate: d("2026-11-07") },
        { type: "REVERSAL", amountPaise: -210_000, businessDate: d("2026-11-08") },
      ],
    });
    expect(Object.fromEntries(m)).toEqual({ MAKEMYTRIP: 210_000, DIRECT: 470_000 });
  });

  it("a booking with no extension is all its own source (unchanged behaviour)", () => {
    const m = new Map<string, number>();
    addRevenueBySource(m, { source: "AGODA", extensions: [], lines: [{ type: "ROOM", amountPaise: 100, businessDate: d("2026-11-01") }] });
    expect(Object.fromEntries(m)).toEqual({ AGODA: 100 });
  });
});
