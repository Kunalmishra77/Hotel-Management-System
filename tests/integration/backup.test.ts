/**
 * Traceability: 00 T-18 — FR-23/24/25, AC-22/23.
 *
 * The dump is injected so these tests never shell out to pg_dump; everything
 * downstream of it (encryption, storage, retention, BackupRun, alerting) is the
 * real code path.
 */
import { createPrismaClient } from "@/lib/db/client";
import { mkdtemp, readFile, readdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupSuccessRate,
  encryptBackup,
  localBackupTarget,
  resolveBackupTarget,
  runBackup,
} from "@/lib/backup";
import {
  resetAlertTransport,
  setAlertTransport,
  type Alert,
} from "@/lib/alerts";

// Same client configuration as production (transaction budget, logging),
// so tests exercise the real behaviour rather than Prisma defaults.
const prisma = createPrismaClient();
const NOW = new Date("2026-07-21T02:30:00.000Z");
const KEY = Buffer.alloc(32, 7).toString("base64");

const DUMP = Buffer.from("PGDMP fake dump contents with SECRET guest data");

let captured: Alert[] = [];

beforeEach(() => {
  captured = [];
  setAlertTransport({
    name: "capture",
    async send(alert) {
      captured.push(alert);
    },
  });
});

afterEach(async () => {
  resetAlertTransport();
  await prisma.backupRun.deleteMany({ where: { target: { contains: "vitest-backup" } } });
});

afterAll(async () => {
  await prisma.backupRun.deleteMany({});
  await prisma.$disconnect();
});

async function tempTarget() {
  const dir = await mkdtemp(join(tmpdir(), "vitest-backup-"));
  return { dir, target: localBackupTarget({ directory: dir, encryptionKey: KEY }) };
}

