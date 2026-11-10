import { describe, expect, it } from "vitest";
import { billParts, linePart, paymentPart, type PartContext, type PartLine } from "@/features/billing/domain/bill-parts";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
let n = 0;
const line = (type: string, amount: number, date: string | null, reversalOfId: string | null = null): PartLine => ({
  id: `l${++n}`, type, businessDate: date ? d(date) : null, reversalOfId, amountPaise: amount, cgstPaise: Math.round(amount * 0.025), sgstPaise: Math.round(amount * 0.025), igstPaise: 0,
});
const night = (date: string) => line("ROOM", 210_000, date);

// Tarun: MMT for 5 Nov, extended directly 6→10 Nov (two extensions).
const tarun: PartContext = {
  bookingSource: "MAKEMYTRIP",
  extensions: [
    { fromDate: d("2026-11-06"), toDate: d("2026-11-09"), source: "DIRECT" },
    { fromDate: d("2026-11-09"), toDate: d("2026-11-10"), source: "DIRECT" },
  ],
};

describe("bill parts — OTA nights on their own bill, everything paid at the hotel on the direct bill", () => {
  it("Tarun: MMT ₹2,205 paid online; Direct ₹8,820 due", () => {
    const lines = ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"].map(night);
    const parts = billParts(lines, [{ mode: "ONLINE", reference: "ADVANCE:res1", amountPaise: 220_500, isRefund: false }], tarun);
    expect(parts.map((p) => [p.part, p.label, p.guestBill, p.chargesPaise, p.paidPaise, p.balancePaise])).toEqual([
      ["MAKEMYTRIP", "MakeMyTrip", false, 220_500, 220_500, 0],
      ["DIRECT", "Direct", true, 882_000, 0, 882_000],
    ]);
  });

  it("food on an all-OTA booking is a direct bill; the OTA bill has only its room nights", () => {
    const ctx: PartContext = { bookingSource: "BOOKING_COM", extensions: [] };
    const room = night("2026-10-01");
    const food = line("FOOD", 30_000, "2026-10-01");
    const parts = billParts([room, food], [
      { mode: "ONLINE", reference: null, amountPaise: 220_500, isRefund: false },
      { mode: "UPI", reference: null, amountPaise: 31_500, isRefund: false },
    ], ctx);
    expect(parts.map((p) => [p.part, p.lineIds, p.balancePaise])).toEqual([["BOOKING_COM", [room.id], 0], ["DIRECT", [food.id], 0]]);
  });

  it("a reversal stays on the bill of the line it reverses", () => {
    const room = night("2026-11-07");
    const rev = line("REVERSAL", -210_000, "2026-11-20", room.id);
    const byId = new Map([room, rev].map((l) => [l.id, l]));
    expect(linePart(rev, byId, tarun)).toBe("DIRECT");
    const otaNight = night("2026-11-05");
    const otaRev = line("REVERSAL", -210_000, "2026-11-20", otaNight.id);
    expect(linePart(otaRev, new Map([otaNight, otaRev].map((l) => [l.id, l])), tarun)).toBe("MAKEMYTRIP");
  });

  it("a direct booking is one direct bill (unchanged), and a direct sale has no reservation", () => {
    const parts = billParts([night("2026-10-01"), line("FOOD", 100, "2026-10-01")], [{ mode: "CASH", reference: null, amountPaise: 1, isRefund: false }], { bookingSource: "WALK_IN", extensions: [] });
    expect(parts.map((p) => p.part)).toEqual(["DIRECT"]);
    expect(billParts([line("POS", 100, "2026-10-01")], [], { bookingSource: null, extensions: [] }).map((p) => p.part)).toEqual(["DIRECT"]);
  });

  it("payments: advance + ONLINE → the OTA; an extension prepaid via Agoda → Agoda; desk money → DIRECT", () => {
    expect(paymentPart({ mode: "CASH", reference: "ADVANCE:x", amountPaise: 1, isRefund: false }, tarun, ["MAKEMYTRIP"])).toBe("MAKEMYTRIP");
    expect(paymentPart({ mode: "ONLINE", reference: null, amountPaise: 1, isRefund: false }, tarun, ["MAKEMYTRIP"])).toBe("MAKEMYTRIP");
    expect(paymentPart({ mode: "UPI", reference: null, amountPaise: 1, isRefund: false }, tarun, ["MAKEMYTRIP"])).toBe("DIRECT");
    expect(paymentPart({ mode: "ONLINE", reference: "Extension 2026-11-06→2026-11-09 · Agoda", amountPaise: 1, isRefund: false }, tarun, ["MAKEMYTRIP", "AGODA"])).toBe("AGODA");
    expect(paymentPart({ mode: "UPI", reference: "Extension 2026-11-06→2026-11-09 · Direct", amountPaise: 1, isRefund: false }, tarun, ["MAKEMYTRIP"])).toBe("DIRECT");
    // No OTA nights at all → everything is the direct bill.
    expect(paymentPart({ mode: "ONLINE", reference: "ADVANCE:x", amountPaise: 1, isRefund: false }, { bookingSource: "DIRECT", extensions: [] }, [])).toBe("DIRECT");
  });
});
