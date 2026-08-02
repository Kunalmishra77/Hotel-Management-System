/**
 * renderTemplate — 12 T-3 (FR-18, FR-24, AC-16). PURE.
 *
 * Substitutes `{{var}}` placeholders from a flat context. STRICT by design: a
 * placeholder with no matching context key throws `RENDER_MISSING_VAR` so the
 * message is dead-lettered rather than sent half-rendered (never a blank Wi-Fi
 * or house-rules message — FR-24). Whitespace inside the braces is tolerated
 * (`{{ guestName }}`). Values are coerced to strings; nullish is treated as
 * missing (a merge field unset for the property must fail, not send empty).
 */
import { DomainError, ErrorCode } from "@/lib/errors";

export type RenderContext = Record<string, string | number | null | undefined>;

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/** The variable names a template body references (deduped, in first-seen order). */
export function templateVariables(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name) seen.add(name);
  }
  return [...seen];
}

export function renderTemplate(body: string, context: RenderContext): string {
  const missing: string[] = [];
  const out = body.replace(PLACEHOLDER, (_full, rawName: string) => {
    const value = context[rawName];
    if (value === undefined || value === null || value === "") {
      missing.push(rawName);
      return "";
    }
    return String(value);
  });

  if (missing.length > 0) {
    // Detail is server-log only; the user-safe message comes from the code.
    throw new DomainError(ErrorCode.RENDER_MISSING_VAR, "Template references unset variables", {
      details: { missing: [...new Set(missing)] },
    });
  }
  return out;
}
