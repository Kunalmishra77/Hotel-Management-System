/**
 * 21 payroll integration — T-8..T-17 (FR-1..17, AC-1/6/7/8/9/10/11/12/14/15/17).
 * Canonical write path against a real Postgres; auth mocked at the boundary.
 *
 * A per-run-unique far-future month keeps the `@@unique([propertyId, month,
 * sequence])` key collision-free across suite runs (same trick as reports.test).
 * Staff/attendance/advances are seeded by this file and cleaned up afterwards
 * (payroll rows are not append-only — reports.test deletes them too).
 */
import { vi, afterAll, beforeAll, describe, expect, it } from "vitest";

const h = vi.hoisted(() => ({ claims: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => h.claims }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createPrismaClient } from "@/lib/db/client";
import { assembleClaims } from "@/lib/auth/claims";
import type { SessionClaims } from "@/lib/auth/claims";
import { PROP_A_ID, USER_ACCOUNTS_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { generateRun, adjustLine, finalizeRun, generateAdjustmentRun } from "@/features/payroll/actions";
import { getRun } from "@/features/payroll/queries";
import { getFinalizedStaffCost } from "@/features/payroll";
import { getStaffForPayroll } from "@/features/staff/queries";

const prisma = createPrismaClient();

const SLOT = Math.floor(Date.now() / 60_000) % 10_800;
const YEAR = 2100 + Math.floor(SLOT / 12);
const MON = (SLOT % 12) + 1;
const YM = `${YEAR}-${String(MON).padStart(2, "0")}`;
const D = (dd: number) => new Date(Date.UTC(YEAR, MON - 1, dd));
const SALARY = 3_100_000;

const ID = (s: string) => `pr_test_${SLOT}_${s}`;
const ANU = ID("anu");
const LATE = ID("late");
const EX = ID("ex");
const ADV = ID("adv");

let acc: SessionClaims;
let rec: SessionClaims;

async function claims(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error(`no claims for ${userId}`);
  return c;
}

beforeAll(async () => {
  acc = await claims(USER_ACCOUNTS_ID);
  rec = await claims(USER_RECEPTION_A_ID);

  await prisma.staff.create({ data: { id: ANU, propertyId: PROP_A_ID, name: "Anu K", mobile: "9800100001", department: "Front Office", monthlySalaryPaise: SALARY, joinedOn: new Date(Date.UTC(2025, 0, 1)), isActive: true } });
  await prisma.staff.create({ data: { id: LATE, propertyId: PROP_A_ID, name: "Late J", mobile: "9800100002", department: "Housekeeping", monthlySalaryPaise: SALARY, joinedOn: D(16), isActive: true } });
  await prisma.staff.create({ data: { id: EX, propertyId: PROP_A_ID, name: "Ex E", mobile: "9800100003", department: "Kitchen", monthlySalaryPaise: SALARY, joinedOn: new Date(Date.UTC(2024, 0, 1)), leftOn: new Date(Date.UTC(YEAR, MON - 2, 15)), isActive: false, deletedAt: new Date(Date.UTC(YEAR, MON - 2, 15)) } });

  for (const [dd, lt, ot] of [[5, "UNPAID", 0], [6, "UNPAID", 0], [7, "SICK", 0], [10, "NONE", 300], [11, "NONE", 300]] as const) {
    await prisma.attendance.create({ data: { staffId: ANU, day: D(dd), leaveType: lt, isLeave: lt !== "NONE", overtimeMinutes: ot, workedMinutes: lt === "NONE" ? 480 : null } });
  }
  await prisma.staffAdvance.create({ data: { id: ADV, staffId: ANU, amountPaise: 4_000_000, recoveredPaise: 0 } });
});

afterAll(async () => {
  // Delete ALL lines of this month's runs (the run can also carry lines for the
  // seed's PROP_A staff, which would FK-block the run delete), then the runs.
  const runs = await prisma.payrollRun.findMany({ where: { propertyId: PROP_A_ID, month: YM }, select: { id: true } });
  await prisma.payrollLine.deleteMany({ where: { runId: { in: runs.map((r) => r.id) } } });
  await prisma.payrollRun.deleteMany({ where: { propertyId: PROP_A_ID, month: YM } });
  await prisma.attendance.deleteMany({ where: { staffId: { in: [ANU, LATE, EX] } } });
  await prisma.staffAdvance.deleteMany({ where: { staffId: { in: [ANU, LATE, EX] } } });
  await prisma.staff.deleteMany({ where: { id: { in: [ANU, LATE, EX] } } });
  await prisma.$disconnect();
});

describe("generateRun (T-8, FR-1/2/10/11, AC-1/10)", () => {
  it("creates one DRAFT regular run, excludes S-EX, emits PayrollRunGenerated; idempotent", async () => {
    h.claims = acc;
    const res = await generateRun({ propertyId: PROP_A_ID, month: YM });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.sequence).toBe(1);
    // The property carries other active staff (seed fixtures), so assert on THIS
    // test's staff rather than an exact property-wide line count.
    expect(res.data.lineCount).toBeGreaterThanOrEqual(2);

    const run = await prisma.payrollRun.findFirst({ where: { propertyId: PROP_A_ID, month: YM, sequence: 1 }, select: { id: true, status: true, runType: true, lines: { select: { staffId: true, netPaise: true } } } });
    expect(run?.status).toBe("DRAFT");
    expect(run?.runType).toBe("REGULAR");
    const lineIds = run?.lines.map((l) => l.staffId) ?? [];
    expect(lineIds).toEqual(expect.arrayContaining([ANU, LATE])); // both active → included
    expect(lineIds).not.toContain(EX); // inactive/left → excluded (AC-1)
    const anuLine = run?.lines.find((l) => l.staffId === ANU);
    expect(anuLine?.netPaise).toBe(0); // earnings < ₹40,000 advance → floored to 0

    const evt = await prisma.domainEvent.findFirst({ where: { type: "PayrollRunGenerated", aggregateId: run!.id } });
    expect(evt).not.toBeNull();

    // Idempotent: a second regular generate returns the same run, no duplicate.
    const again = await generateRun({ propertyId: PROP_A_ID, month: YM });
    expect(again.ok).toBe(true);
    const count = await prisma.payrollRun.count({ where: { propertyId: PROP_A_ID, month: YM, sequence: 1 } });
    expect(count).toBe(1);
  });
});

describe("reads via 09 getStaffForPayroll (T-16, FR-17, AC-17)", () => {
  it("the sanctioned feed is the source; S-EX (deleted) is not returned", async () => {
    const staff = await getStaffForPayroll(acc, PROP_A_ID, YM);
    const ids = staff.map((s) => s.id);
    expect(ids).toContain(ANU);
    expect(ids).toContain(LATE);
    expect(ids).not.toContain(EX);
  });
});

describe("adjustLine (T-9/T-10, FR-6/13, AC-6/7)", () => {
  it("re-derives net, and override without a reason is rejected but accepted with one", async () => {
    h.claims = acc;
    const run = await prisma.payrollRun.findFirst({ where: { propertyId: PROP_A_ID, month: YM, sequence: 1 }, select: { id: true } });
    const line = await prisma.payrollLine.findFirst({ where: { runId: run!.id, staffId: ANU }, select: { id: true, basePaise: true, overtimePaise: true } });

    const adj = await adjustLine({ lineId: line!.id, bonusPaise: 200_000, deductionPaise: 50_000, advancePaise: 100_000 });
    expect(adj.ok).toBe(true);
    const expected = line!.basePaise + 200_000 + line!.overtimePaise - 50_000 - 100_000;
    const after = await prisma.payrollLine.findUnique({ where: { id: line!.id }, select: { netPaise: true, advancePaise: true } });
    expect(after?.netPaise).toBe(expected);
    expect(after?.advancePaise).toBe(100_000);

    const evt = await prisma.domainEvent.findFirst({ where: { type: "PayrollLineAdjusted", aggregateId: line!.id } });
    expect(evt).not.toBeNull();

    // FR-13: overriding a derived component needs a reason.
    const noReason = await adjustLine({ lineId: line!.id, overrideBasePaise: line!.basePaise + 1 });
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.error.code).toBe("REASON_REQUIRED");

    const withReason = await adjustLine({ lineId: line!.id, overrideBasePaise: line!.basePaise + 1, reason: "corrected timesheet" });
    expect(withReason.ok).toBe(true);
    const overridden = await prisma.payrollLine.findUnique({ where: { id: line!.id }, select: { basePaise: true } });
    expect(overridden?.basePaise).toBe(line!.basePaise + 1);
  });
});

