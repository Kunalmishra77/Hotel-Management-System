/**
 * Provider selection — 12 (integrations.md sandbox↔live gating).
 *
 * `mode` on the `MessagingAccount` row is the single switch: anything other than
 * "live" resolves the MockProvider (no external call, app runs end-to-end). Going
 * live is therefore a data change, never a code change (FR-23).
 */
import type { Channel } from "@prisma/client";
import { mockProvider } from "./mock";
import { liveProvider } from "./live";
import type { MessagingAccountConfig, MessagingProvider } from "./types";

export * from "./types";
export { mockProvider } from "./mock";
export { liveProvider, LIVE_BLOCKERS } from "./live";

export type ResolveInput = {
  channel: Channel;
  provider: string;
  mode: string;
  config?: MessagingAccountConfig | null;
};

/**
 * Resolve the provider for a messaging account.
 *
 * Sandbox (or any non-"live" mode, or no account at all) → MockProvider. Only an
 * explicit `mode === "live"` account resolves a live adapter — a half-configured
 * account must never be treated as production.
 */
export function resolveMessagingProvider(account: ResolveInput | null): MessagingProvider {
  if (!account || account.mode !== "live") {
    return mockProvider(account?.channel ?? "WHATSAPP");
  }
  return liveProvider(account.channel, account.provider, account.config ?? {});
}
