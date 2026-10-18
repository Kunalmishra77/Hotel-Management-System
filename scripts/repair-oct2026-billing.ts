/**
 * Oct-2026 billing repair — the three stays broken by the extend / transfer /
 * rate-correction bugs fixed in this change.
 *
 * Every write is an APPEND to the folio ledger (reversal + re-post), never an
 * edit — FolioLine is append-only and the DB trigger enforces it. Reservation
 * rows (dates / nights / status / rate) are updated in place as usual.
 *
 *   npx tsx scripts/repair-oct2026-billing.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/repair-oct2026-billing.ts  (apply)
 *
 * A — Muniama Linganathen · BK-U2BB2TP9 · D-1/17 GF-2
 *     A rate correction had collapsed the whole stay into one ₹22,500 aggregate
 *     line and re-priced the agreed 6→14 Oct nights from ₹2,268 to ₹2,250, and a
 *     later extend skipped 16 Oct entirely (the aggregate was parked on it).
 *     Split per the client's instruction into the OTA stay and a DIRECT
 *     extension so revenue-by-source is right:
 *       BK-U2BB2TP9  BOOKING_COM  6→14 Oct   8 × ₹2,268
 *       (new)        DIRECT       14→21 Oct  7 × ₹2,250
 *
 * B — Suresh Kumar Sharma · BK-7SDVNJN0 → BK-9AF7GP2X · D-1/23 → D-1/30
 *     The transfer never reversed the origin's post-transfer nights, so staff
 *     hand-zeroed the WHOLE origin folio and hand-posted the destination — which
 *     lost the 14 Oct night the guest did stay at D-1/23, and added a 16 Oct
 *     night they did not stay. Restore 14 Oct at the origin, reverse 16 Oct at
 *     the destination. 2 nights @ ₹2,500 + ₹600 kitchen.
 *
 * C — Ankit Bansal · BK-7SJDEVBJ → BK-99OFFBL7 · D-1/30 → D-1/23
 *     Same transfer bug: 15 Oct was billed on BOTH folios. Reverse it at the
 *     origin, and correct the continuation's rate from ₹3,000 to the agreed
 *     ₹2,100. 3 nights @ ₹2,100 + ₹600 food.
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { folioBalance } from "../src/features/billing";
import { activeLines, nextRoomRevision, dateKey } from "../src/features/billing/domain/reversal";
import { computeGst } from "../src/features/billing/domain/gst";
import { roomGstBps } from "../src/lib/constants/gst";
import { generateReservationCode } from "../src/features/reservations/internal";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Business dates of [from, to) — one per night. */
function nights(from: string, to: string): Date[] {
  const out: Date[] = [];
  for (let t = utc(from).getTime(); t < utc(to).getTime(); t += 86_400_000) out.push(new Date(t));
  return out;
}

type LineRow = {
  id: string; type: string; description: string; quantity: number; unitPaise: number;
  amountPaise: bigint; taxRateBps: number; cgstPaise: number; sgstPaise: number; igstPaise: number;
  hsnSac: string | null; placeOfSupplyState: string | null; businessDate: Date;
  revision: number; reversalOfId: string | null;
};
const LINE_SELECT = {
  id: true, type: true, description: true, quantity: true, unitPaise: true, amountPaise: true,
  taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true,
  placeOfSupplyState: true, businessDate: true, revision: true, reversalOfId: true,
} as const;

const plan: string[] = [];
const say = (s: string) => { plan.push(s); console.log(s); };

async function linesOf(folioId: string): Promise<LineRow[]> {
  return prisma.folioLine.findMany({ where: { folioId }, select: LINE_SELECT, orderBy: { createdAt: "asc" } });
}

async function balanceOf(folioId: string): Promise<bigint> {
  const f = await prisma.folio.findUniqueOrThrow({
    where: { id: folioId },
    select: { lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { amountPaise: true, isRefund: true } } },
  });
  return folioBalance(f.lines, f.payments);
}

/** Append a REVERSAL of `l`. The reversal is dated TODAY (the current open
 *  period), the convention every other reversal path uses; revenue is attributed
 *  to the night it cancels by the active-line rule, not by this date. */
