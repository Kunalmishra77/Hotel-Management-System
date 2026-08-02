"use server";

/**
 * Online payment — 06 T-14 (FR-11, AC-12). An order is created with the provider
 * (sandbox), but NO `Payment` is recorded until a SIGNATURE-VERIFIED webhook
 * arrives; a duplicate webhook (same provider payment id) is deduped by the
 * inbox and records nothing extra. The webhook core is exported for the route
 * handler and is directly testable.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { runWithSystemContext } from "@/lib/context";
import { emitEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { DomainError, ErrorCode } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { resolvePaymentProvider } from "@/lib/payments";
import { receiveInbound, verifyWebhookSignature } from "@/lib/integrations/inbox";
import { billingDb, loadFolioContext } from "./internal";

const startSchema = z.object({ folioId: z.string().min(1), amountPaise: z.number().int().positive() });

/** Create a provider order for a folio (FR-11). No Payment is recorded yet. */
export async function startOnlinePayment(input: unknown): Promise<Result<{ orderId: string; amountPaise: number }>> {
  return toResult(async () => {
    const data = startSchema.parse(input);
    const user = await requireUser();
    const ctx = await loadFolioContext(billingDb(user), data.folioId);
    if (!ctx) throw new DomainError(ErrorCode.NOT_FOUND, "Folio not found.");
    authorize(user, "payment:record", ctx.propertyId);

    const order = await resolvePaymentProvider().createOrder({ amountPaise: data.amountPaise, receipt: data.folioId });
    return { orderId: order.orderId, amountPaise: order.amountPaise };
  });
}

export type WebhookOutcome = { status: "recorded" | "duplicate" };

/**
 * Handle a provider webhook: verify signature → inbox dedupe → record ONE
 * Payment. The route handler is a thin wrapper over this. Throws
 * WEBHOOK_SIGNATURE_INVALID on a bad signature (→ 401).
 */
export async function handlePaymentWebhook(params: { rawBody: string; signature: string }): Promise<WebhookOutcome> {
  const provider = resolvePaymentProvider();
  if (!verifyWebhookSignature({ rawBody: params.rawBody, signature: params.signature, secret: provider.webhookSecret() })) {
    throw new DomainError(ErrorCode.WEBHOOK_SIGNATURE_INVALID);
  }

  const payload = JSON.parse(params.rawBody) as {
    event: string; orderId: string; paymentId: string; folioId: string; amountPaise: number;
  };
  const prisma = db.unscoped();

  // Dedupe on the provider's payment id — a retried webhook records nothing extra.
  const received = await receiveInbound(prisma, {
    provider: provider.name,
    externalId: payload.paymentId,
    type: payload.event,
    payload,
  });
  if (received.kind === "DUPLICATE") return { status: "duplicate" };

  const folio = await prisma.folio.findUnique({ where: { id: payload.folioId }, select: { propertyId: true } });
  if (!folio) throw new DomainError(ErrorCode.NOT_FOUND, "Folio not found.");
  const property = await prisma.property.findUniqueOrThrow({ where: { id: folio.propertyId }, select: { orgId: true } });

  await runWithSystemContext(property.orgId, () =>
    prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          propertyId: folio.propertyId,
          folioId: payload.folioId,
          mode: "ONLINE",
          amountPaise: BigInt(payload.amountPaise),
          gatewayOrderId: payload.orderId,
          reference: payload.paymentId,
          isRefund: false,
        },
      });
      await emitEvent(tx, { type: "PaymentReceived", aggregateId: payload.folioId, propertyId: folio.propertyId, payload: { folioId: payload.folioId, tenders: [{ mode: "ONLINE", amountPaise: payload.amountPaise }] } });
      await writeAudit(tx, { action: "payment:online", entityType: "Folio", entityId: payload.folioId, propertyId: folio.propertyId, after: { amountPaise: payload.amountPaise, orderId: payload.orderId } });
    }),
  );

  return { status: "recorded" };
}
