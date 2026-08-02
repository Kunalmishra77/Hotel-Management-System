/**
 * Booking-engine payment webhook — 23 T-11/T-12/T-13/T-14 (FR-6/7/8/9/19).
 *
 * Unauthenticated by design — the SIGNATURE is the authentication, verified FIRST
 * inside the handler. A bad signature is 401; a duplicate (deduped by the inbox)
 * is 200 (providers retry aggressively, and a 500 on a duplicate makes them retry
 * harder). Everything else — confirm / hold-lost-refund / release — is idempotent.
 */
import { handleBookingPaymentWebhook } from "@/features/booking-engine/public";
import { isDomainError, ErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-webhook-signature") ?? "";

  try {
    const outcome = await handleBookingPaymentWebhook({ rawBody, signature });
    return Response.json({ status: outcome.status }, { status: 200 });
  } catch (e) {
    if (isDomainError(e) && e.code === ErrorCode.WEBHOOK_SIGNATURE_INVALID) {
      return Response.json({ error: "invalid signature" }, { status: 401 });
    }
    logger.error("webhook.booking_payments.failed", { error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}
