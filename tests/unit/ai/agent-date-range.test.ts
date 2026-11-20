/** "25 nov se 25 dec tak room khali hai?" (client, 20 Nov 2026). */
import { describe, expect, it } from "vitest";
import { parseDateRange } from "@/features/ai/domain/agent-commands";
import { classify } from "@/features/ai/domain/agent-intents";

const TODAY = new Date("2026-11-20T00:00:00Z");

describe("parseDateRange", () => {
  it.each([
    ["25 nov se 25 dec tak room khali hai?", "2026-11-25", "2026-12-25"],
    ["room available from 25 Nov to 2 Dec", "2026-11-25", "2026-12-02"],
    ["28 dec - 3 jan", "2026-12-28", "2027-01-03"],
    ["25/11 to 30/11", "2026-11-25", "2026-11-30"],
  ])("%s", (q, from, to) => {
    expect(parseDateRange(q, TODAY)).toEqual({ from, to });
  });
  it("one date or none → null", () => {
    expect(parseDateRange("khali rooms", TODAY)).toBeNull();
    expect(parseDateRange("25 nov ko room khali hai", TODAY)).toBeNull();
  });
  it("the question is a vacant-rooms question", () => {
    expect(classify("25 nov se 25 dec tak room khali hai?").kind).toBe("vacant");
  });
});
