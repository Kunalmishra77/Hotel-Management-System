"use server";

/**
 * searchAvailability — 03 T-11 (FR-2, AC-9/10). The "use server" boundary over
 * the availability core; the client booking stepper calls this directly.
 */
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { authorize, hasPermission } from "@/lib/permissions";
import { toResult, type Result } from "@/lib/result";
import { findFreeRooms, type AvailableRoom, type RoomFinder } from "./availability";
import { availabilityGrid, type AvailabilityGrid } from "./availability-grid";
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

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const gridSchema = z.object({
  propertyId: z.string().min(1),
  from: ymd,
  to: ymd,
  categoryId: z.string().min(1).optional(),
});

/**
 * Per-room, per-night availability for the dates asked — rooms that are free for
 * only part of the stay included, so reception can see them and split a stay.
 */
export async function searchAvailabilityGrid(input: unknown): Promise<Result<AvailabilityGrid>> {
  return toResult(async () => {
    const data = gridSchema.parse(input);
    const user = await requireUser();
    authorize(user, "reservation:view", data.propertyId);
    return availabilityGrid(reservationDb(user), { ...data, showGuest: hasPermission(user, "reservation:view") });
  });
}
