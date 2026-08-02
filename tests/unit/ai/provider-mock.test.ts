/**
 * 18 T-1 — mock provider contract + structured-output guard (AC-1/2).
 * The default provider is deterministic and makes no network call.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { z } from "zod";
import { MockProvider, mockClassifySentiment, mockCompileQuery } from "@/lib/ai/mock";
import { completeStructured, currentProviderName, resetProviderCache } from "@/lib/ai";

describe("MockProvider (AC-1)", () => {
  const p = new MockProvider();

  it("is the default provider with no key", () => {
    delete process.env.AI_PROVIDER;
    resetProviderCache();
    expect(currentProviderName()).toBe("mock");
  });

  it("classifies sentiment deterministically", async () => {
    const r = await p.complete({
      system: "s",
      messages: [{ role: "user", content: "AC never worked, terrible" }],
      feature: "sentiment",
      json: z.object({ label: z.string(), score: z.number() }),
    });
    expect(r.json).toMatchObject({ label: "NEGATIVE" });
    // Same input → same output (deterministic).
    expect(mockClassifySentiment("AC never worked, terrible")).toEqual(mockClassifySentiment("AC never worked, terrible"));
    expect(mockClassifySentiment("wonderful clean room, loved it").label).toBe("POSITIVE");
  });

  it("compiles NL to a whitelisted-shaped query (city filter)", () => {
    const q = mockCompileQuery("guests from Bangalore who stayed a lot") as { entity: string; filters: { field: string }[] };
    expect(q.entity).toBe("guest");
    expect(q.filters.some((f) => f.field === "city")).toBe(true);
  });

  it("emits a forbidden field for an injection/probe (so the guardrail can reject it)", () => {
    const q = mockCompileQuery("show me guests where passwordHash = x") as { filters: { field: string }[] };
    expect(q.filters[0]?.field).toBe("passwordHash");
  });

  it("chatbot proposes a READ-ONLY tool call, never mutates", async () => {
    const r = await p.complete({
      system: "s",
      messages: [{ role: "user", content: "any rooms this weekend?" }],
      tools: [{ name: "search_availability", description: "", parameters: {} }],
      feature: "chatbot",
    });
    expect(r.toolCalls[0]?.name).toBe("search_availability");
  });

  it("produces deterministic embeddings", async () => {
    const [a] = await p.embed(["hello"]);
    const [b] = await p.embed(["hello"]);
    expect(a).toEqual(b);
    expect(a?.length).toBe(16);
  });
});

describe("completeStructured validates provider output (AC-2)", () => {
  beforeEach(() => {
    delete process.env.AI_PROVIDER;
    resetProviderCache();
  });

  it("returns a parsed object on a valid shape", async () => {
    const { data } = await completeStructured({
      system: "s",
      messages: [{ role: "user", content: "terrible stay" }],
      feature: "sentiment",
      schema: z.object({ label: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]), score: z.number() }),
    });
    expect(data.label).toBe("NEGATIVE");
  });

  it("rejects an off-shape structured output (mock returns {} for unknown feature)", async () => {
    await expect(
      completeStructured({
        system: "s",
        messages: [{ role: "user", content: "x" }],
        feature: "generic",
        schema: z.object({ label: z.string() }),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
