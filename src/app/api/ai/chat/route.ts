/**
 * 18 T-3 — staff chatbot endpoint (FR-3, AC-3/12). Session-gated + `ai:use`.
 * There is NO anonymous entry point here (the guest-site chatbot is 23): an
 * unauthenticated request is 401, a caller without `ai:use` is 403 (FORBIDDEN).
 */
import { getCurrentSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { httpStatusFor, isDomainError, userMessageFor } from "@/lib/errors";
import { chat } from "@/features/ai/chat";
import { chatSchema } from "@/features/ai/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = session.claims;
  if (!hasPermission(user, "ai:use")) return Response.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json().catch(() => ({}));
    const { message } = chatSchema.parse(body);
    const result = await chat(user, { message });
    return Response.json(result);
  } catch (e) {
    if (isDomainError(e)) return Response.json({ error: userMessageFor(e), code: e.code }, { status: httpStatusFor(e) });
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
