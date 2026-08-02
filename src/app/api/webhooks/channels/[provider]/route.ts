/**
 * OTA / channel webhook — 13 T-7 (FR-5/14, AC-4/5/14). Verifies the provider
 * signature FIRST, then dedupes via the inbox; the reservation is created by the
 * worker's inbox sweep. A bad signature is 401 with no side effect; a duplicate
 * is 200 (providers retry aggressively — a 500 on a duplicate makes them retry
 * harder). Unauthenticated by design; the SIGNATURE is the authentication.
 */
import { handleChannelWebhook } from "@/features/channels/webhook";
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
  const signature = request.headers.get("x-channel-signature") ?? "";

  try {
    const outcome = await handleChannelWebhook({ provider, rawBody, signature });
    return Response.json({ status: outcome.status }, { status: 200 });
  } catch (e) {
    if (isDomainError(e) && e.code === ErrorCode.WEBHOOK_SIGNATURE_INVALID) {
      return Response.json({ error: "invalid signature" }, { status: 401 });
    }
    if (isDomainError(e) && e.code === ErrorCode.VALIDATION_FAILED) {
      return Response.json({ error: "invalid payload" }, { status: 400 });
    }
    logger.error("webhook.channels.failed", { provider, error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}
