/**
 * Channel worker jobs — 13 (FR-3/5/13). Registered in `scripts/worker.ts`:
 *  - `pullActiveChannels`  — sandbox mock adapters pull deterministic fixtures
 *    into the inbox (live adapters pull nothing until certified); deduped there.
 *  - `channelsProcessInbox` — drain the inbox through `processInboundReservation`
 *    exactly-once (the existing 00 inbox loop, with 13's handler map).
 *  - `deadLetterStalePushes` — age persistently-failing OUT pushes to DEAD_LETTER.
 *
 * None of this runs on the request path — the front desk is never blocked (FR-13).
 */
import type { IntegrationInbox, PrismaClient } from "@prisma/client";
import { processInbox, receiveInbound, type ProcessInboxResult } from "@/lib/integrations/inbox";
import { resolveChannelManager, type ChannelAccountConfig } from "@/lib/channels";
import { logger } from "@/lib/logger";
import { channelInboxHandlers } from "./inbound";

export { deadLetterStalePushes } from "./outbound";

/** Pull inbound reservations from every channel into the inbox (deduped). */
export async function pullActiveChannels(prisma: PrismaClient): Promise<{ pulled: number }> {
  const accounts = await prisma.channelAccount.findMany({
    select: { id: true, provider: true, isActive: true, certifiedAt: true, credentialsRef: true, config: true },
  });

  let pulled = 0;
  for (const account of accounts) {
    const manager = resolveChannelManager({
      provider: account.provider,
      isActive: account.isActive,
      certifiedAt: account.certifiedAt,
      credentialsRef: account.credentialsRef,
      config: (account.config ?? {}) as ChannelAccountConfig,
    });
    const messages = await manager.pullReservations();
    for (const m of messages) {
      await receiveInbound(prisma, {
        provider: m.provider,
        externalId: m.externalId,
        type: m.type,
        payload: m.payload as Parameters<typeof receiveInbound>[1]["payload"],
      });
      pulled += 1;
    }
    if (messages.length > 0) {
      await prisma.channelAccount.updateMany({ where: { id: account.id }, data: { lastSyncAt: new Date() } });
    }
  }

  if (pulled > 0) logger.info("channel.pulled", { pulled });
  return { pulled };
}

/** Drain the inbox with 13's inbound handler (exactly-once via `processInbox`). */
export async function channelsProcessInbox(prisma: PrismaClient): Promise<ProcessInboxResult> {
  return processInbox(prisma, channelInboxHandlers(prisma));
}

/** Convenience for a single inbound row (tests / targeted reprocessing). */
export type { IntegrationInbox };
export { processInboundReservation } from "./inbound";
