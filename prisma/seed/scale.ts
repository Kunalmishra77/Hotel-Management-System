/**
 * Scale seed — `npm run db:seed -- --scale` (seed-data.md).
 *
 * Generates 100k+ guests to validate FR-10's p95 < 500ms search budget (AC-10)
 * at target volume. Opt-in only — NOT part of the default seed, which stays
 * small and fast for the test suite.
 *
 * Written and runnable now; the actual 100k run against the managed DB is
 * deferred to a staging environment (see the 04 review's carried risk) — over a
 * laptop link it is slow and adds real load. The generation logic below is what
 * gets executed there.
 *
 * Uses the SAME encryption + token path as a real create, so the seeded rows
 * exercise the real search index rather than a cheaper shortcut that would make
 * the p95 number meaningless.
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import { encryptString, keyedHash } from "../../src/lib/crypto/encryption";
import { normalizeEmail, normalizePhone } from "../../src/features/guests/domain/normalize";
import { ORG_ID } from "./fixtures";

const FIRST = [
  "Ravi", "Anita", "Suresh", "Priya", "Imran", "Lakshmi", "Rohit", "Meena",
  "Arjun", "Kavya", "Vikram", "Nisha", "Sanjay", "Divya", "Rahul", "Pooja",
];
const LAST = [
  "Kumar", "Sharma", "Mehta", "Iyer", "Nair", "Reddy", "Shetty", "Khan",
  "Patel", "Gupta", "Rao", "Menon", "Desai", "Bose", "Chopra", "Verma",
];
const CITIES = ["Bengaluru", "Mumbai", "Delhi", "Chennai", "Pune", "Hyderabad"];

/** Deterministic PRNG (no Math.random — reproducible, and Date/random are banned in some contexts). */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export async function seedScale(prisma: PrismaClient, total = 100_000): Promise<void> {
  const rng = makeRng(42);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(rng() * arr.length)]!;

  const BATCH = 1_000;
  let created = 0;

  for (let start = 0; start < total; start += BATCH) {
    const rows: Prisma.GuestCreateManyInput[] = [];
    for (let i = start; i < Math.min(start + BATCH, total); i++) {
      const fullName = `${pick(FIRST)} ${pick(LAST)}`;
      // Unique, valid Indian mobiles: 9xxxxxxxxx derived from the index.
      const mobile = `9${String(700_000_000 + i).padStart(9, "0")}`.slice(0, 10);
      const email = `guest${i}@example.com`;

      rows.push({
        id: `scale_${i}`,
        orgId: ORG_ID,
        fullName,
        mobile: encryptString(mobile),
        mobileHash: keyedHash(normalizePhone(mobile) ?? mobile),
        email: encryptString(email),
        emailHash: keyedHash(normalizeEmail(email) ?? email),
        city: pick(CITIES),
        ...(i % 20 === 0 ? { companyName: `Company ${i % 500}`, gstNumber: null } : {}),
      });
    }

    await prisma.guest.createMany({ data: rows, skipDuplicates: true });
    created += rows.length;
    if (created % 10_000 === 0) console.log(`  …${created}/${total} scale guests`);
  }

  console.log(`  ✔ scale: ${created} guests`);
}
