/**
 * Public hold + deposit order — 23 T-7/T-8/T-9/T-10 (FR-4/5/10/11/12/22,
 * AC-4/5/11/12/13/16). Rate-limited → bot-rejected → validated → hold → order.
 * A 429 or a bot rejection produces NO hold/order side effects.
 */
import { loadPublishedConfig } from "@/features/booking-engine/queries";
import { placeHold } from "@/features/booking-engine/public";
import { holdSchema } from "@/features/booking-engine/schema";
import { enforceRateLimit, jsonError } from "@/features/booking-engine/http";
import { clientIp } from "@/features/booking-engine/internal";
import { NotFoundError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const limited = enforceRateLimit("hold", request);
  if (limited) return limited;

  try {
    const { slug } = await context.params;
    const cfg = await loadPublishedConfig(slug);
    if (!cfg) throw new NotFoundError("This booking site is not available.");

    const body = holdSchema.parse(await request.json());
    const result = await placeHold(cfg, body, { ip: clientIp(request.headers) });

    // Only the gateway params the client needs — never secrets (FR-5, AC-5).
    return Response.json(
      {
        data: {
          reservationCode: result.reservationCode,
          totalPaise: result.totalPaise,
          amountPaise: result.amountPaise,
          selfServiceToken: result.selfServiceToken,
          gateway: result.gateway,
        },
      },
      { status: result.replayed ? 200 : 201 },
    );
  } catch (e) {
    return jsonError(e);
  }
}
