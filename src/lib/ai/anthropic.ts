/**
 * 18 T-1 — Anthropic adapter (live-gated). NEVER exercised in tests/CI: the
 * default provider is `mock`, and this throws `AI_PROVIDER_ERROR` unless
 * `ANTHROPIC_API_KEY` is present. Going live is a config change, not a code
 * change (integrations.md).
 *
 * A thin fetch adapter over the Messages REST API — no SDK dependency (tech-stack
 * forbids adding one without an ADR). Kept minimal on purpose; the mock is the
 * reference implementation the app is built and tested against.
 */
import { DomainError, ErrorCode } from "@/lib/errors";
import type { CompleteInput, LLMProvider, LLMResult, Msg } from "./types";

const PROVIDER = "anthropic";
const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest";

function keyOrThrow(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new DomainError(ErrorCode.AI_PROVIDER_ERROR, "ANTHROPIC_API_KEY is not configured.");
  return key;
}

function toApiMessages(messages: Msg[]): { role: "user" | "assistant"; content: string }[] {
  // Anthropic separates the system prompt; tool + assistant turns are collapsed
  // to text for this minimal adapter.
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
}

export class AnthropicProvider implements LLMProvider {
  async complete(input: CompleteInput): Promise<LLMResult> {
    const key = keyOrThrow();
    const system = input.json
      ? `${input.system}\n\nRespond with ONLY a JSON object, no prose.`
      : input.system;

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages: toApiMessages(input.messages) }),
    });
    if (!res.ok) throw new DomainError(ErrorCode.AI_PROVIDER_ERROR, `Anthropic request failed (${res.status}).`);

    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).map((c) => c.text ?? "").join("").trim();
    const json = input.json ? safeParseJson(text) : undefined;
    return { text, toolCalls: [], json, provider: PROVIDER };
  }

  async embed(): Promise<number[][]> {
    // Anthropic has no first-party embeddings endpoint; wire a dedicated
    // embedding provider (local/openai) when segmentation goes live.
    throw new DomainError(ErrorCode.AI_PROVIDER_ERROR, "Embeddings are not available via the Anthropic adapter.");
  }
}

function safeParseJson(text: string): unknown {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return start >= 0 && end >= start ? JSON.parse(text.slice(start, end + 1)) : {};
  } catch {
    return {};
  }
}
