"use server";

/**
 * searchAvailability — 03 T-11 (FR-2, AC-9/10). The "use server" boundary over
 * the availability core; the client booking stepper calls this directly.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { toResult, type Result } from "@/lib/result";
import { findFreeRooms, type AvailableRoom, type RoomFinder } from "./availability";
import { reservationDb } from "./internal";
import { searchAvailabilitySchema } from "./schema";

export type AvailabilityResult = { rooms: AvailableRoom[] };

/** Empty availability is a valid 200 with a clear empty state, not an error (AC-10). */
export async function searchAvailability(input: unknown): Promise<Result<AvailabilityResult>> {
  return toResult(async () => {
    const data = searchAvailabilitySchema.parse(input);
    const user = await requireUser();
    authorize(user, "reservation:view", data.propertyId);
    const rooms = await findFreeRooms(reservationDb(user) as unknown as RoomFinder, data);
    return { rooms };
  });
}
