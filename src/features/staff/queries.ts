/**
 * Staff queries — 09 T-9/T-11 (FR-6/7/10, AC-4/9/11). Lists are MASKED (Aadhaar/
 * PAN shown masked, bank never returned). `getStaffForPayroll` is the read 21
 * consumes: salary + employment window + RAW per-day attendance, and NO PII.
 */
import { db } from "@/lib/db";
import { maskMobile } from "@/lib/crypto/encryption";
import { monthlySummary, type MonthlySummary } from "./domain/attendance";
import type { SessionClaims } from "@/lib/auth/claims";

export type StaffListItem = {
  id: string;
  name: string;
  department: string;
  maskedMobile: string | null;
  monthlySalaryPaise: number;
  aadhaarMasked: string | null;
  panMasked: string | null;
  isActive: boolean;
};

function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y!, m! - 1, 1)), end: new Date(Date.UTC(y!, m!, 0)) };
}

export async function listStaff(user: SessionClaims, propertyId: string): Promise<StaffListItem[]> {
  const rows = await db.scoped(user).staff.findMany({
    where: { propertyId, deletedAt: null },
    select: { id: true, name: true, department: true, mobile: true, monthlySalaryPaise: true, aadhaarMasked: true, panMasked: true, isActive: true },
    orderBy: { name: "asc" },
  });
  return rows.map((s) => ({
    id: s.id, name: s.name, department: s.department,
    maskedMobile: maskMobile(s.mobile), // never the raw number in a list (FR-7)
    monthlySalaryPaise: s.monthlySalaryPaise, aadhaarMasked: s.aadhaarMasked, panMasked: s.panMasked, isActive: s.isActive,
  }));
}

/**
 * Staff search — the 15-search federation shard for staff (15 FR-1/2). Keyword
 * matches `name`; property-scoped, cursor-paginated, MASKED (never raw mobile).
 */
export async function searchStaff(
  user: SessionClaims,
  input: { keyword?: string; propertyId?: string; cursor?: string; limit?: number },
): Promise<{ staff: StaffListItem[]; nextCursor: string | null }> {
  const limit = input.limit ?? 25;
  const kw = input.keyword?.trim();
  const rows = await db.scoped(user).staff.findMany({
    where: {
      deletedAt: null,
      ...(input.propertyId ? { propertyId: input.propertyId } : {}),
      ...(kw ? { name: { contains: kw, mode: "insensitive" } } : {}),
    },
    select: { id: true, name: true, department: true, mobile: true, monthlySalaryPaise: true, aadhaarMasked: true, panMasked: true, isActive: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    staff: page.map((s) => ({
      id: s.id, name: s.name, department: s.department,
      maskedMobile: maskMobile(s.mobile),
      monthlySalaryPaise: s.monthlySalaryPaise, aadhaarMasked: s.aadhaarMasked, panMasked: s.panMasked, isActive: s.isActive,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export type StaffWithAttendance = {
  id: string;
  name: string;
  monthlySalaryPaise: number;
  joinedOn: Date;
  leftOn: Date | null;
  isActive: boolean;
  attendance: { day: Date; isLeave: boolean; leaveType: string; workedMinutes: number | null; overtimeMinutes: number }[];
};

/**
 * The payroll feed (FR-10, AC-11). Every staff member whose employment window
 * overlaps the month, with raw per-day attendance so 21 derives paid/LOP/employed
 * days itself. No bank/Aadhaar/PAN in the payload.
 */
export async function getStaffForPayroll(
  user: SessionClaims,
  propertyId: string,
  month: string,
): Promise<StaffWithAttendance[]> {
  const { start, end } = monthBounds(month);
  const rows = await db.scoped(user).staff.findMany({
    where: {
      propertyId,
      deletedAt: null,
      joinedOn: { lte: end },
      OR: [{ leftOn: null }, { leftOn: { gte: start } }], // employed at some point in the month
    },
    select: {
      id: true, name: true, monthlySalaryPaise: true, joinedOn: true, leftOn: true, isActive: true,
      attendance: {
        where: { day: { gte: start, lte: end } },
        select: { day: true, isLeave: true, leaveType: true, workedMinutes: true, overtimeMinutes: true },
        orderBy: { day: "asc" },
      },
    },
  });
  return rows.map((s) => ({
    id: s.id, name: s.name, monthlySalaryPaise: s.monthlySalaryPaise, joinedOn: s.joinedOn, leftOn: s.leftOn, isActive: s.isActive,
    attendance: s.attendance.map((a) => ({ day: a.day, isLeave: a.isLeave, leaveType: a.leaveType, workedMinutes: a.workedMinutes, overtimeMinutes: a.overtimeMinutes })),
  }));
}

/** Per-staff monthly summary — headcount/cost context for 08/14 (FR-6, AC-9). */
export async function attendanceSummary(
  user: SessionClaims,
  propertyId: string,
  month: string,
): Promise<{ staffId: string; name: string; summary: MonthlySummary }[]> {
  const staff = await getStaffForPayroll(user, propertyId, month);
  return staff.map((s) => ({
    staffId: s.id,
    name: s.name,
    summary: monthlySummary(
      s.attendance.map((a) => ({ day: a.day, isLeave: a.isLeave, workedMinutes: a.workedMinutes, overtimeMinutes: a.overtimeMinutes })),
      month,
      { joinedOn: s.joinedOn, leftOn: s.leftOn },
    ),
  }));
}
