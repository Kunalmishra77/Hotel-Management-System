/**
 * Payroll reads — 21 (FR-9/14/16). Every read is property-scoped and gated by
 * `payroll:run` (payroll is financial + touches PII). Staff names come from 09's
 * `getStaffForPayroll`, never a foreign SELECT into Staff (FR-17). Bank/Aadhaar/
 * PAN are never selected here — masked by default (FR-16, compliance.md).
 */
import { authorize } from "@/lib/permissions";
import { NotFoundError } from "@/lib/errors";
import { resolveStorageAdapter } from "@/lib/storage";
import { getStaffForPayroll } from "@/features/staff/queries";
import { payrollDb } from "./internal";
import type { SessionClaims } from "@/lib/auth/claims";

export type PayrollLineView = {
  id: string;
  staffId: string;
  staffName: string;
  basePaise: number;
  bonusPaise: number;
  overtimePaise: number;
  deductionPaise: number;
  advancePaise: number;
  netPaise: number;
  paidDays: number | null;
  lopDays: number | null;
  otMinutes: number | null;
  hasPayslip: boolean;
};

export type PayrollRunView = {
  id: string;
  propertyId: string;
  month: string;
  sequence: number;
  runType: string;
  status: string;
  netTotalPaise: number;
  finalizedAt: Date | null;
  lines: PayrollLineView[];
};

export async function getRun(user: SessionClaims, runId: string): Promise<PayrollRunView | null> {
  const run = await payrollDb(user).payrollRun.findFirst({
    where: { id: runId },
    select: {
      id: true, propertyId: true, month: true, sequence: true, runType: true, status: true,
      netTotalPaise: true, finalizedAt: true,
      lines: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, staffId: true, basePaise: true, bonusPaise: true, overtimePaise: true,
          deductionPaise: true, advancePaise: true, netPaise: true, paidDays: true, lopDays: true,
          otMinutes: true, payslipObjectKey: true,
        },
      },
    },
  });
  if (!run) return null;
  authorize(user, "payroll:run", run.propertyId);

  const staff = await getStaffForPayroll(user, run.propertyId, run.month);
  const nameById = new Map(staff.map((s) => [s.id, s.name]));

  return {
    id: run.id, propertyId: run.propertyId, month: run.month, sequence: run.sequence,
    runType: run.runType, status: run.status, netTotalPaise: Number(run.netTotalPaise),
    finalizedAt: run.finalizedAt,
    lines: run.lines.map((l) => ({
      id: l.id, staffId: l.staffId, staffName: nameById.get(l.staffId) ?? "Staff",
      basePaise: l.basePaise, bonusPaise: l.bonusPaise, overtimePaise: l.overtimePaise,
      deductionPaise: l.deductionPaise, advancePaise: l.advancePaise, netPaise: l.netPaise,
      paidDays: l.paidDays, lopDays: l.lopDays, otMinutes: l.otMinutes,
      hasPayslip: l.payslipObjectKey != null,
    })),
  };
}

export type PayrollRunSummary = {
  id: string; month: string; sequence: number; runType: string; status: string; netTotalPaise: number;
};

export async function listRuns(user: SessionClaims, propertyId: string): Promise<PayrollRunSummary[]> {
  authorize(user, "payroll:run", propertyId);
  const runs = await payrollDb(user).payrollRun.findMany({
    where: { propertyId },
    orderBy: [{ month: "desc" }, { sequence: "asc" }],
    select: { id: true, month: true, sequence: true, runType: true, status: true, netTotalPaise: true },
  });
  return runs.map((r) => ({ ...r, netTotalPaise: Number(r.netTotalPaise) }));
}

/** Fetch a line's payslip PDF bytes (authorized). Used by the download route (FR-16). */
export async function getPayslipBytes(
  user: SessionClaims,
  lineId: string,
): Promise<{ filename: string; contentType: string; bytes: Buffer }> {
  const line = await payrollDb(user).payrollLine.findFirst({
    where: { id: lineId },
    select: { id: true, payslipObjectKey: true, run: { select: { propertyId: true, month: true } } },
  });
  if (!line) throw new NotFoundError("Payroll line not found.");
  authorize(user, "payroll:run", line.run.propertyId);
  if (!line.payslipObjectKey) throw new NotFoundError("Payslip not generated for this line.");
  const bytes = await resolveStorageAdapter().get(line.payslipObjectKey);
  return { filename: `payslip-${line.run.month}-${line.id}.pdf`, contentType: "application/pdf", bytes };
}
