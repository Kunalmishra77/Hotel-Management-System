/**
 * 18 AI — the provider-agnostic LLM contract (ai-features.md).
 *
 * All AI in the app goes through `LLMProvider`. Adapters (mock/anthropic/openai/
 * local) implement this shape and are selected by `AI_PROVIDER`; the default is
 * a deterministic `mock` so the app + tests run with NO key (FR-1).
 *
 * The interface is deliberately minimal: `complete` (chat / tool-use / JSON) and
 * `embed`. A `feature` hint may accompany a request so the deterministic mock can
 * return a shape appropriate to the caller; live adapters ignore it (it is just
 * metadata — never a place to smuggle instructions past the guardrails).
 */
import type { ZodTypeAny } from "zod";

export const AI_FEATURES = ["nl-search", "sentiment", "forecast", "chatbot", "passport-extract", "generic"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export type MsgRole = "system" | "user" | "assistant" | "tool";

export type Msg = {
  role: MsgRole;
  content: string;
  /** For a `tool` message: which tool produced it. */
  name?: string;
  /** Correlates a tool result back to the assistant's tool call. */
  toolCallId?: string;
};

/** A read-only tool the chatbot may call. Parameters described as a JSON-schema object. */
export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type CompleteInput = {
  system: string;
  messages: Msg[];
  /** Read-only tools available to the model. The chatbot exposes NO mutation tools (FR-2). */
  tools?: ToolSpec[];
  /**
   * When set, the caller wants a structured object matching this zod schema.
   * The RESULT is still re-validated with zod by the caller before use (AC-2) —
   * a provider claiming a shape is never trusted on its word.
   */
  json?: ZodTypeAny;
  /** Optional hint so the deterministic mock can shape its stub; live adapters ignore it. */
  feature?: AiFeature;
};

export type LLMResult = {
  text: string;
  toolCalls: ToolCall[];
  /** Present when `json` was requested — the (unvalidated) structured object. */
  json?: unknown;
  /** Which adapter produced this — recorded in `AiInteractionLog` (FR-9). */
  provider: string;
};

export interface LLMProvider {
  complete(input: CompleteInput): Promise<LLMResult>;
  embed(texts: string[]): Promise<number[][]>;
}

/** Providers selectable via `AI_PROVIDER`. */
export const AI_PROVIDER_NAMES = ["mock", "anthropic", "openai", "local"] as const;
export type AiProviderName = (typeof AI_PROVIDER_NAMES)[number];
