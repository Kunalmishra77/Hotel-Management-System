/**
 * Traceability: 00 FR-2 (rotating session), security.md § Authentication
 * (DB-backed sessions, short-lived + rotated).
 */
import { describe, expect, it } from "vitest";
import {
  SESSION_TOKEN_BYTES,
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from "@/lib/auth/session-token";

describe("generateSessionToken", () => {
  it("is unguessable — at least 256 bits of entropy", () => {
    expect(SESSION_TOKEN_BYTES).toBeGreaterThanOrEqual(32);
  });

  it("is URL-safe so it can live in a cookie without escaping", () => {
    expect(generateSessionToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never repeats across many draws", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateSessionToken()));
    expect(seen.size).toBe(500);
  });
});

describe("hashSessionToken", () => {
  it("is deterministic so a presented token can be looked up", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("does not contain the token — a DB leak must not yield usable sessions", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs for different tokens", () => {
    expect(hashSessionToken(generateSessionToken())).not.toBe(
      hashSessionToken(generateSessionToken()),
    );
  });
});

describe("isWellFormedSessionToken", () => {
  it("accepts a generated token", () => {
    expect(isWellFormedSessionToken(generateSessionToken())).toBe(true);
  });

  it("rejects junk without hitting the database", () => {
    // Cheap pre-filter: a malformed cookie should never cost a query.
    for (const bad of ["", "   ", "short", "has spaces", "has/slash", "a".repeat(200)]) {
      expect(isWellFormedSessionToken(bad)).toBe(false);
    }
  });
});
