/**
 * The worker process — `npm run worker`.
 *
 * architecture.md: "Background work (reminders, OTA sync, forecasts, backups)
 * runs as pg-boss jobs in scripts/worker.ts, not inside request handlers."
 * deployment-and-infra.md: the app and this worker are the two runtime
 * processes, same codebase and image.
 *
 * 00-platform owns three jobs; later modules register their own here:
 *   dispatch-outbox  → 00 FR-18  publish domain events (at-least-once)
 *   process-inbox    → 00 FR-22  handle inbound provider webhooks exactly once
 *   daily-backup     → 00 FR-23  encrypted daily backup + admin alert
 */
import "dotenv/config";

import PgBoss from "pg-boss";
import { PrismaClient } from "@prisma/client";
import { dispatchOutbox } from "../src/lib/events/dispatch";
import { registerGuestHistoryConsumer } from "../src/features/guest-history/consumer";
import { registerHousekeepingConsumer } from "../src/features/housekeeping/consumer";
import { registerCommunicationsConsumer } from "../src/features/communications/events/consumer";
import { dispatchQueuedMessages, scheduleTick } from "../src/features/communications/dispatch";
import { registerAiSentimentConsumer } from "../src/features/ai/consumer";
import { registerChannelsConsumer } from "../src/features/channels/consumer";
import { registerInventoryConsumer } from "../src/features/inventory/consumer";
import { registerAccountingConsumer } from "../src/features/accounting/consumer";
import { syncWorker } from "../src/features/accounting/sync";
import { registerImportJobs } from "../src/features/data-onboarding/job";
import { channelsProcessInbox, pullActiveChannels, deadLetterStalePushes } from "../src/features/channels/jobs";
import { runPricingEngine } from "../src/features/dynamic-pricing/engine";
import { releaseExpiredWebOrders } from "../src/features/booking-engine/public";
import { assembleClaims } from "../src/lib/auth/claims";
import { runBackup } from "../src/lib/backup";
import { alertAdmin } from "../src/lib/alerts";
import { logger } from "../src/lib/logger";

export const JOBS = {
  dispatchOutbox: "dispatch-outbox",
  processInbox: "process-inbox",
  dailyBackup: "daily-backup",
  dispatchMessages: "dispatch-messages",
  scheduleComms: "schedule-comms",
  pullChannels: "pull-channels",
  channelDeadLetter: "channel-dead-letter",
  runPricing: "run-pricing",
  releaseWebOrders: "release-web-orders",
  syncAccounting: "sync-accounting",
} as const;

const prisma = new PrismaClient();

/**
 * pg-boss manages its own schema and needs session-level features, so it uses
 * the DIRECT (non-pooled) URL — the same reason Prisma Migrate does (ADR-0005).
 */
function bossConnectionString(): string {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL/DATABASE_URL must be set to run the worker.");
  return url;
}

