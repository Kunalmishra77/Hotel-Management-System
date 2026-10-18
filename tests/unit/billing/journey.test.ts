/**
 * 06 — a guest's outstanding across stays. Netting is right inside one stay and
 * wrong between two, and the difference is the `transferredFromId` chain.
 */
import { describe, expect, it } from "vitest";
import { journeyBalances, outstandingAcrossJourneys, type JourneyFolio } from "@/features/billing/domain/journey";

const leg = (reservationId: string, balancePaise: bigint, transferredFromId: string | null = null): JourneyFolio =>
  ({ reservationId, transferredFromId, balancePaise });

describe("outstandingAcrossJourneys", () => {
  it("nets a linked journey — the real Ankit Bansal case", () => {
    // Paid ₹6,930 whole onto the second leg against a ₹5,040 journey, so the
    // first leg reads ₹2,205 due and the second ₹4,095 in credit. He owes
    // nothing; the hotel owes him ₹1,890.
    const legs = [leg("A", 220_500n), leg("B", -409_500n, "A")];
    expect(outstandingAcrossJourneys(legs)).toBe(0n);
    expect([...journeyBalances(legs).values()]).toEqual([-189_000n]);
  });

  it("still reports a linked journey that genuinely owes", () => {
    // Muniama: ₹448.80 credit on the OTA leg, ₹16,537.50 due on the direct one.
    const legs = [leg("A", -44_880n), leg("B", 1_653_750n, "A")];
    expect(outstandingAcrossJourneys(legs)).toBe(1_608_870n);
  });

  it("does NOT let one stay's credit mask a DIFFERENT stay's due", () => {
    // The rule that made the old behaviour right between unrelated stays.
    expect(outstandingAcrossJourneys([leg("A", -500_000n), leg("B", 220_500n)])).toBe(220_500n);
  });

  it("nets a three-leg chain", () => {
    const legs = [leg("A", 100_000n), leg("B", -250_000n, "A"), leg("C", 100_000n, "B")];
    expect(outstandingAcrossJourneys(legs)).toBe(0n);
    expect([...journeyBalances(legs).values()]).toEqual([-50_000n]);
  });

  it("keeps two separate journeys separate, netting each", () => {
    const legs = [
      leg("A", 220_500n), leg("B", -409_500n, "A"),   // journey 1 → credit
      leg("X", -10_000n), leg("Y", 60_000n, "X"),     // journey 2 → owes 50,000
    ];
    expect(outstandingAcrossJourneys(legs)).toBe(50_000n);
  });

  it("treats a leg whose parent is not in the set as its own journey", () => {
    // The origin belongs to another guest, or simply was not loaded.
    expect(outstandingAcrossJourneys([leg("B", 220_500n, "missing")])).toBe(220_500n);
  });

  it("is zero for no folios, and for folios that all balance", () => {
    expect(outstandingAcrossJourneys([])).toBe(0n);
    expect(outstandingAcrossJourneys([leg("A", 0n), leg("B", 0n, "A")])).toBe(0n);
  });

  it("survives a corrupt self-referencing row instead of hanging", () => {
    const legs: JourneyFolio[] = [{ reservationId: "A", transferredFromId: "A", balancePaise: 220_500n }];
    expect(outstandingAcrossJourneys(legs)).toBe(220_500n);
  });
});
