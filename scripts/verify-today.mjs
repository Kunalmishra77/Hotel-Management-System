/**
 * READ-ONLY verification of every data fix applied on 29 Oct 2026. Each check
 * prints PASS / FAIL with the observed values — evidence, not assumptions.
 *   node scripts/verify-today.mjs
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const d = (x) => new Date(x).toISOString().slice(0, 10);
const inr = (p) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
let pass = 0, fail = 0;
const check = (name, ok, seen) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${seen}`); };

async function bk(code) {
  return prisma.reservation.findFirst({ where: { code }, select: { id: true, status: true, source: true, checkInDate: true, checkOutDate: true, nights: true, ratePaise: true, guestId: true,
    allocations: { select: { startDate: true, endDate: true, room: { select: { number: true, status: true } } }, orderBy: { startDate: "asc" } },
    folio: { select: { lines: { select: { id: true, type: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, reversalOfId: true, businessDate: true } },
      payments: { select: { mode: true, amountPaise: true, isRefund: true, receivedAt: true } },
      invoices: { select: { id: true, number: true, type: true, totalPaise: true, cancelsInvoiceId: true } } } } } });
}
const money = (f) => {
  const total = f.lines.reduce((s, l) => s + Number(l.amountPaise) + l.cgstPaise + l.sgstPaise + l.igstPaise, 0);
  const paid = f.payments.reduce((s, p) => s + (p.isRefund ? -Number(p.amountPaise) : Number(p.amountPaise)), 0);
  const rev = new Set(f.lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
  const roomNights = f.lines.filter((l) => l.type === "ROOM" && !rev.has(l.id)).map((l) => d(l.businessDate));
  const voided = new Set(f.invoices.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId));
  const live = f.invoices.filter((i) => i.type === "TAX_INVOICE" && !voided.has(i.id));
  return { total, paid, bal: total - paid, roomNights, live };
};

async function main() {
  // Arko
  let r = await bk("BK-QFRRKTZM"); let m = money(r.folio);
  const pays = r.folio.payments.filter((p) => !p.isRefund).sort((a, b) => a.receivedAt - b.receivedAt).map((p) => `${p.mode} ${inr(p.amountPaise)} ${d(p.receivedAt)}`);
  check("Arko BK-QFRRKTZM: ₹1,000 advance (26 Oct) + ₹6,875 (29 Oct), balance ₹0", pays.join(" | ") === "UPI ₹1,000.00 2026-10-26 | UPI ₹6,875.00 2026-10-29" && m.bal === 0, `payments: ${pays.join(" | ")} · bill ${inr(m.total)} · balance ${inr(m.bal)}`);

  // Saumen
  r = await bk("BK-RW1DQ2ET"); m = money(r.folio);
  check("Saumen BK-RW1DQ2ET: in-house, 15 room-nights billed, R1+R2 occupied", r.status === "IN_HOUSE" && m.roomNights.length === 15 && r.allocations.every((a) => a.room.status === "OCCUPIED"),
    `${r.status} · nights billed ${m.roomNights.length} · bill ${inr(m.total)} · rooms ${r.allocations.map((a) => `${a.room.number}[${a.room.status}]`).join(", ")}`);

  // Sayan
  r = await bk("BK-QFC1JR9F");
  const segs = r.allocations.map((a) => `${a.room.number} ${d(a.startDate)}→${d(a.endDate)}`).join(" + ");
  check("Sayan BK-QFC1JR9F: R3 26→29 then R1 29→30", segs === "R3 2026-10-26→2026-10-29 + R1 2026-10-29→2026-10-30", `${r.status} · ${segs}`);

  // Harsh
  r = await bk("BK-QF9AF1TN"); m = money(r.folio);
  check("Harsh BK-QF9AF1TN: bill exists, 1 night @ ₹2,078.71 + GST = ₹2,182.65", m.total === 218265 && r.ratePaise === 207871, `rate ${inr(r.ratePaise)} · bill ${inr(m.total)} · paid ${inr(m.paid)} · balance ${inr(m.bal)} · invoices ${m.live.map((i) => i.number).join(",") || "none yet"}`);

  // Nakshatra
  const n1 = await bk("BK-M6FMNZXO"); const mn1 = money(n1.folio);
  check("Nakshatra MMT BK-M6FMNZXO: GF-2 only, bill ₹5,027, balance ₹0", mn1.total === 502700 && mn1.bal === 0 && n1.allocations.map((a) => a.room.number).join() === "GF-2", `rooms ${n1.allocations.map((a) => a.room.number).join(",")} · bill ${inr(mn1.total)} · balance ${inr(mn1.bal)} · invoices ${mn1.live.map((i) => i.number).join(",") || "none yet"}`);
  const n2 = await prisma.reservation.findFirst({ where: { guestId: n1.guestId, source: "DIRECT", checkInDate: n1.checkInDate }, select: { code: true } });
  const nd = n2 ? await bk(n2.code) : null; const mn2 = nd ? money(nd.folio) : null;
  check("Nakshatra Direct (new): GF-3, bill ₹5,078 (room ₹4,678 + bed ₹400)", !!nd && mn2.total === 507800 && nd.allocations.map((a) => a.room.number).join() === "GF-3", nd ? `${n2.code} · rooms ${nd.allocations.map((a) => a.room.number).join(",")} · bill ${inr(mn2.total)} · paid ${inr(mn2.paid)} · balance ${inr(mn2.bal)} (₹478 credit expected)` : "not found");

  // Sunnana
  const s1 = await bk("BK-KV7OYWX7"); const ms = money(s1.folio); const s2 = await bk("BK-M605ULRT"); const ms2 = money(s2.folio);
  check("Sunnana BK-KV7OYWX7: 23→25, R1+R2, bill ₹4,513, paid in full, ONE live invoice", ms.total === 451300 && ms.bal === 0 && ms.live.length === 1 && d(s1.checkOutDate) === "2026-10-25",
    `${d(s1.checkInDate)}→${d(s1.checkOutDate)} · rooms ${s1.allocations.map((a) => a.room.number).join(",")} · nights ${ms.roomNights.join(",")} · bill ${inr(ms.total)} · balance ${inr(ms.bal)} · live invoice ${ms.live.map((i) => `${i.number} ${inr(i.totalPaise)}`).join(",")}`);
  check("Sunnana duplicate BK-M605ULRT: cancelled, folio ₹0, no live invoice", s2.status === "CANCELLED" && ms2.total === 0 && ms2.bal === 0 && ms2.live.length === 0, `${s2.status} · bill ${inr(ms2.total)} · balance ${inr(ms2.bal)} · live invoices ${ms2.live.length}`);

  // Guest merges
  const merged = await prisma.guest.findMany({ where: { mergedIntoId: { not: null } }, select: { id: true } });
  const ids = merged.map((g) => g.id);
  const orphanRes = await prisma.reservation.count({ where: { guestId: { in: ids } } });
  const orphanIds = await prisma.guestId.count({ where: { guestId: { in: ids } } });
  const orphanCF = await prisma.cForm.count({ where: { guestId: { in: ids } } });
  check("Guest merges: no booking / ID / C-Form left on a merged (deleted) profile", orphanRes + orphanIds + orphanCF === 0, `merged profiles ${ids.length} · leftover bookings ${orphanRes} · IDs ${orphanIds} · C-Forms ${orphanCF}`);
  const kb = await prisma.guest.findMany({ where: { fullName: { contains: "Balwant", mode: "insensitive" }, deletedAt: null }, select: { id: true, _count: { select: { reservations: true } } } });
  check("Kumar Balwant: exactly one live profile holding all 3 bookings", kb.length === 1 && kb[0]._count.reservations === 3, `${kb.length} profile(s) · bookings ${kb.map((g) => g._count.reservations).join(",")}`);

  // Integrity sweeps
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const ovl = await prisma.$queryRawUnsafe(`SELECT count(*)::int n FROM "RoomAllocation" a JOIN "RoomAllocation" b ON a."roomId"=b."roomId" AND a.id<b.id AND daterange(a."startDate",a."endDate",'[)') && daterange(b."startDate",b."endDate",'[)')`);
  check("No two bookings hold the same room on the same night", ovl[0].n === 0, `overlapping allocation pairs: ${ovl[0].n}`);
  const live = await prisma.reservation.count({ where: { status: { in: ["IN_HOUSE", "CONFIRMED"] }, externalHotelName: null, allocations: { none: {} } } });
  check("No live/upcoming booking without a room", live === 0, `unallocated in-house/confirmed: ${live}`);
  const multi = await prisma.$queryRawUnsafe(`SELECT f.id, count(*)::int n FROM "Invoice" i JOIN "Folio" f ON f.id=i."folioId" WHERE i.type='TAX_INVOICE' AND NOT EXISTS (SELECT 1 FROM "Invoice" c WHERE c."cancelsInvoiceId"=i.id) GROUP BY f.id HAVING count(*)>1`);
  check("No folio with more than one live tax invoice", multi.length === 0, `folios with 2+ live invoices: ${multi.length}`);
  const dblCN = await prisma.$queryRawUnsafe(`SELECT "cancelsInvoiceId", count(*)::int n FROM "Invoice" WHERE type='CREDIT_NOTE' GROUP BY "cancelsInvoiceId" HAVING count(*)>1`);
  check("No invoice cancelled by two credit notes", dblCN.length === 0, `double credit notes: ${dblCN.length}`);
  console.log(`\n${pass} passed · ${fail} failed  (as of ${todayStr})`);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
