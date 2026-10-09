/** READ-ONLY. Audit every current/recent folio for money that doesn't reconcile. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p) => `₹${(Number(p) / 100).toLocaleString("en-IN")}`;
const key = (d) => d.toISOString().slice(0, 10);
function nights(ci, co) { let n = 0; const d = new Date(Date.UTC(ci.getUTCFullYear(), ci.getUTCMonth(), ci.getUTCDate())); const e = new Date(Date.UTC(co.getUTCFullYear(), co.getUTCMonth(), co.getUTCDate())); while (d < e) { n++; d.setUTCDate(d.getUTCDate() + 1); } return n; }

try {
  const since = new Date(Date.now() - 45 * 86400000);
  const res = await prisma.reservation.findMany({
    where: { OR: [{ status: "IN_HOUSE" }, { status: "CHECKED_OUT", checkOutAt: { gte: since } }] },
    select: { code: true, status: true, source: true, ratePaise: true, checkInDate: true, checkOutDate: true,
      guest: { select: { fullName: true } }, property: { select: { code: true } },
      folio: { select: { id: true,
        lines: { select: { id: true, type: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, reversalOfId: true, businessDate: true } },
        payments: { select: { amountPaise: true, isRefund: true } } } } },
    orderBy: [{ property: { code: "asc" } }, { checkInDate: "asc" } ],
  });

  const unsettled = [], corrupt = [], mismatch = [], inhouse = [];
  for (const r of res) {
    if (!r.folio) continue;
    const L = r.folio.lines;
    const revd = new Set(L.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
    let charges = 0n, roomTaxable = 0n;
    for (const l of L) {
      charges += BigInt(l.amountPaise) + BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise);
      if ((l.type === "ROOM" || l.type === "REVERSAL") && !revd.has(l.id)) {
        // active room-side taxable (ROOM positive, its REVERSAL negative — but reversed originals are excluded)
        if (l.type === "ROOM") roomTaxable += BigInt(l.amountPaise);
      }
    }
    let paid = 0n; for (const p of r.folio.payments) { const a = BigInt(p.amountPaise); paid += p.isRefund ? -a : a; }
    const bal = charges - paid;
    const n = nights(r.checkInDate, r.checkOutDate) || 1;
    const tag = `${r.property.code}/${r.code} ${r.guest.fullName}`;
    const srcOta = !["DIRECT", "WALK_IN", "PHONE", "WEBSITE", "CORPORATE", "TRAVEL_AGENT"].includes(r.source);

    const outOfRange = L.filter((l) => l.type === "ROOM" && !revd.has(l.id)).map((l) => key(l.businessDate)).filter((dk) => dk < key(r.checkInDate) || dk >= key(r.checkOutDate));
    if (outOfRange.length) corrupt.push(`${tag}: room line(s) dated ${[...new Set(outOfRange)].join(",")} outside ${key(r.checkInDate)}..${key(r.checkOutDate)}`);

    const expectedTaxable = BigInt(n * r.ratePaise);
    if (roomTaxable !== expectedTaxable && outOfRange.length === 0) mismatch.push(`${tag}: room taxable ${inr(roomTaxable)} vs expected ${inr(expectedTaxable)} (${n}n×${inr(r.ratePaise)})`);

    if (r.status === "CHECKED_OUT" && bal !== 0n) unsettled.push(`${tag} [${r.source}]: bill ${inr(charges)} paid ${inr(paid)} => ${bal > 0n ? "DUE " : "OVERPAID "}${inr(bal < 0n ? -bal : bal)}`);
    if (r.status === "IN_HOUSE") inhouse.push(`${tag} [${r.source}${srcOta ? " ⚠OTA" : ""}]: bill ${inr(charges)} paid ${inr(paid)} balance ${inr(bal)}`);
  }

  const sec = (title, arr) => { console.log(`\n=== ${title} (${arr.length}) ===`); for (const x of arr) console.log("  " + x); if (!arr.length) console.log("  (none)"); };
  console.log(`Scanned ${res.length} folios (in-house + checked-out last 45d).`);
  sec("CHECKED-OUT with non-zero balance — needs reconciliation", unsettled);
  sec("Room lines dated OUTSIDE the stay — corruption (manual review)", corrupt);
  sec("Room charge != booked nights × rate — verify (may be a legit rate change)", mismatch);
  sec("IN-HOUSE current balances", inhouse);
} catch (e) { console.error("Failed:", e.message); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
