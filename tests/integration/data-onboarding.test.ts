/**
 * 26 data-onboarding integration — T-7..T-19. The crux guarantees: dry-run
 * writes NO targets, all creation flows through 04/03/06 (no foreign INSERTs),
 * commit is idempotent, rollback soft-voids only what it created, master-data is
 * never auto-created, PII (Aadhaar) is masked, and non-admins are denied.
 *
 * Auth mocked at the boundary (as in reservations.test.ts); everything else is
 * real against the test DB. Guests/reservations/folio-lines are append-only /
 * hard to delete, so each flow uses RUN-UNIQUE mobiles + refs; afterAll deletes
 * only this module's ImportBatch/ImportRow and resets ROOMS-A.
 */
import { vi } from "vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import { keyedHash } from "@/lib/crypto/encryption";
import type { SessionClaims } from "@/lib/auth/claims";

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!authMock.current) throw new Error("no test user set");
    return authMock.current;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import {
  ORG_ID,
  PROP_A_ID,
  USER_ADMIN_ID,
  USER_HOUSEKEEPING_ID,
} from "../../prisma/seed/fixtures";
import { resetRoomsA } from "../../prisma/seed/01-property";
import { assembleClaims } from "@/lib/auth/claims";
import { createGuest } from "@/features/guests/actions";
import { createBatch, validateBatch, commitBatch, rollbackBatch } from "@/features/data-onboarding/actions";
import { downloadErrors, getBatchRows } from "@/features/data-onboarding/queries";
import { runImportValidateJob } from "@/features/data-onboarding/job";

const prisma = createPrismaClient();
const batchIds: string[] = [];

// RUN-unique mobile factory: 10 digits, first digit 9 (valid Indian mobile).
const RUN = Date.now() % 100_000_000;
const mob = (i: number) => "9" + String((RUN + i) % 1_000_000_000).padStart(9, "0");
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

async function actAs(userId: string): Promise<SessionClaims> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
  return claims;
}

/** Create a GUESTS batch from rows and return its id. */
async function uploadGuests(rows: string[][], propertyId?: string): Promise<string> {
  const header = "Full name,Mobile,Email,City,State,Company,GSTIN,Aadhaar";
  const csv = [header, ...rows.map((r) => r.join(","))].join("\r\n") + "\r\n";
  const res = await createBatch({ kind: "GUESTS", fileName: "g.csv", fileBase64: b64(csv), propertyId });
  if (!res.ok) throw new Error(res.error.message);
  batchIds.push(res.data.batchId);
  return res.data.batchId;
}

beforeAll(async () => { await actAs(USER_ADMIN_ID); });
afterAll(async () => {
  await prisma.importRow.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.importBatch.deleteMany({ where: { id: { in: batchIds } } });
  await resetRoomsA(prisma);
  await prisma.$disconnect();
});