describe("encryptBackup (FR-23 — encrypted at rest)", () => {
  it("produces ciphertext that does not contain the plaintext", () => {
    const enc = encryptBackup(DUMP, KEY);
    expect(enc.includes(DUMP)).toBe(false);
    expect(enc.toString("utf8")).not.toContain("SECRET guest data");
  });

  it("is non-deterministic (random IV per backup)", () => {
    expect(encryptBackup(DUMP, KEY).equals(encryptBackup(DUMP, KEY))).toBe(false);
  });

  it("refuses a key that is not 32 bytes", () => {
    expect(() => encryptBackup(DUMP, Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("runBackup — success path (FR-23/24, AC-22)", () => {
  it("stores an encrypted artifact and records a SUCCESS BackupRun", async () => {
    const { dir, target } = await tempTarget();

    const outcome = await runBackup(prisma, {
      target,
      now: NOW,
      dump: async () => DUMP,
    });

    expect(outcome.status).toBe("SUCCESS");
    expect(outcome.sizeBytes).toBeGreaterThan(0);

    const run = await prisma.backupRun.findUniqueOrThrow({ where: { id: outcome.runId } });
    expect(run.status).toBe("SUCCESS");
    expect(run.completedAt).not.toBeNull();
    expect(run.sizeBytes).not.toBeNull();
    expect(run.error).toBeNull();

    // The bytes on disk are genuinely encrypted, not merely labelled so.
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]!.endsWith(".enc")).toBe(true);
    const written = await readFile(join(dir, files[0]!));
    expect(written.includes(DUMP)).toBe(false);
    expect(written.toString("utf8")).not.toContain("SECRET guest data");
  });

  it("alerts an administrator on success (FR-24 — success is reported too)", async () => {
    const { target } = await tempTarget();
    await runBackup(prisma, { target, now: NOW, dump: async () => DUMP });

    const alert = captured.find((a) => a.code === "backup.succeeded");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("info");
  });

  it("labels a sandbox run as sandbox, so a degraded backup is never mistaken for live", async () => {
    const { target } = await tempTarget();
    await runBackup(prisma, { target, now: NOW, dump: async () => DUMP });

    const alert = captured.find((a) => a.code === "backup.succeeded");
    expect(alert!.detail!.mode).toBe("sandbox");
    expect(alert!.detail!.live).toBe(false);
  });
});

describe("runBackup — failure path (FR-24)", () => {
  it("records FAILED and alerts critically when the dump fails", async () => {
    const { target } = await tempTarget();

    const outcome = await runBackup(prisma, {
      target,
      now: NOW,
      dump: async () => {
        throw new Error("pg_dump exited 1");
      },
    });

    expect(outcome.status).toBe("FAILED");
    expect(outcome.error).toContain("pg_dump exited 1");

    const run = await prisma.backupRun.findUniqueOrThrow({ where: { id: outcome.runId } });
    expect(run.status).toBe("FAILED");
    expect(run.completedAt).not.toBeNull(); // the attempt is closed out, not left RUNNING
    expect(run.error).toContain("pg_dump exited 1");

    const alert = captured.find((a) => a.code === "backup.failed");
    expect(alert?.severity).toBe("critical");
  });

  it("does not throw — a failed backup must not crash the worker", async () => {
    const { target } = await tempTarget();
    await expect(
      runBackup(prisma, {
        target,
        now: NOW,
        dump: async () => {
          throw new Error("boom");
        },
      }),
    ).resolves.toMatchObject({ status: "FAILED" });
  });

  it("refuses to record success if a target returns unencrypted output", async () => {
    // Guards the FR-23 "encrypted" requirement against a future target that
    // forgets to encrypt.
    const outcome = await runBackup(prisma, {
      now: NOW,
      dump: async () => DUMP,
      target: {
        name: "vitest-backup-plaintext",
        isLive: false,
        async store() {
          return { target: "vitest-backup-plaintext", sizeBytes: 10, encrypted: false };
        },
        async enforceRetention() {
          return 0;
        },
      },
    });

    expect(outcome.status).toBe("FAILED");
    expect(outcome.error).toContain("unencrypted");
  });
});

describe("retention (FR-23)", () => {
  it("deletes artifacts older than the window and keeps newer ones", async () => {
    const { dir, target } = await tempTarget();

    // The artifact name is derived from `now`, so the two runs must use
    // different instants — as real daily backups do. Reusing one instant makes
    // the second run overwrite the first file instead of adding to it.
    const firstRun = new Date(NOW.getTime() - 45 * 24 * 60 * 60_000);
    await runBackup(prisma, { target, now: firstRun, dump: async () => DUMP, retentionDays: 30 });

    // Age the stored file to match the instant it claims to be from.
    const [file] = await readdir(dir);
    await utimes(join(dir, file!), firstRun, firstRun);

    const second = await runBackup(prisma, {
      target,
      now: NOW,
      dump: async () => DUMP,
      retentionDays: 30,
    });

    expect(second.retentionRemoved).toBe(1);
    const remaining = await readdir(dir);
    expect(remaining).toHaveLength(1); // only the fresh one
    expect(remaining[0]).not.toBe(file);
  });

  it("is a no-op when nothing is old enough, and keeps both artifacts", async () => {
    const { dir, target } = await tempTarget();
    const yesterday = new Date(NOW.getTime() - 24 * 60 * 60_000);

    await runBackup(prisma, { target, now: yesterday, dump: async () => DUMP, retentionDays: 30 });
    const second = await runBackup(prisma, {
      target,
      now: NOW,
      dump: async () => DUMP,
      retentionDays: 30,
    });

    expect(second.retentionRemoved).toBe(0);
    expect(await readdir(dir)).toHaveLength(2);
  });
});

describe("resolveBackupTarget — sandbox fallback (FR-25 / AC-23)", () => {
  it("falls back to the local target when no credentials exist", () => {
    const target = resolveBackupTarget({
      PII_ENCRYPTION_KEY: KEY,
      BACKUP_LOCAL_DIR: join(tmpdir(), "vitest-backup-resolve"),
    } as unknown as NodeJS.ProcessEnv);

    expect(target.isLive).toBe(false);
    expect(target.name.startsWith("local:")).toBe(true);
  });

  it("still falls back when live is REQUESTED but credentials are incomplete", () => {
    // Half a configuration must not be treated as production.
    const target = resolveBackupTarget({
      PII_ENCRYPTION_KEY: KEY,
      BACKUP_MODE: "live",
      BACKUP_TARGET_BUCKET: "woodpecker-backups",
      STORAGE_REGION: "ap-south-1",
      // access/secret keys missing
    } as unknown as NodeJS.ProcessEnv);

    expect(target.isLive).toBe(false);
  });

  it("selects the live S3 target when fully configured in an India region", () => {
    const target = resolveBackupTarget({
      PII_ENCRYPTION_KEY: KEY,
      BACKUP_MODE: "live",
      BACKUP_TARGET_BUCKET: "woodpecker-backups",
      STORAGE_REGION: "ap-south-1",
      STORAGE_ACCESS_KEY: "AKIA-test",
      STORAGE_SECRET_KEY: "secret-test",
    } as unknown as NodeJS.ProcessEnv);

    expect(target.isLive).toBe(true);
    expect(target.name).toContain("s3://woodpecker-backups");
  });

  it("REFUSES a live target outside India — DPDP residency (compliance.md)", () => {
    expect(() =>
      resolveBackupTarget({
        PII_ENCRYPTION_KEY: KEY,
        BACKUP_MODE: "live",
        BACKUP_TARGET_BUCKET: "woodpecker-backups",
        STORAGE_REGION: "us-east-1",
        STORAGE_ACCESS_KEY: "AKIA-test",
        STORAGE_SECRET_KEY: "secret-test",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/outside India/);
  });

  it("completes a full run with zero external accounts (AC-23)", async () => {
    // The whole point of FR-25: dev/CI runs end-to-end with no credentials.
    const dir = await mkdtemp(join(tmpdir(), "vitest-backup-zero-"));
    const target = resolveBackupTarget({
      PII_ENCRYPTION_KEY: KEY,
      BACKUP_LOCAL_DIR: dir,
    } as unknown as NodeJS.ProcessEnv);

    const outcome = await runBackup(prisma, { target, now: NOW, dump: async () => DUMP });
    expect(outcome.status).toBe("SUCCESS");
    expect((await readdir(dir))).toHaveLength(1);
  });
});

describe("backupSuccessRate (NFR — ≥99% daily success)", () => {
  it("reports the rate over the window", async () => {
    const { target } = await tempTarget();
    await runBackup(prisma, { target, now: NOW, dump: async () => DUMP });
    await runBackup(prisma, {
      target,
      now: NOW,
      dump: async () => {
        throw new Error("nope");
      },
    });

    const stats = await backupSuccessRate(prisma, 30, NOW);
    expect(stats.total).toBeGreaterThanOrEqual(2);
    expect(stats.rate).toBeGreaterThan(0);
    expect(stats.rate).toBeLessThan(1);
  });

  it("treats an empty window as healthy rather than dividing by zero", async () => {
    await prisma.backupRun.deleteMany({});
    const stats = await backupSuccessRate(prisma, 30, NOW);
    expect(stats.total).toBe(0);
    expect(stats.rate).toBe(1);
  });
});
