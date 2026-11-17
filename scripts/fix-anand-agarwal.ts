/**
 * Anand Agarwal, BK-J8TZLK6M (HKD17) — 16 Nov night on MakeMyTrip at ₹2,552
 * incl. GST (GF-1); 17 Nov night direct at an offer of ₹2,400 incl. GST (GF-3,
 * the room he moved to). Saved the other way round: booking = Direct, extension
 * = MakeMyTrip, and both nights re-priced to ₹2,552.
 * Fix with the app's own actions (as the owner): booking source → MakeMyTrip,
 * the 17 Nov extension → Direct, and the 17 Nov night → ₹2,400 incl. GST.
 * Rooms are already right (GF-1 16→17, GF-3 17→18).
 *
 *   npx tsx --require ./scripts/lib/as-user-hook.cjs scripts/fix-anand-agarwal.ts             (dry-run)
 *   CONFIRM=YES npx tsx --require ./scripts/lib/as-user-hook.cjs scripts/fix-anand-agarwal.ts (apply)
 */
import { PrismaClient } from "@prisma/client";
import { assembleClaims } from "../src/lib/auth/claims";
import { folioBalance, activeLines } from "../src/features/billing";
import { changeBookingSource, setRoomRate } from "../src/features/reservations/move-actions";
import { changeExtensionSource } from "../src/features/reservations/extension-actions";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

async function show(id: string) {
  const r = await prisma.reservation.findUniqueOrThrow({
    where: { id },
    select: { source: true, extensions: { select: { fromDate: true, source: true } }, folio: { select: { lines: true, payments: true } } },
  });
  const nights = activeLines(r.folio!.lines).filter((l) => l.type === "ROOM")
    .map((l) => `${l.businessDate.toISOString().slice(5, 10)} ${inr(Number(l.amountPaise) + l.cgstPaise + l.sgstPaise)}`);
  console.log(`  booking ${r.source} · extensions ${r.extensions.map((e) => `${e.fromDate.toISOString().slice(5, 10)}=${e.source}`).join(", ")}`);
  console.log(`  nights ${nights.join(" | ")} · balance ${inr(folioBalance(r.folio!.lines, r.folio!.payments))}`);
}

async function main() {
  const r = await prisma.reservation.findFirstOrThrow({ where: { code: "BK-J8TZLK6M" }, select: { id: true, status: true, guest: { select: { fullName: true } } } });
  if (!r.guest.fullName.toLowerCase().includes("anand")) throw new Error("unexpected guest");
  console.log(`${r.guest.fullName} · ${r.status} — before:`);
  await show(r.id);
  console.log("  plan: booking → MAKEMYTRIP · extension 17 Nov → DIRECT · 17 Nov night → ₹2,400 incl. GST");
  if (!APPLY) { console.log("\nDRY RUN — nothing written."); return; }

  const owner = await prisma.user.findFirstOrThrow({ where: { email: "woodpecker.sunil@gmail.com" }, select: { id: true } });
  const claims = await assembleClaims(prisma, owner.id);
  (globalThis as { __SCRIPT_CLAIMS?: unknown }).__SCRIPT_CLAIMS = { ...claims, activePropertyId: null };

  const a = await changeBookingSource({ reservationId: r.id, source: "MAKEMYTRIP" });
  console.log("  source:", a.ok ? "ok" : a.error.message);
  const b = await changeExtensionSource({ reservationId: r.id, fromDate: "2026-11-17", source: "DIRECT" });
  console.log("  extension:", b.ok ? "ok" : b.error.message);
  const c = await setRoomRate({ reservationId: r.id, newRatePaise: 240_000, gstMode: "inclusive", fromNight: "2026-11-17", toNight: "2026-11-18" }); // toNight is exclusive
  console.log("  rate:", c.ok ? "ok" : c.error.message);
  console.log("after:");
  await show(r.id);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
