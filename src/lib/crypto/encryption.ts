/**
 * Application-level encryption + masking for PII at rest.
 *
 * compliance.md: PII columns (Aadhaar, passport, contact) are encrypted at
 * rest, Aadhaar is stored masked by default, and scans live in object storage
 * — the DB holds a reference, never the bytes. 00 FR-5 additionally requires
 * the TOTP secret to be encrypted.
 *
 * Envelope format: `v1.<iv-base64>.<ciphertext+tag-base64>`
 * The version prefix exists so a future key rotation can decrypt old values
 * while writing new ones — without it, rotation means a downtime migration.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;
const VERSION = "v1";

let cachedKey: Buffer | null = null;

/**
 * The 32-byte master key from PII_ENCRYPTION_KEY (base64).
 * Read lazily so importing this module never crashes a build that has no env.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "PII_ENCRYPTION_KEY is not set. PII cannot be encrypted — refusing to continue. " +
        "Generate one with: openssl rand -base64 32",
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `PII_ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256 (got ${key.length}).`,
    );
  }

  cachedKey = key;
  return key;
}

/** Test seam: forget the cached key after changing the env var. */
export function resetEncryptionKeyCache(): void {
  cachedKey = null;
}

export function encryptString(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  // Tag travels with the ciphertext so decrypt can authenticate it.
  const payload = Buffer.concat([encrypted, cipher.getAuthTag()]);
  return `${VERSION}.${iv.toString("base64")}.${payload.toString("base64")}`;
}

export function decryptString(envelope: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error("Malformed ciphertext envelope");
  }

  const iv = Buffer.from(parts[1] ?? "", "base64");
  const payload = Buffer.from(parts[2] ?? "", "base64");
  if (iv.length !== IV_BYTES || payload.length <= TAG_BYTES) {
    throw new Error("Malformed ciphertext envelope");
  }

  const ciphertext = payload.subarray(0, payload.length - TAG_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  // Throws on tag mismatch — a tampered value must never decrypt to something
  // plausible-looking.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}.`);
}

/** Encrypt only when a value is present — for optional PII columns. */
export function encryptOptional(value: string | null | undefined): string | null {
  return value == null || value === "" ? null : encryptString(value);
}

export function decryptOptional(value: string | null | undefined): string | null {
  return value == null || value === "" ? null : decryptString(value);
}

/**
 * Keyed (HMAC) hash for the `*Hash` search columns.
 *
 * Why keyed and not a plain SHA-256: a mobile number has only ~10^10 possible
 * values, so an unkeyed digest is trivially brute-forced from a DB dump. The
 * HMAC key makes the dump alone useless. Deterministic by design — that is what
 * makes exact-match search work without decrypting every row (04/15).
 */
export function keyedHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  return createHmac("sha256", getKey()).update(normalized).digest("hex");
}

/** Constant-time comparison for hashes/tokens (avoids timing oracles). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ---------------------------------------------------------------------------
// Masking — compliance.md: masked by default, revealed only with permission +
// reason (04 FR-8/9). These are display helpers; they never touch the DB value.
// ---------------------------------------------------------------------------

/** "123412341234" → "XXXX XXXX 1234" (UIDAI-style last-4 reference). */
export function maskAadhaar(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "XXXX XXXX XXXX";
  return `XXXX XXXX ${digits.slice(-4)}`;
}

/** "9876543210" → "XXXXXX3210". */
export function maskMobile(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return "X".repeat(digits.length);
  return `${"X".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/** "ravi.kumar@example.com" → "r•••••••••@example.com" (domain kept for support). */
export function maskEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = value.lastIndexOf("@");
  if (at <= 0) return "•".repeat(value.length);
  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (local.length <= 1) return `${local}${domain}`;
  return `${local[0]}${"•".repeat(local.length - 1)}${domain}`;
}

/** Generic tail-mask for passport/PAN/bank account display. */
export function maskTail(value: string | null | undefined, visible = 4): string | null {
  if (!value) return null;
  if (value.length <= visible) return "X".repeat(value.length);
  return `${"X".repeat(value.length - visible)}${value.slice(-visible)}`;
}