describe("createBatch + validate dry-run (T-7/T-8, AC-2/4/5)", () => {
  it("creates a DRAFT batch with rows, then validates WITHOUT writing any Guest", async () => {
    await actAs(USER_ADMIN_ID);
    const mobiles = [mob(1), mob(2), mob(3)];
    const batchId = await uploadGuests([
      ["Asha Rao", mobiles[0]!, "a@x.com", "Bengaluru", "KA", "", "", ""],
      ["Vikram Nair", mobiles[1]!, "v@x.com", "Kochi", "KL", "", "", ""],
      ["Priya Shah", mobiles[2]!, "p@x.com", "Mumbai", "MH", "", "", ""],
    ]);

    const draft = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(draft.status).toBe("DRAFT");
    expect(draft.rowCount).toBe(3);
    expect(await prisma.importRow.count({ where: { batchId } })).toBe(3);

    const res = await validateBatch({ batchId });
    expect(res.ok && !res.data.queued && res.data.okCount).toBe(3);

    const after = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(after.status).toBe("VALIDATED");

    // The crux: dry-run wrote NO Guest rows.
    const hashes = mobiles.map((m) => keyedHash(m));
    expect(await prisma.guest.count({ where: { orgId: ORG_ID, mobileHash: { in: hashes } } })).toBe(0);
  });

  it("flags within-file + missing-mobile rows (AC-4/5) and lists only errors (T-9/AC-6)", async () => {
    await actAs(USER_ADMIN_ID);
    const m = mob(10);
    const batchId = await uploadGuests([
      ["Dup A", m, "", "", "", "", "", ""],
      ["No Mobile", "", "", "", "", "", "", ""],
      ["Dup B", m, "", "", "", "", "", ""],
    ]);
    const res = await validateBatch({ batchId });
    expect(res.ok && !res.data.queued).toBe(true);
    if (res.ok && !res.data.queued) {
      expect(res.data.okCount).toBe(1);
      expect(res.data.errorCount).toBe(1);
      expect(res.data.duplicateCount).toBe(1);
    }
    const errFile = await downloadErrors(authMock.current!, batchId);
    expect(errFile.content).toMatch(/row,reason/);
    expect(errFile.content.split("\r\n").filter((l) => /^\d+,/.test(l))).toHaveLength(1);
  });
});

describe("commit GUESTS via 04 + idempotency (T-10/T-14, AC-7/11)", () => {
  it("commits via createGuest, stamps targetId, emits ImportCommitted; re-import creates 0", async () => {
    await actAs(USER_ADMIN_ID);
    const mobiles = [mob(20), mob(21), mob(22)];
    const rows = mobiles.map((mm, i) => [`Guest ${i}`, mm, "", "", "", "", "", ""]);

    const first = await uploadGuests(rows);
    await validateBatch({ batchId: first });
    const commit = await commitBatch({ batchId: first });
    expect(commit.ok && !commit.data.queued && commit.data.created).toBe(3);

    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: first } });
    expect(batch.status).toBe("COMMITTED");

    const committedRows = await prisma.importRow.findMany({ where: { batchId: first, status: "OK" } });
    expect(committedRows.every((r) => r.targetType === "Guest" && r.targetId)).toBe(true);

    const hashes = mobiles.map((mm) => keyedHash(mm));
    expect(await prisma.guest.count({ where: { orgId: ORG_ID, mobileHash: { in: hashes } } })).toBe(3);

    const event = await prisma.domainEvent.findFirst({ where: { type: "ImportCommitted", aggregateId: first } });
    expect(event).not.toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { action: "data:import-commit", entityId: first } });
    expect(audit).not.toBeNull();

    // Re-import the SAME file → idempotent: 0 created, all skipped (AC-11).
    const second = await uploadGuests(rows);
    const v2 = await validateBatch({ batchId: second });
    expect(v2.ok && !v2.data.queued && v2.data.duplicateCount).toBe(3);
    const c2 = await commitBatch({ batchId: second });
    expect(c2.ok && !c2.data.queued && c2.data.created).toBe(0);
  });
});

describe("commit guard (T-11, AC-8)", () => {
  it("rejects a DRAFT (never validated) batch", async () => {
    await actAs(USER_ADMIN_ID);
    const batchId = await uploadGuests([["X", mob(30), "", "", "", "", "", ""]]);
    const res = await commitBatch({ batchId });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("CONFLICT");
  });

  it("rejects a VALIDATED batch that still has ERROR rows", async () => {
    await actAs(USER_ADMIN_ID);
    const batchId = await uploadGuests([
      ["Ok", mob(31), "", "", "", "", "", ""],
      ["No Mobile", "", "", "", "", "", "", ""],
    ]);
    await validateBatch({ batchId });
    const res = await commitBatch({ batchId });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("CONFLICT");
  });
});