function reversalData(l: LineRow, reason: string): Prisma.FolioLineUncheckedCreateInput {
  return {
    folioId: (l as LineRow & { folioId?: string }).folioId!,
    type: "REVERSAL",
    description: `Reversal: ${l.description} (${reason})`,
    quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise,
    taxRateBps: l.taxRateBps, cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
    hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
    businessDate: new Date(), reversalOfId: l.id,
  };
}

function roomNightData(
  folioId: string, state: string, ratePaise: number, businessDate: Date, revision: number, description: string,
): Prisma.FolioLineUncheckedCreateInput {
  const bps = roomGstBps(ratePaise);
  const gst = computeGst(ratePaise, bps, state, state);
  return {
    folioId, type: "ROOM", description, quantity: 1,
    unitPaise: ratePaise, amountPaise: BigInt(ratePaise), taxRateBps: bps,
    cgstPaise: gst.cgstPaise, sgstPaise: gst.sgstPaise, igstPaise: gst.igstPaise,
    hsnSac: "996311", placeOfSupplyState: state, businessDate, revision,
  };
}

/** Reverse the active ROOM lines matching `pick`, then (optionally) re-post those
 *  nights at `ratePaise`. Returns the rows to insert, in order. */
function repriceOrDrop(
  folioId: string, state: string, rows: LineRow[], pick: (l: LineRow) => boolean,
  reason: string, repostAt: number | null, describe: (d: Date) => string,
): Prisma.FolioLineUncheckedCreateInput[] {
  const out: Prisma.FolioLineUncheckedCreateInput[] = [];
  const targets = activeLines(rows).filter((l) => l.type === "ROOM" && pick(l));
  // Track revisions as we go, so two re-posts of the same night can't collide.
  const seen: { type: string; businessDate: Date; revision: number }[] = rows.map((l) => ({ type: l.type, businessDate: l.businessDate, revision: l.revision }));
  for (const l of targets) {
    out.push({ ...reversalData({ ...l, folioId } as LineRow & { folioId: string }, reason) });
    say(`    − reverse ${dateKey(l.businessDate)} ${l.type} ${inr(l.amountPaise)} "${l.description}"`);
    if (repostAt !== null) {
      const rev = nextRoomRevision(seen as never, l.businessDate);
      out.push(roomNightData(folioId, state, repostAt, l.businessDate, rev, describe(l.businessDate)));
      seen.push({ type: "ROOM", businessDate: l.businessDate, revision: rev });
      say(`    + post    ${dateKey(l.businessDate)} ROOM ${inr(repostAt)} (rev ${rev})`);
    }
  }
  return out;
}

