/**
 * The provider-agnostic messaging contract — 12 (integrations.md golden rule).
 *
 * Application/domain code depends ONLY on `MessagingProvider`, never on a
 * concrete SDK. Swapping providers or going live is a config change (a different
 * adapter is resolved), never a code change (`FR-23`). A `MockProvider` is the
 * default so the whole app runs end-to-end with ZERO external accounts.
 */
import type { Channel } from "@prisma/client";

/** A single outbound message, already rendered and addressed (min PII, FR-15). */
export type OutboundMessage = {
  channel: Channel;
  /** The recipient address only — phone (E.164) or email. Never extra PII. */
  toAddress: string;
  /** The fully-rendered body. The only content that reaches the provider. */
  body: string;
  /**
   * Approved provider template id — a WhatsApp/Meta HSM or a TRAI DLT-registered
   * template id. REQUIRED for a LIVE WhatsApp/SMS send (FR-9); absent ⇒ sandbox
   * only.
   */
  providerTemplateId?: string | null;
  /** For correlation/logging metadata only — never sent as content. */
  templateKey?: string | null;
};

/** The outcome of a send attempt. Never throws to the caller — always a result. */
export type SendResult =
  | { ok: true; providerRef: string }
  | { ok: false; error: string };

/** The MessageLog.status values a provider can drive a message toward. */
export type DeliveryState = "SENT" | "DELIVERED" | "READ" | "FAILED";

export interface MessagingProvider {
  /** e.g. "mock:whatsapp", "meta_cloud:whatsapp". */
  readonly name: string;
  readonly channel: Channel;
  /** True only when live credentials AND provider approval are wired. */
  readonly isLive: boolean;

  /** Send a pre-approved template message (HSM/DLT). Used for transactional copy. */
  sendTemplate(message: OutboundMessage): Promise<SendResult>;
  /** Send a free-form session message (only valid inside an open session window). */
  sendSession(message: OutboundMessage): Promise<SendResult>;
  /** Verify an inbound delivery/opt-out webhook signature BEFORE trusting it. */
  verifyWebhook(params: { rawBody: string; signature: string; secret: string }): boolean;
  /** Best-effort poll of a message's current delivery state by provider ref. */
  deliveryStatus(providerRef: string): Promise<DeliveryState>;
}

/** The persisted config shape of a `MessagingAccount.config` (untrusted JSON). */
export type MessagingAccountConfig = {
  /** HMAC secret used to verify inbound webhooks from this provider. */
  webhookSecret?: string;
  /** Provider API base + credentials refs (never the secret bytes in the row). */
  apiKeyRef?: string;
  senderId?: string;
  fromAddress?: string;
};
