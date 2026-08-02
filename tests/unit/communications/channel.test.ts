/** 12 T-4 — selectChannelAndLanguage + candidateChannels (FR-8). */
import { describe, expect, it } from "vitest";
import { candidateChannels, selectChannelAndLanguage } from "@/features/communications/domain/channel";

describe("selectChannelAndLanguage", () => {
  const available = [
    { channel: "WHATSAPP" as const, language: "en" },
    { channel: "WHATSAPP" as const, language: "hi" },
    { channel: "EMAIL" as const, language: "en" },
  ];

  it("prefers the requested language when present", () => {
    expect(selectChannelAndLanguage(["WHATSAPP"], "hi", available)).toEqual({ channel: "WHATSAPP", language: "hi" });
  });

  it("falls back to en when the requested language is absent", () => {
    expect(selectChannelAndLanguage(["EMAIL"], "hi", available)).toEqual({ channel: "EMAIL", language: "en" });
  });

  it("falls back across channels to the first with a template", () => {
    expect(selectChannelAndLanguage(["SMS", "EMAIL"], "en", available)).toEqual({ channel: "EMAIL", language: "en" });
  });

  it("returns null when no channel has a template", () => {
    expect(selectChannelAndLanguage(["SMS"], "en", available)).toBeNull();
  });
});

describe("candidateChannels", () => {
  it("puts the preferred channel first and de-duplicates", () => {
    expect(candidateChannels("EMAIL", ["WHATSAPP", "EMAIL", "SMS"])).toEqual(["EMAIL", "WHATSAPP", "SMS"]);
  });
  it("handles a null preference", () => {
    expect(candidateChannels(null, ["WHATSAPP", "SMS"])).toEqual(["WHATSAPP", "SMS"]);
  });
});
