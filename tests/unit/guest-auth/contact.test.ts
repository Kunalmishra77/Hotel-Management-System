/**
 * Traceability: Phase 2 — guest account ↔ CRM Guest linking.
 *
 * A self-service account must dedupe onto the SAME `Guest` a public booking would
 * create, or the hotel sees two records for one person. That only holds if the
 * keyed hashes are computed identically. These lock that contract.
 */
import { describe, expect, it } from "vitest";
import { keyedHash } from "@/lib/crypto/encryption";
import { mobileHashOf, emailHashOf, normalizeMobile } from "@/lib/guest-auth/contact";

describe("mobileHashOf", () => {
  it("equals keyedHash(normalized, lowercased) — matches upsertPublicGuest", () => {
    expect(mobileHashOf("98765 43210")).toBe(keyedHash(normalizeMobile("98765 43210").toLowerCase()));
  });

  it("is invariant to spaces and dashes (same person, one hash)", () => {
    expect(mobileHashOf("98765-43210")).toBe(mobileHashOf("9876543210"));
    expect(mobileHashOf(" 9876543210 ")).toBe(mobileHashOf("9876543210"));
  });
});

describe("emailHashOf", () => {
  it("equals keyedHash(trimmed, lowercased) — matches upsertPublicGuest", () => {
    expect(emailHashOf("  Ravi@Example.COM ")).toBe(keyedHash("ravi@example.com"));
  });

  it("is case- and whitespace-insensitive", () => {
    expect(emailHashOf("RAVI@EXAMPLE.COM")).toBe(emailHashOf("ravi@example.com"));
  });
});
