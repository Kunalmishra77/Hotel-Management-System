/**
 * Public checkout quote + coupon preview — 23 T-17c (FR-15/23/24, AC-18/20).
 * Recomputes the GST-inclusive total + deposit, and previews a coupon WITHOUT
 * consuming it. Rate-limited; no side effects.
 */
import { loadPublishedConfig, quoteBooking } from "@/features/booking-engine/queries";
import { quoteSchema } from "@/features/booking-engine/schema";
import { enforceRateLimit, jsonError } from "@/features/booking-engine/http";
import { NotFoundError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const limited = enforceRateLimit("availability", request);
  if (limited) return limited;

  try {
    const { slug } = await context.params;
    const cfg = await loadPublishedConfig(slug);
    if (!cfg) throw new NotFoundError("This booking site is not available.");

    const body = quoteSchema.parse(await request.json());
    const result = await quoteBooking(cfg, body);
    return Response.json({ data: result });
  } catch (e) {
    return jsonError(e);
  }
}
