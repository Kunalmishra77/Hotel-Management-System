/**
 * The default MockChannelManager — 13 T-6 (FR-2/3, integrations.md sandbox rule).
 *
 * Performs NO external call. Outbound pushes "succeed" with a deterministic
 * `mock-*` ref (the caller logs them to the ChannelSyncLog outbox), and inbound
 * pulls return the deterministic fixtures configured on the account — so the
 * full inbound→03 and outbound→outbox paths run identically to production with
 * ZERO external accounts. Going live swaps this for a live adapter behind the
 * SAME interface (FR-18).
 */
import { randomUUID } from "node:crypto";
import { verifyWebhookSignature } from "@/lib/integrations/inbox";
import type {
  AvailabilityPush,
  ChannelManager,
  PushResult,
  RatePush,
  RawInboundMessage,
} from "./types";

export function mockChannelManager(
  provider: string,
  fixtures: RawInboundMessage[] = [],
): ChannelManager {
  return {
    name: `mock:${provider}`,
    provider,
    isLive: false,

    async pushAvailability(_input: AvailabilityPush): Promise<PushResult> {
      return { ok: true, ref: `mock-avail-${randomUUID()}` };
    },
    async pushRates(_input: RatePush): Promise<PushResult> {
      return { ok: true, ref: `mock-rate-${randomUUID()}` };
    },
    async pullReservations(): Promise<RawInboundMessage[]> {
      return fixtures;
    },
    async ack(_externalId: string): Promise<void> {
      // No-op in sandbox — a real channel would mark the message consumed.
    },
    mapRoomType(externalRoomType: string): string {
      return externalRoomType.trim().toUpperCase();
    },
    // With no configured secret (pure sandbox) accept the webhook; when a secret
    // IS set, still verify it so the sandbox rehearses the live signature path.
    verifyWebhook: ({ rawBody, signature, secret }) =>
      secret ? verifyWebhookSignature({ rawBody, signature, secret }) : true,
  };
}
