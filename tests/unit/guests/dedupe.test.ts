/**
 * Traceability: 04 T-6/T-7 — FR-5/FR-12, AC-3/AC-11.
 *
 * The scoring decides whether a second booking for "Ravi" prompts a
 * merge/create-anyway or silently creates a duplicate. The merge rule decides
 * which record's data survives — getting it wrong loses a guest's history.
 */
import { describe, expect, it } from "vitest";
import {
  type GuestMatchInput,
  duplicateScore,
  isProbableDuplicate,
  mergeFields,
} from "@/features/guests/domain/dedupe";

const base: GuestMatchInput = {
  fullName: "Ravi Kumar",
  mobile: "9876543210",
  email: "ravi@example.com",
  idValues: ["AADHAAR:1234"],
};

describe("duplicateScore (FR-5 / AC-3)", () => {
  it("scores a same-mobile match as a strong duplicate", () => {
    // The mobile is the single most reliable signal in Indian hospitality.
    const score = duplicateScore(base, { ...base, fullName: "Ravi K", email: null });
    expect(score).toBeGreaterThanOrEqual(0.8);
    expect(isProbableDuplicate(score)).toBe(true);
  });

  it("scores a same-email match as a strong duplicate", () => {
    const score = duplicateScore(base, { ...base, mobile: null, fullName: "R Kumar" });
    expect(isProbableDuplicate(score)).toBe(true);
  });

  it("scores a shared government ID as a strong duplicate", () => {
    const score = duplicateScore(
      { ...base, mobile: null, email: null },
      { ...base, mobile: "9999999999", email: "other@x.com" },
    );
    expect(isProbableDuplicate(score)).toBe(true);
  });

  it("treats a name-only match as NOT a probable duplicate", () => {
    // "Ravi Kumar" is extremely common; matching on name alone would prompt a
    // merge on every second booking and train staff to click through it.
    const score = duplicateScore(
      { fullName: "Ravi Kumar", mobile: "1111111111", email: "a@x.com", idValues: [] },
      { fullName: "Ravi Kumar", mobile: "2222222222", email: "b@x.com", idValues: [] },
    );
    expect(isProbableDuplicate(score)).toBe(false);
  });

  it("scores two unrelated guests near zero", () => {
    const score = duplicateScore(base, {
      fullName: "Anita Sharma",
      mobile: "8000000000",
      email: "anita@x.com",
      idValues: ["PAN:ABCDE"],
    });
    expect(score).toBeLessThan(0.3);
  });

  it("is symmetric", () => {
    const a = base;
    const b = { ...base, fullName: "Ravi K", email: null };
    expect(duplicateScore(a, b)).toBe(duplicateScore(b, a));
  });

  it("compares on NORMALISED values — a differently-typed mobile still matches", () => {
    const score = duplicateScore(base, { ...base, mobile: "+91 98765 43210" });
    expect(isProbableDuplicate(score)).toBe(true);
  });
});

describe("mergeFields (FR-12 / AC-11) — deterministic survivor rule", () => {
  const survivor: Record<string, string | null> = {
    fullName: "Ravi Kumar",
    email: null,
    whatsapp: null,
    city: "Bengaluru",
    foodPreference: null,
    specialRequests: "Late checkout",
  };
  const loser: Record<string, string | null> = {
    fullName: "Ravi K",
    email: "ravi@example.com",
    whatsapp: "9876543210",
    city: "Mumbai",
    foodPreference: "Veg",
    specialRequests: "Ground floor",
  };

  it("keeps the survivor's value where it has one", () => {
    const merged = mergeFields(survivor, loser);
    expect(merged.fullName).toBe("Ravi Kumar");
    expect(merged.city).toBe("Bengaluru");
  });

  it("fills a survivor gap from the loser — no data is silently lost", () => {
    const merged = mergeFields(survivor, loser);
    expect(merged.email).toBe("ravi@example.com");
    expect(merged.whatsapp).toBe("9876543210");
    expect(merged.foodPreference).toBe("Veg");
  });

  it("is deterministic — same inputs, same output", () => {
    expect(mergeFields(survivor, loser)).toEqual(mergeFields(survivor, loser));
  });

  it("never resurrects a field the survivor deliberately cleared to empty string", () => {
    // An explicit "" on the survivor is a choice; only null/undefined is a gap.
    const merged = mergeFields({ ...survivor, foodPreference: "" }, loser);
    expect(merged.foodPreference).toBe("");
  });

  it("does not mutate either input", () => {
    const s = { ...survivor };
    const l = { ...loser };
    mergeFields(s, l);
    expect(s).toEqual(survivor);
    expect(l).toEqual(loser);
  });
});
