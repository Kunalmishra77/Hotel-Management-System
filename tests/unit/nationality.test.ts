/** Live nationality spellings (data audit, 15 Nov 2026) → one name per country. */
import { describe, expect, it } from "vitest";
import { canonicalNationality, isForeignNationality } from "@/lib/nationality";

describe("canonicalNationality", () => {
  it.each([
    ["IND", "India"], ["Indian", "India"], ["indian", "India"], ["INDIAN", "India"], ["Inadian", "India"], ["IN", "India"],
    ["German", "Germany"], ["Germani", "Germany"], ["Rusia", "Russia"], ["Franch", "France"], ["Mexicans", "Mexico"],
    ["South Africaine", "South Africa"], ["UK", "United Kingdom"], ["England", "United Kingdom"], ["British", "United Kingdom"],
    ["UNITED KINGDOM", "United Kingdom"], ["USA", "United States"], ["Nederland", "Netherlands"], ["Nederlandse", "Netherlands"],
    ["norway", "Norway"], ["NEW ZEALAND", "New Zealand"], ["AUSTRALIA", "Australia"], ["BELGIUM", "Belgium"], ["Mauritius", "Mauritius"],
  ])("%s → %s", (raw, want) => {
    expect(canonicalNationality(raw)).toBe(want);
  });
  it("blank → null; unknown text kept as typed", () => {
    expect(canonicalNationality("  ")).toBeNull();
    expect(canonicalNationality("Atlantis")).toBe("Atlantis");
  });
});

describe("isForeignNationality", () => {
  it("every Indian spelling (typo included) is domestic", () => {
    for (const v of ["IND", "Indian", "Inadian", "india", "", null]) expect(isForeignNationality(v)).toBe(false);
  });
  it("any other country is foreign", () => {
    for (const v of ["Norway", "USA", "Germani"]) expect(isForeignNationality(v)).toBe(true);
  });
});
