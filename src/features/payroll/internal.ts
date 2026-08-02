/** Shared internals for the payroll actions. NOT a "use server" module. */
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import type { SessionClaims } from "@/lib/auth/claims";

/**
 * `PayrollRun` is property-scoped (in PROPERTY_SCOPED_MODELS), so writes to it
 * are validated against the caller's scope by the extension. `PayrollLine`,
 * `Staff`, `Attendance` and `StaffAdvance` are NOT scoped models and pass
 * through — they are always constrained by ids already authorized via the run's
 * property or 09's property-scoped `getStaffForPayroll`.
 */
export function payrollDb(user: SessionClaims) {
  return db.scoped(user);
}

export function withPayrollContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
  return runWithContext(
    {
      orgId: user.orgId,
      userId: user.userId,
      propertyScope: user.propertyScope,
      activePropertyId: user.activePropertyId,
      requestId: newRequestId(),
      ip: null,
      device: null,
    },
    fn,
  );
}
