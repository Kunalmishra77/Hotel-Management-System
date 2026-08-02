/**
 * 18 T-1 — the DEFAULT provider: a deterministic mock (FR-1, AC-1/2).
 *
 * With no API key the whole app + test suite must run end-to-end. This adapter
 * returns deterministic, reproducible output for every capability so behaviour
 * is stable in dev/CI: the same input always yields the same result, and no
 * network call is ever made.
 *
 * The mock is intentionally self-contained (it imports no `features/*` code —
 * infrastructure never depends upward, architecture.md). Its "intelligence" is
 * a small, transparent rule set; the numeric/factual grounding lives in the
 * capability domain layer, which is where it belongs (FR-6/10).
 */
import type {
  CompleteInput,
  LLMProvider,
  LLMResult,
  ToolCall,
} from "./types";

const PROVIDER = "mock";

/** Sentiment lexicon — deterministic classification for feedback (FR-5). */
const NEGATIVE = ["terrible", "never worked", "broken", "dirty", "awful", "worst", "rude", "poor", "bad", "cold", "noisy", "smell", "leak", "cancel", "refund", "complaint", "unhappy", "disappointed"];
const POSITIVE = ["excellent", "great", "loved", "clean", "wonderful", "amazing", "good", "friendly", "comfortable", "spotless", "perfect", "recommend", "happy", "helpful"];

/** Words that must NEVER become a real query field — a hallucinated / injection probe. */
const FORBIDDEN_FIELD_HINTS = ["password", "passwordhash", "raw sql", "drop table", "aadhaar number", "secret"];

/** Known cities the NL compiler recognises after "from"/"in". Extendable; not exhaustive. */
const CITY_HINTS = ["bangalore", "bengaluru", "mumbai", "delhi", "chennai", "hyderabad", "pune", "kolkata", "jaipur", "goa"];

function lastUserText(input: CompleteInput): string {
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const m = input.messages[i];
    if (m && m.role === "user") return m.content;
  }
  return input.messages[input.messages.length - 1]?.content ?? "";
}

function hasToolResult(input: CompleteInput): boolean {
  return input.messages.some((m) => m.role === "tool");
}

/** Deterministic sentiment classification. */
export function mockClassifySentiment(text: string): { label: "POSITIVE" | "NEUTRAL" | "NEGATIVE"; score: number } {
  const t = text.toLowerCase();
  const neg = NEGATIVE.filter((w) => t.includes(w)).length;
  const pos = POSITIVE.filter((w) => t.includes(w)).length;
  if (neg > pos) return { label: "NEGATIVE", score: Number(Math.min(0.99, 0.6 + neg * 0.1).toFixed(2)) };
  if (pos > neg) return { label: "POSITIVE", score: Number(Math.min(0.99, 0.6 + pos * 0.1).toFixed(2)) };
  return { label: "NEUTRAL", score: 0.5 };
}

/**
 * Deterministic NL → structured-query object. Produces the 15 `StructuredQuery`
 * SHAPE; it is NOT trusted — the caller validates it with zod AND runs it through
 * 15's field allow-list (FR-4). We intentionally leave a hallucinated/forbidden
 * field in place when the prompt probes for one, so the guardrail can reject it.
 */
