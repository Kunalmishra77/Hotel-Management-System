/** 12 T-3 — renderTemplate (FR-18/FR-24, AC-16). */
import { describe, expect, it } from "vitest";
import { renderTemplate, templateVariables } from "@/features/communications/domain/render";
import { isDomainError, ErrorCode } from "@/lib/errors";

describe("renderTemplate", () => {
  it("substitutes all placeholders (with and without inner whitespace)", () => {
    const out = renderTemplate("Hi {{guestName}}, welcome to {{ propertyName }}.", {
      guestName: "Ravi",
      propertyName: "Woodpecker MG Road",
    });
    expect(out).toBe("Hi Ravi, welcome to Woodpecker MG Road.");
  });

  it("coerces numbers to strings", () => {
    expect(renderTemplate("Balance {{amount}}", { amount: 4200 })).toBe("Balance 4200");
  });

  it("throws RENDER_MISSING_VAR when a variable is absent (AC-16)", () => {
    try {
      renderTemplate("Room {{roomNumber}}", { guestName: "Ravi" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(isDomainError(e)).toBe(true);
      if (isDomainError(e)) expect(e.code).toBe(ErrorCode.RENDER_MISSING_VAR);
    }
  });

  it("treats an empty/nullish value as missing (never a blank Wi-Fi message, FR-24)", () => {
    expect(() => renderTemplate("Wi-Fi {{wifiSsid}}", { wifiSsid: null })).toThrow();
    expect(() => renderTemplate("Wi-Fi {{wifiSsid}}", { wifiSsid: "" })).toThrow();
  });

  it("lists referenced variables (deduped)", () => {
    expect(templateVariables("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });
});
