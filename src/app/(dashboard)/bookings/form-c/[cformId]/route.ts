/**
 * Form C PDF download — 03 T-37 (FR-25). Authorized, property-scoped read of the
 * generated Form C from encrypted object storage. Never public (compliance.md).
 */
import { requireUser } from "@/lib/auth";
import { httpStatusFor, userMessageFor } from "@/lib/errors";
import { getCFormBytes } from "@/features/reservations/queries";

export async function GET(_req: Request, ctx: { params: Promise<{ cformId: string }> }): Promise<Response> {
  try {
    const { cformId } = await ctx.params;
    const user = await requireUser();
    const { filename, contentType, bytes } = await getCFormBytes(user, cformId);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return new Response(userMessageFor(e), { status: httpStatusFor(e) });
  }
}
