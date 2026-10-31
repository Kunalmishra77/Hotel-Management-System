"use server";

/**
 * Payments + refunds — 06 T-12/T-13 (FR-8/9/10, AC-8/9/10/11). Split tenders post
 * in ONE transaction sharing a `settlementBatchId`, emitting ONE `PaymentReceived`
 * carrying the batch + tenders (so 22/12 reconcile without re-reading rows).
 * Refunds are stored positive with `isRefund` and are capped at net-paid.
 */
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { revalidatePath } from "next/cache";
import { splitSumsTo } from "./domain/money";
import { folioBalance, refundWithinNetPaid } from "./domain/balance";
import { billingDb, loadFolioContext, withBillingContext } from "./internal";
import { recordPaymentSchema, refundSchema, moveFolioCreditSchema, correctPaymentSchema } from "./schema";

export type PaymentResult = { batchId: string; totalPaise: number };

/** Record 1..n tenders atomically under one settlement batch (FR-8/9, AC-8/9/10). */
export async function recordPayment(input: unknown): Promise<Result<PaymentResult>> {
  return toResult(async () => {
    const data = recordPaymentSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);
    const ctx = await loadFolioContext(client, data.folioId);
    if (!ctx) throw new NotFoundError("Folio not found.");
    authorize(user, "payment:record", ctx.propertyId);

    const total = data.tenders.reduce((sum, t) => sum + t.amountPaise, 0);
    if (data.expectedTotalPaise != null && !splitSumsTo(data.tenders.map((t) => t.amountPaise), data.expectedTotalPaise)) {
      throw new DomainError(ErrorCode.SPLIT_MISMATCH);
    }

    const batchId = randomUUID();
    return withBillingContext(user, () =>
      client.$transaction(async (tx) => {
        for (const t of data.tenders) {
          await tx.payment.create({
            data: {
              propertyId: ctx.propertyId,
              folioId: data.folioId,
              mode: t.mode,
              amountPaise: BigInt(t.amountPaise),
              reference: t.reference ?? null,
              settlementBatchId: batchId,
              isRefund: false,
              receivedById: user.userId,
            },
          });
        }
        // ONE event for the whole batch, carrying the tenders (FR-8).
        await emitEvent(tx, {
          type: "PaymentReceived",
          aggregateId: data.folioId,
          propertyId: ctx.propertyId,
          payload: { folioId: data.folioId, settlementBatchId: batchId, tenders: data.tenders.map((t) => ({ mode: t.mode, amountPaise: t.amountPaise })) },
        });
        await writeAudit(tx, { action: "payment:record", entityType: "Folio", entityId: data.folioId, propertyId: ctx.propertyId, after: { settlementBatchId: batchId, totalPaise: total } });
        return { batchId, totalPaise: total };
      }),
    );
  });
}

export type RefundResult = { paymentId: string };

/** Refund within net-paid (FR-10, AC-11): folio:refund; Payment(isRefund, positive). */
export async function refund(input: unknown): Promise<Result<RefundResult>> {
  return toResult(async () => {
    const data = refundSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);
    const ctx = await loadFolioContext(client, data.folioId);
    if (!ctx) throw new NotFoundError("Folio not found.");
    authorize(user, "folio:refund", ctx.propertyId, { reason: data.reason });

    const payments = await client.payment.findMany({ where: { folioId: data.folioId }, select: { amountPaise: true, isRefund: true } });
    if (!refundWithinNetPaid(data.amountPaise, payments)) {
      throw new DomainError(ErrorCode.REFUND_EXCEEDS_PAID);
    }

    return withBillingContext(user, () =>
      client.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            propertyId: ctx.propertyId,
            folioId: data.folioId,
            mode: data.mode,
            amountPaise: BigInt(data.amountPaise), // positive; isRefund carries direction
            isRefund: true,
            receivedById: user.userId,
          },
          select: { id: true },
        });
        await emitEvent(tx, { type: "PaymentRefunded", aggregateId: data.folioId, propertyId: ctx.propertyId, payload: { paymentId: payment.id, amountPaise: data.amountPaise } });
        await writeAudit(tx, { action: "folio:refund", entityType: "Payment", entityId: payment.id, propertyId: ctx.propertyId, reason: data.reason, after: { amountPaise: data.amountPaise } });
        return { paymentId: payment.id };
      }),
    );
  });
}

