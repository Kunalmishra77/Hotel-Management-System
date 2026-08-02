/** canTransition — unit (19 T-5, FR-10, AC-9). OPEN → SETTLED → VOID; else rejected. */
import { describe, expect, it } from "vitest";
import { canTransition, isEditable } from "@/features/pos/domain/state";

describe("canTransition (AC-9)", () => {
  it("allows OPEN → SETTLED and SETTLED → VOID", () => {
    expect(canTransition("OPEN", "SETTLED")).toBe(true);
    expect(canTransition("SETTLED", "VOID")).toBe(true);
  });

  it("rejects illegal transitions (SETTLED is immutable, no re-settle, no OPEN→VOID)", () => {
    expect(canTransition("SETTLED", "SETTLED")).toBe(false);
    expect(canTransition("SETTLED", "OPEN")).toBe(false);
    expect(canTransition("OPEN", "VOID")).toBe(false);
    expect(canTransition("VOID", "SETTLED")).toBe(false);
    expect(canTransition("VOID", "VOID")).toBe(false);
  });

  it("only OPEN orders are editable", () => {
    expect(isEditable("OPEN")).toBe(true);
    expect(isEditable("SETTLED")).toBe(false);
    expect(isEditable("VOID")).toBe(false);
  });
});
