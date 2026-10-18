/**
 * Re-date the legacy AGGREGATE room lines onto the nights they actually cover.
 *
 * The old `correctRoomRate` could not re-post a corrected night on its own date
 * (the room-night unique index counted reversed lines), so it folded the whole
 * stay into ONE ROOM line with quantity = n and parked it on the first business
 * date that had no room line — in practice the property's then-current business
 * date, which for the go-live import was 21 Jul 2026. The money is right; the
 * DATES are not, and every businessDate-keyed metric reads them: a September
 * stay's room revenue landed in July, so those nights showed ₹0 revenue at full
 * occupancy (ADR/RevPAR ≈ 0) while 21 Jul showed revenue with no occupancy.
 *
 * This reverses each aggregate and re-posts one line PER NIGHT on the stay's
 * nights that currently have no active room line. Append-only throughout.
 *
 * Totals are preserved EXACTLY, to the paisa: n × unitPaise must equal the
 * aggregate's amount, and any GST rounding difference between n per-night
 * computations and the single aggregate computation is absorbed by the last
 * night. So no folio balance, invoice or payment reconciliation moves — only the
 * dates the revenue is reported on.
 *
 * A line whose quantity does NOT equal the number of uncovered nights is NOT a
 * re-dating problem (the amount itself is in question), so it is reported and
 * skipped rather than guessed at.
 *
 *   npx tsx scripts/split-aggregate-room-lines.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/split-aggregate-room-lines.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { nextRoomRevision, dateKey } from "../src/features/billing/domain/reversal";
import { computeGst } from "../src/features/billing/domain/gst";
import { roomGstBps } from "../src/lib/constants/gst";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

async function main() {
  const aggregates = await prisma.folioLine.findMany({
    where: { type: "ROOM", quantity: { gt: 1 } },
    select: {
      id: true, folioId: true, description: true, quantity: true, unitPaise: true, amountPaise: true,
      taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true,
      placeOfSupplyState: true, businessDate: true, revision: true,
      folio: {
        select: {
          propertyId: true,
          reservation: { select: { code: true, checkInDate: true, checkOutDate: true, guest: { select: { fullName: true } } } },
        },
      },
    },
    orderBy: { businessDate: "asc" },
  });
  const reversed = new Set(
    (await prisma.folioLine.findMany({ where: { reversalOfId: { in: aggregates.map((l) => l.id) } }, select: { reversalOfId: true } }))
      .map((l) => l.reversalOfId),
  );
  // `Folio` carries only `propertyId` (no relation — owning-module boundary), so
  // the property rows are read separately.
  const props = new Map(
    (await prisma.property.findMany({
      where: { id: { in: [...new Set(aggregates.map((l) => l.folio.propertyId))] } },
      select: { id: true, orgId: true, state: true },
    })).map((p) => [p.id, p]),
  );

  const writes: { orgId: string; reversal: Prisma.FolioLineUncheckedCreateInput; nights: Prisma.FolioLineUncheckedCreateInput[] }[] = [];
  const skipped: string[] = [];

  for (const l of aggregates) {
    if (reversed.has(l.id)) continue;
    const r = l.folio.reservation;
    const prop = props.get(l.folio.propertyId);
    const label = `${r?.code ?? "(no reservation)"} ${r?.guest.fullName ?? ""}`.trim();
    if (!r) { skipped.push(`${label}: no reservation on the folio`); continue; }
    if (!prop) { skipped.push(`${label}: property ${l.folio.propertyId} not found`); continue; }

    // Which of the stay's nights currently carry NO active per-night room line?
    const all = await prisma.folioLine.findMany({
      where: { folioId: l.folioId },
      select: { id: true, type: true, businessDate: true, quantity: true, revision: true, reversalOfId: true },
    });
    const revd = new Set(all.filter((x) => x.reversalOfId).map((x) => x.reversalOfId));
    const covered = new Set(
      all.filter((x) => x.type === "ROOM" && !revd.has(x.id) && x.quantity === 1).map((x) => dateKey(x.businessDate)),
    );
    const target: Date[] = [];
    for (let t = r.checkInDate.getTime(); t < r.checkOutDate.getTime(); t += 86_400_000) {
      const d = new Date(t);
      if (!covered.has(dateKey(d))) target.push(d);
    }

    if (target.length !== l.quantity) {
      skipped.push(
        `${label}: aggregate covers ${l.quantity} night(s) but ${target.length} night(s) of the stay ` +
        `(${dateKey(r.checkInDate)}→${dateKey(r.checkOutDate)}) lack a per-night line — amount itself needs a decision, not re-dating`,
      );
      continue;
    }
    if (BigInt(l.unitPaise) * BigInt(l.quantity) !== l.amountPaise) {
      skipped.push(`${label}: ${l.quantity} × ${inr(l.unitPaise)} ≠ ${inr(l.amountPaise)} — amount needs a decision`);
      continue;
    }

    const state = l.placeOfSupplyState ?? prop.state;
    const bps = l.taxRateBps || roomGstBps(l.unitPaise);
    const per = computeGst(l.unitPaise, bps, prop.state, state);

    // Absorb the GST rounding difference (n per-night computations vs the one
    // aggregate computation) on the LAST night, so the folio total cannot move.
    const drift = {
      cgstPaise: l.cgstPaise - per.cgstPaise * l.quantity,
      sgstPaise: l.sgstPaise - per.sgstPaise * l.quantity,
      igstPaise: l.igstPaise - per.igstPaise * l.quantity,
    };

    const seen = all.map((x) => ({ type: x.type, businessDate: x.businessDate, revision: x.revision }));
    const baseDesc = (l.description || "Room").split(" · ")[0] || "Room";
    const nights: Prisma.FolioLineUncheckedCreateInput[] = target.map((d, i) => {
      const last = i === target.length - 1;
      const rev = nextRoomRevision(seen as never, d);
      seen.push({ type: "ROOM", businessDate: d, revision: rev });
      return {
        folioId: l.folioId, type: "ROOM", description: `${baseDesc} · night`, quantity: 1,
        unitPaise: l.unitPaise, amountPaise: BigInt(l.unitPaise), taxRateBps: bps,
        cgstPaise: per.cgstPaise + (last ? drift.cgstPaise : 0),
        sgstPaise: per.sgstPaise + (last ? drift.sgstPaise : 0),
        igstPaise: per.igstPaise + (last ? drift.igstPaise : 0),
        hsnSac: l.hsnSac ?? "996311", placeOfSupplyState: state,
        businessDate: d, revision: rev,
      };
    });

    writes.push({
      orgId: prop.orgId,
      reversal: {
        folioId: l.folioId, type: "REVERSAL",
        description: `Reversal: ${l.description} (re-dated to the actual nights)`,
        quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
        cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
        hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
        businessDate: new Date(), reversalOfId: l.id,
      },
      nights,
    });

    console.log(`${label}`);
    console.log(`  ${dateKey(l.businessDate)}: ${l.quantity} × ${inr(l.unitPaise)} = ${inr(l.amountPaise)} (+gst ${inr(l.cgstPaise + l.sgstPaise + l.igstPaise)})`);
    console.log(`  → ${target.map(dateKey).join(", ")}`);
    const gstSum = nights.reduce((n, x) => n + Number(x.cgstPaise) + Number(x.sgstPaise) + Number(x.igstPaise), 0);
    const baseSum = nights.reduce((n, x) => n + Number(x.amountPaise), 0);
    console.log(`  totals preserved: base ${inr(baseSum)} === ${inr(l.amountPaise)} · gst ${inr(gstSum)} === ${inr(l.cgstPaise + l.sgstPaise + l.igstPaise)}`);
    if (baseSum !== Number(l.amountPaise) || gstSum !== l.cgstPaise + l.sgstPaise + l.igstPaise) {
      throw new Error(`total drift on ${label} — refusing to continue`);
    }
    console.log("");
  }

  if (skipped.length > 0) {
    console.log("SKIPPED — need a human decision:");
    for (const s of skipped) console.log(`  · ${s}`);
    console.log("");
  }
  console.log(`${writes.length} aggregate line(s) to re-date into ${writes.reduce((n, w) => n + w.nights.length, 0)} per-night line(s).`);
  if (!APPLY) { console.log("DRY RUN — set CONFIRM=YES to apply."); return; }

  for (const w of writes) {
    await runWithSystemContext(w.orgId, async () => {
      await prisma.$transaction(async (tx) => {
        await tx.folioLine.create({ data: w.reversal });
        for (const n of w.nights) await tx.folioLine.create({ data: n });
      });
    });
  }
  console.log("Applied.");
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
