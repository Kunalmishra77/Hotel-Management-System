"use server";

/**
 * Staff + attendance actions — 09 T-6/T-7/T-8 (FR-1..5/8/9, AC-1/2/3/5/6/7/8/10).
 * `staff:manage` (Admin/Manager). PII discipline: Aadhaar/PAN are stored MASKED,
 * the bank account is ENCRYPTED — the raw values never land on the row.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { encryptOptional } from "@/lib/crypto/encryption";
import { workedMinutes } from "./domain/attendance";
import { maskId } from "./domain/mask";
import { staffDb, withStaffContext, isUniqueViolation } from "./internal";
import { createStaffSchema, updateStaffSchema, recordAttendanceSchema, deactivateStaffSchema, updateStaffSalarySchema } from "./schema";

export type StaffResult = { id: string };

/** Create a staff record with masked IDs + encrypted bank (FR-1/2/8, AC-1/2). */
export async function createStaff(input: unknown): Promise<Result<StaffResult>> {
  return toResult(async () => {
    const data = createStaffSchema.parse(input);
    const user = await requireUser();
    authorize(user, "staff:manage", data.propertyId);

    return withStaffContext(user, () =>
      staffDb(user).$transaction(async (tx) => {
        const staff = await tx.staff.create({
          data: {
            propertyId: data.propertyId,
            name: data.name,
            mobile: data.mobile,
            department: data.department,
            monthlySalaryPaise: data.monthlySalaryPaise,
            joinedOn: data.joinedOn,
            address: data.address ?? null,
            aadhaarMasked: maskId("AADHAAR", data.aadhaar),
            panMasked: maskId("PAN", data.pan),
            bankAccount: encryptOptional(data.bankAccount ?? null),
            bankIfsc: data.bankIfsc ?? null,
          },
          select: { id: true },
        });
        await emitEvent(tx, { type: "StaffCreated", aggregateId: staff.id, propertyId: data.propertyId, payload: { department: data.department } });
        await writeAudit(tx, { action: "staff:create", entityType: "Staff", entityId: staff.id, propertyId: data.propertyId, after: { name: data.name, department: data.department } });
        return { id: staff.id };
      }),
    );
  });
}

/** Update a staff record (FR-1/2). Re-masks IDs / re-encrypts bank when provided. */
export async function updateStaff(input: unknown): Promise<Result<StaffResult>> {
  return toResult(async () => {
    const data = updateStaffSchema.parse(input);
    const user = await requireUser();
    const client = staffDb(user);
    const staff = await client.staff.findFirst({ where: { id: data.staffId }, select: { id: true, propertyId: true } });
    if (!staff) throw new NotFoundError("Staff not found.");
    authorize(user, "staff:manage", staff.propertyId);

    return withStaffContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.staff.updateMany({
          where: { id: data.staffId },
          data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.mobile !== undefined ? { mobile: data.mobile } : {}),
            ...(data.department !== undefined ? { department: data.department } : {}),
            ...(data.monthlySalaryPaise !== undefined ? { monthlySalaryPaise: data.monthlySalaryPaise } : {}),
            ...(data.address !== undefined ? { address: data.address } : {}),
            ...(data.aadhaar !== undefined ? { aadhaarMasked: maskId("AADHAAR", data.aadhaar) } : {}),
            ...(data.pan !== undefined ? { panMasked: maskId("PAN", data.pan) } : {}),
            ...(data.bankAccount !== undefined ? { bankAccount: encryptOptional(data.bankAccount) } : {}),
            ...(data.bankIfsc !== undefined ? { bankIfsc: data.bankIfsc } : {}),
          },
        });
        await emitEvent(tx, { type: "StaffUpdated", aggregateId: data.staffId, propertyId: staff.propertyId, payload: {} });
        await writeAudit(tx, { action: "staff:update", entityType: "Staff", entityId: data.staffId, propertyId: staff.propertyId, after: { fields: Object.keys(data).filter((k) => k !== "staffId") } });
        return { id: data.staffId };
      }),
    );
  });
}

