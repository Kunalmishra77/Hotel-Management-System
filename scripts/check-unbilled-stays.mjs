/** READ-ONLY. In-house stays with nothing billed for the room — these will be
 *  refused at check-out by the NOTHING_BILLED guard until a rate is set.
 *  node scripts/check-unbilled-stays.mjs
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const d = (x) => x.toISOString().slice(0,10);
const inr = (x) => `₹${(Number(x)/100).toLocaleString("en-IN",{minimumFractionDigits:2})}`;
try {
  const rs = await p.reservation.findMany({
    where: { status: "IN_HOUSE" },
    select: { code:true,source:true,settlementIntent:true,ratePaise:true,advancePaise:true,nights:true,checkInDate:true,checkOutDate:true,
      guest:{select:{fullName:true}}, property:{select:{name:true}}, allocations:{select:{room:{select:{number:true}}}},
      folio:{select:{lines:{select:{id:true,type:true,amountPaise:true,reversalOfId:true}}}} },
    orderBy: { checkInDate: "asc" },
  });
  const blocked = [];
  for (const r of rs) {
    const lines = r.folio?.lines ?? [];
    const revd = new Set(lines.filter(l=>l.reversalOfId).map(l=>l.reversalOfId));
    const roomCharged = lines.filter(l=>l.type==="ROOM" && !revd.has(l.id)).reduce((s,l)=>s+BigInt(l.amountPaise),0n);
    if (roomCharged <= 0n) blocked.push({ r, roomCharged });
  }
  console.log(`${rs.length} in-house stay(s); ${blocked.length} with NOTHING billed for the room\n`);
  for (const { r } of blocked) {
    console.log(`  ${r.code}  ${r.guest.fullName.padEnd(24)} ${r.source.padEnd(11)} ${r.property.name.padEnd(20)} room ${r.allocations[0]?.room.number ?? "-"}`);
    console.log(`     ${d(r.checkInDate)} → ${d(r.checkOutDate)} (${r.nights}n) · rate ${inr(r.ratePaise)} · advance ${inr(r.advancePaise)} · ${r.settlementIntent}`);
  }
  if (blocked.length) console.log(`\nFix each from the booking page → "Edit room rate" (and record the OTA prepayment on the folio).`);
} catch (e) { console.error("Failed:", e.message); process.exitCode = 1; }
finally { await p.$disconnect(); }
