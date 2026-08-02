/**
 * Payslip download — 21 T-19 (FR-7/16, AC-8/14). Authorized, property-scoped read
 * of the finalized line's PDF from encrypted object storage. Never public.
 */
import { requireUser } from "@/lib/auth";
import { httpStatusFor, userMessageFor } from "@/lib/errors";
import { getPayslipBytes } from "@/features/payroll/queries";

export async function GET(_req: Request, ctx: { params: Promise<{ lineId: string }> }): Promise<Response> {
  try {
    const { lineId } = await ctx.params;
    const user = await requireUser();
    const { filename, contentType, bytes } = await getPayslipBytes(user, lineId);
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
