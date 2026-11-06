/**
 * Traceability: client req #6 — pending guest info/documents surfaced before
 * checkout. The checklist is a pure derivation; these tests pin what counts as
 * "pending" and which items block a clean checkout (required) vs. are optional.
 */
import { describe, it, expect } from "vitest";
import { missingForCheckIn, pendingGuestInfo, type ChecklistInput } from "@/features/reservations/domain/guest-checklist";

const complete: ChecklistInput = {
  maskedMobile: "9•••••210",
  maskedEmail: "a•••@x.com",
  companyName: null,
  gstNumber: null,
  addressLine: "A-24, Hauz Khas",
  ids: [{ hasScan: true }],
  balancePaise: 0,
};

const keys = (i: ChecklistInput) => pendingGuestInfo(i).map((x) => x.key);

describe("pendingGuestInfo", () => {
  it("returns nothing when the guest record is complete and settled", () => {
    expect(pendingGuestInfo(complete)).toEqual([]);
  });

  it("flags a missing contact number and email", () => {
    const k = keys({ ...complete, maskedMobile: null, maskedEmail: null });
    expect(k).toContain("mobile");
    expect(k).toContain("email");
  });

  it("flags no ID on file, and separately an ID with no scan", () => {
    expect(keys({ ...complete, ids: [] })).toContain("id");
    expect(keys({ ...complete, ids: [{ hasScan: false }] })).toContain("id-scan");
  });

  it("asks for a GSTIN only when the stay is billed to a company", () => {
    expect(keys({ ...complete, companyName: null, gstNumber: null })).not.toContain("gstin");
    expect(keys({ ...complete, companyName: "Acme Pvt Ltd", gstNumber: null })).toContain("gstin");
  });

  it("flags an outstanding balance as required", () => {
    const items = pendingGuestInfo({ ...complete, balancePaise: 50000 });
    const balance = items.find((x) => x.key === "balance");
    expect(balance?.required).toBe(true);
  });

  it("treats missing ID as required but email/address as optional", () => {
    const items = pendingGuestInfo({ ...complete, maskedEmail: null, addressLine: null, ids: [] });
    expect(items.find((x) => x.key === "id")?.required).toBe(true);
    expect(items.find((x) => x.key === "email")?.required).toBe(false);
    expect(items.find((x) => x.key === "address")?.required).toBe(false);
  });
});

describe("check-in details (client, 5 Nov 2026)", () => {
  const full = { hasMobile: true, hasWhatsapp: true, gender: "Female", nationality: "India", addressLine: "A-24", city: "Delhi", country: "India", idCount: 1 };

  it("check-in needs mobile, WhatsApp, gender, nationality, home address, city, country and an ID", () => {
    expect(missingForCheckIn(full)).toEqual([]);
    expect(missingForCheckIn({ hasMobile: false, hasWhatsapp: false, gender: null, nationality: " ", addressLine: null, city: "", country: null, idCount: 0 })).toEqual([
      "mobile number", "WhatsApp number", "gender", "nationality", "home address", "city", "country", "a photo ID",
    ]);
  });

  it("email and date of birth never block check-in — they go to pending as optional", () => {
    const items = pendingGuestInfo({ ...complete, maskedEmail: null, hasWhatsapp: true, dob: null, gender: "Male", nationality: "India" });
    expect(items.map((x) => [x.key, x.required])).toEqual([["email", false], ["dob", false]]);
  });

  it("an older in-house guest missing WhatsApp / gender / nationality shows them as required pending", () => {
    const items = pendingGuestInfo({ ...complete, hasWhatsapp: false, dob: "1990-01-01", gender: null, nationality: null });
    expect(items.filter((x) => x.required).map((x) => x.key)).toEqual(["whatsapp", "gender", "nationality"]);
  });

  it("callers that don't pass the new fields see no new items", () => {
    expect(keys(complete)).toEqual([]);
  });

  it("a returning guest is never re-asked — only the photo ID can block (client, 6 Nov 2026)", () => {
    const bare = { hasMobile: false, hasWhatsapp: false, gender: null, nationality: null, addressLine: null, city: null, country: null, returning: true };
    expect(missingForCheckIn({ ...bare, idCount: 2 })).toEqual([]);
    expect(missingForCheckIn({ ...bare, idCount: 0 })).toEqual(["a photo ID"]);
    // A first-time guest with the same gaps is still blocked on all of them.
    expect(missingForCheckIn({ ...bare, idCount: 1, returning: false })).toHaveLength(7);
  });
});
