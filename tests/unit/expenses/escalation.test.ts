/**
 * Traceability: Phase 6 — expense approval escalation.
 *
 * The threshold decides who may approve a spend: a Manager below it, Super Admin
 * above. An off-by-one here would let a Manager wave through a major expense.
 */
import { describe, expect, it } from "vitest";
import {
  EXPENSE_ESCALATION_THRESHOLD_PAISE,
  requiresSuperApproval,
} from "@/features/expenses/domain/escalation";

describe("requiresSuperApproval", () => {
  it("is false at or below the threshold", () => {
    expect(requiresSuperApproval(0)).toBe(false);
    expect(requiresSuperApproval(EXPENSE_ESCALATION_THRESHOLD_PAISE - 1)).toBe(false);
    expect(requiresSuperApproval(EXPENSE_ESCALATION_THRESHOLD_PAISE)).toBe(false);
  });

  it("is true just over the threshold", () => {
    expect(requiresSuperApproval(EXPENSE_ESCALATION_THRESHOLD_PAISE + 1)).toBe(true);
    expect(requiresSuperApproval(EXPENSE_ESCALATION_THRESHOLD_PAISE * 10)).toBe(true);
  });
});
