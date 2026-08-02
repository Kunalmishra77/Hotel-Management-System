/**
 * The default MockProvider — 12 T-20 (FR-4, integrations.md sandbox rule).
 *
 * Performs NO external call. `send*` returns a deterministic `mock-*` providerRef
 * and success, so the outbox → dispatch → status path runs identically to
 * production and the whole app works with zero external accounts. Delivery is
 * reported DELIVERED (a real webhook would drive this in live mode).
 */
import { randomUUID } from "node:crypto";
import { verifyWebhookSignature } from "@/lib/integrations/inbox";
import type { Channel } from "@prisma/client";
import type { MessagingProvider, OutboundMessage, SendResult } from "./types";

export function mockProvider(channel: Channel): MessagingProvider {
  const send = async (_message: OutboundMessage): Promise<SendResult> => {
    // Deterministic ref; no network. The body never leaves the process.
    return { ok: true, providerRef: `mock-${channel.toLowerCase()}-${randomUUID()}` };
  };

  return {
    name: `mock:${channel.toLowerCase()}`,
    channel,
    isLive: false,
    sendTemplate: send,
    sendSession: send,
    // With no configured secret (pure sandbox) accept the webhook; when a secret
    // IS set, still verify it so the sandbox rehearses the live signature path.
    verifyWebhook: ({ rawBody, signature, secret }) =>
      secret ? verifyWebhookSignature({ rawBody, signature, secret }) : true,
    async deliveryStatus() {
      return "DELIVERED";
    },
  };
}
