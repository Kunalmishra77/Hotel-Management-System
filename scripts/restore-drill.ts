/**
 * Restore drill — 00 T-19.
 *
 * security.md / non-functional-requirements.md require a documented, PERIODICALLY
 * DRILLED restore. An untested backup is not a backup: the failure modes that
 * matter (wrong key, truncated upload, unrestorable dump, missing extension) are
 * invisible until someone actually restores.
 *
 * This script restores the latest artifact into a THROWAWAY database and
 * verifies it, then reports. It never touches the live database.
 *
 *   npm run restore:drill                 # newest local artifact
 *   npm run restore:drill -- <file.enc>   # a specific artifact
 *
 * Runbook + acceptance criteria: docs/runbooks/restore-drill.md
 */
import "dotenv/config";

import { spawn } from "node:child_process";
import { createDecipheriv } from "node:crypto";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../src/lib/logger";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Mirror of encryptBackup in src/lib/backup/targets.ts. */
function decryptBackup(payload: Buffer, keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("PII_ENCRYPTION_KEY must decode to 32 bytes.");

  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const body = payload.subarray(IV_BYTES, payload.length - TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => errors.push(c));
    child.on("error", (e) => reject(new Error(`${command} could not start: ${e.message}`)));
    child.on("close", (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString(),
        stderr: Buffer.concat(errors).toString(),
      }),
    );
  });
}

/** Same override as the backup side — Windows/container binaries vary. */
function pgBinary(name: "pg_restore"): string {
  const explicit = process.env.PG_RESTORE_PATH;
  if (explicit) return explicit;
  const dumpPath = process.env.PG_DUMP_PATH;
  if (dumpPath) return dumpPath.replace(/pg_dump(\.exe)?$/i, (m) => m.replace("pg_dump", name));
  return name;
}

async function newestArtifact(directory: string): Promise<string> {
  const entries = (await readdir(directory)).filter((f) => f.endsWith(".enc"));
  if (entries.length === 0) {
    throw new Error(
      `No .enc artifacts in ${directory}. Run a backup first (npm run backup:now).`,
    );
  }
  const withTimes = await Promise.all(
    entries.map(async (name) => ({ name, mtime: (await stat(join(directory, name))).mtimeMs })),
  );
  withTimes.sort((a, b) => b.mtime - a.mtime);
  return join(directory, withTimes[0]!.name);
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const key = process.env.PII_ENCRYPTION_KEY;
  if (!key) throw new Error("PII_ENCRYPTION_KEY is required to decrypt a backup.");

  const directory = process.env.BACKUP_LOCAL_DIR ?? join(process.cwd(), ".backups");
  const explicit = process.argv[2];
  const artifactPath = explicit ?? (await newestArtifact(directory));

  console.log(`Restore drill\n  artifact: ${artifactPath}`);

  // 1. Decrypt — proves the key in use can actually open the artifact.
  const encrypted = await readFile(artifactPath);
  let plaintext: Buffer;
  try {
    plaintext = decryptBackup(encrypted, key);
  } catch {
    throw new Error(
      "DECRYPTION FAILED. The artifact is corrupt or PII_ENCRYPTION_KEY has rotated " +
        "without re-encrypting existing backups. This is the drill catching a real problem.",
    );
  }
  console.log(`  decrypted: ${plaintext.byteLength} bytes`);

  // 2. Structural check — does the decrypted blob parse as a restorable dump?
  // This runs in BOTH modes: it is cheap and it catches a truncated or
  // corrupted artifact without needing a database at all.
  const workDir = await mkdtemp(join(tmpdir(), "wp-restore-"));
  const dumpPath = join(workDir, "restore.dump");
  await writeFile(dumpPath, plaintext);

  if (!plaintext.subarray(0, 5).equals(Buffer.from("PGDMP"))) {
    throw new Error(
      "Decrypted artifact is not a pg_dump custom-format archive (missing PGDMP header). " +
        "The backup is corrupt.",
    );
  }

  const listing = await run(pgBinary("pg_restore"), ["--list", dumpPath]);
  if (listing.code !== 0) {
    throw new Error(`pg_restore --list rejected the archive: ${listing.stderr.trim().slice(0, 400)}`);
  }
  const tableCount = (listing.stdout.match(/^\d+;.*TABLE DATA /gm) ?? []).length;
  console.log(`  archive valid: ${tableCount} table-data entries`);

  if (tableCount === 0) {
    throw new Error("Archive contains no table data — the dump captured an empty database.");
  }

  // 3. Restore into a throwaway database.
  const target = process.env.RESTORE_DRILL_URL;
  if (!target) {
    console.log(
      "\n  RESTORE_DRILL_URL not set — decrypt + archive-validation only.\n" +
        "  Set it to a scratch database to exercise the full restore:\n" +
        '    RESTORE_DRILL_URL="postgresql://…/woodpecker_drill" npm run restore:drill\n',
    );
    console.log(`Drill (partial) PASSED in ${Date.now() - startedAt}ms.`);
    return;
  }

  console.log("  restoring…");
  const restore = await run(pgBinary("pg_restore"), [
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-acl",
    "--dbname",
    target,
    dumpPath,
  ]);
  // pg_restore exits non-zero on benign warnings with --clean; surface them but
  // judge success by the verification step below.
  if (restore.stderr.trim()) console.log(`  pg_restore notes: ${restore.stderr.trim().slice(0, 400)}`);

  // 4. Verify — the part that makes this a drill rather than a file copy.
  const { PrismaClient } = await import("@prisma/client");
  const drillDb = new PrismaClient({ datasources: { db: { url: target } } });
  try {
    const [orgs, users, properties, audits] = await Promise.all([
      drillDb.organization.count(),
      drillDb.user.count(),
      drillDb.property.count(),
      drillDb.auditLog.count(),
    ]);

    console.log(
      `  verified: organizations=${orgs} users=${users} properties=${properties} auditLogs=${audits}`,
    );

    if (orgs === 0 || users === 0) {
      throw new Error(
        "RESTORE VERIFICATION FAILED: the restored database has no organisation or no users.",
      );
    }

    logger.info("restore_drill.succeeded", {
      artifact: artifactPath,
      orgs,
      users,
      properties,
      durationMs: Date.now() - startedAt,
    });
    console.log(`\nDrill PASSED in ${Date.now() - startedAt}ms.`);
  } finally {
    await drillDb.$disconnect();
  }
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  logger.error("restore_drill.failed", { error: message });
  console.error(`\nDrill FAILED: ${message}`);
  process.exitCode = 1;
});