export function mockCompileQuery(text: string): unknown {
  const t = text.toLowerCase();

  // Entity detection — "guest" wins first so "guests who stayed…" stays a guest
  // query (not a reservation query).
  let entity: string = "guest";
  if (/\bguest/.test(t)) entity = "guest";
  else if (/booking|reservation/.test(t)) entity = "reservation";
  else if (/invoice|bill/.test(t)) entity = "invoice";
  else if (/expense|spend/.test(t)) entity = "expense";
  else if (/staff|employee/.test(t)) entity = "staff";

  const filters: { field: string; op: string; value: string | number | string[] }[] = [];

  // A probe for a raw column / injection → emit it verbatim so validation rejects it (AC-5).
  const forbidden = FORBIDDEN_FIELD_HINTS.find((w) => t.includes(w));
  if (forbidden) {
    filters.push({ field: "passwordHash", op: "eq", value: "x" });
    return { entity, filters };
  }

  // City after "from"/"in", or any recognised city token.
  const city = CITY_HINTS.find((c) => t.includes(c));
  if (city && (entity === "guest")) {
    filters.push({ field: "city", op: "eq", value: capitalize(city) });
  }

  // "last N years/months" → a createdAt lower bound (guest) / checkInDate (reservation).
  const rangeMatch = t.match(/last\s+(\d+)\s+(year|month)/);
  const dateField = entity === "reservation" ? "checkInDate" : entity === "guest" ? "createdAt" : undefined;
  let dateRange: { field: string; from: Date; to: Date } | undefined;
  if (rangeMatch && dateField) {
    const n = Number(rangeMatch[1]);
    const unit = rangeMatch[2];
    const to = new Date();
    const from = new Date(to);
    if (unit === "year") from.setFullYear(from.getFullYear() - n);
    else from.setMonth(from.getMonth() - n);
    dateRange = { field: dateField, from, to };
  }

  return dateRange ? { entity, filters, dateRange } : { entity, filters };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Deterministic narrative for grounded numeric summaries (FR-6). */
function mockNarrative(input: CompleteInput): string {
  // The numbers are supplied by the caller (grounding); we only phrase them.
  const facts = lastUserText(input).replace(/\s+/g, " ").trim();
  return `Based on the figures provided, here is a summary: ${facts}`.slice(0, 600);
}

/** Deterministic chatbot behaviour: call a read-only tool once, then answer. */
function mockChat(input: CompleteInput): LLMResult {
  const text = lastUserText(input).toLowerCase();
  const tools = input.tools ?? [];

  // Second turn — a tool result is present: summarise it, never mutate.
  if (hasToolResult(input)) {
    const result = [...input.messages].reverse().find((m) => m.role === "tool");
    return { text: `Here is what I found: ${result?.content ?? "no data"}`, toolCalls: [], provider: PROVIDER };
  }

  const wantsAvailability = /room|avail|weekend|vacan|free|book/.test(text);
  const availTool = tools.find((tt) => tt.name === "search_availability");
  if (wantsAvailability && availTool) {
    const call: ToolCall = { id: "call_1", name: "search_availability", arguments: { when: "weekend" } };
    return { text: "", toolCalls: [call], provider: PROVIDER };
  }

  const faqTool = tools.find((tt) => tt.name === "property_faq");
  if (faqTool) {
    return { text: "", toolCalls: [{ id: "call_1", name: "property_faq", arguments: { topic: text.slice(0, 40) } }], provider: PROVIDER };
  }

  // No tool applies — a plain, non-committal answer. Cannot confirm bookings (FR-3).
  return { text: "I can help you look things up, but I can't confirm bookings or change data here.", toolCalls: [], provider: PROVIDER };
}

export class MockProvider implements LLMProvider {
  async complete(input: CompleteInput): Promise<LLMResult> {
    // Structured-output requests.
    if (input.json) {
      if (input.feature === "sentiment") {
        return { text: "", toolCalls: [], json: mockClassifySentiment(lastUserText(input)), provider: PROVIDER };
      }
      if (input.feature === "nl-search") {
        return { text: "", toolCalls: [], json: mockCompileQuery(lastUserText(input)), provider: PROVIDER };
      }
      // Unknown structured request → empty object; the caller's zod.parse decides.
      return { text: "", toolCalls: [], json: {}, provider: PROVIDER };
    }

    // Tool-using chatbot.
    if (input.tools && input.tools.length > 0) return mockChat(input);

    // Plain narrative.
    return { text: mockNarrative(input), toolCalls: [], provider: PROVIDER };
  }

  /**
   * Deterministic pseudo-embeddings: a fixed-dimension vector derived from the
   * text so clustering/segmentation is reproducible with no key. Not semantic —
   * but stable, which is what dev/CI needs.
   */
  async embed(texts: string[]): Promise<number[][]> {
    const DIM = 16;
    return texts.map((text) => {
      const v = new Array<number>(DIM).fill(0);
      for (let i = 0; i < text.length; i++) {
        v[i % DIM] = (v[i % DIM] ?? 0) + text.charCodeAt(i);
      }
      const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
      return v.map((x) => Number((x / norm).toFixed(6)));
    });
  }
}
