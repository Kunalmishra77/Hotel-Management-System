import { describe, expect, it } from "vitest";
import { parseAmount, parseCommand, parseDate } from "@/features/ai/domain/agent-commands";

const today = new Date("2026-11-12T00:00:00Z");
const cmd = (s: string) => parseCommand(s, today);

describe("PMS Agent commands — sentence → action, no LLM", () => {
  it("dates and amounts", () => {
    expect(parseDate("8 dec", today)).toBe("2026-12-08");
    expect(parseDate("till 8th December", today)).toBe("2026-12-08");
    expect(parseDate("upto 08/12", today)).toBe("2026-12-08");
    expect(parseDate("2027-01-05", today)).toBe("2027-01-05");
    expect(parseDate("5 jan", today)).toBe("2027-01-05"); // next January, not last
    expect(parseDate("kal", today)).toBe("2026-11-13");
    expect(parseAmount("₹2,535 cash")).toBe(253_500);
    expect(parseAmount("BK-AL7N8L9P me 2535 jama")).toBe(253_500);
    expect(parseAmount("rate 6k")).toBe(600_000);
    expect(parseAmount("extend till 08/12")).toBeNull();
  });

  it("extend, check-in/out, rate, payment", () => {
    expect(cmd("BK-RW1DQ2ET ko 30 Nov tak extend karo")).toEqual({ kind: "extend", target: { code: "BK-RW1DQ2ET" }, date: "2026-11-30", gstInclusive: false, source: undefined });
    expect(cmd("extend BK-RW1DQ2ET to 8 dec at rate 6000 incl gst via mmt")).toMatchObject({ kind: "extend", date: "2026-12-08", ratePaise: 600_000, gstInclusive: true, source: "MAKEMYTRIP" });
    expect(cmd("2F-3 wale guest ko check out karo")).toEqual({ kind: "checkOut", target: { room: "2F-3" } });
    expect(cmd("check in BK-AL7N8L9P")).toEqual({ kind: "checkIn", target: { code: "BK-AL7N8L9P" } });
    expect(cmd("BK-AL7N8L9P ka rate 6000 karo")).toEqual({ kind: "rate", target: { code: "BK-AL7N8L9P" }, ratePaise: 600_000, gstInclusive: false });
    expect(cmd("BK-QQWQ4HDC me 1937 mmt payment record karo")).toEqual({ kind: "payment", target: { code: "BK-QQWQ4HDC" }, amountPaise: 193_700, mode: "ONLINE" });
    expect(cmd("Adriana ka 2535 cash jama karo")).toEqual({ kind: "payment", target: { name: "adriana" }, amountPaise: 253_500, mode: "CASH" });
    expect(cmd("2535 upi received for BK-AKV7L13E")).toMatchObject({ kind: "payment", mode: "UPI" });
  });

  it("hold, source, move, clean, charge, scan", () => {
    expect(cmd("BK-AL7N8L9P late arrival hold karo")).toEqual({ kind: "holdLate", target: { code: "BK-AL7N8L9P" } });
    expect(cmd("BK-AL7N8L9P guest nahi aayega remove hold")).toEqual({ kind: "releaseHold", target: { code: "BK-AL7N8L9P" } });
    expect(cmd("BK-QQWQ4HDC source MMT karo")).toEqual({ kind: "source", target: { code: "BK-QQWQ4HDC" }, source: "MAKEMYTRIP" });
    expect(cmd("move 2F-3 guest to GF-1")).toEqual({ kind: "move", target: { room: "2F-3" }, toRoom: "GF-1" });
    expect(cmd("BK-AL7N8L9P ko 3F-1 me shift karo")).toEqual({ kind: "move", target: { code: "BK-AL7N8L9P" }, toRoom: "3F-1" });
    expect(cmd("2F-2 clean ho gaya")).toEqual({ kind: "roomClean", room: "2F-2" });
    expect(cmd("room 104 clean ho gaya")).toEqual({ kind: "roomClean", room: "104" });
    expect(cmd("BK-AL7N8L9P me dinner 300 add karo")).toEqual({ kind: "charge", target: { code: "BK-AL7N8L9P" }, chargeType: "FOOD", amountPaise: 30_000, description: "Dinner" });
    expect(cmd("koi galti hai kya check karo")).toEqual({ kind: "scan" });
  });

  it("questions are not commands", () => {
    expect(cmd("extend kaise kare")).toBeNull();
    expect(cmd("how to check out?")).toBeNull();
    expect(cmd("aaj kaun aa raha hai")).toBeNull();
    expect(cmd("2F-3 me kaun hai")).toBeNull();
  });
});
