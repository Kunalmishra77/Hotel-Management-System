/** Property-local days — the "today" tiles must not show yesterday between 00:00 and 05:30 IST. */
import { describe, expect, it } from "vitest";
import { localDayInstants, localToday } from "@/lib/local-day";

describe("localToday", () => {
  it("is the India date, not the UTC date, just after midnight IST", () => {
    // 30 Oct 00:30 IST = 29 Oct 19:00 UTC
    expect(localToday("Asia/Kolkata", new Date("2026-10-29T19:00:00Z")).toISOString()).toBe("2026-10-30T00:00:00.000Z");
  });
  it("matches the UTC date in the afternoon", () => {
    expect(localToday("Asia/Kolkata", new Date("2026-10-30T10:00:00Z")).toISOString()).toBe("2026-10-30T00:00:00.000Z");
  });
});

describe("localDayInstants", () => {
  it("an IST day runs 18:30 UTC the day before → 18:30 UTC", () => {
    const { start, next } = localDayInstants(new Date("2026-10-31T00:00:00Z"), "Asia/Kolkata");
    expect(start.toISOString()).toBe("2026-10-30T18:30:00.000Z");
    expect(next.toISOString()).toBe("2026-10-31T18:30:00.000Z");
  });
  it("an invoice issued at 23:00 IST on the 31st falls inside the 31st", () => {
    const { start, next } = localDayInstants(new Date("2026-10-31T00:00:00Z"), "Asia/Kolkata");
    const issued = new Date("2026-10-31T17:30:00Z"); // 23:00 IST
    expect(issued >= start && issued < next).toBe(true);
  });
});
