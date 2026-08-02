"use server";

/**
 * Corporate credit settlement — 06 T-22 (FR-17, AC-21). Inside ONE transaction:
 * `corporate.reserveCredit` (row-locked check-and-increment) runs BEFORE the
 * Payment is recorded, so a settlement over the limit rolls the whole thing back
 * — nothing persists. Two near-limit settlements can't both pass (the row lock
 * serializes them). No foreign SELECT: 25 later reads via `corporateReceivable`.
 */
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { NotFoundError, DomainError, ErrorCode } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { reserveCredit } from "@/features/corporate";
import { folioBalance } from "./domain/balance";
import { billingDb, loadFolioContext, withBillingContext } from "./internal";
import { settleCorporateSchema } from "./schema";

export type SettleCorporateResult = { paymentId: string; amountPaise: number; receivablePaise: number };

export async function settleCorporate(input: unknown): Promise<Result<SettleCorporateResult>> {
  return toResult(async () => {
    const data = settleCorporateSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);
    const ctx = await loadFolioContext(client, data.folioId);
    if (!ctx) throw new NotFoundError("Folio not found.");
    authorize(user, "payment:record", ctx.propertyId);

    return withBillingContext(user, () =>
      client.$transaction(async (tx) => {
        // Balance is computed inside the tx so the reserved amount matches reality.
        const folio = await tx.folio.findUniqueOrThrow({
          where: { id: data.folioId },
          select: {
            lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } },
            payments: { select: { amountPaise: true, isRefund: true } },
          },
        });
        const balance = folioBalance(folio.lines, folio.payments);
        if (balance <= 0n) throw new DomainError(ErrorCode.INVALID_AMOUNT, "Nothing to settle on this folio.");

        // Atomic check-and-increment; over-limit throws and rolls everything back.
        const { receivablePaise } = await reserveCredit(
          tx as unknown as Prisma.TransactionClient,
          data.corporateId,
          balance,
        );

        const payment = await tx.payment.create({
          data: {
            propertyId: ctx.propertyId,
            folioId: data.folioId,
            mode: "CORPORATE_CREDIT",
            amountPaise: balance,
            isRefund: false,
            receivedById: user.userId,
          },
          select: { id: true },
        });
        await emitEvent(tx, { type: "CorporateReceivableChanged", aggregateId: data.corporateId, propertyId: ctx.propertyId, payload: { corporateId: data.corporateId, receivablePaise: Number(receivablePaise), folioId: data.folioId } });
        await emitEvent(tx, { type: "PaymentReceived", aggregateId: data.folioId, propertyId: ctx.propertyId, payload: { folioId: data.folioId, tenders: [{ mode: "CORPORATE_CREDIT", amountPaise: Number(balance) }] } });
        await writeAudit(tx, { action: "folio:settle-corporate", entityType: "Folio", entityId: data.folioId, propertyId: ctx.propertyId, after: { corporateId: data.corporateId, amountPaise: Number(balance) } });

        return { paymentId: payment.id, amountPaise: Number(balance), receivablePaise: Number(receivablePaise) };
      }),
    );
  });
}
