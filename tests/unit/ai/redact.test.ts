/**
 * 18 T-10 — prompt/log redaction (FR-9, AC-11). PII values never leave.
 */
import { describe, expect, it } from "vitest";
import { redactText, redactValue } from "@/lib/ai/redact";

describe("redactText (AC-11)", () => {
  it("removes Aadhaar (grouped and raw)", () => {
    expect(redactText("aadhaar 1234 5678 9012 on file")).not.toContain("5678 9012");
    expect(redactText("id 123456789012")).not.toContain("123456789012");
  });

  it("removes phone, email, PAN", () => {
    expect(redactText("call 9876543210")).not.toContain("9876543210");
    expect(redactText("mail ravi@example.com")).not.toContain("ravi@example.com");
    expect(redactText("PAN ABCDE1234F")).not.toContain("ABCDE1234F");
  });

  it("removes explicit rupee amounts (money beyond need)", () => {
    expect(redactText("balance ₹12,500 due")).not.toContain("12,500");
  });

  it("keeps ordinary words intact", () => {
    expect(redactText("guests from Bangalore who stayed twice")).toContain("Bangalore");
  });
});

describe("redactValue (AC-11)", () => {
  it("drops PII-named keys and scrubs string values", () => {
    const out = redactValue({ mobile: "9876543210", note: "email me at a@b.com", city: "Pune" }) as Record<string, unknown>;
    expect(out.mobile).toBe("[REDACTED]");
    expect(String(out.note)).not.toContain("a@b.com");
    expect(out.city).toBe("Pune");
  });
});
