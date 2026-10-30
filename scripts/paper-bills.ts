/**
 * The client's real paper tax invoices WASPL:803–836 (FY 2026-27), transcribed
 * from the photos in woodpecker.zip (IMG_1642–1675), mapped to the portal stay.
 * Amounts in RUPEES as printed; room/extra rates are pre-GST (the bills add
 * 2.5% CGST + 2.5% SGST on everything). `total` = "Amount Chargeable".
 * Used by conform-paper-bills.ts (phase A) and rebuild-invoice-register.ts (B).
 */
export type PaperPay = { mode: "UPI" | "CASH" | "CREDIT_CARD" | "ONLINE" | "BANK_TRANSFER"; amount: number; date?: string; ref?: string };
export type PaperExtra = { type: "FOOD" | "EXTRA_BED" | "MISC" | "LAUNDRY"; desc: string; amount: number; date: string; /** collected GST-inclusive (handwritten "Ex. Bed 500") */ gross?: number };
export type PaperBill = {
  inv: number;
  dated: string; // invoice "Dated"
  code: string; // the portal booking the bill belongs to
  guestName?: string; // rename the guest (photo spelling)
  customerName?: string; // bill-to on the invoice when not the guest (company / consignee)
  gstin?: string;
  source?: string;
  stay?: { from: string; to: string };
  rooms?: { n: string; from: string; to: string }[];
  nights: { from: string; to: string; rate: number; rooms?: number; desc?: string }[];
  extras?: PaperExtra[];
  offInvoice?: PaperExtra[]; // charged + collected, but written off the printed bill
  total: number;
  payments?: PaperPay[]; // undefined = keep the portal's payments (already right)
  merge?: string[];
  emptyOnly?: string[];
  clearAllocsOf?: string[];
  side?: { code: string; guestName?: string; extras: PaperExtra[]; payments: PaperPay[] };
  note?: string;
};

const mmt = (amount: number, id: string): PaperPay => ({ mode: "ONLINE", amount, ref: `MakeMyTrip ${id}` });

