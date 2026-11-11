import { describe, expect, it } from "vitest";
import { docRule, idDisplayName, idDocumentProblem } from "@/features/guests/domain/id-documents";

describe("ID documents — which sides are needed (client, 11 Nov 2026)", () => {
  it("Aadhaar, Driving licence and Voter ID need both sides", () => {
    for (const type of ["AADHAAR", "DRIVING_LICENCE", "VOTER_ID"]) {
      expect(docRule(type).backRequired).toBe(true);
      expect(idDocumentProblem({ type, hasFront: true, hasBack: false })).toMatch(/back .* both sides/);
      expect(idDocumentProblem({ type, hasFront: false, hasBack: true })).toMatch(/front/);
      expect(idDocumentProblem({ type, hasFront: false, hasBack: false })).toMatch(/both sides/);
      expect(idDocumentProblem({ type, hasFront: true, hasBack: true })).toBeNull();
    }
  });

  it("Passport, PAN and Visa need one side", () => {
    for (const type of ["PASSPORT", "PAN", "VISA"]) {
      expect(idDocumentProblem({ type, hasFront: true, hasBack: false })).toBeNull();
      expect(idDocumentProblem({ type, hasFront: false, hasBack: false })).toMatch(/Upload the/);
    }
  });

  it("an Other document needs its name and a front; the back is optional", () => {
    expect(idDocumentProblem({ type: "OTHER", hasFront: true, hasBack: false })).toMatch(/name/);
    expect(idDocumentProblem({ type: "OTHER", hasFront: true, hasBack: false, documentName: "  " })).toMatch(/name/);
    expect(idDocumentProblem({ type: "OTHER", hasFront: true, hasBack: false, documentName: "Company ID" })).toBeNull();
    expect(idDocumentProblem({ type: "OTHER", hasFront: true, hasBack: true, documentName: "Company ID" })).toBeNull();
    expect(idDisplayName("OTHER", "Company ID")).toBe("Company ID");
    expect(idDisplayName("OTHER", null)).toBe("Other document");
    expect(idDisplayName("VOTER_ID", "ignored")).toBe("Voter ID");
  });
});
