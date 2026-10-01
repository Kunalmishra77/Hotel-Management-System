/**
 * Rollback for correct-gst-to-5.mjs — restores the exact rows from a backup JSON
 * (folio lines, invoices incl. pdfObjectKey, snapshots) to undo the 5% correction.
 *
 *   BACKUP_FILE=./_gst-backup-<ts>.json node scripts/restore-gst-backup.mjs        # dry run
 *   CONFIRM=YES BACKUP_FILE=./_gst-backup-<ts>.json node scripts/restore-gst-backup.mjs
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();
const CONFIRM = process.env.CONFIRM === "YES";
const FILE = process.env.BACKUP_FILE;
if (!FILE) { console.error("Set BACKUP_FILE=path to the backup JSON."); process.exit(1); }

const b = JSON.parse(readFileSync(FILE, "utf8"));
console.log(`Backup from ${b.at}: ${b.folioLines.length} lines, ${b.invoices.length} invoices, ${b.snapshots.length} snapshots.`);
if (!CONFIRM) { console.log("DRY RUN — re-run with CONFIRM=YES to restore."); await prisma.$disconnect(); process.exit(0); }

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('ALTER TABLE "FolioLine" DISABLE TRIGGER folioline_append_only');
    await tx.$executeRawUnsafe('ALTER TABLE "Invoice" DISABLE TRIGGER invoice_immutable');
    try {
      for (const l of b.folioLines) {
        await tx.folioLine.update({ where: { id: l.id }, data: { amountPaise: l.amountPaise, unitPaise: l.unitPaise, cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise, taxRateBps: l.taxRateBps } });
      }
      for (const i of b.invoices) {
        await tx.invoice.update({ where: { id: i.id }, data: { taxableValuePaise: i.taxableValuePaise, cgstPaise: i.cgstPaise, sgstPaise: i.sgstPaise, igstPaise: i.igstPaise, pdfObjectKey: i.pdfObjectKey } });
      }
      for (const s of b.snapshots) {
        await tx.dailyStatSnapshot.update({ where: { id: s.id }, data: { roomRevenuePaise: s.roomRevenuePaise, totalRevenuePaise: s.totalRevenuePaise, adrPaise: s.adrPaise, revparPaise: s.revparPaise } });
      }
    } finally {
      await tx.$executeRawUnsafe('ALTER TABLE "FolioLine" ENABLE TRIGGER folioline_append_only');
      await tx.$executeRawUnsafe('ALTER TABLE "Invoice" ENABLE TRIGGER invoice_immutable');
    }
  }, { timeout: 120000 });
  console.log("RESTORED ✓ — rows put back to their pre-correction values.");
} finally {
  await prisma.$disconnect();
}
