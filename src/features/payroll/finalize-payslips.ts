/**
 * Post-finalize payslip generation (21 T-19, FR-7). NOT a "use server" module.
 *
 * Runs AFTER the finalize transaction commits — like 06's invoice PDF, a render
 * failure is non-fatal (the run is valid; a retry job re-attaches the key). Staff
 * names come from 09's sanctioned `getStaffForPayroll` read, never a foreign
 * SELECT (FR-17); bank/PII is masked/omitted by default (FR-16, compliance.md).
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveStorageAdapter } from "@/lib/storage";
import { getStaffForPayroll } from "@/features/staff/queries";
import type { SessionClaims } from "@/lib/auth/claims";
import { renderPayslip } from "./payslip";

/** Object key for a finalized line's payslip — namespaced, greppable, purgeable. */
export function payslipObjectKey(propertyId: string, runId: string, lineId: string): string {
  return `payslips/${propertyId}/${runId}/${lineId}`;
}

/**
 * Render + store a payslip PDF per line and attach its object key. Best-effort:
 * any failure is logged and swallowed so finalize never rolls back on a render
 * error (AC-8 requires the run finalized; the PDF is a follow-up artifact).
 */
export async function generatePayslipsForRun(
  user: SessionClaims,
  args: { runId: string; propertyId: string; month: string },
): Promise<void> {
  try {
    const run = await db.scoped(user).payrollRun.findFirst({
      where: { id: args.runId },
      select: {
        id: true,
        month: true,
        lines: {
          select: {
            id: true, staffId: true, basePaise: true, bonusPaise: true, overtimePaise: true,
            deductionPaise: true, advancePaise: true, netPaise: true, paidDays: true, lopDays: true,
          },
        },
      },
    });
    if (!run) return;

    const staff = await getStaffForPayroll(user, args.propertyId, args.month);
    const nameById = new Map(staff.map((s) => [s.id, s.name]));

    const property = await db.unscoped().property.findFirst({
      where: { id: args.propertyId },
      select: { name: true },
    });
    const propertyName = property?.name ?? "Property";
    const storage = resolveStorageAdapter();

    for (const line of run.lines) {
      const pdf = await renderPayslip({
        propertyName,
        month: run.month,
        staffName: nameById.get(line.staffId) ?? "Staff",
        bankAccountMasked: null, // masked by default; no sanctioned 09 bank read yet (FR-16)
        paidDays: line.paidDays,
        lopDays: line.lopDays,
        basePaise: line.basePaise,
        bonusPaise: line.bonusPaise,
        overtimePaise: line.overtimePaise,
        deductionPaise: line.deductionPaise,
        advancePaise: line.advancePaise,
        netPaise: line.netPaise,
      });
      const key = payslipObjectKey(args.propertyId, run.id, line.id);
      await storage.put(key, pdf, { contentType: "application/pdf" });
      await db.unscoped().payrollLine.update({ where: { id: line.id }, data: { payslipObjectKey: key } });
    }
  } catch (e) {
    logger.warn("payroll.payslip_render_failed", {
      runId: args.runId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
