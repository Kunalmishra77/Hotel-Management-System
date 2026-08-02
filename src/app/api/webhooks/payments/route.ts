/**
 * Payment provider webhook — 06 T-14 (FR-11, AC-12). Verifies the provider
 * signature, dedupes via the inbox, and records the payment exactly once. A bad
 * signature is 401; a duplicate is 200 (providers retry aggressively — a 500 on a
 * duplicate makes them retry harder). Unauthenticated by design; the SIGNATURE is
 * the authentication.
 */
import { handlePaymentWebhook } from "@/features/billing/online-payment";
import { isDomainError, ErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-webhook-signature") ?? "";

  try {
    const outcome = await handlePaymentWebhook({ rawBody, signature });
    return Response.json({ status: outcome.status }, { status: 200 });
  } catch (e) {
    if (isDomainError(e) && e.code === ErrorCode.WEBHOOK_SIGNATURE_INVALID) {
      return Response.json({ error: "invalid signature" }, { status: 401 });
    }
    logger.error("webhook.payments.failed", { error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}
