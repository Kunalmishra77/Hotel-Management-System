/**
 * Inbound channel webhook handler — 13 T-7 (FR-5/14, AC-4/5/14).
 *
 * Signature-verify-FIRST (api-conventions.md, security.md): a missing/invalid
 * signature throws `WEBHOOK_SIGNATURE_INVALID` and takes NO side effect — no
 * inbox row, no reservation. A verified message is recorded in the inbox keyed
 * `(provider, externalId)` and deduped there; a re-delivery is a success without
 * reprocessing (providers retry aggressively). The reservation itself is created
 * by the worker's inbox sweep (`processInboundReservation`), off this path.
 */
import { db } from "@/lib/db";
import { DomainError, ErrorCode } from "@/lib/errors";
import { receiveInbound } from "@/lib/integrations/inbox";
import { resolveChannelManager, type ChannelAccountConfig } from "@/lib/channels";
import type { Prisma } from "@prisma/client";

export type WebhookOutcome = { status: "ACCEPTED" | "DUPLICATE"; inboxId: string };

function parseBody(rawBody: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Webhook body must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError(ErrorCode.VALIDATION_FAILED, "Webhook body is not valid JSON.");
  }
}

function reqStr(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, `Missing "${key}".`);
  }
  return v.trim();
}

export async function handleChannelWebhook(params: {
  provider: string;
  rawBody: string;
  signature: string;
}): Promise<WebhookOutcome> {
  const { provider, rawBody, signature } = params;
  const body = parseBody(rawBody);
  const propertyId = reqStr(body, "propertyId");
  const externalId = reqStr(body, "externalId");
  const type = reqStr(body, "type");

  const prisma = db.unscoped();
  const account = await prisma.channelAccount.findFirst({
    where: { propertyId, provider },
    select: { provider: true, isActive: true, certifiedAt: true, credentialsRef: true, config: true },
  });

  // Resolve the manager (sandbox mock unless certified+active) and verify FIRST.
  const config = (account?.config ?? {}) as ChannelAccountConfig;
  const manager = resolveChannelManager({
    provider,
    isActive: account?.isActive ?? false,
    certifiedAt: account?.certifiedAt ?? null,
    credentialsRef: account?.credentialsRef ?? null,
    config,
  });
  const secret = config.webhookSecret ?? "";
  if (!manager.verifyWebhook({ rawBody, signature, secret })) {
    // FR-14: reject with no side effect — nothing is written.
    throw new DomainError(ErrorCode.WEBHOOK_SIGNATURE_INVALID);
  }

  const received = await receiveInbound(prisma, {
    provider,
    externalId,
    type,
    payload: body as Prisma.InputJsonValue,
  });
  return { status: received.kind, inboxId: received.id };
}
