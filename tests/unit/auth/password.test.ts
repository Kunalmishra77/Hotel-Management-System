/**
 * Traceability: 00 FR-1 (bcrypt cost ≥ 12, min length from SecuritySettings),
 * AC-1 (password only ever compared as a hash).
 */
import { describe, expect, it } from "vitest";
import {
  BCRYPT_COST,
  hashPassword,
  passwordIssues,
  verifyPassword,
} from "@/lib/auth/password";

describe("hashPassword", () => {
  it("never returns the plaintext", async () => {
    const hash = await hashPassword("CorrectHorse99!");
    expect(hash).not.toContain("CorrectHorse99!");
  });

  it("uses a bcrypt cost of at least 12 (security.md)", async () => {
    const hash = await hashPassword("CorrectHorse99!");
    // bcrypt format: $2a$<cost>$<salt+digest>
    const cost = Number(hash.split("$")[2]);
    expect(BCRYPT_COST).toBeGreaterThanOrEqual(12);
    expect(cost).toBeGreaterThanOrEqual(12);
  });

  it("salts — the same password hashes differently each time", async () => {
    const a = await hashPassword("CorrectHorse99!");
    const b = await hashPassword("CorrectHorse99!");
    expect(a).not.toBe(b);
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", async () => {
    const hash = await hashPassword("CorrectHorse99!");
    await expect(verifyPassword("CorrectHorse99!", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("CorrectHorse99!");
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });

  it("returns false — never throws — for a malformed stored hash", async () => {
    // A corrupt row must fail the sign-in, not 500 the whole request.
    await expect(verifyPassword("x", "not-a-bcrypt-hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "")).resolves.toBe(false);
  });
});

describe("passwordIssues (FR-1: minimum length is org config, not a constant)", () => {
  it("accepts a password meeting the configured minimum", () => {
    expect(passwordIssues("abcdefghij", 10)).toEqual([]);
  });

  it("rejects one shorter than the configured minimum", () => {
    const issues = passwordIssues("short", 10);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain("10");
  });

  it("honours a different org minimum", () => {
    expect(passwordIssues("abcdefghij", 16).length).toBeGreaterThan(0);
    expect(passwordIssues("abcdefghijklmnop", 16)).toEqual([]);
  });

  it("rejects an empty password", () => {
    expect(passwordIssues("", 10).length).toBeGreaterThan(0);
  });
});
