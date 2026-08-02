/**
 * Backup targets — 00 FR-23/25.
 *
 * FR-23: a separate, ENCRYPTED, India-region (`DATA_REGION`) location with a
 * retention policy.
 * FR-25: "If live backup-storage credentials are absent, degrade to the
 * sandbox/local target and still complete + record the run — dev/CI must run
 * end-to-end with zero external accounts."
 *
 * Both targets implement one interface, so `runBackup` contains no branching on
 * environment and the sandbox path exercises the same code as production.
 */
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../logger";

export type BackupArtifact = {
  /** Logical name, e.g. "woodpecker-2026-07-21.sql". */
  filename: string;
  contents: Buffer;
};

export type StoredBackup = {
  /** Where it landed — recorded on BackupRun.target. */
  target: string;
  sizeBytes: number;
  /** True when the bytes were encrypted before leaving this process. */
  encrypted: boolean;
};

export type BackupTarget = {
  name: string;
  /** True only for a real, credentialed remote target. */
  isLive: boolean;
  store: (artifact: BackupArtifact) => Promise<StoredBackup>;
  /** Delete anything older than the retention window; returns how many. */
  enforceRetention: (retentionDays: number, now: Date) => Promise<number>;
};

/**
 * Encrypt bytes at rest with AES-256-GCM before they leave the process
 * (FR-23 "encrypted"; security.md "encryption at rest").
 *
 * Uses the same PII key material. Envelope: [12-byte IV][ciphertext][16-byte tag].
 */
export function encryptBackup(plaintext: Buffer, keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("Backup encryption key must decode to 32 bytes (AES-256).");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}

export function checksum(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Local filesystem target — the zero-credential fallback (FR-25).
 *
 * Still encrypts and still enforces retention, so the sandbox path is a genuine
 * rehearsal of the production path rather than a no-op that hides bugs until
 * go-live.
 */
export function localBackupTarget(options: {
  directory: string;
  encryptionKey: string;
}): BackupTarget {
  return {
    name: `local:${options.directory}`,
    isLive: false,

    async store(artifact) {
      await mkdir(options.directory, { recursive: true });
      const encrypted = encryptBackup(artifact.contents, options.encryptionKey);
      const path = join(options.directory, `${artifact.filename}.enc`);
      await writeFile(path, encrypted);
      return { target: path, sizeBytes: encrypted.byteLength, encrypted: true };
    },

    async enforceRetention(retentionDays, now) {
      let removed = 0;
      const cutoff = now.getTime() - retentionDays * 24 * 60 * 60_000;
      let entries: string[];
      try {
        entries = await readdir(options.directory);
      } catch {
        return 0; // nothing stored yet
      }

      for (const entry of entries) {
        if (!entry.endsWith(".enc")) continue;
        const path = join(options.directory, entry);
        const info = await stat(path);
        if (info.mtimeMs < cutoff) {
          await rm(path, { force: true });
          removed += 1;
        }
      }
      return removed;
    },
  };
}

/**
 * Choose the target for the current environment.
 *
 * Live requires BOTH a bucket and credentials. Anything less falls back to
 * local — silently going "live" with half a configuration would be worse than
 * an obviously-local backup.
 */
export function resolveBackupTarget(env: NodeJS.ProcessEnv = process.env): BackupTarget {
  const encryptionKey = env.PII_ENCRYPTION_KEY ?? "";
  const directory = env.BACKUP_LOCAL_DIR ?? join(process.cwd(), ".backups");

  const wantsLive = env.BACKUP_MODE === "live";
  const hasCredentials = Boolean(
    env.BACKUP_TARGET_BUCKET && env.STORAGE_ACCESS_KEY && env.STORAGE_SECRET_KEY,
  );

  if (wantsLive && !hasCredentials) {
    // Loud, because someone intended production behaviour and is not getting it.
    logger.warn("backup.live_requested_without_credentials", {
      reason: "BACKUP_TARGET_BUCKET / STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY incomplete",
      fallback: "local",
    });
  }

  if (!wantsLive || !hasCredentials) {
    return localBackupTarget({ directory, encryptionKey });
  }

  // Region guard — compliance.md requires India residency for backups.
  const region = env.STORAGE_REGION ?? "";
  if (!region.startsWith("ap-south")) {
    throw new Error(
      `Backup region "${region}" is outside India. compliance.md (DPDP) requires ` +
        "ap-south-1/ap-south-2 for the database, backups and object storage.",
    );
  }

  return s3BackupTarget({
    bucket: env.BACKUP_TARGET_BUCKET!,
    region,
    encryptionKey,
  });
}

/**
 * S3-compatible target. The SDK client is created lazily so that dev, CI and
 * the unit tests never need the dependency wired up or credentials present.
 */
export function s3BackupTarget(options: {
  bucket: string;
  region: string;
  encryptionKey: string;
  prefix?: string;
}): BackupTarget {
  const prefix = options.prefix ?? "db";

  return {
    name: `s3://${options.bucket}/${prefix}`,
    isLive: true,

    async store(artifact) {
      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({ region: options.region });
      const encrypted = encryptBackup(artifact.contents, options.encryptionKey);
      const key = `${prefix}/${artifact.filename}.enc`;

      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: encrypted,
          // Belt and braces: we encrypt client-side AND ask for server-side
          // encryption, so a misconfigured bucket policy is not the only guard.
          ServerSideEncryption: "AES256",
          ChecksumSHA256: undefined,
          Metadata: { checksum: checksum(artifact.contents) },
        }),
      );

      return {
        target: `s3://${options.bucket}/${key}`,
        sizeBytes: encrypted.byteLength,
        encrypted: true,
      };
    },

    async enforceRetention(retentionDays, now) {
      const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = await import(
        "@aws-sdk/client-s3"
      );
      const client = new S3Client({ region: options.region });
      const cutoff = now.getTime() - retentionDays * 24 * 60 * 60_000;

      const listed = await client.send(
        new ListObjectsV2Command({ Bucket: options.bucket, Prefix: `${prefix}/` }),
      );

      let removed = 0;
      for (const object of listed.Contents ?? []) {
        if (!object.Key || !object.LastModified) continue;
        if (object.LastModified.getTime() >= cutoff) continue;
        await client.send(
          new DeleteObjectCommand({ Bucket: options.bucket, Key: object.Key }),
        );
        removed += 1;
      }
      return removed;
    },
  };
}
