import { describe, it, expect } from "vitest";
import { canAdvanceTicket, nextTicketStatus } from "@/features/pos/domain/kitchen-ticket";

describe("kitchen ticket state machine (19 FR-24)", () => {
  it("advances forward one step at a time", () => {
    expect(canAdvanceTicket("QUEUED", "PREPARING")).toBe(true);
    expect(canAdvanceTicket("PREPARING", "READY")).toBe(true);
    expect(canAdvanceTicket("READY", "SERVED")).toBe(true);
  });

  it("rejects skips, backward moves, and self-transitions", () => {
    expect(canAdvanceTicket("QUEUED", "READY")).toBe(false);
    expect(canAdvanceTicket("QUEUED", "SERVED")).toBe(false);
    expect(canAdvanceTicket("READY", "QUEUED")).toBe(false);
    expect(canAdvanceTicket("SERVED", "READY")).toBe(false);
    expect(canAdvanceTicket("SERVED", "SERVED")).toBe(false);
    expect(canAdvanceTicket("PREPARING", "PREPARING")).toBe(false);
  });

  it("nextTicketStatus returns the single successor, or null at the end", () => {
    expect(nextTicketStatus("QUEUED")).toBe("PREPARING");
    expect(nextTicketStatus("PREPARING")).toBe("READY");
    expect(nextTicketStatus("READY")).toBe("SERVED");
    expect(nextTicketStatus("SERVED")).toBeNull();
  });
});
