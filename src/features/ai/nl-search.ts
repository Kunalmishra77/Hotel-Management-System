/**
 * 18 T-4 — natural-language search (FR-4, AC-4/5). NOT a "use server" module:
 * exported for direct call by the action wrapper and by tests with explicit claims.
 *
 * Pipeline (no raw SQL, ever):
 *   NL text → LLM proposes a StructuredQuery (validated by zod)
 *           → 15.validateStructuredQuery  (the authoritative field allow-list)
 *           → 15.runStructuredQuery        (parameterised, caller-scoped, masked)
 *
 * The LLM only *proposes* the query object; a hallucinated or non-whitelisted
 * field is rejected `INVALID_QUERY` and never executed (FR-4).
 */
import { authorize } from "@/lib/permissions";
import { completeStructured, redactText } from "@/lib/ai";
import { runStructuredQuery } from "@/features/search/structured";
import type { SearchResult, StructuredQuery } from "@/features/search/types";
import type { SessionClaims } from "@/lib/auth/claims";
import { structuredQueryOutputSchema } from "./schema";
import { logInteraction } from "./internal";

const SYSTEM = [
  "You translate a hotel staff member's natural-language request into a single-entity structured query object.",
  "Emit ONLY fields the search layer whitelists. Never write SQL. Never invent columns.",
].join(" ");

export type NlSearchResult = {
  query: StructuredQuery;
  results: SearchResult[];
};

/**
 * Compile + run a natural-language search for `user`. Requires `ai:use`.
 * Throws `INVALID_QUERY` if the compiled query is not whitelisted (AC-5).
 */
export async function nlSearch(user: SessionClaims, input: { text: string }): Promise<NlSearchResult> {
  authorize(user, "ai:use");

  // PII-minimised prompt (FR-9) — the request text is redacted before it leaves.
  const redacted = redactText(input.text);
  const { data, provider } = await completeStructured({
    system: SYSTEM,
    messages: [{ role: "user", content: redacted }],
    feature: "nl-search",
    schema: structuredQueryOutputSchema,
  });

  // The proposed object is typed like a StructuredQuery; runStructuredQuery
  // re-validates it against 15's allow-list and throws INVALID_QUERY on any
  // deviation BEFORE it touches the database (FR-4).
  const query = data as StructuredQuery;
  const results = await runStructuredQuery(user, query);

  await logInteraction({
    userId: user.userId,
    feature: "nl-search",
    provider,
    rawInput: { text: input.text },
    outputRef: `${query.entity}:${results.length} results`,
  });

  return { query, results };
}
