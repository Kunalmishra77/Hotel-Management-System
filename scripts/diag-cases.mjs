/** READ-ONLY. Dump reservations + folios for guests matching NAME.
 *  $env:NAME="muniama"; node scripts/diag-cases.mjs
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const NAME = process.env.NAME ?? "";
const inr = (p) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const d = (x) => (x ? x.toISOString().slice(0, 10) : "—");

try {
  const guests = await prisma.guest.findMany({
    where: { fullName: { contains: NAME, mode: "insensitive" } },
    select: { id: true, fullName: true, mobile: true },
  });
  if (guests.length === 0) { console.log(`No guest matching "${NAME}"`); process.exit(0); }

  for (const g of guests) {
    console.log(`\n================ GUEST ${g.fullName} (${g.mobile ?? "no mobile"}) id=${g.id}`);
    const rs = await prisma.reservation.findMany({
      where: { guestId: g.id },
      orderBy: { checkInDate: "asc" },
      select: {
        id: true, code: true, status: true, source: true, propertyId: true,
        checkInDate: true, checkOutDate: true, nights: true, ratePaise: true,
        advancePaise: true, otherChargesPaise: true, extraBedPaise: true,
        discountPaise: true, taxPaise: true, transferredFromId: true,
        property: { select: { name: true, state: true } },
        allocations: { select: { startDate: true, endDate: true, room: { select: { number: true } } } },
        folio: { select: { id: true } },
      },
    });
    for (const r of rs) {
      const calcNights = Math.round((r.checkOutDate - r.checkInDate) / 86400000);
      console.log(`\n--- ${r.code} [${r.status}] src=${r.source} @ ${r.property.name} (${r.property.state})`);
      console.log(`    id=${r.id}${r.transferredFromId ? ` transferredFrom=${r.transferredFromId}` : ""}`);
      console.log(`    stay ${d(r.checkInDate)} -> ${d(r.checkOutDate)}  nights(field)=${r.nights} nights(calc)=${calcNights}`);
      console.log(`    rate=${inr(r.ratePaise)} advance=${inr(r.advancePaise)} other=${inr(r.otherChargesPaise)} extraBed=${inr(r.extraBedPaise)} disc=${inr(r.discountPaise)}`);
      for (const a of r.allocations) console.log(`    alloc room ${a.room.number}: ${d(a.startDate)} -> ${d(a.endDate)}`);

      if (!r.folio) { console.log("    (no folio)"); continue; }
      const f = await prisma.folio.findUnique({
        where: { id: r.folio.id },
        select: {
          id: true, isClosed: true,
          lines: { orderBy: { createdAt: "asc" }, select: { id: true, type: true, description: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, businessDate: true, reversalOfId: true } },
          payments: { select: { amountPaise: true, mode: true, isRefund: true, reference: true, receivedAt: true } },
        },
      });
      const reversedIds = new Set(f.lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
      let charges = 0n, tax = 0n, pay = 0n;
      console.log(`    folio ${f.id} ${f.isClosed ? "CLOSED" : "OPEN"} — ${f.lines.length} lines`);
      for (const l of f.lines) {
        const t = BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise);
        charges += BigInt(l.amountPaise); tax += t;
        const flag = l.type === "REVERSAL" ? " (rev)" : reversedIds.has(l.id) ? " (REVERSED)" : "";
        console.log(`      ${d(l.businessDate)} ${l.type.padEnd(9)} unit=${inr(l.unitPaise).padStart(11)} base=${inr(l.amountPaise).padStart(11)} gst=${inr(t).padStart(9)} bps=${String(l.taxRateBps).padStart(4)} ${l.description}${flag}`);
      }
      for (const p of f.payments) {
        const a = BigInt(p.amountPaise); pay += p.isRefund ? -a : a;
        console.log(`      ${d(p.receivedAt)} ${p.isRefund ? "REFUND " : "PAYMENT"} ${inr(p.amountPaise)} ${p.mode} ref=${p.reference ?? ""}`);
      }
      // net of reversals (what the bill actually shows)
      let netBase = 0n, netTax = 0n, roomNights = 0;
      for (const l of f.lines) {
        if (l.type === "REVERSAL" || reversedIds.has(l.id)) continue;
        netBase += BigInt(l.amountPaise);
        netTax += BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise);
        if (l.type === "ROOM") roomNights++;
      }
      console.log(`    => ALL lines: base ${inr(charges)} gst ${inr(tax)} total ${inr(charges + tax)}`);
      console.log(`    => ACTIVE    : base ${inr(netBase)} gst ${inr(netTax)} total ${inr(netBase + netTax)} | activeRoomNights=${roomNights}`);
      console.log(`    => paid ${inr(pay)} | BALANCE ${inr(charges + tax - pay)}`);
    }
  }
} catch (e) {
  console.error("Failed:", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
