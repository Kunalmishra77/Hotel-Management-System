/**
 * Public availability — 23 T-6 (FR-1/2/3/10/18, AC-1/2/3/11). Unauthenticated,
 * rate-limited, versioned. Returns per-category availability + GST-inclusive
 * price for online-sellable inventory only. No PII, no internal room numbers.
 */
import { loadPublishedConfig, getPublicAvailability } from "@/features/booking-engine/queries";
import { availabilityQuerySchema } from "@/features/booking-engine/schema";
import { enforceRateLimit, jsonError } from "@/features/booking-engine/http";
import { NotFoundError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  // Rate-limit BEFORE any work — a 429 has no side effects (FR-10).
  const limited = enforceRateLimit("availability", request);
  if (limited) return limited;

  try {
    const { slug } = await context.params;
    const cfg = await loadPublishedConfig(slug);
    if (!cfg) throw new NotFoundError("This booking site is not available.");

    const url = new URL(request.url);
    const query = availabilityQuerySchema.parse({
      checkInDate: url.searchParams.get("in"),
      checkOutDate: url.searchParams.get("out"),
      adults: url.searchParams.get("adults") ?? undefined,
      children: url.searchParams.get("children") ?? undefined,
      rooms: url.searchParams.get("rooms") ?? undefined,
    });

    const result = await getPublicAvailability(cfg, query);
    return Response.json({ data: result });
  } catch (e) {
    return jsonError(e);
  }
}
