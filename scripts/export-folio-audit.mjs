/** READ-ONLY. Export every current/recent folio to folio-audit.csv for reconciliation. */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const rupees = (p) => (Number(p) / 100).toFixed(2);
const key = (d) => d.toISOString().slice(0, 10);
function nights(ci, co) { let n = 0; const d = new Date(Date.UTC(ci.getUTCFullYear(), ci.getUTCMonth(), ci.getUTCDate())); const e = new Date(Date.UTC(co.getUTCFullYear(), co.getUTCMonth(), co.getUTCDate())); while (d < e) { n++; d.setUTCDate(d.getUTCDate() + 1); } return n; }
const csv = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;

try {
  const since = new Date(Date.now() - 45 * 86400000);
  const res = await prisma.reservation.findMany({
    where: { OR: [{ status: "IN_HOUSE" }, { status: "CHECKED_OUT", checkOutAt: { gte: since } }] },
    select: { code: true, status: true, source: true, ratePaise: true, checkInDate: true, checkOutDate: true,
      guest: { select: { fullName: true } }, property: { select: { code: true } },
      folio: { select: { lines: { select: { id: true, type: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, reversalOfId: true, businessDate: true } }, payments: { select: { amountPaise: true, isRefund: true } } } } },
    orderBy: [{ property: { code: "asc" } }, { checkInDate: "asc" }],
  });

  const rows = [["Property", "Booking", "Guest", "Status", "Source", "Nights", "Bill", "Paid", "Balance", "Flag", "Note"]];
  for (const r of res) {
    if (!r.folio) continue;
    const L = r.folio.lines;
    const revd = new Set(L.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
    let charges = 0n, roomTax = 0n;
    for (const l of L) { charges += BigInt(l.amountPaise) + BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise); if (l.type === "ROOM" && !revd.has(l.id)) roomTax += BigInt(l.amountPaise); }
    let paid = 0n; for (const p of r.folio.payments) { const a = BigInt(p.amountPaise); paid += p.isRefund ? -a : a; }
    const bal = Number(charges - paid);
    const n = nights(r.checkInDate, r.checkOutDate) || 1;
    const outRange = L.filter((l) => l.type === "ROOM" && !revd.has(l.id)).map((l) => key(l.businessDate)).filter((dk) => dk < key(r.checkInDate) || dk >= key(r.checkOutDate));
    let flag = "OK", note = "";
    if (outRange.length) { flag = "CORRUPT-DATING"; note = `room line dated ${[...new Set(outRange)].join(",")} outside stay (night-audit bug; bill now clean)`; }
    else if (Number(roomTax) !== n * r.ratePaise) { flag = "RATE-DIFFERS"; note = `charged room ₹${rupees(roomTax)} vs ${n}n×₹${rupees(r.ratePaise)} (likely rate edit / GST-incl data entry)`; }
    if (r.status === "CHECKED_OUT" && bal !== 0) {
      if (Math.abs(bal) < 500) { if (flag === "OK") flag = "ROUNDING"; }
      else { flag = bal > 0 ? "DUE" : "OVERPAID"; note = note || (bal > 0 ? "payment likely not recorded — confirm cash & record" : "possible double-recorded payment OR advance to refund"); }
    }
    rows.push([r.property.code, r.code, r.guest.fullName, r.status, r.source, n, rupees(charges), rupees(paid), rupees(bal), flag, note].map(csv));
  }
  const out = "folio-audit.csv";
  writeFileSync(out, rows.map((r) => r.join(",")).join("\r\n"), "utf8");
  const counts = {}; for (const r of rows.slice(1)) { const f = r[9].replace(/"/g, ""); counts[f] = (counts[f] || 0) + 1; }
  console.log(`Wrote ${out} — ${rows.length - 1} folios.`);
  console.log("By flag:", counts);
} catch (e) { console.error("Failed:", e.message); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