export type MoveCreditResult = { movedPaise: number; fromBalancePaise: number; toBalancePaise: number };

/**
 * Move a credit from one folio onto another folio of the SAME guest journey.
 *
 * Full-stay billing plus a split stay leaves money in the wrong place: the guest
 * pays once, at one desk, but the stay is billed on a folio per leg. The leg that
 * took the payment ends up in credit while the other still shows a due, and
 * check-out gates folio by folio — so reception is asked to collect money the
 * guest has already handed over. Collecting it twice, or deferring a balance that
 * was never owed, are both wrong; the money just needs to sit where the charge is.
 *
 * This reallocates what was ALREADY received. It writes two payment rows (out of
 * one folio, into the other) and never a charge, so revenue, GST and invoices are
 * untouched and the cash total across the journey is unchanged.
 *
 * Guards: both folios must belong to the same guest AND the same linked journey
 * (`transferredFromId` chain), the source must actually be in credit, and the
 * move cannot exceed that credit. Same-journey is the point — this is not a way
 * to shuffle money between unrelated guests.
 */
export async function moveFolioCredit(input: unknown): Promise<Result<MoveCreditResult>> {
  return toResult(async () => {
    const data = moveFolioCreditSchema.parse(input);
    if (data.fromFolioId === data.toFolioId) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Pick two different folios.", { publicMessage: "Pick two different folios." });
    }
    const user = await requireUser();
    const client = billingDb(user);

    const folios = await client.folio.findMany({
      where: { id: { in: [data.fromFolioId, data.toFolioId] } },
      select: {
        id: true, propertyId: true,
        reservation: { select: { id: true, code: true, guestId: true, transferredFromId: true } },
        lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } },
        payments: { select: { amountPaise: true, isRefund: true } },
      },
    });
    const from = folios.find((f) => f.id === data.fromFolioId);
    const to = folios.find((f) => f.id === data.toFolioId);
    if (!from || !to) throw new NotFoundError("Folio not found.");
    authorize(user, "folio:charge", from.propertyId);
    authorize(user, "folio:charge", to.propertyId);

    if (!from.reservation || !to.reservation || from.reservation.guestId !== to.reservation.guestId) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Both folios must belong to the same guest.", {
        publicMessage: "Both bookings must belong to the same guest.",
      });
    }
    // One journey: either one leg continues the other.
    const linked =
      to.reservation.transferredFromId === from.reservation.id ||
      from.reservation.transferredFromId === to.reservation.id;
    if (!linked) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Folios are not legs of one stay.", {
        publicMessage: "These bookings aren't linked legs of one stay, so a credit can't move between them.",
      });
    }

    const fromBalance = folioBalance(from.lines, from.payments);
    const credit = -fromBalance; // positive when the folio is in credit
    if (credit <= 0n) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "That folio has no credit to move.", {
        publicMessage: "That booking has no credit to move.",
      });
    }
    const amount = BigInt(data.amountPaise ?? Number(credit));
    if (amount > credit) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Amount exceeds the credit.", {
        publicMessage: `Only ${Number(credit) / 100} is in credit on that booking.`,
      });
    }

    const reason = data.reason ?? `credit moved to ${to.reservation.code}`;
    const batch = randomUUID();

    return withBillingContext(user, () =>
      client.$transaction(async (tx) => {
        // Out of the paying folio. `isRefund` is the only direction the schema
        // has; the reference says plainly that no cash left the till.
        const out = await tx.payment.create({
          data: {
            propertyId: from.propertyId, folioId: from.id, mode: "CASH",
            amountPaise: amount, isRefund: true, settlementBatchId: batch,
            reference: `Credit moved to ${to.reservation!.code}`, receivedById: user.userId,
          },
          select: { id: true },
        });
        const into = await tx.payment.create({
          data: {
            propertyId: to.propertyId, folioId: to.id, mode: "CASH",
            amountPaise: amount, isRefund: false, settlementBatchId: batch,
            reference: `Credit moved from ${from.reservation!.code}`, receivedById: user.userId,
          },
          select: { id: true },
        });
        await emitEvent(tx, {
          type: "PaymentReceived", aggregateId: to.id, propertyId: to.propertyId,
          payload: { folioId: to.id, settlementBatchId: batch, movedFromFolioId: from.id, tenders: [{ mode: "CASH", amountPaise: Number(amount) }] },
        });
        await writeAudit(tx, {
          action: "folio:move-credit", entityType: "Payment", entityId: into.id, propertyId: to.propertyId, reason,
          before: { fromFolioId: from.id, fromBalancePaise: Number(fromBalance) },
          after: { toFolioId: to.id, amountPaise: Number(amount), outPaymentId: out.id },
        });
        revalidatePath(`/bookings/${from.reservation!.id}`);
        revalidatePath(`/bookings/${to.reservation!.id}`);
        return {
          movedPaise: Number(amount),
          fromBalancePaise: Number(fromBalance + amount),
          toBalancePaise: Number(folioBalance(to.lines, to.payments) - amount),
        };
      }),
    );
  });
}

