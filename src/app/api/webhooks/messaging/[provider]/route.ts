/**
 * Messaging provider webhook — 12 T-11 (FR-6/11/16/22, AC-5/6/9/14).
 *
 * Unauthenticated by design — the SIGNATURE is the authentication (verified first
 * inside the handler). A bad signature is 401; a duplicate is 200 (providers
 * retry aggressively, and a 500 on a duplicate makes them retry harder). The
 * `[provider]` segment selects which MessagingAccount config verifies + routes.
 */
import { handleMessagingWebhook } from "@/features/communications/webhook";
import { isDomainError, ErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await context.params;
  const rawBody = await request.text();
  const signature =
    request.headers.get("x-webhook-signature") ?? request.headers.get("x-hub-signature-256") ?? "";

  try {
    const outcome = await handleMessagingWebhook({ provider, rawBody, signature });
    return Response.json({ status: outcome.status }, { status: 200 });
  } catch (e) {
    if (isDomainError(e) && e.code === ErrorCode.WEBHOOK_SIGNATURE_INVALID) {
      return Response.json({ error: "invalid signature" }, { status: 401 });
    }
    logger.error("webhook.messaging.failed", { provider, error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}
