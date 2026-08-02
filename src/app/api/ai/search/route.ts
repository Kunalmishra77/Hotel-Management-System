/**
 * 18 T-4 — NL-search endpoint (FR-4, AC-4/5/12). Session-gated + `ai:use`.
 * Compiles NL → 15 StructuredQuery → validates (allow-list) → runs scoped +
 * masked. Never emits raw SQL. Unauthenticated → 401; no `ai:use` → 403.
 */
import { getCurrentSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { httpStatusFor, isDomainError, userMessageFor } from "@/lib/errors";
import { nlSearch } from "@/features/ai/nl-search";
import { askSchema } from "@/features/ai/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = session.claims;
  if (!hasPermission(user, "ai:use")) return Response.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json().catch(() => ({}));
    const { text } = askSchema.parse(body);
    const result = await nlSearch(user, { text });
    // Return the masked result cards + the compiled query (no raw SQL exists).
    return Response.json({ query: result.query, results: result.results });
  } catch (e) {
    if (isDomainError(e)) return Response.json({ error: userMessageFor(e), code: e.code }, { status: httpStatusFor(e) });
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
