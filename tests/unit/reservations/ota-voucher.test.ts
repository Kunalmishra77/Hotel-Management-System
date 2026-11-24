/**
 * Pasted OTA voucher → booking fields (client, 24 Nov 2026). Fixture: the real
 * Go-MMT host voucher NH73039534032550 (Sneha Dey), as it comes out of the PDF
 * (stacked) and as a two-column copy interleaves it.
 */
import { describe, expect, it } from "vitest";
import { parseOtaVoucher } from "@/features/reservations/domain/ota-voucher";

const STACKED = `Host Voucher
Woodpecker Apartments | Hauz Khas, Delhi
D-1/17 Hauz Khas (3rd 4th Floor), Delhi, IN
PRIMARY GUEST DETAILS
Sneha Dey
CHECK-IN CHECK-OUT
03 Dec '26
2:00 PM
06 Dec '26 (3 Nights)
11:00 AM
TOTAL NO. OF GUEST(S)
2 Adults
BOOKING ID
NH73039534032550
BOOKED ON
23 Nov '26 12:42 PM
BOOKING STATUS
Confirmed
PAYMENT STATUS
Paid Online
BOOKED VIA
MakeMyTrip
PNR
0193600953
1 Room(s)
1 x Deluxe Room
2 Adults •Room Only
Payment
Property Gross Charges
₹ 8,747.49
Payable to Property
₹ 7,222.96
Room wise Payment Breakup (in ₹)
Date Room Charges (R) Extra Adult/Child (E) Fees & Charges (F) Taxes (T) Gross Charges (G=R+E+F+T) Commission (C) Net Amount (G-C)
December 03, 2026 2,776.98 0.0 0.0 138.85 2,915.83 491.52 2,424.31
GRAND TOTAL 8,330.94 0.0 0.0 416.55 8,747.49 1,474.55 7,272.94
Final Calculation
1. Room Charges ₹ 8,330.94
2. Extra Adult/ Child Charges ₹ 0.0
3. Property Taxes ₹ 416.55
4. Service Charges ₹ 0.0
(A) Property Gross Charges (1+2+3+4) ₹ 8,747.49
5. Go-MMT Commission ₹ 1,249.62
6. GST on Commission @ 18.0% (Includes IGST/CGST/SGST) ₹ 224.93
(B) Go-MMT Commission (including GST) (5+6) ₹ 1,474.55
7. TCS @ 0.5% ₹ 41.65
8. TDS @ 0.1% ₹ 8.33
Payable to Property (A-B-C) ₹ 7,222.96`;

// The same voucher copied from a browser PDF viewer: columns interleaved.
const COLUMNS = `make my trip Host Voucher Woodpecker Apartments | Hauz Khas, Delhi
PRIMARY GUEST DETAILS BOOKING ID BOOKED ON Sneha Dey NH73039534032550 23 Nov ’26 12:42 PM
CHECK-IN CHECK-OUT BOOKING STATUS PAYMENT STATUS 03 Dec ’26 06 Dec ’26 (3 Nights) Confirmed Paid Online
2:00 PM 11:00 AM BOOKED VIA PNR TOTAL NO. OF GUEST(S) MakeMyTrip 0193600953 2 Adults
Property Gross Charges Payable to Property ₹ 8,747.49 ₹ 7,222.96
1. Room Charges ₹ 8,330.94 2. Extra Adult/ Child Charges ₹ 0.0 3. Property Taxes ₹ 416.55 4. Service Charges ₹ 0.0
(A) Property Gross Charges (1+2+3+4) ₹8,747.49 Payable to Property (A-B-C) ₹7,222.96`;

describe("parseOtaVoucher — Go-MMT host voucher", () => {
  for (const [name, text] of [["stacked (PDF text)", STACKED], ["two-column copy", COLUMNS]] as const) {
    it(`reads Sneha Dey's MMT voucher — ${name}`, () => {
      const r = parseOtaVoucher(text);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      const v = r.voucher;
      expect(v.source).toBe("MAKEMYTRIP");
      expect(v.channelRef).toBe("NH73039534032550");
      expect(v.pnr).toBe("0193600953");
      expect(v.guestName).toBe("Sneha Dey");
      expect(v.checkInDate).toBe("2026-12-03");
      expect(v.checkOutDate).toBe("2026-12-06");
      expect(v.nights).toBe(3);
      expect(v.adults).toBe(2);
      expect(v.roomChargesPaise).toBe(833_094);
      expect(v.taxPaise).toBe(41_655);
      expect(v.grossPaise).toBe(874_749);
      expect(v.payablePaise).toBe(722_296);
      expect(v.prepaid).toBe(true);
      expect(v.ratePaise).toBe(277_698); // ₹2,776.98 a night before GST
    });
  }

  it("a Goibibo voucher (same Go-MMT layout) is a Goibibo booking", () => {
    const r = parseOtaVoucher(STACKED.replace("BOOKED VIA\nMakeMyTrip", "BOOKED VIA\nGoibibo"));
    expect(r.ok && r.voucher.source).toBe("GOIBIBO");
  });

  it("pay-at-hotel is not prepaid", () => {
    const r = parseOtaVoucher(STACKED.replace("Paid Online", "Pay at Hotel"));
    expect(r.ok && r.voucher.prepaid).toBe(false);
  });

  it("says plainly when a format isn't readable yet, never guesses", () => {
    const r = parseOtaVoucher("Expedia Partner Central — Reservation 2607899921 for V S Sastry, check-in 22 Nov 2026, 2 nights, room rate 2,999.00");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Expedia/);
  });

  it("a voucher missing its Final Calculation is refused, not half-read", () => {
    const r = parseOtaVoucher(STACKED.split("Final Calculation")[0]!.replace(/Property Gross Charges\n₹ 8,747.49/, ""));
    expect(r.ok).toBe(false);
  });
});
