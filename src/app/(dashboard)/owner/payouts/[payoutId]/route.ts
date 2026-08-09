/**
 * 27 owner-portal — payout statement PDF download. Authorized, property-scoped,
 * non-public. Rendered on demand from the immutable OwnerPayout snapshot.
 */
import { requireUser } from "@/lib/auth";
import { httpStatusFor, userMessageFor } from "@/lib/errors";
import { getPayoutStatementBytes } from "@/features/owner-portal/queries";

export async function GET(_req: Request, ctx: { params: Promise<{ payoutId: string }> }): Promise<Response> {
  try {
    const { payoutId } = await ctx.params;
    const user = await requireUser();
    const { filename, contentType, bytes } = await getPayoutStatementBytes(user, payoutId);
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
