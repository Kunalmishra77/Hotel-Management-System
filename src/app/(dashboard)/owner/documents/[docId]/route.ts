/**
 * 27 owner-portal — vault document download. Authorized, property-scoped, access
 * -logged, non-public (compliance.md). Bytes come from encrypted object storage.
 */
import { requireUser } from "@/lib/auth";
import { httpStatusFor, userMessageFor } from "@/lib/errors";
import { getOwnerDocumentBytes } from "@/features/owner-portal/queries";

export async function GET(_req: Request, ctx: { params: Promise<{ docId: string }> }): Promise<Response> {
  try {
    const { docId } = await ctx.params;
    const user = await requireUser();
    const { filename, contentType, bytes } = await getOwnerDocumentBytes(user, docId);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return new Response(userMessageFor(e), { status: httpStatusFor(e) });
  }
}
