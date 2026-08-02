/**
 * Object storage — ID scans, invoice PDFs, images.
 *
 * tech-stack.md: S3-compatible (AWS S3 `ap-south-1` / MinIO). integrations.md:
 * with no live credentials the adapter runs in a local sandbox and the whole
 * app still works — dev/CI need zero external accounts.
 *
 * Provider-abstracted exactly like `lib/backup/targets.ts`: one interface, a
 * local target and an S3 target, chosen by env. 04 uploads ID scans through
 * this; the DB row keeps only `scanObjectKey` + `scanChecksum`, never bytes
 * (04 FR-7).
 *
 * Scans are PII, so bytes are ENCRYPTED at rest before they leave the process —
 * the same AES-256-GCM envelope as backups — regardless of target.
 */
import { createDecipheriv, createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { encryptBackup } from "../backup/targets";
import { logger } from "../logger";

export type StoredObject = {
  /** The key recorded on the DB row (`scanObjectKey`). */
  key: string;
  /** SHA-256 of the PLAINTEXT bytes (`scanChecksum`) — integrity, not secrecy. */
  checksum: string;
  sizeBytes: number;
  encrypted: boolean;
};

export type StorageAdapter = {
  name: string;
  isLive: boolean;
  /** Store bytes under `key`; returns the key + plaintext checksum. */
  put(key: string, bytes: Buffer, options?: { contentType?: string }): Promise<StoredObject>;
  /** Fetch + decrypt. Used by export and by an authorized scan view. */
  get(key: string): Promise<Buffer>;
  /** Remove an object — used by erase (04 FR-14). */
  delete(key: string): Promise<void>;
};

function checksum(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function encryptionKey(env: NodeJS.ProcessEnv): string {
  const key = env.PII_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("PII_ENCRYPTION_KEY is required to store PII objects (ID scans).");
  }
  return key;
}

/** Reverse of encryptBackup's [iv|ciphertext|tag] envelope. */
function decrypt(payload: Buffer, keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const body = payload.subarray(12, payload.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/**
 * Local filesystem target — the zero-credential sandbox (integrations.md).
 *
 * Still encrypts, so the sandbox is a genuine rehearsal of production and a
 * scan on a dev disk is not readable as a plain image.
 */
export function localStorageAdapter(options: {
  directory: string;
  encryptionKey: string;
}): StorageAdapter {
  const pathFor = (key: string) => join(options.directory, `${key}.enc`);

  return {
    name: `local:${options.directory}`,
    isLive: false,

    async put(key, bytes) {
      const encrypted = encryptBackup(bytes, options.encryptionKey);
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, encrypted);
      return {
        key,
        checksum: checksum(bytes),
        sizeBytes: bytes.byteLength,
        encrypted: true,
      };
    },

    async get(key) {
      const encrypted = await readFile(pathFor(key));
      return decrypt(encrypted, options.encryptionKey);
    },

    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}

/**
 * S3-compatible target. The SDK client is created lazily so dev, CI and unit
 * tests never need credentials or the dependency wired up.
 */
export function s3StorageAdapter(options: {
  bucket: string;
  region: string;
  endpoint?: string;
  encryptionKey: string;
  prefix?: string;
}): StorageAdapter {
  const prefix = options.prefix ?? "scans";
  const objectKey = (key: string) => `${prefix}/${key}`;

  return {
    name: `s3://${options.bucket}/${prefix}`,
    isLive: true,

    async put(key, bytes) {
      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({ region: options.region, endpoint: options.endpoint });
      const encrypted = encryptBackup(bytes, options.encryptionKey);
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: objectKey(key),
          Body: encrypted,
          ServerSideEncryption: "AES256",
        }),
      );
      return { key, checksum: checksum(bytes), sizeBytes: bytes.byteLength, encrypted: true };
    },

    async get(key) {
      const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({ region: options.region, endpoint: options.endpoint });
      const res = await client.send(
        new GetObjectCommand({ Bucket: options.bucket, Key: objectKey(key) }),
      );
      const bytes = Buffer.from(await res.Body!.transformToByteArray());
      return decrypt(bytes, options.encryptionKey);
    },

    async delete(key) {
      const { S3Client, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({ region: options.region, endpoint: options.endpoint });
      await client.send(
        new DeleteObjectCommand({ Bucket: options.bucket, Key: objectKey(key) }),
      );
    },
  };
}

/**
 * Choose the adapter for the environment. Live requires bucket + both keys;
 * anything less falls back to local — a half-configuration must not be treated
 * as production. Live is India-region-guarded (compliance.md), like backups.
 */
export function resolveStorageAdapter(env: NodeJS.ProcessEnv = process.env): StorageAdapter {
  const key = encryptionKey(env);
  const directory = env.STORAGE_LOCAL_DIR ?? join(process.cwd(), ".storage");

  const hasCredentials = Boolean(
    env.STORAGE_BUCKET && env.STORAGE_ACCESS_KEY && env.STORAGE_SECRET_KEY,
  );

  if (!hasCredentials) {
    return localStorageAdapter({ directory, encryptionKey: key });
  }

  const region = env.STORAGE_REGION ?? "";
  if (!region.startsWith("ap-south")) {
    throw new Error(
      `Storage region "${region}" is outside India. compliance.md (DPDP) requires ` +
        "ap-south-1/ap-south-2 for object storage.",
    );
  }

  logger.info("storage.live", { bucket: env.STORAGE_BUCKET, region });
  return s3StorageAdapter({
    bucket: env.STORAGE_BUCKET!,
    region,
    endpoint: env.STORAGE_ENDPOINT || undefined,
    encryptionKey: key,
  });
}

/**
 * Object key for a guest ID scan. Namespaced by org and guest so keys are
 * unguessable, greppable, and easy to purge on erase.
 */
export function scanObjectKey(params: {
  orgId: string;
  guestId: string;
  idType: string;
  unique: string;
}): string {
  return `guest-ids/${params.orgId}/${params.guestId}/${params.idType}-${params.unique}`;
}
