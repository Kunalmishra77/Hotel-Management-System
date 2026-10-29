/** Country from the phone's international code (client: "+1 → country automatically"). */
import { describe, expect, it } from "vitest";
import { countryFromPhone } from "@/lib/phone-country";

describe("countryFromPhone", () => {
  it("reads the code with or without spaces / dashes / 00", () => {
    expect(countryFromPhone("+1 555 123 4567")).toBe("United States");
    expect(countryFromPhone("+44 7700-900123")).toBe("United Kingdom");
    expect(countryFromPhone("0049 151 2345678")).toBe("Germany");
    expect(countryFromPhone("+91 98765 43210")).toBe("India");
  });
  it("longest code wins", () => {
    expect(countryFromPhone("+971501234567")).toBe("United Arab Emirates");
    expect(countryFromPhone("+358401234567")).toBe("Finland");
  });
  it("shared codes resolve to the most likely country", () => {
    expect(countryFromPhone("+7 912 345 6789")).toBe("Russia");
    expect(countryFromPhone("+39 312 345 6789")).toBe("Italy");
  });
  it("a local number (no + / 00) gives nothing", () => {
    expect(countryFromPhone("9876543210")).toBeNull();
    expect(countryFromPhone("")).toBeNull();
    expect(countryFromPhone(null)).toBeNull();
  });
});
