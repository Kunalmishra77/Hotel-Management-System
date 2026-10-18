/**
 * Rebuild the guest-history stats cache (`GuestStatsSnapshot`) from source.
 *
 * The snapshot behind every guest profile's Visits / Room-nights / Lifetime
 * spend / Outstanding / Last stay is a CACHE, refreshed by the `GuestStats`
 * event consumer when a booking or folio changes through the app. The Oct-2026
 * billing repairs wrote folio lines and reservation rows DIRECTLY, so no event
 * was raised and every touched guest's profile still shows pre-repair figures —
 * Muniama's, for instance, read 14 room-nights / ₹29,250 / ₹11,213 against an
 * actual 15 / ₹33,894 / ₹16,537.50.
 *
 * The dry run derives the fresh figures through the SAME pieces the recompute
 * uses (`guestBilling` + the pure `deriveStats`), so it is read-only without
 * becoming a second, divergent definition of them. Applying then calls
 * `recomputeGuestStats`, which is idempotent and derives from source again.
 *
 * NOTE on Outstanding: `guestBilling` sums only POSITIVE folio balances, so a
 * CREDIT on one folio does not offset a due on another. For a guest whose stay
 * was split across linked bookings (an OTA stay continuing direct, a transfer)
 * the profile shows the sum of the dues, not the journey's net — the combined
 * stay statement on the booking page is the number to settle on.
 *
 *   npx tsx scripts/reconcile-guest-stats.ts                      (dry-run, read-only)
 *   $env:CONFIRM="YES"; npx tsx scripts/reconcile-guest-stats.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { recomputeGuestStats } from "../src/features/guest-history/recompute";
import { deriveStats, type HistoryReservation } from "../src/features/guest-history/domain/derive";
import { guestBilling } from "../src/features/billing/queries";
import type { SessionClaims } from "../src/lib/auth/claims";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");

/**
 * Retry a step past a dropped connection. A managed pooler refuses a connection
 * now and then (P1001), and this sweep is hundreds of round-trips — without this
 * one blip abandons the run partway, leaving some profiles refreshed and others
 * stale. Every step here is idempotent, so retrying is always safe.
 */
async function withRetry<T>(what: string, fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const code = (e as { code?: string }).code;
      if (code !== "P1001" && code !== "P1017" && code !== "P2024") throw e;
      const waitMs = Math.min(30_000, 2_000 * 2 ** i);
      console.log(`    … ${what}: connection refused (${code}), retrying in ${waitMs / 1000}s`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

async function freshStats(orgId: string, guestId: string) {
  const rows = await prisma.reservation.findMany({
    where: { guestId, property: { orgId } },
    select: { status: true, nights: true, ratePaise: true, checkOutAt: true, checkInDate: true, allocations: { select: { room: { select: { categoryId: true } } }, take: 1 } },
  });
  const reservations: HistoryReservation[] = rows.map((r) => ({
    status: r.status, nights: r.nights, ratePaise: r.ratePaise,
    checkOutAt: r.checkOutAt, checkInDate: r.checkInDate,
    categoryId: r.allocations[0]?.room.categoryId ?? null,
  }));
  const billing = await guestBilling({ orgId } as SessionClaims, guestId);
  return deriveStats(reservations, { revenuePaise: billing.revenuePaise, outstandingPaise: billing.outstandingPaise });
}

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  let changed = 0;
  let total = 0;
  const failed: string[] = [];

  for (const org of orgs) {
    const guests = await prisma.guest.findMany({
      where: { orgId: org.id },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    });
    console.log(`${org.name}: ${guests.length} guest(s)\n`);

    for (const g of guests) {
      total += 1;
      const before = await withRetry(`${g.fullName} read`, () => prisma.guestStatsSnapshot.findUnique({ where: { guestId: g.id } }));
      const after = await withRetry(`${g.fullName} derive`, () => freshStats(org.id, g.id));

      const moved =
        !before ||
        before.visits !== after.visits ||
        before.totalRoomNights !== after.totalRoomNights ||
        Number(before.totalRevenuePaise) !== after.totalRevenuePaise ||
        Number(before.outstandingPaise) !== after.outstandingPaise ||
        day(before.lastStayAt) !== day(after.lastStayAt);

      if (moved) {
        changed += 1;
        console.log(`  ${g.fullName}`);
        if (!before) {
          console.log(`    (no snapshot) → visits ${after.visits} · nights ${after.totalRoomNights} · spend ${inr(after.totalRevenuePaise)} · outstanding ${inr(after.outstandingPaise)}`);
        } else {
          const f = (label: string, b: string, a: string) => { if (b !== a) console.log(`    ${label.padEnd(12)} ${b} → ${a}`); };
          f("visits", String(before.visits), String(after.visits));
          f("nights", String(before.totalRoomNights), String(after.totalRoomNights));
          f("spend", inr(before.totalRevenuePaise), inr(after.totalRevenuePaise));
          f("outstanding", inr(before.outstandingPaise), inr(after.outstandingPaise));
          f("last stay", day(before.lastStayAt), day(after.lastStayAt));
        }
      }

      if (APPLY) {
        try {
          await withRetry(`${g.fullName} write`, () => recomputeGuestStats(org.id, g.id));
        } catch (e) {
          failed.push(`${g.fullName}: ${(e as Error).message.split("\n")[0]}`);
        }
      }
    }
  }

  if (failed.length > 0) {
    console.log(`\n${failed.length} guest(s) could NOT be updated — re-run to finish (the recompute is idempotent):`);
    for (const f of failed) console.log(`  · ${f}`);
  }
  console.log(`\n${changed} of ${total} guest profile(s) ${APPLY ? "updated" : "would change"}${failed.length ? `, ${failed.length} failed` : ""}.`);
  if (!APPLY) console.log("DRY RUN — nothing written. Set CONFIRM=YES to apply.");
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
