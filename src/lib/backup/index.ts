/**
 * Daily backup job — 00 T-18 (FR-23/24/25, AC-22/23).
 *
 * Records a `BackupRun` row for EVERY attempt (FR-24: success and failure are
 * both reported) and alerts an administrator either way. With no live
 * credentials it degrades to the encrypted local target and still completes
 * (FR-25 / AC-23).
 */
import { spawn } from "node:child_process";
import type { PrismaClient } from "@prisma/client";
import { alertAdmin } from "../alerts";
import { logger } from "../logger";
import { resolveBackupTarget, type BackupTarget } from "./targets";

export type BackupOptions = {
  target?: BackupTarget;
  retentionDays?: number;
  now?: Date;
  /** Injected for tests; defaults to a real `pg_dump`. */
  dump?: () => Promise<Buffer>;
};

export type BackupOutcome = {
  runId: string;
  status: "SUCCESS" | "FAILED";
  target: string | null;
  sizeBytes: number | null;
  retentionRemoved: number;
  error: string | null;
};

/**
 * Capture the database with `pg_dump`.
 *
 * Uses DIRECT_URL, not DATABASE_URL: a transaction-mode pooler cannot serve a
 * consistent full dump (see ADR-0005).
 */
export function pgDump(databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!databaseUrl) {
      reject(new Error("No DIRECT_URL/DATABASE_URL to back up."));
      return;
    }

    // Windows Postgres installers do not put bin/ on PATH, and a container may
    // ship a versioned binary. PG_DUMP_PATH lets deployment point at the right
    // one without a code change.
    const binary = process.env.PG_DUMP_PATH ?? "pg_dump";

    const child = spawn(binary, ["--format=custom", "--no-owner", "--no-acl", databaseUrl], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => errors.push(c));

    child.on("error", (e) =>
      reject(new Error(`pg_dump could not be started (is it on PATH?): ${e.message}`)),
    );
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`pg_dump exited ${code}: ${Buffer.concat(errors).toString().slice(0, 500)}`));
    });
  });
}

function backupFilename(now: Date): string {
  // Colons are illegal in object keys on some stores; use a flat timestamp.
  return `woodpecker-${now.toISOString().replace(/[:.]/g, "-")}.dump`;
}

/**
 * Run one backup end-to-end.
 *
 * Never throws: a failure is recorded on `BackupRun` and alerted, because a
 * crashed job that leaves no trace is exactly the failure mode FR-24 exists to
 * prevent.
 */
export async function runBackup(
  db: PrismaClient,
  options: BackupOptions = {},
): Promise<BackupOutcome> {
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
  const target = options.target ?? resolveBackupTarget();
  const dump = options.dump ?? (() => pgDump());

  const run = await db.backupRun.create({
    data: { startedAt: now, status: "RUNNING", target: target.name },
    select: { id: true },
  });

  try {
    const contents = await dump();
    const stored = await target.store({ filename: backupFilename(now), contents });

    if (!stored.encrypted) {
      // Refuse to call an unencrypted backup a success — FR-23 requires it.
      throw new Error("Backup target returned unencrypted output; refusing to record success.");
    }

    const retentionRemoved = await target.enforceRetention(retentionDays, now);

    await db.backupRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        completedAt: new Date(now.getTime()),
        target: stored.target,
        sizeBytes: BigInt(stored.sizeBytes),
      },
    });

    await alertAdmin({
      severity: "info",
      code: "backup.succeeded",
      title: "Daily backup completed",
      detail: {
        runId: run.id,
        target: stored.target,
        sizeBytes: stored.sizeBytes,
        live: target.isLive,
        retentionRemoved,
        // Make the degraded path visible rather than quietly "fine".
        mode: target.isLive ? "live" : "sandbox",
      },
    });

    logger.info("backup.succeeded", { runId: run.id, live: target.isLive });

    return {
      runId: run.id,
      status: "SUCCESS",
      target: stored.target,
      sizeBytes: stored.sizeBytes,
      retentionRemoved,
      error: null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    await db.backupRun.update({
      where: { id: run.id },
      data: { status: "FAILED", completedAt: new Date(now.getTime()), error: message.slice(0, 1000) },
    });

    await alertAdmin({
      severity: "critical",
      code: "backup.failed",
      title: "Daily backup FAILED",
      detail: { runId: run.id, target: target.name, error: message },
    });

    logger.error("backup.failed", { runId: run.id, error: message });

    return {
      runId: run.id,
      status: "FAILED",
      target: target.name,
      sizeBytes: null,
      retentionRemoved: 0,
      error: message,
    };
  }
}

/**
 * Backup health for the ops dashboard / restore drill
 * (non-functional-requirements.md: "daily backup success ≥ 99%").
 */
export async function backupSuccessRate(
  db: PrismaClient,
  sinceDays = 30,
  now: Date = new Date(),
): Promise<{ total: number; succeeded: number; rate: number }> {
  const since = new Date(now.getTime() - sinceDays * 24 * 60 * 60_000);
  const [total, succeeded] = await Promise.all([
    db.backupRun.count({ where: { startedAt: { gte: since } } }),
    db.backupRun.count({ where: { startedAt: { gte: since }, status: "SUCCESS" } }),
  ]);
  return { total, succeeded, rate: total === 0 ? 1 : succeeded / total };
}

export * from "./targets";
