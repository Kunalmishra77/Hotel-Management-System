/**
 * Channel-manager provider selection — 13 (integrations.md sandbox↔live gating).
 *
 * The `mode` derived from the `ChannelAccount` is the single switch: unless the
 * account is BOTH `isActive` AND certified, the MockChannelManager is resolved
 * (no external call, app runs end-to-end). Going live is therefore a data change
 * (certify + activate), never a code change (FR-2/17/18).
 */
import { mockChannelManager } from "./mock";
import { liveChannelManager } from "./live";
import type { ChannelAccountConfig, ChannelManager } from "./types";

export * from "./types";
export { mockChannelManager } from "./mock";
export { liveChannelManager } from "./live";

export type ResolveChannelInput = {
  provider: string;
  isActive: boolean;
  certifiedAt: Date | null;
  credentialsRef: string | null;
  config?: ChannelAccountConfig | null;
};

/**
 * Resolve the manager for a channel account.
 *
 * Sandbox (inactive, uncertified, or missing credentials) → MockChannelManager.
 * Only an account that is active AND certified AND has a credentials reference
 * resolves the live adapter — a half-configured account must never be treated as
 * production (FR-17/18).
 */
export function resolveChannelManager(account: ResolveChannelInput): ChannelManager {
  const config = account.config ?? {};
  const isLiveReady =
    account.isActive && account.certifiedAt != null && !!account.credentialsRef;
  if (!isLiveReady) {
    return mockChannelManager(account.provider, config.fixtures ?? []);
  }
  return liveChannelManager(account.provider, config);
}
