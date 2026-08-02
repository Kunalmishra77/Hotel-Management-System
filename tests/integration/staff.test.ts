/**
 * 09 staff integration — T-6..T-11 (FR-1..10, AC-1..11). Auth mocked at the
 * boundary; PII discipline + attendance rules verified against the real DB.
 */
import { vi } from "vitest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => { if (!authMock.current) throw new Error("no user"); return authMock.current; } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { PROP_A_ID, USER_MANAGER_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { createStaff, recordAttendance, deactivateStaff } from "@/features/staff/actions";
import { listStaff, getStaffForPayroll, attendanceSummary } from "@/features/staff/queries";

const prisma = createPrismaClient();
const createdStaff: string[] = [];

async function actAs(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  authMock.current = c;
  return c;
}
function track(r: { ok: boolean; data?: { id: string } }) { if (r.ok && r.data) createdStaff.push(r.data.id); }

const anu = (o: Record<string, unknown> = {}) => ({
  propertyId: PROP_A_ID, name: "Anu K", mobile: "9800000009", department: "Housekeeping",
  monthlySalaryPaise: 3_100_000, joinedOn: "2025-01-01", aadhaar: "1234 5678 9012", pan: "ABCDE1234F",
  bankAccount: "111122223333", bankIfsc: "HDFC0001", ...o,
});

beforeEach(() => { authMock.current = null; });
afterEach(async () => {
  if (createdStaff.length) {
    await prisma.attendance.deleteMany({ where: { staffId: { in: createdStaff } } });
    await prisma.staff.deleteMany({ where: { id: { in: createdStaff } } });
    createdStaff.length = 0;
  }
});
afterAll(async () => { await prisma.$disconnect(); });

describe("createStaff (T-6, FR-1/2/8, AC-1/2/3/4)", () => {
  it("stores Aadhaar/PAN MASKED, bank ENCRYPTED; emits + audits (AC-1)", async () => {
    await actAs(USER_MANAGER_ID);
    const res = await createStaff(anu());
    track(res);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = await prisma.staff.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(s.aadhaarMasked).toBe("XXXX XXXX 9012");
    expect(s.panMasked).toBe("XXXXXX234F");
    expect(s.bankAccount).not.toBe("111122223333"); // encrypted
    expect(s.bankAccount?.startsWith("v1.")).toBe(true);
    expect(await prisma.domainEvent.findFirst({ where: { type: "StaffCreated", aggregateId: res.data.id } })).not.toBeNull();
  });

  it("rejects salary ≤ 0 (AC-2)", async () => {
    await actAs(USER_MANAGER_ID);
    const res = await createStaff(anu({ monthlySalaryPaise: 0 }));
    track(res);
    expect(res.ok).toBe(false);
  });

  it("denies Reception (no staff:manage) → FORBIDDEN (AC-3)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createStaff(anu());
    track(res);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });

  it("masks contact + IDs in the list, never returns the bank (AC-4)", async () => {
    await actAs(USER_MANAGER_ID);
    const res = await createStaff(anu());
    track(res);
    const claims = await actAs(USER_MANAGER_ID);
    const list = await listStaff(claims, PROP_A_ID);
    const row = list.find((s) => s.id === (res.ok ? res.data.id : ""));
    expect(row?.aadhaarMasked).toBe("XXXX XXXX 9012");
    expect(row?.maskedMobile).toBe("XXXXXX0009");
    expect(JSON.stringify(list)).not.toContain("111122223333"); // bank never surfaced
  });
});

