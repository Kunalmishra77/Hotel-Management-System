/**
 * 27 owner-portal — read queries. Property-scoped; the owner sees ONLY properties
 * they own (`db.scoped(user)` + explicit `authorize(..., propertyId)`).
 *
 * Financials reuse the canonical reports/analytics computation (never recomputed),
 * but under the owner's own `owner:view-financials` permission — NOT the report
 * action's `report:view-financial`, which the owner does not hold (design gotcha).
 */
import { authorize } from "@/lib/permissions";
import { computeProfitReport, type ProfitReport } from "@/features/reports/queries";
import { trend } from "@/features/analytics/queries";
import type { SessionClaims } from "@/lib/auth/claims";

export type OwnerFinancials = ProfitReport & {
  trend: { businessDate: string; value: number }[];
};

/** Revenue / expense / profit / occupancy + a revenue trend for one owned property. */
export async function ownerFinancials(
  user: SessionClaims,
  input: { propertyId: string; from: Date; to: Date },
): Promise<OwnerFinancials> {
  authorize(user, "owner:view-financials", input.propertyId);
  const propertyIds = [input.propertyId];
  const [report, revTrend] = await Promise.all([
    computeProfitReport(user, { propertyIds, from: input.from, to: input.to }),
    trend(user, { metric: "revenue", from: input.from, to: input.to, propertyIds }),
  ]);
  return { breakdown: report.breakdown, metrics: report.metrics, trend: revTrend };
}
