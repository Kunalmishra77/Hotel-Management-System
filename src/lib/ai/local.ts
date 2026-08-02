/**
 * 18 T-1 — local / self-hosted adapter (live-gated). Targets any OpenAI-compatible
 * endpoint (Ollama, vLLM, LM Studio) via `AI_LOCAL_BASE_URL`. NEVER exercised in
 * tests/CI; throws `AI_PROVIDER_ERROR` unless the base URL is configured.
 *
 * Reuses the OpenAI wire format — the point of the provider abstraction is that
 * swapping to on-prem inference is a config change, not a code change (ai-features.md).
 */
import { DomainError, ErrorCode } from "@/lib/errors";
import type { CompleteInput, LLMProvider, LLMResult } from "./types";

const PROVIDER = "local";
const MODEL = process.env.AI_LOCAL_MODEL ?? "llama3.1";
const EMBED_MODEL = process.env.AI_LOCAL_EMBED_MODEL ?? "nomic-embed-text";

function baseOrThrow(): string {
  const base = process.env.AI_LOCAL_BASE_URL;
  if (!base) throw new DomainError(ErrorCode.AI_PROVIDER_ERROR, "AI_LOCAL_BASE_URL is not configured.");
  return base.replace(/\/$/, "");
}

export class LocalProvider implements LLMProvider {
  async complete(input: CompleteInput): Promise<LLMResult> {
    const base = baseOrThrow();
    const messages = [
      { role: "system", content: input.system },
      ...input.messages.filter((m) => m.role !== "system").map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    ];
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages, ...(input.json ? { response_format: { type: "json_object" } } : {}) }),
    });
    if (!res.ok) throw new DomainError(ErrorCode.AI_PROVIDER_ERROR, `Local model request failed (${res.status}).`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (data.choices?.[0]?.message?.content ?? "").trim();
    const json = input.json ? safeParseJson(text) : undefined;
    return { text, toolCalls: [], json, provider: PROVIDER };
  }

  async embed(texts: string[]): Promise<number[][]> {
    const base = baseOrThrow();
    const res = await fetch(`${base}/v1/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    });
    if (!res.ok) throw new DomainError(ErrorCode.AI_PROVIDER_ERROR, `Local embeddings failed (${res.status}).`);
    const data = (await res.json()) as { data?: { embedding: number[] }[] };
    return (data.data ?? []).map((d) => d.embedding);
  }
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
