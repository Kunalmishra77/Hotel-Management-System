/**
 * 18 T-1 — the provider selector + the structured-output guard (FR-1, AC-1/2).
 *
 * `getLLMProvider()` resolves the adapter named by `AI_PROVIDER` (default
 * `mock`). Everything above this line depends only on the `LLMProvider`
 * interface, so swapping providers never touches a call site (integrations.md).
 *
 * `completeStructured()` is the ONLY way capabilities should ask for a JSON
 * result: it re-validates the provider's output with zod before returning it, so
 * a hallucinated shape is rejected here rather than trusted downstream (AC-2).
 */
import type { ZodTypeAny, z } from "zod";
import { DomainError, ErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AiProviderName, CompleteInput, LLMProvider } from "./types";
import { MockProvider } from "./mock";
import { AnthropicProvider } from "./anthropic";
import { OpenAiProvider } from "./openai";
import { LocalProvider } from "./local";

export * from "./types";
export { redactText, redactValue } from "./redact";

let cached: { name: string; provider: LLMProvider } | null = null;

export function currentProviderName(): AiProviderName {
  const raw = (process.env.AI_PROVIDER ?? "mock").toLowerCase();
  return raw === "anthropic" || raw === "openai" || raw === "local" ? raw : "mock";
}

/** Resolve the configured provider. Defaults to the deterministic mock (FR-1). */
export function getLLMProvider(): LLMProvider {
  const name = currentProviderName();
  if (cached && cached.name === name) return cached.provider;

  const provider: LLMProvider =
    name === "anthropic" ? new AnthropicProvider()
    : name === "openai" ? new OpenAiProvider()
    : name === "local" ? new LocalProvider()
    : new MockProvider();

  cached = { name, provider };
  return provider;
}

/** Test/DI seam — reset the memoised provider (used after mutating env in tests). */
export function resetProviderCache(): void {
  cached = null;
}

/**
 * Ask the provider for a structured object and validate it with `schema` before
 * returning. A provider that returns an off-shape object fails here as
 * `AI_VALIDATION_FAILED` (mapped to VALIDATION_FAILED) — grounding/guardrails
 * never run on an unvalidated blob (AC-2).
 */
export async function completeStructured<S extends ZodTypeAny>(
  input: Omit<CompleteInput, "json"> & { schema: S },
): Promise<{ data: z.infer<S>; provider: string }> {
  const provider = getLLMProvider();
  const result = await provider.complete({ ...input, json: input.schema });
  const parsed = input.schema.safeParse(result.json);
  if (!parsed.success) {
    logger.warn("ai.structured_output_invalid", { feature: input.feature, provider: result.provider });
    throw new DomainError(ErrorCode.VALIDATION_FAILED, "The AI returned an unexpected format.", {
      details: { issues: parsed.error.issues.length },
    });
  }
  return { data: parsed.data as z.infer<S>, provider: result.provider };
}
