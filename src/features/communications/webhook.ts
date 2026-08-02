/**
 * Inbound messaging webhooks — 12 T-11/T-13/T-16 (FR-6/11/16/22, AC-5/6/9/14).
 *
 * One entry point for every provider callback. The order is non-negotiable
 * (security.md): verify the signature FIRST, then dedupe via the IntegrationInbox
 * on a stable external id, then apply the effect — advance delivery status, record
 * a marketing opt-out (STOP), or capture an after-checkout feedback reply. A
 * duplicate is ignored idempotently (no double status flip / double count).
 */
import { runWithSystemContext } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { receiveInbound } from "@/lib/integrations/inbox";
import { resolveMessagingProvider, type MessagingAccountConfig } from "@/lib/messaging";
import { db } from "@/lib/db";

/** The normalized webhook envelope every provider adapter maps into. */
type MessagingWebhookBody = {
  /** "status" | "optout" | "feedback" */
  kind?: string;
  providerRef?: string;
  status?: string; // DELIVERED | READ | FAILED
  from?: string; // sender address (opt-out / inbound reply)
  guestId?: string;
  propertyId?: string;
  rating?: number;
  comment?: string;
};

export type WebhookOutcome = { status: "applied" | "duplicate" | "ignored" };

const ADVANCEABLE = new Set(["DELIVERED", "READ", "FAILED", "SENT"]);

export async function handleMessagingWebhook(input: {
  provider: string;
  rawBody: string;
  signature: string;
}): Promise<WebhookOutcome> {
  const account = await db.unscoped().messagingAccount.findFirst({ where: { provider: input.provider } });
  const config = (account?.config ?? {}) as unknown as MessagingAccountConfig;
  const provider = resolveMessagingProvider(
    account ? { channel: account.channel, provider: account.provider, mode: account.mode, config } : null,
  );

  // 1) Signature first — never trust the body before this passes (FR-6).
  const ok = provider.verifyWebhook({ rawBody: input.rawBody, signature: input.signature, secret: config.webhookSecret ?? "" });
  if (!ok) throw new DomainError(ErrorCode.WEBHOOK_SIGNATURE_INVALID, "Bad webhook signature");

  let body: MessagingWebhookBody;
  try {
    body = JSON.parse(input.rawBody) as MessagingWebhookBody;
  } catch {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, "Malformed webhook body");
  }

  const orgId = account?.orgId;
  const kind = body.kind ?? (body.status ? "status" : body.rating != null || body.comment ? "feedback" : "optout");

  if (kind === "status") return advanceStatus(input.provider, body);
  if (!orgId) return { status: "ignored" };
  if (kind === "optout") return recordOptOut(orgId, account!.channel, body);
  if (kind === "feedback") return captureInboundFeedback(orgId, body);
  return { status: "ignored" };
}

/** FR-6/22: advance a message's delivery status, deduped per (providerRef,status). */
async function advanceStatus(provider: string, body: MessagingWebhookBody): Promise<WebhookOutcome> {
  const providerRef = body.providerRef;
  const status = (body.status ?? "").toUpperCase();
  if (!providerRef || !ADVANCEABLE.has(status)) return { status: "ignored" };

  const dedupe = await receiveInbound(db.unscoped(), {
    provider: `messaging:${provider}`,
    externalId: `status:${providerRef}:${status}`,
    type: "delivery-status",
    payload: {},
  });
  if (dedupe.kind === "DUPLICATE") return { status: "duplicate" };

  const log = await db.unscoped().messageLog.findFirst({ where: { providerRef }, select: { id: true, propertyId: true, status: true } });
  if (!log) return { status: "ignored" };

  await db.unscoped().messageLog.update({ where: { id: log.id }, data: { status } });
  logger.info("comms.status_advanced", { messageLogId: log.id, to: status });
  return { status: "applied" };
}

/** FR-11: a STOP/UNSUBSCRIBE marks marketing OPTED_OUT for the channel. */
async function recordOptOut(orgId: string, channel: import("@prisma/client").Channel, body: MessagingWebhookBody): Promise<WebhookOutcome> {
  // Resolve the guest: explicit id, else by the sender address on a recent log.
  let guestId = body.guestId ?? null;
  if (!guestId && body.from) {
    const recent = await db.unscoped().messageLog.findFirst({ where: { toAddress: body.from, channel }, orderBy: { createdAt: "desc" }, select: { guestId: true } });
    guestId = recent?.guestId ?? null;
  }
  if (!guestId) return { status: "ignored" };

  const dedupe = await receiveInbound(db.unscoped(), {
    provider: "messaging:optout",
    externalId: `optout:${guestId}:${channel}`,
    type: "opt-out",
    payload: {},
  });
  if (dedupe.kind === "DUPLICATE") return { status: "duplicate" };

  await runWithSystemContext(orgId, () =>
    db.unscoped().$transaction(async (tx) => {
      await tx.communicationConsent.upsert({
        where: { guestId_channel: { guestId: guestId!, channel } },
        create: { guestId: guestId!, channel, marketingStatus: "OPTED_OUT" },
        update: { marketingStatus: "OPTED_OUT" },
      });
      await emitEvent(tx, { type: "ConsentChanged", aggregateId: guestId!, payload: { channel, marketingStatus: "OPTED_OUT", source: "inbound-stop" } });
      await writeAudit(tx, { action: "communication:send", entityType: "CommunicationConsent", entityId: `${guestId}:${channel}`, after: { marketingStatus: "OPTED_OUT", channel } });
    }),
  );
  logger.info("comms.opted_out", { channel });
  return { status: "applied" };
}

/** FR-16: an after-checkout reply becomes a Feedback row + FeedbackReceived. */
async function captureInboundFeedback(orgId: string, body: MessagingWebhookBody): Promise<WebhookOutcome> {
  if (!body.guestId || !body.propertyId) return { status: "ignored" };
  await runWithSystemContext(orgId, () =>
    db.unscoped().$transaction((tx) =>
      createFeedback(tx, { guestId: body.guestId!, propertyId: body.propertyId!, rating: body.rating ?? null, comment: body.comment ?? null, source: "inbound-reply" }),
    ),
  );
  return { status: "applied" };
}

/**
 * Shared feedback capture (used by the webhook and the captureFeedback action).
 * Creates the Feedback row this module owns and emits FeedbackReceived so 18 can
 * classify sentiment (18 never writes Feedback directly — contracts.md).
 *
 * Runs inside the CALLER's transaction + context (system for the webhook, the
 * user's for the action), so the audit row records the correct actor.
 */
export async function createFeedback(
  tx: import("@prisma/client").Prisma.TransactionClient,
  input: { guestId: string; propertyId: string; rating: number | null; comment: string | null; source: string },
): Promise<string> {
  const feedback = await tx.feedback.create({
    data: { propertyId: input.propertyId, guestId: input.guestId, rating: input.rating, comment: input.comment, source: input.source },
    select: { id: true },
  });
  await emitEvent(tx, { type: "FeedbackReceived", aggregateId: feedback.id, propertyId: input.propertyId, payload: { guestId: input.guestId, rating: input.rating } });
  await writeAudit(tx, { action: "communication:send", entityType: "Feedback", entityId: feedback.id, propertyId: input.propertyId, after: { rating: input.rating, source: input.source } });
  return feedback.id;
}
