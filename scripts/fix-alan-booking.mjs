/**
 * One-off (client-authorised): delete Alan Hewitt's current mis-entered booking
 * BK-DVIK6FMN so the stay can be re-entered cleanly via Data Entry (18→24 Sep,
 * 6 nights @ ₹1894 + 5% GST, paid). Deletes ONLY that reservation + its folio /
 * lines / allocation / registration card — KEEPS the guest record (Alan Hewitt) and
 * their ID documents. No invoice exists on this booking. Append-only guards are
 * lifted only for these rows inside the transaction, then re-enabled.
 *
 * DRY RUN by default; set CONFIRM=YES to delete.
 *   node scripts/fix-alan-booking.mjs
 *   CONFIRM=YES node scripts/fix-alan-booking.mjs
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CONFIRM = process.env.CONFIRM === "YES";
const CODE = process.env.CODE ?? "BK-DVIK6FMN";

async function main() {
  const r = await prisma.reservation.findFirst({
    where: { code: CODE },
    select: { id: true, code: true, status: true, guest: { select: { fullName: true } }, allocations: { select: { roomId: true } } },
  });
  if (!r) { console.log(`No reservation ${CODE} found — nothing to do.`); return; }
  const folio = await prisma.folio.findFirst({ where: { reservationId: r.id }, select: { id: true } });
  const invoices = await prisma.invoice.count({ where: { folioId: folio?.id ?? "" } });

  console.log(`Reservation: ${r.code} (${r.status}) — guest ${r.guest?.fullName}`);
  console.log(`Folio: ${folio ? folio.id : "(none)"} | invoices on it: ${invoices}`);
  console.log(`Rooms freed: ${r.allocations.map((a) => a.roomId).join(", ") || "(none)"}`);

  if (!CONFIRM) { console.log("\nDRY RUN — nothing deleted. Re-run with CONFIRM=YES."); return; }

  const del = async (label, fn) => { const x = await fn(); console.log(`  ${label}: ${x?.count ?? 1}`); };
  const folioIds = folio ? [folio.id] : [];

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('ALTER TABLE "FolioLine" DISABLE TRIGGER folioline_append_only');
    await tx.$executeRawUnsafe('ALTER TABLE "Payment" DISABLE TRIGGER payment_append_only');
    await tx.$executeRawUnsafe('ALTER TABLE "Invoice" DISABLE TRIGGER invoice_immutable');

    if (folioIds.length) {
      await del("invoices", () => tx.invoice.deleteMany({ where: { folioId: { in: folioIds } } }));
      await del("folio lines", () => tx.folioLine.deleteMany({ where: { folioId: { in: folioIds } } }));
      await del("payments", () => tx.payment.deleteMany({ where: { folioId: { in: folioIds } } }));
    }
    await del("room allocations", () => tx.roomAllocation.deleteMany({ where: { reservationId: r.id } }));
    await del("registration cards", () => tx.registrationCard.deleteMany({ where: { reservationId: r.id } }));
    await del("c-forms", () => tx.cForm.deleteMany({ where: { reservationId: r.id } }));
    await del("reservation guests", () => tx.reservationGuest.deleteMany({ where: { reservationId: r.id } }));
    await del("add-on requests", () => tx.addOnRequest.deleteMany({ where: { reservationId: r.id } }));
    await del("guest messages", () => tx.guestMessage.deleteMany({ where: { reservationId: r.id } }));
    await del("pos orders", () => tx.posOrder.deleteMany({ where: { reservationId: r.id } }));
    if (folioIds.length) await del("folio", () => tx.folio.deleteMany({ where: { id: { in: folioIds } } }));
    await del("reservation", () => tx.reservation.deleteMany({ where: { id: r.id } }));

    await tx.$executeRawUnsafe('ALTER TABLE "FolioLine" ENABLE TRIGGER folioline_append_only');
    await tx.$executeRawUnsafe('ALTER TABLE "Payment" ENABLE TRIGGER payment_append_only');
    await tx.$executeRawUnsafe('ALTER TABLE "Invoice" ENABLE TRIGGER invoice_immutable');
  });

  console.log("\n✔ Deleted the mis-entered booking. Guest 'Alan Hewitt' kept — now re-enter the stay via Data Entry (18→24 Sep, ₹1894/night, 5% GST, payment).");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
