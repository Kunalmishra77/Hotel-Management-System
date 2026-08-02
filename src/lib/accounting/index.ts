/**
 * Accounting-provider selection — 22 (integrations.md sandbox↔live gating).
 *
 * The `mode` on the `AccountingConfig` row is the single switch: anything other
 * than "live" resolves the MockAccountingProvider (no external call, app runs
 * end-to-end). Only an explicit `mode === "live"` resolves a live adapter — a
 * half-configured account must never be treated as production. Going live is
 * therefore a config change, never a code change (FR-1/7).
 */
import { mockAccountingProvider } from "./mock";
import { liveAccountingProvider } from "./live";
import type { AccountingProvider } from "./types";

export * from "./types";
export { mockAccountingProvider } from "./mock";
export { liveAccountingProvider } from "./live";

export type ResolveAccountingInput = { provider: string; mode: string };

export function resolveAccountingProvider(input: ResolveAccountingInput): AccountingProvider {
  if (input.mode !== "live") return mockAccountingProvider(input.provider);
  return liveAccountingProvider(input.provider);
}
