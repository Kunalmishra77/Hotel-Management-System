/**
 * Large-file import jobs — 26 T-19 (FR-11, AC-15). A file over
 * `IMPORT_INLINE_LIMIT` rows is validated/committed by a pg-boss job instead of
 * inline, so the request never blocks; the parse is streamed and rows are
 * processed in chunks (bounded memory), with progress persisted to the batch and
 * a completion signal (VALIDATED, or the `ImportCommitted` event).
 *
 * The job has no HTTP session, so it rebuilds the initiating admin's claims from
 * `ImportBatch.createdById` via `assembleClaims` and runs under that context.
 * Validation (pure reads) runs fully in the worker; commit reaches the owning
 * modules (see report: guest/balance creates use 04/06 request-session actions —
 * a system-context variant is the noted follow-up; reservation ingest via 03's
 * channel path already runs headless).
 */
import type { PrismaClient } from "@prisma/client";
import type PgBoss from "pg-boss";
import { assembleClaims } from "@/lib/auth/claims";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db";
import { loadBatch } from "./internal";
import { runValidation } from "./validate-core";
import { runCommit } from "./commit-core";
import type { SessionClaims } from "@/lib/auth/claims";

export const JOBS_IMPORT = {
  validate: "import-validate",
  commit: "import-commit",
} as const;

export type ImportJobData = { batchId: string; userId: string };

/** Rebuild the initiator's claims from the batch's creator (headless context). */
async function contextFor(prisma: PrismaClient, data: ImportJobData): Promise<SessionClaims> {
  const user = await assembleClaims(prisma, data.userId);
  if (!user) throw new Error(`import job: no claims for user ${data.userId}`);
  return user;
}

export async function runImportValidateJob(prisma: PrismaClient, data: ImportJobData): Promise<void> {
  const user = await contextFor(prisma, data);
  const batch = await loadBatch(user.orgId, data.batchId);
  const counts = await runValidation(user, batch, (done, total) =>
    logger.info("import.validate.progress", { batchId: batch.id, done, total }),
  );
  logger.info("import.validate.done", { batchId: batch.id, ...counts });
}

export async function runImportCommitJob(prisma: PrismaClient, data: ImportJobData): Promise<void> {
  const user = await contextFor(prisma, data);
  const batch = await loadBatch(user.orgId, data.batchId);
  const summary = await runCommit(user, batch, (done, total) =>
    logger.info("import.commit.progress", { batchId: batch.id, done, total }),
  );
  logger.info("import.commit.done", { batchId: batch.id, ...summary });
}

/**
 * Register the import workers on the shared pg-boss instance. Called from
 * scripts/worker.ts (integration delta). Typed loosely to avoid a hard pg-boss
 * type dependency in the web bundle.
 */
export function registerImportJobs(
  boss: { work: (name: string, handler: (job: { data: ImportJobData }) => Promise<void>) => Promise<unknown> },
  prisma: PrismaClient,
): void {
  void boss.work(JOBS_IMPORT.validate, (job) => runImportValidateJob(prisma, job.data));
  void boss.work(JOBS_IMPORT.commit, (job) => runImportCommitJob(prisma, job.data));
}

// --- Enqueue (web process) --------------------------------------------------
let bossSingleton: PgBoss | null = null;

async function getBoss(): Promise<PgBoss> {
  if (bossSingleton) return bossSingleton;
  const { default: PgBossCtor } = await import("pg-boss");
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DIRECT_URL/DATABASE_URL required to enqueue import jobs.");
  const boss = new PgBossCtor({ connectionString, schema: "pgboss" });
  await boss.start();
  bossSingleton = boss;
  return boss;
}

/** Enqueue a large-file import job from a server action. */
export async function enqueueImportJob(name: string, data: ImportJobData): Promise<void> {
  const boss = await getBoss();
  await boss.send(name, data);
  // Mark the batch as picked up so the UI can show "processing" (commit uses the
  // COMMITTING status; validate has no intermediate enum state, so the row status
  // stays PENDING until the job flips the batch to VALIDATED).
  if (name === JOBS_IMPORT.commit) {
    await db.unscoped().importBatch.updateMany({ where: { id: data.batchId }, data: { status: "COMMITTING" } });
  }
}