export type PaymentCorrectionResult = { correctedPaymentId: string; newPaymentId: string | null };

/**
 * Correct a payment entered by mistake — wrong mode (Cash for UPI), wrong amount,
 * or recorded on the wrong bill. Payments are append-only, so the wrong entry is
 * cancelled by an equal refund line marked as a correction (no money leaves) and,
 * when given, the right entry is recorded in its place with the original date.
 * The bill view hides the cancelled pair. Audited with the reason.
 *
 * Same-day corrections are front-desk work (`payment:record`); an older payment
 * changes a closed day's collections, so it needs `folio:refund` (Accounts/Admin).
 */
export async function correctPaymentEntry(input: unknown): Promise<Result<PaymentCorrectionResult>> {
  return toResult(async () => {
    const data = correctPaymentSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);
    const original = await client.payment.findFirst({
      where: { id: data.paymentId, isRefund: false },
      select: { id: true, folioId: true, propertyId: true, mode: true, amountPaise: true, receivedAt: true, reference: true },
    });
    if (!original) throw new NotFoundError("Payment not found.");
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const sameDay = original.receivedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === today;
    authorize(user, sameDay ? "payment:record" : "folio:refund", original.propertyId, { reason: data.reason });

    const marker = `CORRECTION:${original.id}`;
    const already = await client.payment.findFirst({ where: { folioId: original.folioId, isRefund: true, reference: { startsWith: marker } }, select: { id: true } });
    if (already) {
      throw new DomainError(ErrorCode.CONFLICT, "This payment was already corrected.", { publicMessage: "This payment was already corrected." });
    }
    const newAmount = data.newAmountPaise ?? Number(original.amountPaise);

    return withBillingContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.payment.create({
          data: {
            propertyId: original.propertyId, folioId: original.folioId, mode: original.mode, amountPaise: original.amountPaise,
            reference: `${marker} ${data.reason}`.slice(0, 190), isRefund: true, receivedAt: original.receivedAt, receivedById: user.userId,
          },
        });
        let newPaymentId: string | null = null;
        if (data.newMode) {
          const p = await tx.payment.create({
            data: {
              propertyId: original.propertyId, folioId: original.folioId, mode: data.newMode, amountPaise: BigInt(newAmount),
              reference: original.reference ?? `Corrected entry`, isRefund: false, receivedAt: original.receivedAt, receivedById: user.userId,
              settlementBatchId: randomUUID(),
            },
            select: { id: true },
          });
          newPaymentId = p.id;
        }
        await emitEvent(tx, {
          type: "PaymentCorrected",
          aggregateId: original.folioId,
          propertyId: original.propertyId,
          payload: { folioId: original.folioId, paymentId: original.id, newPaymentId, from: { mode: original.mode, amountPaise: Number(original.amountPaise) }, to: data.newMode ? { mode: data.newMode, amountPaise: newAmount } : null },
        });
        await writeAudit(tx, {
          action: "payment:correct", entityType: "Payment", entityId: original.id, propertyId: original.propertyId, reason: data.reason,
          before: { mode: original.mode, amountPaise: Number(original.amountPaise) },
          after: data.newMode ? { mode: data.newMode, amountPaise: newAmount, newPaymentId } : { cancelled: true },
        });
        revalidatePath("/billing");
        return { correctedPaymentId: original.id, newPaymentId };
      }),
    );
  });
}
