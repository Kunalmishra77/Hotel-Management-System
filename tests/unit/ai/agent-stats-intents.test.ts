/**
 * The client's own questions (13 Nov 2026) that the agent got wrong: counting
 * questions were searched as guest names, Hindi script was ignored, and a menu
 * price question returned guests.
 */
import { describe, expect, it } from "vitest";
import { classify, parsePeriod, toLatin } from "@/features/ai/domain/agent-intents";

const TODAY = new Date("2026-11-13T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("counting questions → stats, never a guest search", () => {
  it.each([
    ["kitne guest abhi tak hai ye pura saal mei", "guests"],
    ["kitne customers, 2026 mei humare properties mei aa chuke hai?", "checkins"],
    ["Woodpecker के apartments में यह पूरा साल में कितने customers check-in हैं? हमारी पूरी 4 properties में यह पूरा 2026 में कितने customers check-in हैं?", "checkins"],
    ["2026 में कितने ग्राहक आए", "checkins"],
    ["is mahine kitni bookings aayi", "bookings"],
    ["how many room nights in october", "nights"],
    ["kitni bookings cancel hui is saal", "cancellations"],
  ])("%s", (q, metric) => {
    const i = classify(q);
    expect(i.kind).toBe("stats");
    if (i.kind === "stats") expect(i.metric).toBe(metric);
  });

  it("'how many guests now' is the in-house list", () => {
    expect(classify("kitne guest abhi hai").kind).toBe("inHouse");
  });
  it("money totals stay business questions", () => {
    expect(classify("total revenue this month").kind).toBe("business");
    expect(classify("kitna due hai").kind).toBe("business");
  });
  it("'kitne rooms khali' is still the vacant list", () => {
    expect(classify("kitne rooms khali hai").kind).toBe("vacant");
  });
});

describe("price questions", () => {
  it("jelebi kitne rupe ka hai → price of 'jelebi'", () => {
    expect(classify("jelebi kitne rupe ka hai?")).toEqual({ kind: "price", item: "jelebi" });
  });
  it("room rate questions are not menu prices", () => {
    expect(classify("room rate kitne ka hai").kind).not.toBe("price");
  });
});

describe("things it doesn't understand are not guest searches", () => {
  it.each(["customers?", "kitne abhi tak ye pura saal mei", "how many are there in all the properties of the group please"])("%s", (q) => {
    expect(classify(q).kind).not.toBe("guest");
  });
  it("a plain name is still a guest search", () => {
    expect(classify("Abhishek Mishra")).toEqual({ kind: "guest", name: "abhishek mishra" });
  });
});

describe("parsePeriod", () => {
  it("defaults to this year so far", () => {
    const p = parsePeriod("kitne customers aaye", TODAY);
    expect([iso(p.from), iso(p.to), p.label]).toEqual(["2026-01-01", "2026-11-14", "2026 so far"]);
  });
  it("a named year", () => {
    const p = parsePeriod("2025 me kitne guest", TODAY);
    expect([iso(p.from), iso(p.to), p.label]).toEqual(["2025-01-01", "2026-01-01", "2025"]);
  });
  it("a month name, Hindi too", () => {
    expect(iso(parsePeriod("october ke check-ins", TODAY).from)).toBe("2026-10-01");
    expect(iso(parsePeriod("अक्टूबर में कितने ग्राहक", TODAY).to)).toBe("2026-11-01");
  });
  it("a later month means last year's", () => {
    expect(iso(parsePeriod("december me kitne guest", TODAY).from)).toBe("2025-12-01");
  });
  it("this month / last month / today", () => {
    expect(iso(parsePeriod("is mahine kitne", TODAY).from)).toBe("2026-11-01");
    const last = parsePeriod("pichle mahine kitne guest", TODAY);
    expect([iso(last.from), iso(last.to)]).toEqual(["2026-10-01", "2026-11-01"]);
    expect(parsePeriod("aaj kitne", TODAY).label).toBe("today");
  });
});

describe("toLatin", () => {
  it("reads Hindi script and digits", () => {
    expect(toLatin("२०२६ में कितने ग्राहक")).toBe("2026 mei kitne customers");
  });
});