describe("RESERVATIONS commit via 03 (T-12/T-16, AC-9/13)", () => {
  it("creates a historical CHECKED_OUT stay; unmatched guest → GUEST_UNMATCHED; bad category → UNKNOWN_MASTER_DATA", async () => {
    await actAs(USER_ADMIN_ID);
    const guestMobile = mob(40);
    const created = await createGuest({ fullName: "Stay Guest", mobile: guestMobile });
    expect(created.ok).toBe(true);

    const header = "Guest mobile,Check-in (YYYY-MM-DD),Check-out (YYYY-MM-DD),Source,Room category,Room no,Amount (₹),External booking id";
    const good = [guestMobile, "2024-11-01", "2024-11-03", "DIRECT", "Deluxe", "", "8000", `LEGACY-${RUN}-A`];
    const unmatched = [mob(41), "2024-11-01", "2024-11-03", "DIRECT", "Deluxe", "", "8000", `LEGACY-${RUN}-B`];
    const badCat = [guestMobile, "2024-11-05", "2024-11-06", "DIRECT", "Nonexistent", "", "8000", `LEGACY-${RUN}-C`];
    const csv = [header, good.join(","), unmatched.join(","), badCat.join(",")].join("\r\n") + "\r\n";

    const res = await createBatch({ kind: "RESERVATIONS", fileName: "r.csv", fileBase64: b64(csv), propertyId: PROP_A_ID });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    batchIds.push(res.data.batchId);

    const v = await validateBatch({ batchId: res.data.batchId });
    expect(v.ok && !v.data.queued && v.data.okCount).toBe(1);
    if (v.ok && !v.data.queued) expect(v.data.errorCount).toBe(2); // unmatched + bad category

    const rows = await getBatchRows(authMock.current!, res.data.batchId);
    expect(rows.find((r) => r.rowNum === 2)?.reason).toMatch(/guest/i); // GUEST_UNMATCHED
    expect(rows.find((r) => r.rowNum === 3)?.reason).toMatch(/category/i); // UNKNOWN_MASTER_DATA

    // Commit is guarded (AC-8): a batch with un-resolved ERROR rows is rejected —
    // the workflow is fix-the-file + re-upload a clean batch, not partial commit.
    const rejected = await commitBatch({ batchId: res.data.batchId });
    expect(rejected.ok).toBe(false);

    // Re-upload a CLEAN file (just the good row) and commit it.
    const cleanCsv = [header, good.join(",")].join("\r\n") + "\r\n";
    const clean = await createBatch({ kind: "RESERVATIONS", fileName: "r2.csv", fileBase64: b64(cleanCsv), propertyId: PROP_A_ID });
    expect(clean.ok).toBe(true);
    if (!clean.ok) return;
    batchIds.push(clean.data.batchId);
    const cv = await validateBatch({ batchId: clean.data.batchId });
    expect(cv.ok && !cv.data.queued && cv.data.errorCount).toBe(0);

    const commit = await commitBatch({ batchId: clean.data.batchId });
    expect(commit.ok && !commit.data.queued && commit.data.created).toBe(1);

    const reservation = await prisma.reservation.findFirst({
      where: { propertyId: PROP_A_ID, channelRef: `RESERVATIONS:ref:LEGACY-${RUN}-A` },
      select: { status: true, guestId: true },
    });
    expect(reservation?.status).toBe("CHECKED_OUT");
    expect(reservation?.guestId).toBe(created.ok ? created.data.id : "");
  });
});

