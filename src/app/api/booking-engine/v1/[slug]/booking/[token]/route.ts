/**
 * Self-service booking status + cancel — 23 T-16 (FR-16/20, AC-15). No login: the
 * HMAC-signed token IS the authorization, and it grants access to ONLY that one
 * booking (never another guest's). GET → status; POST → windowed cancel.
 */
import { verifyBookingToken } from "@/features/booking-engine/internal";
import { getBookingStatusByReservation, cancelWebBooking } from "@/features/booking-engine/public";
import { enforceRateLimit, jsonError } from "@/features/booking-engine/http";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolve(token: string): Promise<string> {
  const payload = verifyBookingToken(token);
  if (!payload) throw new DomainError(ErrorCode.TOKEN_INVALID);
  return payload.reservationId;
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const limited = enforceRateLimit("booking", request);
  if (limited) return limited;
  try {
    const { token } = await context.params;
    const reservationId = await resolve(token);
    const status = await getBookingStatusByReservation(reservationId);
    if (!status) throw new NotFoundError("Booking not found.");
    return Response.json({ data: status });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const limited = enforceRateLimit("booking", request);
  if (limited) return limited;
  try {
    const { token } = await context.params;
    const reservationId = await resolve(token);
    const result = await cancelWebBooking(reservationId);
    return Response.json({ data: result });
  } catch (e) {
    return jsonError(e);
  }
}
