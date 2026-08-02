/**
 * Template download — 26 (FR-2, AC-1). GET /data-import/template?kind=GUESTS.
 * Admin-only; returns the per-kind CSV (headers + example row).
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { httpStatusFor, userMessageFor } from "@/lib/errors";
import { getTemplate } from "@/features/data-onboarding/queries";
import { importKindSchema } from "@/features/data-onboarding/schema";

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    authorize(user, "data:import", null);
    const url = new URL(request.url);
    const kind = importKindSchema.parse(url.searchParams.get("kind") ?? "GUESTS");
    const file = getTemplate(kind);
    return new Response(file.content, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
      },
    });
  } catch (e) {
    return new Response(userMessageFor(e), { status: httpStatusFor(e) });
  }
}
