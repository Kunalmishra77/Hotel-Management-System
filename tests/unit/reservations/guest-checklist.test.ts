/**
 * Traceability: client req #6 — pending guest info/documents surfaced before
 * checkout. The checklist is a pure derivation; these tests pin what counts as
 * "pending" and which items block a clean checkout (required) vs. are optional.
 */
import { describe, it, expect } from "vitest";
import { pendingGuestInfo, type ChecklistInput } from "@/features/reservations/domain/guest-checklist";

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
