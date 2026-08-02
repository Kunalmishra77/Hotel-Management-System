/**
 * Live-gated channel adapters — 13 T-6 (integrations.md honesty rule).
 *
 * These are the seams for the real OTA / aggregator connectors. Each is HONEST
 * about the external blocker the client must clear before a single live sync can
 * happen (integrations.md — "never imply we can bypass OTA certification"):
 * a certified connectivity partnership per OTA, or a channel-manager aggregator
 * account. They are intentionally not wired to an SDK here — the app never needs
 * them to run (the mock covers every path), and wiring them without the
 * partnership would be dishonest.
 *
 * When the client completes onboarding, implement the push/pull methods against
 * the aggregator/OTA SDK behind this SAME interface — no call-site changes (FR-2).
 * A push returns a failed result (rather than throwing) so the worker's
 * retry/dead-letter path stays in control (FR-13).
 */
import { verifyWebhookSignature } from "@/lib/integrations/inbox";
import type {
  AvailabilityPush,
  ChannelAccountConfig,
  ChannelManager,
  PushResult,
  RatePush,
  RawInboundMessage,
} from "./types";
import { liveBlockerFor } from "./types";

export function liveChannelManager(
  provider: string,
  config: ChannelAccountConfig,
): ChannelManager {
  const blocker = liveBlockerFor(provider);
  const notWired = async (): Promise<PushResult> => ({
    ok: false,
    error: `LIVE channel "${provider}" not wired — blocker: ${blocker}`,
  });

  return {
    name: `live:${provider}`,
    provider,
    isLive: true,
    pushAvailability: (_input: AvailabilityPush) => notWired(),
    pushRates: (_input: RatePush) => notWired(),
    async pullReservations(): Promise<RawInboundMessage[]> {
      // A live pull needs the certified connection; until wired, nothing arrives
      // by pull (inbound comes via the verified webhook instead).
      return [];
    },
    async ack(_externalId: string): Promise<void> {
      // Implemented against the provider SDK once the partnership is live.
    },
    mapRoomType(externalRoomType: string): string {
      return externalRoomType.trim().toUpperCase();
    },
    verifyWebhook: ({ rawBody, signature, secret }) =>
      verifyWebhookSignature({ rawBody, signature, secret: secret || config.webhookSecret || "" }),
  };
}
