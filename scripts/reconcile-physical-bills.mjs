/**
 * READ-ONLY reconciliation of the 34 physical tax invoices (WASPL:803–836, photos
 * in woodpecker.zip, transcribed by hand) against the portal. For each bill: find
 * the portal booking(s) by guest-name keyword + check-in date, and compare
 * property, dates, nights, room charge, extras, GST, total, payments and the
 * portal's own invoice number. Prints one block per bill + a summary.
 *   node scripts/reconcile-physical-bills.mjs
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const d = (x) => new Date(x).toISOString().slice(0, 10);
const r2 = (p) => Math.round(Number(p)) / 100;

// key = name keyword for search; prop = D-1/NN; ci/co = check-in/out; nights = billed period;
// rate = per-period pre-tax; extras = other taxable; total = amount chargeable; pay = terms of payment.
const BILLS = [
  { inv: 803, key: "Ritu Mishra", prop: "D-1/3", ci: "2026-10-18", co: "2026-10-20", nights: 2, rate: 2540, extras: 0, total: 5334, pay: "UPI 5334" },
  { inv: 804, key: "Shaji", prop: "D-1/23", ci: "2026-10-17", co: "2026-10-21", nights: 3, rate: 5142, extras: 0, total: 16197, pay: "Cash + UPI 6200" },
  { inv: 805, key: "Vikas Khurana", alt: "Khurana", prop: "D-1/17", ci: "2026-10-19", co: "2026-10-20", nights: 1, rate: 1818.79, extras: 0, total: 1910, pay: "MMT (net 1576.89)" },
  { inv: 806, key: "Muniama", prop: "D-1/17", ci: "2026-10-14", co: "2026-10-20", nights: 6, rate: 2155.5, extras: 0, total: 13579, pay: "Cash 5000 + Card 8580" },
  { inv: 807, key: "Soma Dhar", prop: "D-1/17", ci: "2026-10-15", co: "2026-10-21", nights: 6, rate: 1999, extras: 0, total: 12594, pay: "Cash 12600" },
  { inv: 808, key: "Emma", prop: "D-1/17", ci: "2026-10-20", co: "2026-10-22", nights: 2, rate: 1962, extras: 0, total: 4120, pay: "Cash 4120" },
  { inv: 809, key: "Shaji", prop: "D-1/23", ci: "2026-10-22", co: "2026-10-23", nights: 2, rate: 2571, extras: 0, total: 5399, pay: "UPI 5400", note: "2 rooms x 1 night" },
  { inv: 810, key: "Sayan Sen", prop: "D-1/3", ci: "2026-10-21", co: "2026-10-23", nights: 2, rate: 2150, extras: 347, total: 4880, pay: "UPI 4880" },
  { inv: 811, key: "Bishal Banik", prop: "D-1/17", ci: "2026-10-22", co: "2026-10-23", nights: 1, rate: 2057.28, extras: 0, total: 2160, pay: "MMT (net 1710.82)" },
  { inv: 812, key: "Tushita", prop: "D-1/3", ci: "2026-10-22", co: "2026-10-23", nights: 1, rate: 2500, extras: 0, total: 2625, pay: "UPI 500 (21/10) + UPI 2125" },
  { inv: 813, key: "Kumar Balwant", prop: "D-1/17", ci: "2026-10-23", co: "2026-10-24", nights: 2, rate: 2572, extras: 2713, total: 8250, pay: "UPI 5000 + UPI 2750", note: "2 rooms x 1 night + food" },
  { inv: 814, key: "Ankit", prop: "D-1/30", ci: "2026-10-21", co: "2026-10-24", nights: 3, rate: 2100, extras: 1200, total: 7875, pay: "UPI 7875", note: "B2B Talent Loan Technologys, GSTIN 07AAHCT9474D1Z0" },
  { inv: 815, key: "Alexandre Droz", prop: "D-1/3", ci: "2026-10-22", co: "2026-10-24", nights: 2, rate: 2109, extras: 0, total: 4430, pay: "Cash 4430" },
  { inv: 816, key: "Sharda", prop: "D-1/17", ci: "2026-10-22", co: "2026-10-24", nights: 4, rate: 2000, extras: 497, total: 8922, pay: "Credit card 8922", note: "2 rooms x 2 nights" },
  { inv: 817, key: "Varad", prop: "D-1/23", ci: "2026-10-17", co: "2026-10-24", nights: 7, rate: 1900, extras: 634, total: 14630, pay: "UPI 2315 + UPI 8000 (18/10) + UPI 4315" },
  { inv: 818, key: "Nakshatra", prop: "D-1/17", ci: "2026-10-24", co: "2026-10-25", nights: 2, rate: 2394, extras: 0, total: 5027, pay: "MMT (net 4151.20)", note: "2 rooms x 1 night (24th)" },
  { inv: 819, key: "Gopal Sharma", prop: "D-1/17", ci: "2026-10-24", co: "2026-10-25", nights: 1, rate: 2500, extras: 300, total: 2940, pay: "Credit (Mr A Rungta)" },
  { inv: 820, key: "Lar", prop: "D-1/3", ci: "2026-10-23", co: "2026-10-25", nights: 2, rate: 2149, extras: 0, total: 4513, pay: "AGODA (net 3713.38)", note: "Sunnanå Lars" },
  { inv: 821, key: "Madeleyne", prop: "D-1/3", ci: "2026-10-24", co: "2026-10-25", nights: 1, rate: 2666, extras: 0, total: 2800, pay: "Cash 2800" },
  { inv: 822, key: "PK", prop: "D-1/23", ci: "2026-10-24", co: "2026-10-25", nights: 1, rate: 2217, extras: 0, total: 2328, pay: "UPI 2328", note: "Dr PK" },
  { inv: 823, key: "Siddique", prop: "D-1/17", ci: "2026-10-19", co: "2026-10-25", nights: 12, rate: 2000, extras: 0, total: 25200, pay: "UPI 14200 + UPI 10000 + Adv UPI 1000 (1/9)", note: "2 rooms x 6 nights" },
  { inv: 824, key: "Satish", prop: "D-1/17", ci: "2026-10-24", co: "2026-10-26", nights: 2, rate: 2300, extras: 400, total: 5250, pay: "UPI 1000 (15/10) + UPI 4265" },
  { inv: 825, key: "Nakshatra", prop: "D-1/17", ci: "2026-10-25", co: "2026-10-26", nights: 2, rate: 2218, extras: 400, total: 5078, pay: "UPI 5078", note: "Direct: 2 rooms x 1 night (25th) + extra bed" },
  { inv: 826, key: "Karen", prop: "D-1/17", ci: "2026-10-22", co: "2026-10-26", nights: 4, rate: 2250, extras: 0, total: 9450, pay: "Cash 9450" },
  { inv: 827, key: "Dilwar", prop: "D-1/23", ci: "2026-10-23", co: "2026-10-26", nights: 3, rate: 5000, extras: 0, total: 15750, pay: "UPI 12750 + UPI 3000 (29/8)" },
  { inv: 828, key: "Shivang", prop: "D-1/17", ci: "2026-10-25", co: "2026-10-27", nights: 2, rate: 2381, extras: 0, total: 5000, pay: "UPI 3000 (29/09) + UPI 2000 (26/10)" },
  { inv: 829, key: "Satheesh", alt: "NuMed", prop: "D-1/17", ci: "2026-10-25", co: "2026-10-26", nights: 1, rate: 2013.73, extras: 0, total: 2114, pay: "MMT (net 1745.91)", note: "B2B NuMed Systems, GSTIN 33AAGCN7212E1ZU" },
  { inv: 830, key: "Mandrati", alt: "Murali", prop: "D-1/17", ci: "2026-10-25", co: "2026-10-26", nights: 1, rate: 2726.62, extras: 0, total: 2863, pay: "MMT (net 2363.98) + note 'Ex. Bed 500'" },
  { inv: 831, key: "Jayesh Iyer", prop: "D-1/17", ci: "2026-10-25", co: "2026-10-26", nights: 1, rate: 1948.75, extras: 0, total: 2046, pay: "MMT (net 1689.57)" },
  { inv: 832, key: "Kumar Balwant", prop: "D-1/17", ci: "2026-10-25", co: "2026-10-26", nights: 1, rate: 2051.31, extras: 0, total: 2154, pay: "MMT (net 1778.49) + note 'Room in D-1/3, Ex. Person 1500 UPI on 26'" },
  { inv: 833, key: "Chaturvedi", prop: "D-1/17", ci: "2026-10-26", co: "2026-10-28", nights: 1, rate: 2300, extras: 300, total: 2730, pay: "Credit — IIT Delhi Textile & Fibre Engg Dept" },
  { inv: 834, key: "Harsh", prop: "D-1/17", ci: "2026-10-26", co: "2026-10-27", nights: 1, rate: 2078.71, extras: 0, total: 2183, pay: "MMT (net 1802.26)" },
  { inv: 835, key: "Arjun", alt: "Bhankar", prop: "D-1/17", ci: "2026-10-26", co: "2026-10-27", nights: 1, rate: 1948.75, extras: 0, total: 2046, pay: "MMT (net 1689.57)" },
  { inv: 836, key: "Jai Shan", prop: "D-1/17", ci: "2026-10-26", co: "2026-10-27", nights: 1, rate: 2396.02, extras: 0, total: 2516, pay: "MMT (net 2077.35)" },
];

const PROP = { "D-1/17": "HKD17", "D-1/23": "HKD23", "D-1/3": "HKD3", "D-1/30": "HKD30" };

async function main() {
  const out = [];
  for (const b of BILLS) {
    const ci = new Date(`${b.ci}T00:00:00Z`);
    const keys = [b.key, b.alt].filter(Boolean);
    const cands = await prisma.reservation.findMany({
      where: { OR: keys.map((k) => ({ guest: { fullName: { contains: k, mode: "insensitive" } } })), checkInDate: { gte: new Date(ci.getTime() - 3 * 864e5), lte: new Date(ci.getTime() + 3 * 864e5) } },
      select: { code: true, status: true, source: true, checkInDate: true, checkOutDate: true, nights: true, ratePaise: true, guest: { select: { fullName: true } }, property: { select: { code: true } },
        allocations: { select: { room: { select: { number: true } } } },
        folio: { select: { lines: { select: { id: true, type: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, reversalOfId: true } }, payments: { select: { mode: true, amountPaise: true, isRefund: true } }, invoices: { select: { id: true, number: true, type: true, totalPaise: true, cancelsInvoiceId: true } } } } },
    });
    const rows = cands.map((r) => {
      const ls = r.folio?.lines ?? [];
      const rev = new Set(ls.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
      const act = ls.filter((l) => l.type !== "REVERSAL" && !rev.has(l.id));
      const total = ls.reduce((s, l) => s + Number(l.amountPaise) + l.cgstPaise + l.sgstPaise + l.igstPaise, 0);
      const room = act.filter((l) => l.type === "ROOM").reduce((s, l) => s + Number(l.amountPaise), 0);
      const extras = act.filter((l) => !["ROOM", "MISC", "DISCOUNT"].includes(l.type)).reduce((s, l) => s + Number(l.amountPaise), 0);
      const pays = (r.folio?.payments ?? []);
      const paid = pays.reduce((s, p) => s + (p.isRefund ? -Number(p.amountPaise) : Number(p.amountPaise)), 0);
      const inv = r.folio?.invoices ?? [];
      const voided = new Set(inv.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId));
      const live = inv.filter((i) => i.type === "TAX_INVOICE" && !voided.has(i.id));
      return { code: r.code, status: r.status, src: r.source, guest: r.guest.fullName, prop: r.property.code, ci: d(r.checkInDate), co: d(r.checkOutDate), nights: r.nights,
        rooms: r.allocations.map((a) => a.room.number).join("+") || "none", room: r2(room), extras: r2(extras), total: r2(total), paid: r2(paid),
        pays: pays.map((p) => `${p.isRefund ? "-" : ""}${p.mode} ${r2(p.amountPaise)}`).join(", "), inv: live.map((i) => `${i.number.replace(/\s/g, "")} ${r2(i.totalPaise)}`).join(", ") || "none" };
    });
    out.push({ b, rows });
  }
  console.log(JSON.stringify(out, null, 1));
}
main().catch((e) => { console.error("FAILED:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
