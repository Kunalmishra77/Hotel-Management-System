"use server";

/**
 * Payroll actions — 21 T-8..T-12 (FR-1..15). Canonical write path:
 * zod.parse → requireUser → authorize("payroll:run", propertyId) → transaction →
 * emit event → audit → typed Result. Money in integer paise; all computation is
 * the pure `domain/` layer. `payroll:run` is 🔒 audited (rbac-matrix).
 *
 * Staff/Attendance are read ONLY via 09 `getStaffForPayroll` (FR-17). A finalized
 * run is immutable (RUN_LOCKED); corrections go through `generateAdjustmentRun`.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { ConflictError, DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { resolvePayrollConfig } from "@/lib/constants/payroll";
import { getStaffForPayroll, type StaffWithAttendance } from "@/features/staff/queries";
import { computeLine, isEligible, netPaise, type ComputedLine } from "./domain";
import { payrollDb, withPayrollContext } from "./internal";
import { generatePayslipsForRun } from "./finalize-payslips";
import {
  adjustLineSchema,
  finalizeRunSchema,
  generateAdjustmentRunSchema,
  generateRunSchema,
} from "./schema";

export type RunResult = { runId: string; status: string; sequence: number; lineCount: number; netTotalPaise: number };
export type LineResult = { lineId: string; netPaise: number };

/** Outstanding advance (paise) per staff = Σ max(0, amount − recovered). */
async function outstandingByStaff(
  client: ReturnType<typeof payrollDb>,
  staffIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (staffIds.length === 0) return out;
  const advances = await client.staffAdvance.findMany({
    where: { staffId: { in: staffIds } },
    select: { staffId: true, amountPaise: true, recoveredPaise: true },
  });
  for (const a of advances) {
    out.set(a.staffId, (out.get(a.staffId) ?? 0) + Math.max(0, a.amountPaise - a.recoveredPaise));
  }
  return out;
}

/** Pure: compute each eligible line (base/OT/net) — DB writes stay inline in the tx. */
function computeRunLines(
  month: string,
  staff: StaffWithAttendance[],
  outstanding: Map<string, number>,
): { staffId: string; c: ComputedLine }[] {
  const cfg = resolvePayrollConfig();
  return staff.map((s) => ({
    staffId: s.id,
    c: computeLine({
      month,
      monthlySalaryPaise: s.monthlySalaryPaise,
      joinedOn: s.joinedOn,
      leftOn: s.leftOn,
      attendance: s.attendance,
      cfg,
      advanceOutstandingPaise: outstanding.get(s.id) ?? 0,
    }),
  }));
}

/**
 * Generate the REGULAR run (sequence=1) for a property-month (FR-1/2/10, AC-1/10).
 * Idempotent: if a regular run already exists, return the DRAFT for review, or
 * reject (conflict) when it is FINALIZED (correct via an adjustment run).
 */
export async function generateRun(input: unknown): Promise<Result<RunResult>> {
  return toResult(async () => {
    const { propertyId, month } = generateRunSchema.parse(input);
    const user = await requireUser();
    authorize(user, "payroll:run", propertyId);

    const client = payrollDb(user);
    const all = await getStaffForPayroll(user, propertyId, month); // FR-17
    const staff = all.filter((s) => isEligible(s, month)); // FR-11
    const outstanding = await outstandingByStaff(client, staff.map((s) => s.id));
    const lines = computeRunLines(month, staff, outstanding);

    return withPayrollContext(user, () =>
      client.$transaction(async (tx) => {
        const existing = await tx.payrollRun.findFirst({
          where: { propertyId, month, sequence: 1 },
          select: { id: true, status: true, sequence: true, netTotalPaise: true, _count: { select: { lines: true } } },
        });
        if (existing) {
          if (existing.status === "FINALIZED") {
            throw new ConflictError("A finalized payroll run already exists for this month. Create an adjustment run to correct it.");
          }
          return { runId: existing.id, status: existing.status, sequence: existing.sequence, lineCount: existing._count.lines, netTotalPaise: Number(existing.netTotalPaise) };
        }

        const run = await tx.payrollRun.create({
          data: { propertyId, month, sequence: 1, runType: "REGULAR", status: "DRAFT", netTotalPaise: 0n },
          select: { id: true },
        });
        let total = 0n;
        for (const { staffId, c } of lines) {
          await tx.payrollLine.create({ data: { runId: run.id, staffId, basePaise: c.basePaise, overtimePaise: c.overtimePaise, bonusPaise: c.bonusPaise, deductionPaise: c.deductionPaise, advancePaise: c.advancePaise, netPaise: c.netPaise, paidDays: c.paidDays, lopDays: c.lopDays, otMinutes: c.otMinutes } });
          total += BigInt(c.netPaise);
        }
        await tx.payrollRun.updateMany({ where: { id: run.id }, data: { netTotalPaise: total } });

        await emitEvent(tx, { type: "PayrollRunGenerated", aggregateId: run.id, propertyId, payload: { month, sequence: 1, runType: "REGULAR", lineCount: lines.length, netTotalPaise: Number(total) } });
        await writeAudit(tx, { action: "payroll:run", entityType: "PayrollRun", entityId: run.id, propertyId, after: { month, sequence: 1, runType: "REGULAR", lineCount: lines.length, netTotalPaise: Number(total) } });
        return { runId: run.id, status: "DRAFT", sequence: 1, lineCount: lines.length, netTotalPaise: Number(total) };
      }),
    );
  });
}

