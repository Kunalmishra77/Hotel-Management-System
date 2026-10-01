/**
 * One-time correction: fix historical bills entered at 12% (and one 18% line) to a
 * flat 5% GST, KEEPING EACH BILL'S TOTAL THE SAME (the tax split is re-cut inside the
 * unchanged total — client-authorised correction of a data-entry rate error).
 *
 * Touches, atomically (all-or-nothing) with the append-only guards lifted only for
 * the duration of the transaction:
 *   - FolioLine  : re-split amount/cgst/sgst so total is unchanged, rate → 5%.
 *   - Invoice    : re-split taxable/cgst/sgst (total unchanged); pdfObjectKey → null
 *                  so the PDF re-renders at 5% on next view.
 *   - DailyStatSnapshot : revenue rises by exactly the tax that moved into taxable,
 *                  so dashboards stay consistent with the corrected bills.
 *
 * SAFETY: always writes a full backup of the affected rows to a JSON file first.
 * Runs a DRY RUN (no writes) unless CONFIRM=YES. A companion restore script can put
 * the backed-up rows back if anything looks wrong.
 *
 *   node scripts/correct-gst-to-5.mjs            # backup + dry-run only
 *   CONFIRM=YES node scripts/correct-gst-to-5.mjs
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient();
const CONFIRM = process.env.CONFIRM === "YES";
const BACKUP = process.env.BACKUP_FILE || `./_gst-backup-${Date.now()}.json`;
const FIX_BPS = [1200, 1800]; // rates to correct → 500 (5%)

/** Keep `total` fixed; return the 5% split (taxable + cgst + sgst == total). */
function resplit5(total) {
  const sign = total < 0 ? -1 : 1;
  const a = Math.abs(total);
  for (let t = Math.round(a / 1.05) - 2; t <= Math.round(a / 1.05) + 2; t++) {
    const c = Math.round((t * 250) / 10000);
    if (t + 2 * c === a) return { taxable: sign * t, cgst: sign * c, sgst: sign * c };
  }
  const c = Math.round((Math.round(a / 1.05) * 250) / 10000);
  return { taxable: sign * (a - 2 * c), cgst: sign * c, sgst: sign * c };
}
const n = (v) => Number(v);

