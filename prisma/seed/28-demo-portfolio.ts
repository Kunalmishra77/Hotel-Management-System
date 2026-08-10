/**
 * Demo portfolio seed — makes the multi-property architecture real: 5 hotels, a
 * Manager per property, and 30 days of daily stat snapshots per property so every
 * occupancy/revenue/ADR/RevPAR figure (Super-Admin command centre, manager
 * overview, owner home, reports) shows live-looking numbers instead of zeros.
 *
 * Idempotent (fixed ids + upserts). Pure DB. Deterministic values (no RNG) so a
 * re-seed is stable. Runs on the shared DB via `npm run db:seed`.
 */
import type { PrismaClient } from "@prisma/client";
import { RoleName } from "@prisma/client";
import { hashPassword } from "../../src/lib/auth/password";
import { ORG_ID, PROP_A_ID, PROP_B_ID, DEV_PASSWORD } from "./fixtures";

// Three more properties so the org runs 5 hotels (A + B already exist).
const EXTRA = [
  { id: "prop_wir", code: "WIR", name: "Woodpecker Indiranagar", city: "Bengaluru", gstin: "29AABCW1234F3ZH", rooms: 32, mgr: { id: "user_mgr_wir", email: "manager.ir@woodpecker.example", name: "Kavya Reddy" } },
  { id: "prop_wko", code: "WKO", name: "Woodpecker Koramangala", city: "Bengaluru", gstin: "29AABCW1234F4ZG", rooms: 28, mgr: { id: "user_mgr_wko", email: "manager.ko@woodpecker.example", name: "Arjun Nair" } },
  { id: "prop_whs", code: "WHS", name: "Woodpecker HSR Layout", city: "Bengaluru", gstin: "29AABCW1234F5ZF", rooms: 24, mgr: { id: "user_mgr_whs", email: "manager.hs@woodpecker.example", name: "Sneha Pillai" } },
];

const day = (offsetDaysAgo: number, ref: Date): Date => {
  const dt = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  dt.setUTCDate(dt.getUTCDate() - offsetDaysAgo);
  return dt;
};

/** Deterministic occupancy 55–92% varying by day + property (no RNG). */
function occBps(dayIdx: number, propIdx: number): number {
  const base = 6800 + propIdx * 400;
  const wave = Math.round(1200 * Math.sin((dayIdx / 30) * Math.PI * 2 + propIdx));
  const weekend = dayIdx % 7 === 5 || dayIdx % 7 === 6 ? 900 : 0;
  return Math.max(4200, Math.min(9600, base + wave + weekend));
}

async function seedSnapshots(prisma: PrismaClient, propertyId: string, propIdx: number, rooms: number, adrBasePaise: number, ref: Date) {
  for (let i = 1; i <= 30; i++) {
    const businessDate = day(i, ref);
    const available = rooms;
    const occ = occBps(i, propIdx);
    const occupied = Math.round((available * occ) / 10000);
    const adrPaise = adrBasePaise + (i % 5) * 12_000 + propIdx * 30_000;
    const roomRevenue = BigInt(occupied * adrPaise);
    const totalRevenue = (roomRevenue * 128n) / 100n; // + F&B/other ~28%
    const expense = (totalRevenue * 42n) / 100n;
    const revpar = available > 0 ? Math.round(Number(roomRevenue) / available) : 0;
    const data = {
      availableRoomNights: available,
      occupiedRoomNights: occupied,
      roomRevenuePaise: roomRevenue,
      totalRevenuePaise: totalRevenue,
      expensePaise: expense,
      adrPaise,
      revparPaise: revpar,
      occupancyBps: occ,
    };
    await prisma.dailyStatSnapshot.upsert({
      where: { propertyId_businessDate: { propertyId, businessDate } },
      create: { propertyId, businessDate, ...data },
      update: data,
    });
  }
}

export async function seedDemoPortfolio(prisma: PrismaClient): Promise<void> {
  const ref = new Date(); // "today" — snapshots cover the prior 30 closed days
  const passwordHash = await hashPassword(DEV_PASSWORD);

  // Extra properties + their managers.
  for (const p of EXTRA) {
    await prisma.property.upsert({
      where: { id: p.id },
      create: {
        id: p.id, orgId: ORG_ID, name: p.name, code: p.code,
        addressLine1: `${p.code} Main Road`, city: p.city, state: "Karnataka", pincode: "560001",
        gstin: p.gstin, timezone: "Asia/Kolkata", managementFeeBps: 1500,
        currentBusinessDate: ref, nightAuditTime: "03:00",
      },
      update: { name: p.name, managementFeeBps: 1500 },
    });
    await prisma.user.upsert({
      where: { id: p.mgr.id },
      create: { id: p.mgr.id, orgId: ORG_ID, email: p.mgr.email, name: p.mgr.name, passwordHash, isActive: true },
      update: { passwordHash, isActive: true, name: p.mgr.name },
    });
    await prisma.roleAssignment.deleteMany({ where: { userId: p.mgr.id } });
    await prisma.roleAssignment.create({ data: { userId: p.mgr.id, role: RoleName.MANAGER, propertyIds: [p.id] } });
  }

  // Snapshots for all 5 properties (varied per property).
  await seedSnapshots(prisma, PROP_A_ID, 0, 40, 480_000, ref);
  await seedSnapshots(prisma, PROP_B_ID, 1, 36, 520_000, ref);
  await seedSnapshots(prisma, EXTRA[0]!.id, 2, EXTRA[0]!.rooms, 560_000, ref);
  await seedSnapshots(prisma, EXTRA[1]!.id, 3, EXTRA[1]!.rooms, 500_000, ref);
  await seedSnapshots(prisma, EXTRA[2]!.id, 4, EXTRA[2]!.rooms, 460_000, ref);
}