/** Record one day's attendance (FR-3/4/5, AC-5/6/7/8). One row per (staff, day). */
export async function recordAttendance(input: unknown): Promise<Result<{ id: string; workedMinutes: number | null }>> {
  return toResult(async () => {
    const data = recordAttendanceSchema.parse(input);
    const user = await requireUser();
    const client = staffDb(user);
    const staff = await client.staff.findFirst({ where: { id: data.staffId }, select: { id: true, propertyId: true, isActive: true } });
    if (!staff) throw new NotFoundError("Staff not found.");
    // MoM: Reception logs attendance — a narrow permission, not full staff:manage.
    authorize(user, "attendance:record", staff.propertyId);
    if (!staff.isActive) throw new DomainError(ErrorCode.VALIDATION_FAILED, "Cannot record attendance for a deactivated staff member.");

    // Validate + compute. A check-out at/before check-in is invalid (AC-6).
    let minutes: number | null = null;
    if (!data.isLeave && data.checkInAt && data.checkOutAt) {
      if (data.checkOutAt <= data.checkInAt) throw new DomainError(ErrorCode.VALIDATION_FAILED, "Check-out must be after check-in.");
      minutes = workedMinutes(data.checkInAt, data.checkOutAt);
    }

    return withStaffContext(user, () =>
      client.$transaction(async (tx) => {
        let row;
        try {
          row = await tx.attendance.create({
            data: {
              staffId: data.staffId,
              day: data.day,
              checkInAt: data.isLeave ? null : (data.checkInAt ?? null),
              checkOutAt: data.isLeave ? null : (data.checkOutAt ?? null),
              workedMinutes: minutes,
              isLeave: data.isLeave,
              leaveType: data.leaveType,
              overtimeMinutes: data.overtimeMinutes,
            },
            select: { id: true },
          });
        } catch (e) {
          if (isUniqueViolation(e)) throw new DomainError(ErrorCode.ATTENDANCE_DUPLICATE); // AC-8
          throw e;
        }
        await emitEvent(tx, { type: "AttendanceRecorded", aggregateId: data.staffId, propertyId: staff.propertyId, payload: { day: data.day.toISOString().slice(0, 10), workedMinutes: minutes, isLeave: data.isLeave } });
        await writeAudit(tx, { action: "attendance:record", entityType: "Attendance", entityId: row.id, propertyId: staff.propertyId, after: { day: data.day.toISOString().slice(0, 10), workedMinutes: minutes, isLeave: data.isLeave } });
        return { id: row.id, workedMinutes: minutes };
      }),
    );
  });
}

/**
 * Update ONLY a staff member's monthly salary (MoM 2026-08-03 — reception logs
 * salary updates). A narrow, audited money action: `staff:salary-update`, NOT full
 * `staff:manage` — so reception can adjust salary without touching PII/bank/CRUD.
 */
export async function updateStaffSalary(input: unknown): Promise<Result<StaffResult>> {
  return toResult(async () => {
    const data = updateStaffSalarySchema.parse(input);
    const user = await requireUser();
    const client = staffDb(user);
    const staff = await client.staff.findFirst({ where: { id: data.staffId }, select: { id: true, propertyId: true, monthlySalaryPaise: true } });
    if (!staff) throw new NotFoundError("Staff not found.");
    authorize(user, "staff:salary-update", staff.propertyId);

    return withStaffContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.staff.updateMany({ where: { id: data.staffId }, data: { monthlySalaryPaise: data.monthlySalaryPaise } });
        await emitEvent(tx, { type: "StaffUpdated", aggregateId: data.staffId, propertyId: staff.propertyId, payload: { salaryUpdated: true } });
        await writeAudit(tx, {
          action: "staff:salary-update",
          entityType: "Staff",
          entityId: data.staffId,
          propertyId: staff.propertyId,
          before: { monthlySalaryPaise: staff.monthlySalaryPaise },
          after: { monthlySalaryPaise: data.monthlySalaryPaise },
        });
        return { id: data.staffId };
      }),
    );
  });
}

/** Deactivate a staff member (FR-9, AC-10): excluded from payroll, history kept. */
export async function deactivateStaff(input: unknown): Promise<Result<StaffResult>> {
  return toResult(async () => {
    const data = deactivateStaffSchema.parse(input);
    const user = await requireUser();
    const client = staffDb(user);
    const staff = await client.staff.findFirst({ where: { id: data.staffId }, select: { id: true, propertyId: true } });
    if (!staff) throw new NotFoundError("Staff not found.");
    authorize(user, "staff:manage", staff.propertyId);

    return withStaffContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.staff.updateMany({ where: { id: data.staffId }, data: { isActive: false, leftOn: data.leftOn ?? new Date() } });
        await emitEvent(tx, { type: "StaffUpdated", aggregateId: data.staffId, propertyId: staff.propertyId, payload: { deactivated: true } });
        await writeAudit(tx, { action: "staff:deactivate", entityType: "Staff", entityId: data.staffId, propertyId: staff.propertyId, after: { isActive: false } });
        return { id: data.staffId };
      }),
    );
  });
}