describe("recordAttendance (T-7, FR-3/4/5, AC-5/6/7/8)", () => {
  async function makeStaff() {
    await actAs(USER_MANAGER_ID);
    const res = await createStaff(anu());
    track(res);
    if (!res.ok) throw new Error("staff create failed");
    return res.data.id;
  }

  it("computes worked minutes = 510 for 09:00→17:30 (AC-5)", async () => {
    const staffId = await makeStaff();
    const res = await recordAttendance({ staffId, day: "2026-07-12", checkInAt: "2026-07-12T09:00:00+05:30", checkOutAt: "2026-07-12T17:30:00+05:30" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.workedMinutes).toBe(510);
  });

  it("rejects check-out before check-in (AC-6)", async () => {
    const staffId = await makeStaff();
    const res = await recordAttendance({ staffId, day: "2026-07-12", checkInAt: "2026-07-12T09:00:00+05:30", checkOutAt: "2026-07-12T08:00:00+05:30" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("records leave with no worked minutes; OT persists on another day (AC-7)", async () => {
    const staffId = await makeStaff();
    const leave = await recordAttendance({ staffId, day: "2026-07-12", isLeave: true, leaveType: "SICK" });
    expect(leave.ok).toBe(true);
    if (leave.ok) expect(leave.data.workedMinutes).toBeNull();
    const ot = await recordAttendance({ staffId, day: "2026-07-13", checkInAt: "2026-07-13T09:00:00+05:30", checkOutAt: "2026-07-13T17:30:00+05:30", overtimeMinutes: 90 });
    expect(ot.ok).toBe(true);
    const row = await prisma.attendance.findFirstOrThrow({ where: { staffId, day: new Date("2026-07-13") } });
    expect(row.overtimeMinutes).toBe(90);
  });

  it("rejects a second row for the same day (AC-8)", async () => {
    const staffId = await makeStaff();
    await recordAttendance({ staffId, day: "2026-07-12", isLeave: true });
    const dup = await recordAttendance({ staffId, day: "2026-07-12", isLeave: true });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("ATTENDANCE_DUPLICATE");
  });
});

describe("payroll feed + lifecycle (T-8/T-9, FR-6/9/10, AC-9/10/11)", () => {
  it("returns raw per-day attendance with NO PII for payroll (AC-11)", async () => {
    await actAs(USER_MANAGER_ID);
    const res = await createStaff(anu());
    track(res);
    if (!res.ok) throw new Error("create failed");
    await recordAttendance({ staffId: res.data.id, day: "2026-07-12", checkInAt: "2026-07-12T09:00:00+05:30", checkOutAt: "2026-07-12T17:30:00+05:30" });

    const claims = await actAs(USER_MANAGER_ID);
    const feed = await getStaffForPayroll(claims, PROP_A_ID, "2026-07");
    const anuFeed = feed.find((s) => s.id === res.data.id);
    expect(anuFeed).toBeDefined();
    expect(anuFeed!.monthlySalaryPaise).toBe(3_100_000);
    expect(anuFeed!.attendance.length).toBe(1);
    expect(anuFeed!.attendance[0]!.workedMinutes).toBe(510);
    expect(JSON.stringify(anuFeed)).not.toContain("XXXX XXXX 9012"); // no masked-id either
    expect(JSON.stringify(anuFeed)).not.toContain("v1."); // no encrypted bank

    const summary = await attendanceSummary(claims, PROP_A_ID, "2026-07");
    expect(summary.find((s) => s.staffId === res.data.id)?.summary.workedDays).toBe(1);
  });

  it("excludes a staff member who left before the month, keeps history (AC-10)", async () => {
    await actAs(USER_MANAGER_ID);
    const res = await createStaff(anu());
    track(res);
    if (!res.ok) throw new Error("create failed");
    await recordAttendance({ staffId: res.data.id, day: "2026-06-15", checkInAt: "2026-06-15T09:00:00+05:30", checkOutAt: "2026-06-15T17:30:00+05:30" });
    await deactivateStaff({ staffId: res.data.id, leftOn: "2026-06-30" });

    const claims = await actAs(USER_MANAGER_ID);
    const july = await getStaffForPayroll(claims, PROP_A_ID, "2026-07");
    expect(july.find((s) => s.id === res.data.id)).toBeUndefined(); // left before July

    const june = await getStaffForPayroll(claims, PROP_A_ID, "2026-06");
    expect(june.find((s) => s.id === res.data.id)).toBeDefined(); // worked in June — history kept
  });
});