async function main() {
  const inserts: Prisma.FolioLineUncheckedCreateInput[] = [];
  const afterwards: (() => Promise<void>)[] = [];

  // ===================== A · Muniama ====================================
  say("\n=== A · Muniama Linganathen (BK-U2BB2TP9) — split OTA 6→14 / DIRECT 14→21 ===");
  const mun = await prisma.reservation.findFirstOrThrow({
    where: { code: "BK-U2BB2TP9" },
    select: {
      id: true, propertyId: true, guestId: true, status: true, adults: true, children: true,
      checkInDate: true, checkOutDate: true, folio: { select: { id: true } },
      property: { select: { orgId: true, state: true } },
      allocations: { select: { id: true, roomId: true, room: { select: { number: true } } } },
    },
  });
  const munFolio = mun.folio!.id;
  const munRows = await linesOf(munFolio);
  const munRoom = mun.allocations[0]!;
  say(`  before: balance ${inr(await balanceOf(munFolio))}`);

  // Every active ROOM line on this folio is wrong (the ₹22,500 aggregate parked
  // on 16 Oct, plus the ₹2,250 nights of the extension that now belong to the
  // new DIRECT booking). Drop them all, then lay the 8 OTA nights back down.
  inserts.push(...repriceOrDrop(
    munFolio, mun.property.state, munRows, () => true,
    "re-billed per agreed rates (6–14 Oct OTA @ ₹2,268; 14–21 Oct direct @ ₹2,250)",
    null, () => "",
  ));
  const munSeen = munRows.map((l) => ({ type: l.type, businessDate: l.businessDate, revision: l.revision }));
  for (const d of nights("2026-10-06", "2026-10-14")) {
    const rev = nextRoomRevision(munSeen as never, d);
    inserts.push(roomNightData(munFolio, mun.property.state, 226_800, d, rev, `Room ${munRoom.room.number} · night`));
    munSeen.push({ type: "ROOM", businessDate: d, revision: rev });
    say(`    + post    ${dateKey(d)} ROOM ${inr(226_800)} (rev ${rev})`);
  }
  say(`  origin becomes: 6→14 Oct · 8 nights · ₹2,268 · BOOKING_COM · CHECKED_OUT`);
  say(`  new booking:    14→21 Oct · 7 nights · ₹2,250 · DIRECT · IN_HOUSE · room ${munRoom.room.number}`);

  afterwards.push(async () => {
    await prisma.reservation.update({
      where: { id: mun.id },
      data: { checkOutDate: utc("2026-10-14"), nights: 8, ratePaise: 226_800, status: "CHECKED_OUT", checkOutAt: utc("2026-10-14") },
    });
    await prisma.roomAllocation.update({ where: { id: munRoom.id }, data: { endDate: utc("2026-10-14") } });

    const created = await prisma.reservation.create({
      data: {
        propertyId: mun.propertyId, code: generateReservationCode(), guestId: mun.guestId,
        status: "IN_HOUSE", source: "DIRECT",
        checkInDate: utc("2026-10-14"), checkOutDate: utc("2026-10-21"),
        checkInAt: utc("2026-10-14"), nights: 7,
        adults: mun.adults, children: mun.children,
        ratePaise: 225_000, transferredFromId: mun.id,
        notes: "Direct extension of BK-U2BB2TP9 (Booking.com stay 6–14 Oct). Split so revenue-by-source is correct.",
      },
      select: { id: true, code: true },
    });
    await prisma.roomAllocation.create({
      data: { propertyId: mun.propertyId, reservationId: created.id, roomId: munRoom.roomId, startDate: utc("2026-10-14"), endDate: utc("2026-10-21") },
    });
    const newFolio = await prisma.folio.create({
      data: { propertyId: mun.propertyId, reservationId: created.id, kind: "RESERVATION" },
      select: { id: true },
    });
    for (const d of nights("2026-10-14", "2026-10-21")) {
      await prisma.folioLine.create({ data: roomNightData(newFolio.id, mun.property.state, 225_000, d, 0, `Room ${munRoom.room.number} · night`) });
    }
    console.log(`  → created ${created.code} (folio ${newFolio.id}) balance ${inr(await balanceOf(newFolio.id))}`);
  });

  // ===================== B · Suresh =====================================
  say("\n=== B · Suresh Kumar Sharma — 2 nights @ ₹2,500 + ₹600 kitchen ===");
  const surA = await prisma.reservation.findFirstOrThrow({
    where: { code: "BK-7SDVNJN0" },
    select: { id: true, propertyId: true, folio: { select: { id: true } }, property: { select: { state: true } }, allocations: { select: { room: { select: { number: true } } } } },
  });
  const surAFolio = surA.folio!.id;
  const surARows = await linesOf(surAFolio);
  say(`  origin BK-7SDVNJN0 (D-1/23) before: balance ${inr(await balanceOf(surAFolio))}`);
  // Staff had reversed BOTH nights. 14 Oct was genuinely stayed here — restore it.
  const surASeen = surARows.map((l) => ({ type: l.type, businessDate: l.businessDate, revision: l.revision }));
  const night14 = utc("2026-10-14");
  if (activeLines(surARows).some((l) => l.type === "ROOM" && dateKey(l.businessDate) === "2026-10-14")) {
    say("    (14 Oct already billed — nothing to restore)");
  } else {
    const rev = nextRoomRevision(surASeen as never, night14);
    inserts.push(roomNightData(surAFolio, surA.property.state, 250_000, night14, rev, `Room ${surA.allocations[0]?.room.number ?? ""} · night`.trim()));
    say(`    + post    2026-10-14 ROOM ${inr(250_000)} (rev ${rev}) — night actually stayed at D-1/23`);
  }

  const surB = await prisma.reservation.findFirstOrThrow({
    where: { code: "BK-9AF7GP2X" },
    select: { id: true, folio: { select: { id: true } }, property: { select: { state: true } } },
  });
  const surBFolio = surB.folio!.id;
  const surBRows = await linesOf(surBFolio);
  say(`  continuation BK-9AF7GP2X (D-1/30) before: balance ${inr(await balanceOf(surBFolio))}`);
  // Guest left 16 Oct → only the 15 Oct night belongs here.
  inserts.push(...repriceOrDrop(
    surBFolio, surB.property.state, surBRows,
    (l) => dateKey(l.businessDate) >= "2026-10-16",
    "guest checked out 16 Oct — night not stayed", null, () => "",
  ));

  // ===================== C · Ankit ======================================
  say("\n=== C · Ankit Bansal — 3 nights @ ₹2,100 + ₹600 food ===");
  const ankA = await prisma.reservation.findFirstOrThrow({
    where: { code: "BK-7SJDEVBJ" },
    select: { id: true, folio: { select: { id: true } }, property: { select: { state: true } } },
  });
  const ankAFolio = ankA.folio!.id;
  const ankARows = await linesOf(ankAFolio);
  say(`  origin BK-7SJDEVBJ (D-1/30) before: balance ${inr(await balanceOf(ankAFolio))}`);
  // Transferred out on 15 Oct, so 15 Oct belongs to the continuation only.
  inserts.push(...repriceOrDrop(
    ankAFolio, ankA.property.state, ankARows,
    (l) => dateKey(l.businessDate) >= "2026-10-15",
    "transferred to another property — night billed on the continuation", null, () => "",
  ));

  const ankB = await prisma.reservation.findFirstOrThrow({
    where: { code: "BK-99OFFBL7" },
    select: { id: true, folio: { select: { id: true } }, property: { select: { state: true } }, allocations: { select: { room: { select: { number: true } } } } },
  });
  const ankBFolio = ankB.folio!.id;
  const ankBRows = await linesOf(ankBFolio);
  say(`  continuation BK-99OFFBL7 (D-1/23) before: balance ${inr(await balanceOf(ankBFolio))}`);
  const ankRoom = ankB.allocations[0]?.room.number ?? "";
  inserts.push(...repriceOrDrop(
    ankBFolio, ankB.property.state, ankBRows, () => true,
    "rate corrected to the agreed ₹2,100/night", 210_000,
    () => `Room ${ankRoom} · night`.trim(),
  ));
  afterwards.push(async () => {
    await prisma.reservation.update({ where: { id: ankB.id }, data: { ratePaise: 210_000 } });
  });

  // ===================== apply ==========================================
  say(`\n${inserts.length} folio line(s) to append; ${afterwards.length} reservation update step(s).`);
  if (!APPLY) {
    say("DRY RUN — set CONFIRM=YES to apply.");
    return;
  }

  await runWithSystemContext(mun.property.orgId, async () => {
    await prisma.$transaction(async (tx) => {
      for (const data of inserts) await tx.folioLine.create({ data });
    });
    for (const step of afterwards) await step();
  });

  console.log("\n=== AFTER ===");
  for (const code of ["BK-U2BB2TP9", "BK-7SDVNJN0", "BK-9AF7GP2X", "BK-7SJDEVBJ", "BK-99OFFBL7"]) {
    const r = await prisma.reservation.findFirst({ where: { code }, select: { code: true, status: true, nights: true, ratePaise: true, folio: { select: { id: true } } } });
    if (r?.folio) console.log(`  ${r.code} [${r.status}] ${r.nights}n @${inr(r.ratePaise)} → balance ${inr(await balanceOf(r.folio.id))}`);
  }
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