describe("RBAC (T-17, FR-14, AC-15)", () => {
  it("a role without payroll:run cannot generate", async () => {
    h.claims = rec;
    const res = await generateRun({ propertyId: PROP_A_ID, month: YM });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });

  it("PII/getRun is denied for an unauthorized viewer (AC-14)", async () => {
    const run = await prisma.payrollRun.findFirst({ where: { propertyId: PROP_A_ID, month: YM, sequence: 1 }, select: { id: true } });
    await expect(getRun(rec, run!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("finalizeRun + carry-forward (T-11/T-13/T-14, FR-7/12/15, AC-8/11/12)", () => {
  it("locks the run, emits PayrollFinalized, increments StaffAdvance, and getFinalizedStaffCost reflects it", async () => {
    h.claims = acc;
    const run = await prisma.payrollRun.findFirst({ where: { propertyId: PROP_A_ID, month: YM, sequence: 1 }, select: { id: true } });

    const fin = await finalizeRun({ runId: run!.id });
    expect(fin.ok).toBe(true);

    const finalized = await prisma.payrollRun.findUnique({ where: { id: run!.id }, select: { status: true, finalizedAt: true, finalizedById: true, netTotalPaise: true } });
    expect(finalized?.status).toBe("FINALIZED");
    expect(finalized?.finalizedById).toBe(USER_ACCOUNTS_ID);

    const evt = await prisma.domainEvent.findFirst({ where: { type: "PayrollFinalized", aggregateId: run!.id } });
    expect(evt).not.toBeNull();

    // AC-11: the canonical synchronous read matches the finalized net (no foreign SELECT).
    const cost = await getFinalizedStaffCost([PROP_A_ID], YM);
    expect(cost).toBe(Number(finalized!.netTotalPaise));

    // AC-12: advance recovered by exactly the line's advancePaise (carry-forward).
    const adv = await prisma.staffAdvance.findUnique({ where: { id: ADV }, select: { recoveredPaise: true } });
    expect(adv?.recoveredPaise).toBe(100_000);
  });
});

describe("immutability + corrections (T-12, FR-8/9/10, AC-9/10)", () => {
  it("a finalized run rejects edits (RUN_LOCKED) and re-generation (conflict); adjustment run at next sequence", async () => {
    h.claims = acc;
    const run = await prisma.payrollRun.findFirst({ where: { propertyId: PROP_A_ID, month: YM, sequence: 1 }, select: { id: true } });
    const line = await prisma.payrollLine.findFirst({ where: { runId: run!.id, staffId: LATE }, select: { id: true } });

    const locked = await adjustLine({ lineId: line!.id, bonusPaise: 1 });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error.code).toBe("RUN_LOCKED");

    const refinal = await finalizeRun({ runId: run!.id });
    expect(refinal.ok).toBe(false);
    if (!refinal.ok) expect(refinal.error.code).toBe("RUN_LOCKED");

    const regen = await generateRun({ propertyId: PROP_A_ID, month: YM });
    expect(regen.ok).toBe(false);
    if (!regen.ok) expect(regen.error.code).toBe("CONFLICT"); // RUN_EXISTS surrogate

    const adjRun = await generateAdjustmentRun({ propertyId: PROP_A_ID, month: YM });
    expect(adjRun.ok).toBe(true);
    if (adjRun.ok) {
      expect(adjRun.data.sequence).toBe(2);
      const row = await prisma.payrollRun.findUnique({ where: { id: adjRun.data.runId }, select: { runType: true } });
      expect(row?.runType).toBe("ADJUSTMENT");
    }
  });
});
