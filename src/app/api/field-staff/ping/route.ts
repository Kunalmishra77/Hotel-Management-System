/**
 * 09 addendum — public field-staff location ping (FR-17/18). Token-authed (the
 * tracking token is the credential) + rate-limited; no session. Called by the
 * `/track/[token]` tracker while the driver is on-duty.
 */
import { recordFieldPing } from "@/features/staff/field-internal";
import { httpStatusFor, userMessageFor } from "@/lib/errors";

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    await recordFieldPing(body);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: userMessageFor(e) }), {
      status: httpStatusFor(e),
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}
