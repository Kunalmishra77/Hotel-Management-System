import { describe, expect, it } from "vitest";
import { assignParts, billParts, otaPaymentPart, type PartContext, type PartLine } from "@/features/billing/domain/bill-parts";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
let n = 0;
const line = (type: string, amount: number, date: string | null, reversalOfId: string | null = null, description = "x"): PartLine => ({
  id: `l${++n}`, type, description, businessDate: date ? d(date) : null, reversalOfId, amountPaise: amount, cgstPaise: Math.round(amount * 0.025), sgstPaise: Math.round(amount * 0.025), igstPaise: 0,
});
const night = (date: string) => line("ROOM", 210_000, date);
const roundOff = (paise: number) => ({ ...line("MISC", paise, "2026-10-02", null, "Round off"), cgstPaise: 0, sgstPaise: 0 });
const pay = (mode: string, amountPaise: number, reference: string | null = null) => ({ mode, reference, amountPaise, isRefund: false });
const summary = (parts: ReturnType<typeof billParts>) => parts.map((p) => [p.part, p.chargesPaise, p.paidPaise, p.balancePaise]);

// Tarun: MMT for 5 Nov, extended directly 6→10 Nov (two extensions).
const tarun: PartContext = {
  bookingSource: "MAKEMYTRIP",
  extensions: [
    { fromDate: d("2026-11-06"), toDate: d("2026-11-09"), source: "DIRECT" },
    { fromDate: d("2026-11-09"), toDate: d("2026-11-10"), source: "DIRECT" },
  ],
};
const bcom: PartContext = { bookingSource: "BOOKING_COM", extensions: [] };

describe("bill parts — OTA nights on their own bill, everything paid at the hotel on the direct bill", () => {
  it("Tarun: MMT ₹2,205 prepaid online; Direct ₹8,820 due", () => {
    const lines = ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"].map(night);
    const parts = billParts(lines, [pay("ONLINE", 220_500, "ADVANCE:res1")], tarun);
    expect(summary(parts)).toEqual([["MAKEMYTRIP", 220_500, 220_500, 0], ["DIRECT", 882_000, 0, 882_000]]);
    expect(parts.map((p) => [p.label, p.guestBill])).toEqual([["MakeMyTrip", false], ["Direct", true]]);
  });

  it("a Booking.com stay paid at the hotel with only a round-off is ONE bill, fully paid (Shivam)", () => {
    const lines = [line("ROOM", 515_600, "2026-10-01"), roundOff(-80)];
    const parts = billParts(lines, [pay("UPI", 541_300)], bcom);
    expect(parts.map((p) => p.part)).toEqual(["BOOKING_COM"]);
    expect(parts[0]!.balancePaise).toBe(0);
  });

  it("hotel money pays the Direct bill first, then the OTA bill (Shrinath: Agoda + direct extension, all paid at the desk)", () => {
    const ctx: PartContext = { bookingSource: "AGODA", extensions: [{ fromDate: d("2026-10-04"), toDate: d("2026-10-05"), source: "DIRECT" }] };
    const lines = [night("2026-10-01"), night("2026-10-02"), night("2026-10-03"), night("2026-10-04")];
    expect(summary(billParts(lines, [pay("CASH", 882_000)], ctx))).toEqual([["AGODA", 661_500, 661_500, 0], ["DIRECT", 220_500, 220_500, 0]]);
    // Part paid: the direct bill is settled first, the rest stays due on the OTA bill.
    expect(summary(billParts(lines, [pay("CASH", 300_000)], ctx))).toEqual([["AGODA", 661_500, 79_500, 582_000], ["DIRECT", 220_500, 220_500, 0]]);
  });

  it("food on an all-OTA booking is a direct bill; round-off rides on the direct bill when it has charges", () => {
    const room = line("ROOM", 200_000, "2026-10-01");
    const food = line("FOOD", 30_000, "2026-10-01");
    const ro = roundOff(-50);
    const assigned = assignParts([room, food, ro], bcom);
    expect([assigned.get(room.id), assigned.get(food.id), assigned.get(ro.id)]).toEqual(["BOOKING_COM", "DIRECT", "DIRECT"]);
    const parts = billParts([room, food, ro], [pay("ONLINE", 210_000), pay("UPI", 31_450)], bcom);
    expect(summary(parts)).toEqual([["BOOKING_COM", 210_000, 210_000, 0], ["DIRECT", 31_450, 31_450, 0]]);
  });

  it("an OTA overpayment spills onto the direct bill (MMT prepaid more than its nights)", () => {
    const ctx: PartContext = { bookingSource: "MAKEMYTRIP", extensions: [] };
    const lines = [line("ROOM", 200_000, "2026-10-01"), line("FOOD", 50_000, "2026-10-01")];
    expect(summary(billParts(lines, [pay("ONLINE", 262_500)], ctx))).toEqual([["MAKEMYTRIP", 210_000, 210_000, 0], ["DIRECT", 52_500, 52_500, 0]]);
  });

  it("a reversal stays on the bill of the line it reverses", () => {
    const direct = night("2026-11-07");
    const ota = night("2026-11-05");
    const r1 = line("REVERSAL", -210_000, "2026-11-20", direct.id);
    const r2 = line("REVERSAL", -210_000, "2026-11-20", ota.id);
    const a = assignParts([direct, ota, r1, r2], tarun);
    expect([a.get(r1.id), a.get(r2.id)]).toEqual(["DIRECT", "MAKEMYTRIP"]);
  });

  it("a direct booking is one direct bill (unchanged), and a direct sale has no reservation", () => {
    expect(billParts([night("2026-10-01"), line("FOOD", 100, "2026-10-01")], [pay("CASH", 1)], { bookingSource: "WALK_IN", extensions: [] }).map((p) => p.part)).toEqual(["DIRECT"]);
    expect(billParts([line("POS", 100, "2026-10-01")], [], { bookingSource: null, extensions: [] }).map((p) => p.part)).toEqual(["DIRECT"]);
  });

  it("which payments are OTA prepayments", () => {
    expect(otaPaymentPart(pay("CASH", 1, "ADVANCE:x"), tarun, ["MAKEMYTRIP"])).toBe("MAKEMYTRIP");
    expect(otaPaymentPart(pay("ONLINE", 1), tarun, ["MAKEMYTRIP"])).toBe("MAKEMYTRIP");
    expect(otaPaymentPart(pay("UPI", 1), tarun, ["MAKEMYTRIP"])).toBeNull();
    expect(otaPaymentPart(pay("ONLINE", 1, "Extension 2026-11-06→2026-11-09 · Agoda"), tarun, ["MAKEMYTRIP", "AGODA"])).toBe("AGODA");
    expect(otaPaymentPart(pay("UPI", 1, "Extension 2026-11-06→2026-11-09 · Direct"), tarun, ["MAKEMYTRIP"])).toBeNull();
    expect(otaPaymentPart(pay("ONLINE", 1, "ADVANCE:x"), { bookingSource: "DIRECT", extensions: [] }, [])).toBeNull();
  });
});