export const PAPER_BILLS: PaperBill[] = [
  { inv: 803, dated: "2026-10-19", code: "BK-DC5QA207", nights: [{ from: "2026-10-18", to: "2026-10-20", rate: 2540 }], total: 5334, payments: [{ mode: "UPI", amount: 5334 }] },
  { inv: 804, dated: "2026-10-19", code: "BK-9H8JR1PZ", nights: [{ from: "2026-10-17", to: "2026-10-20", rate: 2571, rooms: 2 }], total: 16197,
    payments: [{ mode: "UPI", amount: 6200 }, { mode: "CASH", amount: 9997 }],
    note: "Paper: 'Cash + UPI 6200' (cash amount not written → ₹9,997 = total − UPI). Paper check-out reads 21.10 but bills 3 nights (17→20); dates kept 17→20." },
  { inv: 805, dated: "2026-10-20", code: "BK-G7CK1BRH", guestName: "Vikas Khurana", nights: [{ from: "2026-10-19", to: "2026-10-20", rate: 1818.79 }], total: 1910, payments: [mmt(1910, "GH72036280141390")] },
  { inv: 806, dated: "2026-10-20", code: "BK-DJAK5SU3", nights: [{ from: "2026-10-14", to: "2026-10-20", rate: 2155.5 }], total: 13579, payments: [{ mode: "CASH", amount: 5000 }, { mode: "CREDIT_CARD", amount: 8580 }] },
  { inv: 807, dated: "2026-10-20", code: "BK-95K623MY", nights: [{ from: "2026-10-15", to: "2026-10-21", rate: 1999 }], total: 12594, payments: [{ mode: "CASH", amount: 12600 }] },
  { inv: 808, dated: "2026-10-22", code: "BK-GFKA69I8", nights: [{ from: "2026-10-20", to: "2026-10-22", rate: 1962 }], total: 4120, payments: [{ mode: "CASH", amount: 4120 }] },
  { inv: 809, dated: "2026-10-23", code: "BK-9HBQP1YV", nights: [{ from: "2026-10-22", to: "2026-10-23", rate: 2571, rooms: 2 }], total: 5399, payments: [{ mode: "UPI", amount: 5400 }] },
  { inv: 810, dated: "2026-10-23", code: "BK-J4LF10QP", nights: [{ from: "2026-10-21", to: "2026-10-23", rate: 2150 }], extras: [{ type: "FOOD", desc: "Food", amount: 347, date: "2026-10-22" }], total: 4880, payments: [{ mode: "UPI", amount: 4880 }] },
  { inv: 811, dated: "2026-10-23", code: "BK-JHRI2J3K", source: "MAKEMYTRIP", nights: [{ from: "2026-10-22", to: "2026-10-23", rate: 2057.28 }], total: 2160, payments: [mmt(2160, "GH72036280310416")] },
  { inv: 812, dated: "2026-10-23", code: "BK-J3N47RKA", nights: [{ from: "2026-10-22", to: "2026-10-23", rate: 2500 }], total: 2625, payments: [{ mode: "UPI", amount: 500, date: "2026-10-21", ref: "Advance" }, { mode: "UPI", amount: 2125, date: "2026-10-23" }] },
  { inv: 813, dated: "2026-10-24", code: "BK-KB83VMB1", nights: [{ from: "2026-10-23", to: "2026-10-24", rate: 2572, rooms: 2 }], extras: [{ type: "FOOD", desc: "Food - Tea / Coffee", amount: 2713, date: "2026-10-23" }], total: 8250,
    note: "Paper payment line 'UPI 5000 + UPI 2750' adds to ₹7,750, not the ₹8,250 billed — the portal's ONLINE ₹5,500 + UPI ₹2,750 (= ₹8,250) is kept." },
  { inv: 814, dated: "2026-10-24", code: "BK-HT2JJ4CA", customerName: "Talent Loan Technologys Pvt. Ltd.", gstin: "07AAHCT9474D1Z0", emptyOnly: ["BK-KARAYD6J"],
    nights: [{ from: "2026-10-21", to: "2026-10-24", rate: 2100 }], extras: [{ type: "FOOD", desc: "Food - Tea / Coffee", amount: 1200, date: "2026-10-23" }], total: 7875, payments: [{ mode: "UPI", amount: 7875 }],
    note: "One company bill for all 3 nights; the 23→24 night was in HKD3 (BK-KARAYD6J keeps its room, its money moves here)." },
  { inv: 815, dated: "2026-10-24", code: "BK-J3QMEQ6H", nights: [{ from: "2026-10-22", to: "2026-10-24", rate: 2109 }], total: 4430, payments: [{ mode: "CASH", amount: 4430 }] },
  { inv: 816, dated: "2026-10-24", code: "BK-J3ANHR1Q", merge: ["BK-JI3AT6K6"], nights: [{ from: "2026-10-22", to: "2026-10-24", rate: 2000, rooms: 2 }], extras: [{ type: "FOOD", desc: "Food", amount: 497, date: "2026-10-23" }], total: 8922, payments: [{ mode: "CREDIT_CARD", amount: 8922 }] },
  { inv: 817, dated: "2026-10-24", code: "BK-BXP97DIK", nights: [{ from: "2026-10-17", to: "2026-10-24", rate: 1900 }], extras: [{ type: "FOOD", desc: "Food", amount: 634, date: "2026-10-23" }], total: 14630 },
  { inv: 818, dated: "2026-10-25", code: "BK-M6FMNZXO", clearAllocsOf: ["BK-TECU7A8R"], stay: { from: "2026-10-24", to: "2026-10-25" },
    rooms: [{ n: "GF-2", from: "2026-10-24", to: "2026-10-25" }, { n: "GF-3", from: "2026-10-24", to: "2026-10-25" }],
    nights: [{ from: "2026-10-24", to: "2026-10-25", rate: 2394, rooms: 2 }], total: 5027, payments: [mmt(5027, "GH72225280443796")] },
  { inv: 819, dated: "2026-10-25", code: "BK-M8TYKPAZ", guestName: "Gopal Sharma", nights: [{ from: "2026-10-24", to: "2026-10-25", rate: 2500 }], extras: [{ type: "FOOD", desc: "Dinner 1 (ordered but not eaten)", amount: 300, date: "2026-10-24" }], total: 2940, payments: [],
    note: "On credit (Mr A Rungta) — no payment; ₹2,940 stays due." },
  { inv: 820, dated: "2026-10-25", code: "BK-KV7OYWX7", guestName: "Sunnanå Lars", emptyOnly: ["BK-M605ULRT"], nights: [{ from: "2026-10-23", to: "2026-10-25", rate: 2149 }], total: 4513 },
  { inv: 821, dated: "2026-10-25", code: "BK-IBBBSEQF", nights: [{ from: "2026-10-24", to: "2026-10-25", rate: 2666 }], total: 2800, payments: [{ mode: "CASH", amount: 2800 }] },
  { inv: 822, dated: "2026-10-25", code: "BK-MKO0FL4P", customerName: "Dr PK", nights: [{ from: "2026-10-24", to: "2026-10-25", rate: 2217 }], total: 2328, payments: [{ mode: "UPI", amount: 2328 }],
    note: "Paper 'Dr PK x1' = portal guest Pawan Kumar Sachan (guest name kept; bill-to as printed)." },
  { inv: 823, dated: "2026-10-25", code: "BK-EX0PBYQE", merge: ["BK-EX6BGVCD"], customerName: "Abdul Siddique / Nasiran Nisha, Sana Praveen & Mohd. Nahiq Siddique",
    nights: [{ from: "2026-10-19", to: "2026-10-25", rate: 2000, rooms: 2 }], total: 25200,
    payments: [{ mode: "UPI", amount: 1000, date: "2026-09-01", ref: "Advance" }, { mode: "UPI", amount: 14200, date: "2026-10-25" }, { mode: "UPI", amount: 10000, date: "2026-10-25" }] },
  { inv: 824, dated: "2026-10-26", code: "BK-M8X7YCRJ", nights: [{ from: "2026-10-24", to: "2026-10-26", rate: 2300 }], extras: [{ type: "FOOD", desc: "Dinner", amount: 400, date: "2026-10-25" }], total: 5250,
    payments: [{ mode: "UPI", amount: 1000, date: "2026-10-15", ref: "Advance" }, { mode: "UPI", amount: 4250, date: "2026-10-26" }],
    note: "Paper payment line reads 'UPI 1000 + UPI 4265' (= ₹5,265, ₹15 over the ₹5,250 billed) — recorded as 1,000 + 4,250 so the bill settles; tell me if ₹15 really was taken extra." },
  { inv: 825, dated: "2026-10-26", code: "BK-TECU7A8R", stay: { from: "2026-10-25", to: "2026-10-26" },
    rooms: [{ n: "GF-2", from: "2026-10-25", to: "2026-10-26" }, { n: "GF-3", from: "2026-10-25", to: "2026-10-26" }],
    nights: [{ from: "2026-10-25", to: "2026-10-26", rate: 2218, rooms: 2 }], extras: [{ type: "EXTRA_BED", desc: "Extra bed", amount: 400, date: "2026-10-25" }], total: 5078, payments: [{ mode: "UPI", amount: 5078 }] },
  { inv: 826, dated: "2026-10-26", code: "BK-J3JNLXB2", nights: [{ from: "2026-10-22", to: "2026-10-26", rate: 2250 }], total: 9450, payments: [{ mode: "CASH", amount: 9450 }] },
  { inv: 827, dated: "2026-10-26", code: "BK-KNFC9WWL", stay: { from: "2026-10-23", to: "2026-10-26" },
    rooms: [{ n: "R1", from: "2026-10-23", to: "2026-10-26" }, { n: "R2", from: "2026-10-23", to: "2026-10-26" }],
    nights: [{ from: "2026-10-23", to: "2026-10-26", rate: 5000, desc: "2 BHK unit (2 rooms)" }], total: 15750,
    payments: [{ mode: "UPI", amount: 3000, date: "2026-08-29", ref: "Advance" }, { mode: "UPI", amount: 12750 }] },
  { inv: 828, dated: "2026-10-26", code: "BK-NHQMC7BO", guestName: "Shivang Dhand", nights: [{ from: "2026-10-25", to: "2026-10-27", rate: 2381 }], total: 5000,
    payments: [{ mode: "UPI", amount: 3000, date: "2026-09-29", ref: "Advance" }, { mode: "UPI", amount: 2000, date: "2026-10-26" }] },
  { inv: 829, dated: "2026-10-26", code: "BK-NQB97588", guestName: "Satheesh Kumar", customerName: "NuMed Systems Pvt Ltd", gstin: "33AAGCN7212E1ZU",
    nights: [{ from: "2026-10-25", to: "2026-10-26", rate: 2013.73 }], total: 2114, payments: [mmt(2114, "NH90082527136822")] },
  { inv: 830, dated: "2026-10-26", code: "BK-NHJ9Z7TC", nights: [{ from: "2026-10-25", to: "2026-10-26", rate: 2726.62 }], total: 2863,
    offInvoice: [{ type: "EXTRA_BED", desc: "Extra bed (collected separately — not on the printed bill)", amount: 0, gross: 500, date: "2026-10-25" }],
    payments: [mmt(2863, "NH75069527033238"), { mode: "CASH", amount: 500, ref: "Extra bed" }],
    note: "Handwritten 'Ex. Bed 500' beside the bill — kept on the folio and paid, but not on the invoice (as on paper)." },
  { inv: 831, dated: "2026-10-26", code: "BK-NR5YY8MK", nights: [{ from: "2026-10-25", to: "2026-10-26", rate: 1948.75 }], total: 2046, payments: [mmt(2046, "GH76117280548480")] },
  { inv: 832, dated: "2026-10-26", code: "BK-QDHOZYM6", nights: [{ from: "2026-10-25", to: "2026-10-26", rate: 2051.31 }], total: 2154, payments: [mmt(2154, "NH72139527278680")],
    side: { code: "BK-QDIOVGL0", extras: [{ type: "EXTRA_BED", desc: "Extra person", amount: 0, gross: 1500, date: "2026-10-25" }], payments: [{ mode: "UPI", amount: 1500, date: "2026-10-26", ref: "Extra person (paper #832 note)" }] },
    note: "Handwritten 'Room in D-1/3, Ex. Person 1500 UPI on 26' — the extra person sits on the second booking BK-QDIOVGL0 (paid UPI), off the invoice." },
  { inv: 833, dated: "2026-10-27", code: "BK-QERVCTY6", guestName: "Sandeep Chaturvedi", customerName: "Head, Textile and Fiber Engineering Department, IIT Delhi", stay: { from: "2026-10-26", to: "2026-10-28" },
    nights: [{ from: "2026-10-26", to: "2026-10-27", rate: 2300 }], extras: [{ type: "FOOD", desc: "Food 1 x 300", amount: 300, date: "2026-10-26" }], total: 2730, payments: [],
    note: "On credit to IIT ('CR IIT') — no payment; ₹2,730 due. Paper stay 26→28 but bills 1 night (as printed)." },
  { inv: 834, dated: "2026-10-27", code: "BK-QF9AF1TN", customerName: "Harsh Raj", nights: [{ from: "2026-10-26", to: "2026-10-27", rate: 2078.71 }], total: 2183, payments: [mmt(2183, "NH72252527352728")] },
  { inv: 835, dated: "2026-10-27", code: "BK-QF5QK7KR", guestName: "Arjun Bhankar", nights: [{ from: "2026-10-26", to: "2026-10-27", rate: 1948.75 }], total: 2046, payments: [mmt(2046, "NH22252527348468")] },
  { inv: 836, dated: "2026-10-27", code: "BK-QDCO9L1R", guestName: "Jai Shanklar kumar", nights: [{ from: "2026-10-26", to: "2026-10-27", rate: 2396.02 }], total: 2516, payments: [mmt(2516, "NH22145527128892")],
    side: { code: "BK-QDR61XR2", extras: [{ type: "EXTRA_BED", desc: "Extra (x1)", amount: 0, gross: 500, date: "2026-10-26" }], payments: [{ mode: "CASH", amount: 500, date: "2026-10-27" }] },
    note: "The ₹500 extra the portal had on this booking isn't on the paper bill — moved to the second booking BK-QDR61XR2 (paid cash), off the invoice." },
];
