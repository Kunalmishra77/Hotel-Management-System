import { describe, it, expect } from "vitest";
import { parseInvoiceSeq, decideNumberClaim, formatInvoiceNumber, type NumberHolder } from "@/features/billing/domain/invoice-number";

const h = (o: Partial<NumberHolder>): NumberHolder => ({ folioId: "f1", billPart: "DIRECT", type: "TAX_INVOICE", revision: 0, live: false, ...o });

describe("FR-RV-3 — invoice number claim", () => {
  it("parses the sequence out of a formatted number", () => {
    expect(parseInvoiceSeq(formatInvoiceNumber({ prefix: "WASPL", financialYear: "2026-27", nextNumber: 685 }))).toBe(685);
    expect(parseInvoiceSeq("garbage")).toBeNull();
  });
  it("a free number is revision 0", () => {
    expect(decideNumberClaim([], { folioId: "f1", billPart: "DIRECT" })).toEqual({ ok: true, revision: 0 });
  });
  it("the same bill's cancelled copy → next revision (one customer, one number)", () => {
    expect(decideNumberClaim([h({ revision: 0 }), h({ type: "CREDIT_NOTE", revision: 0 }), h({ revision: 1 })], { folioId: "f1", billPart: "DIRECT" })).toEqual({ ok: true, revision: 2 });
  });
  it("an old whole-stay bill (part null) belongs to every bill of that folio", () => {
    expect(decideNumberClaim([h({ billPart: null })], { folioId: "f1", billPart: "DIRECT" })).toEqual({ ok: true, revision: 1 });
  });
  it("another folio's number is refused", () => {
    expect(decideNumberClaim([h({ folioId: "f2" })], { folioId: "f1", billPart: "DIRECT" })).toEqual({ ok: false, reason: "taken" });
  });
  it("another bill part of the same stay is refused", () => {
    expect(decideNumberClaim([h({ billPart: "MAKEMYTRIP" })], { folioId: "f1", billPart: "DIRECT" })).toEqual({ ok: false, reason: "taken" });
  });
  it("a live copy of this very bill is refused (correct it instead)", () => {
    expect(decideNumberClaim([h({ live: true })], { folioId: "f1", billPart: "DIRECT" })).toEqual({ ok: false, reason: "live" });
  });
});
