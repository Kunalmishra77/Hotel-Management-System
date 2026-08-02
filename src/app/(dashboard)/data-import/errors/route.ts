/**
 * Error-report download — 26 (FR-7, AC-6). GET /data-import/errors?batchId=…
 * Admin-only; returns exactly the ERROR rows (rowNum + reason) as CSV.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { httpStatusFor, userMessageFor } from "@/lib/errors";
import { downloadErrors } from "@/features/data-onboarding/queries";
import { downloadErrorsSchema } from "@/features/data-onboarding/schema";

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    authorize(user, "data:import", null);
    const url = new URL(request.url);
    const { batchId } = downloadErrorsSchema.parse({ batchId: url.searchParams.get("batchId") ?? "" });
    const file = await downloadErrors(user, batchId);
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