describe("BALANCES commit via 06 (T-13, AC-10)", () => {
  it("posts an opening-balance folio line for the matched guest", async () => {
    await actAs(USER_ADMIN_ID);
    const guestMobile = mob(50);
    const g = await createGuest({ fullName: "Balance Guest", mobile: guestMobile });
    expect(g.ok).toBe(true);

    const csv = ["Guest mobile,Outstanding amount (₹)", `${guestMobile},1500`].join("\r\n") + "\r\n";
    const res = await createBatch({ kind: "BALANCES", fileName: "b.csv", fileBase64: b64(csv), propertyId: PROP_A_ID });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    batchIds.push(res.data.batchId);

    await validateBatch({ batchId: res.data.batchId });
    const commit = await commitBatch({ batchId: res.data.batchId });
    expect(commit.ok && !commit.data.queued && commit.data.created).toBe(1);

    const row = await prisma.importRow.findFirstOrThrow({ where: { batchId: res.data.batchId, status: "OK" } });
    expect(row.targetType).toBe("FolioLine");
    const line = await prisma.folioLine.findUniqueOrThrow({ where: { id: row.targetId! } });
    expect(Number(line.amountPaise)).toBe(150_000); // ₹1,500 opening principal reconciles
  });
});

describe("rollback (T-15, AC-12)", () => {
  it("committed GUESTS batch → soft-voids created guests via targetId; ImportRolledBack emitted", async () => {
    await actAs(USER_ADMIN_ID);
    const mobile = mob(60);
    const batchId = await uploadGuests([["Rollback Guest", mobile, "", "", "", "", "", ""]]);
    await validateBatch({ batchId });
    await commitBatch({ batchId });
    const row = await prisma.importRow.findFirstOrThrow({ where: { batchId, status: "OK" } });
    const guestId = row.targetId!;

    const rb = await rollbackBatch({ batchId, reason: "test rollback" });
    expect(rb.ok && rb.data.voided).toBe(1);

    const guest = await prisma.guest.findUniqueOrThrow({ where: { id: guestId } });
    expect(guest.deletedAt).not.toBeNull(); // soft-voided via 04.eraseGuest
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("ROLLED_BACK");
    const ev = await prisma.domainEvent.findFirst({ where: { type: "ImportRolledBack", aggregateId: batchId } });
    expect(ev).not.toBeNull();
  });

  it("uncommitted batch → discarded (batch + rows removed)", async () => {
    await actAs(USER_ADMIN_ID);
    const res = await createBatch({ kind: "GUESTS", fileName: "d.csv", fileBase64: b64("Full name,Mobile\nX," + mob(61) + "\n") });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const rb = await rollbackBatch({ batchId: res.data.batchId, reason: "discard" });
    expect(rb.ok && rb.data.discarded).toBe(true);
    expect(await prisma.importBatch.findUnique({ where: { id: res.data.batchId } })).toBeNull();
    expect(await prisma.importRow.count({ where: { batchId: res.data.batchId } })).toBe(0);
  });
});

describe("PII masking + RBAC + large-file job (T-17/T-18/T-19, AC-14/3/15)", () => {
  it("masks Aadhaar in the stored raw row — the full value never lands in the DB", async () => {
    await actAs(USER_ADMIN_ID);
    const batchId = await uploadGuests([["Aadhaar Guest", mob(70), "", "", "", "", "", "1111 2222 3333"]]);
    const row = await prisma.importRow.findFirstOrThrow({ where: { batchId } });
    const raw = row.raw as Record<string, string>;
    expect(raw.aadhaar).toBe("XXXX-XXXX-3333");
  });

  it("denies a non-admin (Housekeeping, no data:import) with FORBIDDEN", async () => {
    await actAs(USER_HOUSEKEEPING_ID);
    const res = await createBatch({ kind: "GUESTS", fileName: "x.csv", fileBase64: b64("Full name,Mobile\nX,9800000000\n") });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
    await actAs(USER_ADMIN_ID);
  });

  it("large-file pg-boss job runner validates headlessly with progress + completion", async () => {
    await actAs(USER_ADMIN_ID);
    const batchId = await uploadGuests([
      ["Job A", mob(80), "", "", "", "", "", ""],
      ["Job B", mob(81), "", "", "", "", "", ""],
    ]);
    // The job rebuilds claims from the batch creator — no HTTP session needed.
    await runImportValidateJob(prisma, { batchId, userId: USER_ADMIN_ID });
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("VALIDATED");
    expect(batch.okCount).toBe(2);
  });
});
