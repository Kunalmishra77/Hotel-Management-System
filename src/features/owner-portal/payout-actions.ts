"use server";

/**
 * 27 owner-portal — payout writes (FR-11/12/13). Money path: figures are grounded
 * on the canonical reports layer, computed with the pure `computePayout`, and
 * snapshotted into an append-only `OwnerPayout` row. A paid row is never edited.
 * Staff-only: owner:manage sets the fee; owner:payout-manage records + pays.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { computeProfitReport } from "@/features/reports/queries";
import { ownerDb, withOwnerContext } from "./internal";
import { computePayout, monthStart, monthEnd } from "./domain/payout";
import { setManagementFeeSchema, recordOwnerPayoutSchema, markPayoutPaidSchema } from "./schema";

export async function setManagementFee(input: unknown): Promise<Result<{ propertyId: string; feeBps: number }>> {
  return toResult(async () => {
    const data = setManagementFeeSchema.parse(input);
    const user = await requireUser();
    authorize(user, "owner:manage", data.propertyId);

    return withOwnerContext(user, () =>
      ownerDb(user).$transaction(async (tx) => {
        const before = await tx.property.findFirst({ where: { id: data.propertyId }, select: { managementFeeBps: true } });
        await tx.property.update({ where: { id: data.propertyId }, data: { managementFeeBps: data.feeBps } });
        await writeAudit(tx, {
          action: "owner:set-management-fee",
          entityType: "Property",
          entityId: data.propertyId,
          propertyId: data.propertyId,
          before: { managementFeeBps: before?.managementFeeBps ?? 0 },
          after: { managementFeeBps: data.feeBps },
        });
        return { propertyId: data.propertyId, feeBps: data.feeBps };
      }),
    );
  });
}

export type OwnerPayoutRecorded = {
  id: string;
  netPayablePaise: number;
  managementFeePaise: number;
  idempotent: boolean;
};

export async function recordOwnerPayout(input: unknown): Promise<Result<OwnerPayoutRecorded>> {
  return toResult(async () => {
    const data = recordOwnerPayoutSchema.parse(input);
    const user = await requireUser();
    authorize(user, "owner:payout-manage", data.propertyId);
    const period = monthStart(data.periodMonth);

    // Idempotent: a recorded (property, month) is returned as-is — figures are a
    // snapshot and must never be silently recomputed/overwritten (FR-12).
    const existing = await ownerDb(user).ownerPayout.findFirst({
      where: { propertyId: data.propertyId, periodMonth: period },
      select: { id: true, netPayablePaise: true, managementFeePaise: true },
    });
    if (existing) {
      return {
        id: existing.id,
        netPayablePaise: Number(existing.netPayablePaise),
        managementFeePaise: Number(existing.managementFeePaise),
        idempotent: true,
      };
    }

    // Ground the numbers on the canonical reports layer for the whole month.
    const report = await computeProfitReport(user, { propertyIds: [data.propertyId], from: period, to: monthEnd(period) });
    const prop = await ownerDb(user).property.findFirst({ where: { id: data.propertyId }, select: { managementFeeBps: true } });
    const feeBps = prop?.managementFeeBps ?? 0;
    const revenuePaise = BigInt(report.breakdown.revenuePaise);
    const expensePaise = BigInt(report.breakdown.expensePaise);
    const { managementFeePaise, netPayablePaise } = computePayout(revenuePaise, expensePaise, feeBps);

    return withOwnerContext(user, () =>
      ownerDb(user).$transaction(async (tx) => {
        const row = await tx.ownerPayout.create({
          data: {
            propertyId: data.propertyId,
            periodMonth: period,
            grossRevenuePaise: revenuePaise,
            expensePaise,
            managementFeeBps: feeBps,
            managementFeePaise,
            netPayablePaise,
            status: "COMPUTED",
            recordedById: user.userId,
          },
          select: { id: true },
        });
        await emitEvent(tx, {
          type: "OwnerPayoutRecorded",
          aggregateId: row.id,
          propertyId: data.propertyId,
          payload: { period: period.toISOString().slice(0, 7), netPayablePaise: netPayablePaise.toString() },
        });
        await writeAudit(tx, {
          action: "owner:payout-record",
          entityType: "OwnerPayout",
          entityId: row.id,
          propertyId: data.propertyId,
          after: { period: period.toISOString().slice(0, 7), feeBps, netPaise: netPayablePaise.toString() },
        });
        return { id: row.id, netPayablePaise: Number(netPayablePaise), managementFeePaise: Number(managementFeePaise), idempotent: false };
      }),
    );
  });
}

export async function markPayoutPaid(input: unknown): Promise<Result<{ id: string; status: string }>> {
  return toResult(async () => {
    const data = markPayoutPaidSchema.parse(input);
    const user = await requireUser();

    const payout = await ownerDb(user).ownerPayout.findFirst({
      where: { id: data.payoutId },
      select: { id: true, propertyId: true, status: true, paymentRef: true },
    });
    if (!payout) throw new NotFoundError("Payout not found.");
    authorize(user, "owner:payout-manage", payout.propertyId);

    // Append-only: a paid row is never edited. Re-marking paid is a no-op.
    if (payout.status === "PAID") {
      return { id: payout.id, status: payout.status };
    }

    return withOwnerContext(user, () =>
      ownerDb(user).$transaction(async (tx) => {
        const updated = await tx.ownerPayout.update({
          where: { id: payout.id },
          data: { status: "PAID", paidAt: new Date(), paymentRef: data.paymentRef },
          select: { id: true, status: true },
        });
        await emitEvent(tx, {
          type: "OwnerPayoutPaid",
          aggregateId: payout.id,
          propertyId: payout.propertyId,
          payload: { paymentRef: data.paymentRef },
        });
        await writeAudit(tx, {
          action: "owner:payout-pay",
          entityType: "OwnerPayout",
          entityId: payout.id,
          propertyId: payout.propertyId,
          before: { status: "COMPUTED" },
          after: { status: "PAID", paymentRef: data.paymentRef },
        });
        return updated;
      }),
    );
  });
}
