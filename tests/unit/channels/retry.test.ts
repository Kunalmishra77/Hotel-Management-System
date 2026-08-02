/** 13 — outbound push retry/dead-letter classification (FR-13). Pure. */
import { describe, expect, it } from "vitest";
import { classifyRetry, MAX_PUSH_AGE_MS } from "@/features/channels/domain/retry";

describe("classifyRetry (FR-13)", () => {
  const created = new Date("2027-01-01T00:00:00.000Z");

  it("retries a recently-failed push", () => {
    const now = new Date(created.getTime() + 60_000);
    expect(classifyRetry(created, now)).toBe("RETRY");
  });

  it("dead-letters a push that has been failing past the window", () => {
    const now = new Date(created.getTime() + MAX_PUSH_AGE_MS + 1);
    expect(classifyRetry(created, now)).toBe("DEAD_LETTER");
  });
});