/**
 * Generate an ADJUSTMENT run at the next sequence for an already-run month
 * (FR-8, AC-9). Corrections never edit a finalized run — they add a new,
 * separately-audited run permitted by the `(propertyId, month, sequence)` key.
 */
export async function generateAdjustmentRun(input: unknown): Promise<Result<RunResult>> {
  return toResult(async () => {
    const { propertyId, month } = generateAdjustmentRunSchema.parse(input);
    const user = await requireUser();
    authorize(user, "payroll:run", propertyId);

    const client = payrollDb(user);
    const all = await getStaffForPayroll(user, propertyId, month);
    const staff = all.filter((s) => isEligible(s, month));
    const outstanding = await outstandingByStaff(client, staff.map((s) => s.id));
    const lines = computeRunLines(month, staff, outstanding);

    return withPayrollContext(user, () =>
      client.$transaction(async (tx) => {
        const prior = await tx.payrollRun.aggregate({ where: { propertyId, month }, _max: { sequence: true } });
        const maxSeq = prior._max.sequence;
        if (!maxSeq) throw new ConflictError("No payroll run exists for this month yet. Generate the regular run first.");
        const sequence = maxSeq + 1;

        const run = await tx.payrollRun.create({
          data: { propertyId, month, sequence, runType: "ADJUSTMENT", status: "DRAFT", netTotalPaise: 0n },
          select: { id: true },
        });
        let total = 0n;
        for (const { staffId, c } of lines) {
          await tx.payrollLine.create({ data: { runId: run.id, staffId, basePaise: c.basePaise, overtimePaise: c.overtimePaise, bonusPaise: c.bonusPaise, deductionPaise: c.deductionPaise, advancePaise: c.advancePaise, netPaise: c.netPaise, paidDays: c.paidDays, lopDays: c.lopDays, otMinutes: c.otMinutes } });
          total += BigInt(c.netPaise);
        }
        await tx.payrollRun.updateMany({ where: { id: run.id }, data: { netTotalPaise: total } });

        await emitEvent(tx, { type: "PayrollRunGenerated", aggregateId: run.id, propertyId, payload: { month, sequence, runType: "ADJUSTMENT", lineCount: lines.length, netTotalPaise: Number(total) } });
        await writeAudit(tx, { action: "payroll:run", entityType: "PayrollRun", entityId: run.id, propertyId, after: { month, sequence, runType: "ADJUSTMENT", lineCount: lines.length, netTotalPaise: Number(total) } });
        return { runId: run.id, status: "DRAFT", sequence, lineCount: lines.length, netTotalPaise: Number(total) };
      }),
    );
  });
}

/**
 * Edit a DRAFT line (FR-6/13, AC-6/7): adjust bonus/deduction/advance-recovery
 * and re-derive net; overriding a derived component (base/OT) requires a reason
 * and writes an audited override. A finalized line rejects with RUN_LOCKED.
 */
