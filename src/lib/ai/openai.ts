/**
 * 18 T-1 — OpenAI adapter (live-gated). NEVER exercised in tests/CI; throws
 * `AI_PROVIDER_ERROR` unless `OPENAI_API_KEY` is present. Thin fetch adapter over
 * the Chat Completions + Embeddings REST APIs — no SDK dependency (tech-stack).
 */
import { DomainError, ErrorCode } from "@/lib/errors";
import type { CompleteInput, LLMProvider, LLMResult } from "./types";

const PROVIDER = "openai";
const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const EMBED_URL = "https://api.openai.com/v1/embeddings";
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL ?? "text-embedding-3-small";

function keyOrThrow(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new DomainError(ErrorCode.AI_PROVIDER_ERROR, "OPENAI_API_KEY is not configured.");
  return key;
}

export class OpenAiProvider implements LLMProvider {
  async complete(input: CompleteInput): Promise<LLMResult> {
    const key = keyOrThrow();
    const messages = [
      { role: "system", content: input.system },
      ...input.messages.filter((m) => m.role !== "system").map((m) => ({
        role: m.role === "assistant" ? "assistant" : m.role === "tool" ? "user" : "user",
        content: m.content,
      })),
    ];

    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        messages,
        ...(input.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) throw new DomainError(ErrorCode.AI_PROVIDER_ERROR, `OpenAI request failed (${res.status}).`);

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (data.choices?.[0]?.message?.content ?? "").trim();
    const json = input.json ? safeParseJson(text) : undefined;
    return { text, toolCalls: [], json, provider: PROVIDER };
  }

  async embed(texts: string[]): Promise<number[][]> {
    const key = keyOrThrow();
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    });
    if (!res.ok) throw new DomainError(ErrorCode.AI_PROVIDER_ERROR, `OpenAI embeddings failed (${res.status}).`);
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