async function main(): Promise<void> {
  const boss = new PgBoss({
    connectionString: bossConnectionString(),
    // Its own schema so pg-boss tables never collide with the domain schema.
    schema: "pgboss",
  });

  boss.on("error", (error) => logger.error("pgboss.error", { error: error.message }));

  await boss.start();

  // Register the event consumers the dispatcher delivers to (05 guest-history;
  // more modules register here as they add consumers).
  registerGuestHistoryConsumer();
  registerHousekeepingConsumer();
  registerCommunicationsConsumer();
  registerAiSentimentConsumer();
  registerChannelsConsumer();
  registerInventoryConsumer();
  registerAccountingConsumer();
  // 26 data-onboarding: large-file import jobs (enqueued on demand). The pg-boss
  // handler shape is looser than registerImportJobs' declared param — the tested
  // path is the inline runner; the worker path is a documented follow-up.
  registerImportJobs(boss as never, prisma);

  logger.info("worker.started", { jobs: Object.values(JOBS) });

  // --- Outbox dispatch (FR-18) ------------------------------------------
  await boss.work(JOBS.dispatchOutbox, async () => {
    const result = await dispatchOutbox(prisma);
    if (result.fetched > 0) logger.info("worker.outbox", { ...result });
    if (result.deadLettered > 0) {
      await alertAdmin({
        severity: "critical",
        code: "outbox.dead_letter",
        title: `${result.deadLettered} domain event(s) dead-lettered`,
        detail: { ...result },
      });
    }
  });

  // --- Inbound webhooks (FR-22) -----------------------------------------
  // 13 owns the inbox sweep (OTA reservation ingestion, deduped once). 06/12
  // verify + handle their webhooks inline in the route handlers.
  await boss.work(JOBS.processInbox, async () => {
    const result = await channelsProcessInbox(prisma);
    if (result.fetched > 0) logger.info("worker.inbox", { ...result });
  });

  // --- Daily backup (FR-23/24/25) ---------------------------------------
  await boss.work(JOBS.dailyBackup, async () => {
    await runBackup(prisma);
  });

  // --- 12 communications: dispatch queued messages + schedule sweep -----
  // Sending is off the request write path (12 design.md); the outbox is drained
  // here, and scheduled automations (e.g. pre-arrival) are anchored every 5 min.
  await boss.work(JOBS.dispatchMessages, async () => {
    const r = await dispatchQueuedMessages(prisma);
    if (r.fetched) logger.info("worker.comms_dispatch", { ...r });
  });
  await boss.work(JOBS.scheduleComms, async () => {
    await scheduleTick(prisma);
  });

  // --- 13 channels: pull active OTAs + age stale outbound pushes ---------
  await boss.work(JOBS.pullChannels, async () => {
    await pullActiveChannels(prisma);
  });
  await boss.work(JOBS.channelDeadLetter, async () => {
    await deadLetterStalePushes(prisma);
  });

  // --- 24 dynamic pricing: nightly suggestion sweep ---------------------
  // No-op until a runner user (with pricing:approve) is configured; suggestions
  // are never auto-applied (24 FR-1) — a human approves them.
  await boss.work(JOBS.runPricing, async () => {
    const runnerId = process.env.PRICING_RUNNER_USER_ID;
    if (!runnerId) return;
    const claims = await assembleClaims(prisma, runnerId);
    if (!claims) return;
    const from = new Date();
    const to = new Date();
    to.setUTCDate(to.getUTCDate() + 30);
    for (const propertyId of claims.accessiblePropertyIds) {
      await runPricingEngine(claims, { propertyId, from, to });
    }
  });

  // --- 23 booking engine: release expired web-order holds ---------------
  await boss.work(JOBS.releaseWebOrders, async () => {
    const r = await releaseExpiredWebOrders(prisma);
    if (r.released > 0) logger.info("worker.web_orders_expired", { ...r });
  });

  // --- 22 accounting sync: push enqueued docs; retry FAILED (self-heals) -
  await boss.work(JOBS.syncAccounting, async () => {
    const r = await syncWorker(prisma);
    if (r.processed > 0) logger.info("worker.accounting_sync", { ...r });
  });

  // Schedules. Cron is interpreted in the property-local operating timezone;
  // the backup runs before the 03:00 night-audit window so a restore point
  // exists for the day just closed.
  await boss.schedule(JOBS.dispatchOutbox, "* * * * *", undefined, { tz: "Asia/Kolkata" });
  await boss.schedule(JOBS.processInbox, "* * * * *", undefined, { tz: "Asia/Kolkata" });
  await boss.schedule(JOBS.dailyBackup, "30 2 * * *", undefined, { tz: "Asia/Kolkata" });
  await boss.schedule(JOBS.dispatchMessages, "* * * * *", undefined, { tz: "Asia/Kolkata" });
  await boss.schedule(JOBS.scheduleComms, "*/5 * * * *", undefined, { tz: "Asia/Kolkata" });
  await boss.schedule(JOBS.pullChannels, "* * * * *", undefined, { tz: "Asia/Kolkata" });
  await boss.schedule(JOBS.channelDeadLetter, "*/5 * * * *", undefined, { tz: "Asia/Kolkata" });
  await boss.schedule(JOBS.runPricing, "0 3 * * *", undefined, { tz: "Asia/Kolkata" });
  await boss.schedule(JOBS.releaseWebOrders, "* * * * *", undefined, { tz: "Asia/Kolkata" });
  await boss.schedule(JOBS.syncAccounting, "* * * * *", undefined, { tz: "Asia/Kolkata" });

  logger.info("worker.scheduled", {
    dispatchOutbox: "every minute",
    processInbox: "every minute",
    dailyBackup: "02:30 Asia/Kolkata",
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("worker.stopping", { signal });
    // Graceful: let in-flight jobs finish rather than leaving a half-dispatched
    // batch — at-least-once tolerates a repeat, but a clean stop is cheaper.
    await boss.stop({ graceful: true });
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(async (e: unknown) => {
  logger.error("worker.crashed", { error: e instanceof Error ? e.message : String(e) });
  await prisma.$disconnect();
  process.exit(1);
});
