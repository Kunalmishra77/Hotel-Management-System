import { describe, it, expect } from "vitest";
import { isValidGstin, stateFromGstin } from "@/lib/gstin";

describe("GSTIN", () => {
  it("validates format and reads the state", () => {
    expect(isValidGstin("07aahct9474d1z0")).toBe(true);
    expect(stateFromGstin("07AAHCT9474D1Z0")).toBe("Delhi");
    expect(stateFromGstin("27AAHCT9474D1Z0")).toBe("Maharashtra");
    expect(isValidGstin("07AAHCT9474D1")).toBe(false);
    expect(stateFromGstin("bad")).toBeNull();
  });
});
