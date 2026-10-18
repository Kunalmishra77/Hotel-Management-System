/** READ-ONLY. Find legacy AGGREGATE room lines — one ROOM line standing for
 *  several nights (quantity > 1), produced by the old `correctRoomRate`.
 *
 *  They hold the right TOTAL but book every night's revenue onto one arbitrary
 *  business date, so daily room revenue / ADR / RevPAR are wrong for both the
 *  nights that lost their revenue and the day that absorbed it.
 *
 *  node scripts/scan-aggregate-room-lines.mjs
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const inr = (p) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const d = (x) => x.toISOString().slice(0, 10);

try {
  const agg = await prisma.folioLine.findMany({
    where: { type: "ROOM", quantity: { gt: 1 } },
    select: {
      id: true, folioId: true, description: true, quantity: true, unitPaise: true,
      amountPaise: true, businessDate: true, revision: true,
      folio: {
        select: {
          propertyId: true,
          reservation: { select: { code: true, checkInDate: true, checkOutDate: true, nights: true, status: true, guest: { select: { fullName: true } } } },
        },
      },
    },
    orderBy: { businessDate: "asc" },
  });

  // Exclude any already reversed — those no longer affect revenue.
  const reversed = new Set(
    (await prisma.folioLine.findMany({ where: { reversalOfId: { in: agg.map((l) => l.id) } }, select: { reversalOfId: true } }))
      .map((l) => l.reversalOfId),
  );
  const live = agg.filter((l) => !reversed.has(l.id));

  console.log(`${agg.length} aggregate ROOM line(s) total; ${live.length} still active\n`);
  for (const l of live) {
    const r = l.folio.reservation;
    console.log(`${r?.code ?? "(no reservation)"} ${r?.guest.fullName ?? ""} [${r?.status ?? "-"}]`);
    console.log(`  stay ${r ? `${d(r.checkInDate)} -> ${d(r.checkOutDate)} (${r.nights}n)` : "?"}`);
    console.log(`  line ${l.id} on ${d(l.businessDate)}: ${l.quantity} × ${inr(l.unitPaise)} = ${inr(l.amountPaise)} rev=${l.revision}`);
    console.log(`       "${l.description}"`);
    // Which nights of the stay currently have NO active room line?
    if (r) {
      const all = await prisma.folioLine.findMany({ where: { folioId: l.folioId }, select: { id: true, type: true, businessDate: true, quantity: true, reversalOfId: true } });
      const rev2 = new Set(all.filter((x) => x.reversalOfId).map((x) => x.reversalOfId));
      const covered = new Set(all.filter((x) => x.type === "ROOM" && !rev2.has(x.id) && x.quantity === 1).map((x) => d(x.businessDate)));
      const missing = [];
      for (let t = r.checkInDate.getTime(); t < r.checkOutDate.getTime(); t += 86400000) {
        const k = d(new Date(t));
        if (!covered.has(k)) missing.push(k);
      }
      console.log(`       nights with no per-night line: ${missing.join(", ") || "(none)"}`);
    }
    console.log("");
  }
} catch (e) {
  console.error("Failed:", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
