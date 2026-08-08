/**
 * Consolidated integrations status (16) — one org-admin view of every external
 * provider's sandbox↔live mode + the go-live blocker, spanning messaging (12),
 * payments, accounting (22), OTA channels (13) and AI (18). Read-only; the
 * per-domain consoles (/channels, /accounting, /communications) own the deep
 * config. `integration:manage` is Administrator-only, so this is org-admin-gated.
 */
import { Channel } from "@prisma/client";
import { authorize } from "@/lib/permissions";
import { LIVE_BLOCKERS } from "@/lib/messaging";
import { currentProviderName } from "@/lib/ai";
import { integrationsDb } from "./internal";
import type { SessionClaims } from "@/lib/auth/claims";

export type MessagingChannelStatus = {
  channel: Channel;
  label: string;
  /** The suggested provider when a channel has never been configured. */
  defaultProvider: string;
  provider: string;
  mode: "sandbox" | "live";
  configured: boolean;
  blocker: string;
};

export type IntegrationsOverview = {
  messaging: MessagingChannelStatus[];
  payments: { provider: string; mode: "sandbox" | "live"; liveAdapterBuilt: boolean; blocker: string };
  accounting: { provider: string; mode: "sandbox" | "live"; configured: boolean }[];
  channels: { total: number; live: number; sandbox: number };
  ai: { provider: string; live: boolean };
};

/** Display metadata per messaging channel (label + a sensible default provider). */
const MESSAGING_CHANNELS: { channel: Channel; label: string; defaultProvider: string }[] = [
  { channel: Channel.WHATSAPP, label: "WhatsApp", defaultProvider: "meta_cloud" },
  { channel: Channel.SMS, label: "SMS", defaultProvider: "msg91" },
  { channel: Channel.EMAIL, label: "Email", defaultProvider: "resend" },
];

function normalizeMode(mode: string): "sandbox" | "live" {
  return mode === "live" ? "live" : "sandbox";
}

/** Env fallback that treats an empty/whitespace value as absent (not just null). */
function envOr(value: string | undefined, fallback: string): string {
  return value && value.trim() !== "" ? value : fallback;
}

export async function getIntegrationsOverview(user: SessionClaims): Promise<IntegrationsOverview> {
  authorize(user, "integration:manage", null); // Administrator-only (AC), org-level
  const prisma = integrationsDb();
  const orgId = user.orgId;

  // --- Messaging (12): one row per (channel, provider); default → sandbox/mock.
  const messagingRows = await prisma.messagingAccount.findMany({ where: { orgId } });
  const messaging: MessagingChannelStatus[] = MESSAGING_CHANNELS.map((m) => {
    const row = messagingRows.find((r) => r.channel === m.channel);
    return {
      channel: m.channel,
      label: m.label,
      defaultProvider: m.defaultProvider,
      provider: row?.provider ?? m.defaultProvider,
      mode: normalizeMode(row?.mode ?? "sandbox"),
      configured: Boolean(row),
      blocker: LIVE_BLOCKERS[m.channel],
    };
  });

  // --- Payments: env-driven; the live adapter is not built yet (honest).
  const payments = {
    provider: envOr(process.env.PAYMENTS_PROVIDER, "razorpay"),
    mode: normalizeMode(envOr(process.env.PAYMENTS_MODE, "sandbox")),
    liveAdapterBuilt: false,
    blocker: "Business KYC (PAN, GST, bank) + a wired Razorpay/Cashfree adapter",
  };

  // --- Accounting (22): configured providers, or the sandbox default if none.
  const accountingRows = await prisma.accountingConfig.findMany({ where: { orgId } });
  const accounting =
    accountingRows.length > 0
      ? accountingRows.map((r) => ({
          provider: r.provider,
          mode: normalizeMode(r.mode),
          configured: true,
        }))
      : [{ provider: envOr(process.env.ACCOUNTING_PROVIDER, "mock"), mode: "sandbox" as const, configured: false }];

  // --- OTA channels (13): live-vs-sandbox connection count across the org.
  const propertyIds = (
    await prisma.property.findMany({ where: { orgId }, select: { id: true } })
  ).map((p) => p.id);
  const channelRows = await prisma.channelAccount.findMany({
    where: { propertyId: { in: propertyIds } },
    select: { isActive: true },
  });
  const live = channelRows.filter((c) => c.isActive).length;
  const channels = { total: channelRows.length, live, sandbox: channelRows.length - live };

  // --- AI (18): provider is env-selected; "mock" is the deterministic default.
  const aiProvider = currentProviderName();
  const ai = { provider: aiProvider, live: aiProvider !== "mock" };

  return { messaging, payments, accounting, channels, ai };
}