try {
  // ---- Gather affected rows ------------------------------------------------
  const lines = await prisma.folioLine.findMany({
    where: { taxRateBps: { in: FIX_BPS } },
    select: {
      id: true, folioId: true, type: true, quantity: true, unitPaise: true,
      amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true,
      businessDate: true, folio: { select: { propertyId: true } },
    },
  });
  const invoices = await prisma.invoice.findMany({
    select: { id: true, number: true, type: true, taxableValuePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, totalPaise: true, pdfObjectKey: true },
  });
  const invToFix = invoices.filter((inv) => {
    const taxable = n(inv.taxableValuePaise);
    const tax = n(inv.cgstPaise) + n(inv.sgstPaise) + n(inv.igstPaise);
    const bps = taxable ? Math.round((tax / taxable) * 10000) : 0;
    return bps > 550; // anything above ~5% needs correcting
  });
  const snapshots = await prisma.dailyStatSnapshot.findMany();

  // ---- Backup --------------------------------------------------------------
  writeFileSync(BACKUP, JSON.stringify({
    at: new Date().toISOString(),
    folioLines: lines.map((l) => ({ ...l, amountPaise: n(l.amountPaise) })),
    invoices: invToFix.map((i) => ({ ...i, taxableValuePaise: n(i.taxableValuePaise), totalPaise: n(i.totalPaise) })),
    snapshots: snapshots.map((s) => ({ id: s.id, roomRevenuePaise: n(s.roomRevenuePaise), totalRevenuePaise: n(s.totalRevenuePaise), adrPaise: s.adrPaise, revparPaise: s.revparPaise })),
  }, null, 2));
  console.log(`Backup written: ${BACKUP} (${lines.length} lines, ${invToFix.length} invoices, ${snapshots.length} snapshots)`);

  // ---- Compute line corrections + per-(property,date) revenue deltas --------
  const lineUpdates = [];
  const deltaByKey = new Map(); // `${propertyId}|${yyyy-mm-dd}` -> { room, total }
  for (const l of lines) {
    const total = n(l.amountPaise) + l.cgstPaise + l.sgstPaise + l.igstPaise;
    const r = resplit5(total);
    const unit = l.quantity ? Math.round(r.taxable / l.quantity) : r.taxable;
    lineUpdates.push({ id: l.id, amountPaise: r.taxable, unitPaise: unit, cgstPaise: r.cgst, sgstPaise: r.sgst, igstPaise: 0, taxRateBps: 500 });
    const key = `${l.folio.propertyId}|${l.businessDate.toISOString().slice(0, 10)}`;
    const d = deltaByKey.get(key) ?? { room: 0, total: 0 };
    const dRev = r.taxable - n(l.amountPaise); // revenue (ex-tax) increase
    d.total += dRev;
    if (l.type === "ROOM") d.room += dRev;
    deltaByKey.set(key, d);
  }

  const invUpdates = invToFix.map((inv) => {
    const total = n(inv.totalPaise);
    const r = resplit5(total);
    return { id: inv.id, number: inv.number, taxableValuePaise: r.taxable, cgstPaise: r.cgst, sgstPaise: r.sgst, igstPaise: 0 };
  });

  // Snapshot updates keyed by (property, businessDate)
  const snapByKey = new Map(snapshots.map((s) => [`${s.propertyId}|${s.businessDate.toISOString().slice(0, 10)}`, s]));
  const snapUpdates = [];
  for (const [key, d] of deltaByKey) {
    const s = snapByKey.get(key);
    if (!s) continue;
    const roomRev = n(s.roomRevenuePaise) + d.room;
    const totalRev = n(s.totalRevenuePaise) + d.total;
    snapUpdates.push({
      id: s.id,
      roomRevenuePaise: roomRev,
      totalRevenuePaise: totalRev,
      adrPaise: s.occupiedRoomNights > 0 ? Math.round(roomRev / s.occupiedRoomNights) : s.adrPaise,
      revparPaise: s.availableRoomNights > 0 ? Math.round(roomRev / s.availableRoomNights) : s.revparPaise,
    });
  }

  console.log(`Plan: ${lineUpdates.length} folio lines, ${invUpdates.length} invoices, ${snapUpdates.length} snapshots.`);
  console.log("Invoice samples (total unchanged):");
  for (const u of invUpdates.slice(0, 3)) {
    const old = invToFix.find((i) => i.id === u.id);
    console.log(`  ${u.number}: total ${n(old.totalPaise)} | taxable ${n(old.taxableValuePaise)}→${u.taxableValuePaise} | tax ${n(old.cgstPaise)+n(old.sgstPaise)+n(old.igstPaise)}→${u.cgstPaise+u.sgstPaise}`);
  }

  if (!CONFIRM) {
    console.log("\nDRY RUN — no changes written. Re-run with CONFIRM=YES to apply.");
    await prisma.$disconnect();
    process.exit(0);
  }

  // ---- Apply atomically ----------------------------------------------------
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('ALTER TABLE "FolioLine" DISABLE TRIGGER folioline_append_only');
    await tx.$executeRawUnsafe('ALTER TABLE "Invoice" DISABLE TRIGGER invoice_immutable');
    try {
      for (const u of lineUpdates) {
        await tx.folioLine.update({ where: { id: u.id }, data: { amountPaise: u.amountPaise, unitPaise: u.unitPaise, cgstPaise: u.cgstPaise, sgstPaise: u.sgstPaise, igstPaise: u.igstPaise, taxRateBps: u.taxRateBps } });
      }
      for (const u of invUpdates) {
        await tx.invoice.update({ where: { id: u.id }, data: { taxableValuePaise: u.taxableValuePaise, cgstPaise: u.cgstPaise, sgstPaise: u.sgstPaise, igstPaise: u.igstPaise, pdfObjectKey: null } });
      }
      for (const u of snapUpdates) {
        await tx.dailyStatSnapshot.update({ where: { id: u.id }, data: { roomRevenuePaise: u.roomRevenuePaise, totalRevenuePaise: u.totalRevenuePaise, adrPaise: u.adrPaise, revparPaise: u.revparPaise } });
      }
    } finally {
      await tx.$executeRawUnsafe('ALTER TABLE "FolioLine" ENABLE TRIGGER folioline_append_only');
      await tx.$executeRawUnsafe('ALTER TABLE "Invoice" ENABLE TRIGGER invoice_immutable');
    }
  }, { timeout: 120000 });

  console.log("APPLIED ✓ — bills, folios and snapshots corrected to 5%. Old PDFs will re-render at 5% on next view.");
} finally {
  await prisma.$disconnect();
}