export async function adjustLine(input: unknown): Promise<Result<LineResult>> {
  return toResult(async () => {
    const data = adjustLineSchema.parse(input);
    const user = await requireUser();
    const client = payrollDb(user);

    const line = await client.payrollLine.findFirst({
      where: { id: data.lineId },
      select: {
        id: true, staffId: true, basePaise: true, overtimePaise: true, bonusPaise: true,
        deductionPaise: true, advancePaise: true, netPaise: true,
        run: { select: { id: true, propertyId: true, status: true } },
      },
    });
    if (!line) throw new NotFoundError("Payroll line not found.");
    authorize(user, "payroll:run", line.run.propertyId);
    if (line.run.status === "FINALIZED") throw new DomainError(ErrorCode.RUN_LOCKED, "Run is finalized.");

    // FR-13: an override of a derived component away from its current value needs a reason.
    const overrodeBase = data.overrideBasePaise != null && data.overrideBasePaise !== line.basePaise;
    const overrodeOt = data.overrideOvertimePaise != null && data.overrideOvertimePaise !== line.overtimePaise;
    const overridden = overrodeBase || overrodeOt;
    if (overridden && !data.reason) {
      throw new DomainError(ErrorCode.REASON_REQUIRED, "A reason is required to override a computed amount.");
    }

    const base = data.overrideBasePaise ?? line.basePaise;
    const ot = data.overrideOvertimePaise ?? line.overtimePaise;
    const bonus = data.bonusPaise ?? line.bonusPaise;
    const deduction = data.deductionPaise ?? line.deductionPaise;

    // Cap advance recovery at the actual outstanding balance; then floor per FR-15.
    const outstanding = (await outstandingByStaff(client, [line.staffId])).get(line.staffId) ?? 0;
    const desired = data.advancePaise ?? line.advancePaise;
    const { netPaise: net, advanceRecoveredPaise: recovered } = netPaise({
      basePaise: base, bonusPaise: bonus, overtimePaise: ot, deductionPaise: deduction,
      advanceOutstandingPaise: Math.min(desired, outstanding),
    });

    return withPayrollContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.payrollLine.update({
          where: { id: line.id },
          data: { basePaise: base, overtimePaise: ot, bonusPaise: bonus, deductionPaise: deduction, advancePaise: recovered, netPaise: net, notes: data.reason ?? undefined },
        });
        const agg = await tx.payrollLine.aggregate({ where: { runId: line.run.id }, _sum: { netPaise: true } });
        await tx.payrollRun.updateMany({ where: { id: line.run.id }, data: { netTotalPaise: BigInt(agg._sum.netPaise ?? 0) } });

        await emitEvent(tx, { type: "PayrollLineAdjusted", aggregateId: line.id, propertyId: line.run.propertyId, payload: { runId: line.run.id, netPaise: net, overridden } });
        await writeAudit(tx, { action: "payroll:run", entityType: "PayrollLine", entityId: line.id, propertyId: line.run.propertyId, reason: data.reason ?? null, before: { netPaise: line.netPaise, basePaise: line.basePaise, overtimePaise: line.overtimePaise }, after: { netPaise: net, basePaise: base, overtimePaise: ot, overridden } });
        return { lineId: line.id, netPaise: net };
      }),
    );
  });
}

/**
 * Finalize a DRAFT run (FR-7/9/15, AC-8): lock it immutable, stamp finalizedAt/By,
 * increment each staff advance's recovered balance (carry-forward), emit
 * PayrollFinalized, then render payslip PDFs post-commit. Rejects RUN_LOCKED.
 */
export async function finalizeRun(input: unknown): Promise<Result<RunResult>> {
  return toResult(async () => {
    const { runId } = finalizeRunSchema.parse(input);
    const user = await requireUser();
    const client = payrollDb(user);

    const run = await client.payrollRun.findFirst({
      where: { id: runId },
      select: { id: true, propertyId: true, month: true, sequence: true, status: true, netTotalPaise: true, lines: { select: { id: true, staffId: true, advancePaise: true } } },
    });
    if (!run) throw new NotFoundError("Payroll run not found.");
    authorize(user, "payroll:run", run.propertyId);
    if (run.status === "FINALIZED") throw new DomainError(ErrorCode.RUN_LOCKED, "Run is already finalized.");

    const result = await withPayrollContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.payrollRun.updateMany({ where: { id: run.id }, data: { status: "FINALIZED", finalizedAt: new Date(), finalizedById: user.userId } });

        // Carry-forward (FR-15): increment StaffAdvance.recoveredPaise, oldest-first.
        for (const line of run.lines) {
          if (line.advancePaise <= 0) continue;
          const advances = await tx.staffAdvance.findMany({ where: { staffId: line.staffId }, orderBy: { createdAt: "asc" }, select: { id: true, amountPaise: true, recoveredPaise: true } });
          let remaining = line.advancePaise;
          for (const adv of advances) {
            if (remaining <= 0) break;
            const room = adv.amountPaise - adv.recoveredPaise;
            if (room <= 0) continue;
            const take = Math.min(room, remaining);
            await tx.staffAdvance.update({ where: { id: adv.id }, data: { recoveredPaise: adv.recoveredPaise + take } });
            remaining -= take;
          }
        }

        await emitEvent(tx, { type: "PayrollFinalized", aggregateId: run.id, propertyId: run.propertyId, payload: { month: run.month, sequence: run.sequence, netTotalPaise: Number(run.netTotalPaise) } });
        await writeAudit(tx, { action: "payroll:run", entityType: "PayrollRun", entityId: run.id, propertyId: run.propertyId, before: { status: "DRAFT" }, after: { status: "FINALIZED", netTotalPaise: Number(run.netTotalPaise) } });
        return { runId: run.id, status: "FINALIZED", sequence: run.sequence, lineCount: run.lines.length, netTotalPaise: Number(run.netTotalPaise) };
      }),
    );

    // Post-commit, non-fatal (mirrors 06's invoice PDF): render + store payslips.
    await generatePayslipsForRun(user, { runId: run.id, propertyId: run.propertyId, month: run.month });
    return result;
  });
}
