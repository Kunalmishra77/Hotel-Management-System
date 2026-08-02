/**
 * Live-gated adapters — 12 T-21.
 *
 * These are the seams for the real providers. Each is HONEST about the external
 * blocker the client must clear before it can send a single live message
 * (integrations.md — "never imply we can bypass OTA certification or DLT"):
 *
 *   WhatsApp (Meta Cloud / Gupshup / Twilio) — a Meta-approved WABA via a BSP,
 *     plus per-template HSM approval. Without an approved `providerTemplateId`
 *     a live send is refused upstream (FR-9).
 *   SMS (MSG91 / Twilio)                      — TRAI **DLT** registration: a
 *     registered sender-ID and a registered template. No DLT ⇒ carriers drop it.
 *   Email (Resend / SES)                      — domain verification (SPF/DKIM);
 *     an unverified domain lands in spam or is rejected.
 *
 * They are intentionally not wired to an SDK here: the app never needs them to
 * run (the mock covers every path), and wiring them without the above approvals
 * would be dishonest. When the client completes onboarding, implement `send*`
 * against the SDK behind this same interface — no call-site changes (FR-23).
 */
import { verifyWebhookSignature } from "@/lib/integrations/inbox";
import type { Channel } from "@prisma/client";
import type { MessagingAccountConfig, MessagingProvider, OutboundMessage, SendResult } from "./types";

/** The external prerequisite each channel needs before it can go live. */
export const LIVE_BLOCKERS: Record<Channel, string> = {
  WHATSAPP: "Meta-approved WABA via a BSP + per-template HSM approval",
  SMS: "TRAI DLT registration: registered sender-ID + registered template",
  EMAIL: "Sender domain verification (SPF/DKIM)",
};

/**
 * A live adapter that reports itself live but refuses to send until an SDK is
 * wired AND the external blocker is cleared. Returning a failed result (rather
 * than throwing) keeps the worker's retry/dead-letter path in control (FR-7).
 */
export function liveProvider(
  channel: Channel,
  provider: string,
  config: MessagingAccountConfig,
): MessagingProvider {
  const notImplemented = async (_message: OutboundMessage): Promise<SendResult> => ({
    ok: false,
    error: `LIVE ${channel} via "${provider}" not wired — blocker: ${LIVE_BLOCKERS[channel]}`,
  });

  return {
    name: `${provider}:${channel.toLowerCase()}`,
    channel,
    isLive: true,
    sendTemplate: notImplemented,
    sendSession: notImplemented,
    verifyWebhook: ({ rawBody, signature, secret }) =>
      verifyWebhookSignature({ rawBody, signature, secret: secret || config.webhookSecret || "" }),
    async deliveryStatus() {
      return "SENT";
    },
  };
}
