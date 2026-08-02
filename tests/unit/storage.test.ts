/**
 * Traceability: 04 T-9 (FR-7) — scans stored in encrypted, India-region object
 * storage; the row keeps only key + checksum, never bytes.
 */
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  localStorageAdapter,
  resolveStorageAdapter,
  scanObjectKey,
} from "@/lib/storage";

const KEY = Buffer.alloc(32, 9).toString("base64");
const SCAN = Buffer.from("PNGDATA fake passport scan with a visible number 123456");

async function tempAdapter() {
  const dir = await mkdtemp(join(tmpdir(), "vitest-storage-"));
  return { dir, adapter: localStorageAdapter({ directory: dir, encryptionKey: KEY }) };
}

const dirs: string[] = [];
afterAll(() => {
  // temp dirs are OS-cleaned; nothing to disconnect.
  void dirs;
});

describe("localStorageAdapter — round trip", () => {
  it("stores and retrieves the exact bytes", async () => {
    const { adapter } = await tempAdapter();
    const stored = await adapter.put("k1", SCAN);
    expect(stored.sizeBytes).toBe(SCAN.byteLength);

    const back = await adapter.get("k1");
    expect(back.equals(SCAN)).toBe(true);
  });

  it("writes ENCRYPTED bytes to disk — the scan is not readable as-is", async () => {
    const { dir, adapter } = await tempAdapter();
    await adapter.put("k2", SCAN);

    const [file] = await readdir(dir);
    const onDisk = await readFile(join(dir, file!));
    // The plaintext number must not appear in the stored file.
    expect(onDisk.includes(SCAN)).toBe(false);
    expect(onDisk.toString("utf8")).not.toContain("123456");
    expect(onDisk.toString("utf8")).not.toContain("passport scan");
  });

  it("checksums the PLAINTEXT for integrity", async () => {
    const { adapter } = await tempAdapter();
    const stored = await adapter.put("k3", SCAN);
    expect(stored.checksum).toMatch(/^[a-f0-9]{64}$/);
    // Same bytes → same checksum, so a later fetch can verify integrity.
    const { adapter: other } = await tempAdapter();
    expect((await other.put("kX", SCAN)).checksum).toBe(stored.checksum);
  });

  it("deletes an object (erase path, FR-14)", async () => {
    const { adapter } = await tempAdapter();
    await adapter.put("k4", SCAN);
    await adapter.delete("k4");
    await expect(adapter.get("k4")).rejects.toThrow();
  });

  it("marks itself as sandbox, not live", async () => {
    const { adapter } = await tempAdapter();
    expect(adapter.isLive).toBe(false);
  });
});

describe("resolveStorageAdapter", () => {
  it("falls back to local with no credentials (integrations.md)", () => {
    const adapter = resolveStorageAdapter({
      PII_ENCRYPTION_KEY: KEY,
      STORAGE_LOCAL_DIR: join(tmpdir(), "vitest-storage-resolve"),
    } as unknown as NodeJS.ProcessEnv);
    expect(adapter.isLive).toBe(false);
  });

  it("still falls back when credentials are incomplete", () => {
    const adapter = resolveStorageAdapter({
      PII_ENCRYPTION_KEY: KEY,
      STORAGE_BUCKET: "woodpecker",
      STORAGE_REGION: "ap-south-1",
      // keys missing
    } as unknown as NodeJS.ProcessEnv);
    expect(adapter.isLive).toBe(false);
  });

  it("selects live S3 when fully configured in an India region", () => {
    const adapter = resolveStorageAdapter({
      PII_ENCRYPTION_KEY: KEY,
      STORAGE_BUCKET: "woodpecker",
      STORAGE_REGION: "ap-south-1",
      STORAGE_ACCESS_KEY: "AKIA-test",
      STORAGE_SECRET_KEY: "secret",
    } as unknown as NodeJS.ProcessEnv);
    expect(adapter.isLive).toBe(true);
  });

  it("REFUSES a live target outside India (compliance.md)", () => {
    expect(() =>
      resolveStorageAdapter({
        PII_ENCRYPTION_KEY: KEY,
        STORAGE_BUCKET: "woodpecker",
        STORAGE_REGION: "us-east-1",
        STORAGE_ACCESS_KEY: "AKIA-test",
        STORAGE_SECRET_KEY: "secret",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/outside India/);
  });

  it("requires an encryption key — PII cannot be stored unencrypted", () => {
    expect(() =>
      resolveStorageAdapter({ STORAGE_LOCAL_DIR: tmpdir() } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/PII_ENCRYPTION_KEY/);
  });
});

describe("scanObjectKey", () => {
  it("namespaces by org and guest for unguessable, purgeable keys", () => {
    const key = scanObjectKey({
      orgId: "org_1",
      guestId: "guest_1",
      idType: "PASSPORT",
      unique: "abc123",
    });
    expect(key).toBe("guest-ids/org_1/guest_1/PASSPORT-abc123");
  });
});
