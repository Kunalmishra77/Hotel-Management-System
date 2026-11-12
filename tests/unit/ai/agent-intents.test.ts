import { describe, expect, it } from "vitest";
import { classify, matchGuide } from "@/features/ai/domain/agent-intents";

const kind = (q: string) => classify(q).kind;

describe("PMS Agent — understanding questions without an LLM", () => {
  it("booking codes and rooms", () => {
    expect(classify("BK-AL7N8L9P ka status")).toEqual({ kind: "booking", code: "BK-AL7N8L9P" });
    expect(classify("2F-3 me kaun hai")).toEqual({ kind: "room", room: "2F-3" });
    expect(classify("who is in GF-1?")).toEqual({ kind: "room", room: "GF-1" });
    expect(classify("R2 ka guest")).toEqual({ kind: "room", room: "R2" });
    expect(classify("room 101 me kaun")).toEqual({ kind: "room", room: "101" });
  });

  it("today / tomorrow movements, vacancy, in-house — English and Hinglish", () => {
    expect(classify("aaj kaun aa raha hai")).toEqual({ kind: "arrivals", dayOffset: 0 });
    expect(classify("kal ke arrivals")).toEqual({ kind: "arrivals", dayOffset: 1 });
    expect(classify("today's departures")).toEqual({ kind: "departures", dayOffset: 0 });
    expect(kind("aaj check out kaun karega")).toBe("departures");
    expect(kind("khali room kitne hai")).toBe("vacant");
    expect(kind("abhi kaun kaun ruka hai")).toBe("inHouse");
  });

  it("money and operations go to the business answers", () => {
    for (const q of ["aaj ke pending dues", "this month's revenue", "profit kitna hua", "occupancy", "cancellations this month", "kitne room clean karne hai"]) {
      expect(kind(q)).toBe("business");
    }
  });

  it("how-to questions get the platform guide", () => {
    const g = classify("extend kaise kare");
    expect(g.kind).toBe("guide");
    if (g.kind === "guide") expect(g.topic.id).toBe("extend");
    expect(matchGuide("guest late aayega, no show ho gaya kya kare")?.id).toBe("late-arrival");
    expect(matchGuide("how to void an invoice")?.id).toBe("invoice");
    expect(matchGuide("mmt payment kaise record kare")?.id).toBe("ota-payment");
    expect(matchGuide("how to split bill ota and direct")?.id).toBe("split-bill");
  });

  it("anything else is a guest lookup by name; empty → help", () => {
    expect(classify("Saumen Chatterjee")).toEqual({ kind: "guest", name: "saumen chatterjee" });
    expect(classify("tarun ka balance kitna hai")).toEqual({ kind: "guest", name: "tarun kitna" });
    expect(kind("hello")).toBe("help");
    expect(kind("?")).toBe("help");
  });
});
