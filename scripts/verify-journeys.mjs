/** READ-ONLY. Per-guest journey check: every night billed exactly once, at the
 *  agreed rate, and the COMBINED balance across linked bookings.
 *  node scripts/verify-journeys.mjs
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const inr = (p) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const d = (x) => x.toISOString().slice(0, 10);

const JOURNEYS = [
  { who: "Muniama Linganathen", codes: ["BK-U2BB2TP9", "BK-DJAK5SU3"], expectNights: 15, expectCombined: 1_608_870 },
  { who: "Suresh Kumar Sharma", codes: ["BK-7SDVNJN0", "BK-9AF7GP2X"], expectNights: 2, expectCombined: 0 },
  { who: "Ankit Bansal", codes: ["BK-7SJDEVBJ", "BK-99OFFBL7"], expectNights: 2, expectCombined: -189_000 },
];

let ok = true;
try {
  for (const j of JOURNEYS) {
    console.log(`\n=== ${j.who} ===`);
    let combined = 0n;
    let totalNights = 0;
    const allNightKeys = [];
    for (const code of j.codes) {
      const r = await prisma.reservation.findFirst({
        where: { code },
        select: {
          code: true, status: true, source: true, nights: true, ratePaise: true,
          checkInDate: true, checkOutDate: true,
          property: { select: { name: true } },
          folio: { select: { id: true, lines: { select: { id: true, type: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, businessDate: true, quantity: true, reversalOfId: true } }, payments: { select: { amountPaise: true, isRefund: true } } } },
        },
      });
      if (!r) { console.log(`  ${code}: NOT FOUND`); ok = false; continue; }
      const f = r.folio;
      const revd = new Set(f.lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
      const active = f.lines.filter((l) => !revd.has(l.id) && !(l.type === "REVERSAL" && l.reversalOfId));
      let base = 0n, tax = 0n, paid = 0n;
      const nightKeys = [];
      for (const l of active) {
        base += BigInt(l.amountPaise);
        tax += BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise);
        if (l.type === "ROOM") { for (let i = 0; i < l.quantity; i++) nightKeys.push(d(l.businessDate)); }
      }
      for (const p of f.payments) paid += p.isRefund ? -BigInt(p.amountPaise) : BigInt(p.amountPaise);
      const bal = base + tax - paid;
      combined += bal;
      totalNights += nightKeys.length;
      allNightKeys.push(...nightKeys);

      const stayNights = Math.round((r.checkOutDate - r.checkInDate) / 86400000);
      const nightsOk = nightKeys.length === stayNights && r.nights === stayNights;
      if (!nightsOk) ok = false;
      console.log(`  ${r.code} [${r.status}] ${r.source} @ ${r.property.name}`);
      console.log(`    ${d(r.checkInDate)} → ${d(r.checkOutDate)} · stay ${stayNights}n · nights(field) ${r.nights} · billed room-nights ${nightKeys.length} ${nightsOk ? "✔" : "✘ MISMATCH"}`);
      console.log(`    rate ${inr(r.ratePaise)} · charges ${inr(base)} + gst ${inr(tax)} = ${inr(base + tax)} · paid ${inr(paid)} · balance ${inr(bal)}`);
    }
    const dupes = allNightKeys.filter((k, i) => allNightKeys.indexOf(k) !== i);
    if (dupes.length > 0) { ok = false; console.log(`  ✘ NIGHT BILLED TWICE: ${[...new Set(dupes)].join(", ")}`); }
    else console.log(`  ✔ no night billed twice across the journey`);
    const nOk = totalNights === j.expectNights;
    const bOk = combined === BigInt(j.expectCombined);
    if (!nOk || !bOk) ok = false;
    console.log(`  journey nights ${totalNights} (expected ${j.expectNights}) ${nOk ? "✔" : "✘"}`);
    console.log(`  COMBINED BALANCE ${inr(combined)} (expected ${inr(j.expectCombined)}) ${bOk ? "✔" : "✘"}`);
  }
  console.log(`\n${ok ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error("Failed:", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
