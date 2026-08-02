"use client";

/**
 * Keeps the property tiles live — 01 T-12 (FR-7, AC-7).
 *
 * "When a room's status changes (event RoomStatusChanged from 02/10), the
 * system shall update the property's live occupancy view within the realtime
 * latency budget."
 *
 * Renders nothing: it only subscribes, and the refresh re-runs the server
 * query that produced the tiles.
 */
import { useRealtime } from "@/hooks/use-realtime";

const OCCUPANCY_EVENTS = [
  "RoomStatusChanged",
  "PropertyUpdated",
  "PropertyCreated",
  "PropertyDeactivated",
] as const;

export function RealtimeOccupancy({ propertyId }: { propertyId?: string }) {
  useRealtime({ types: OCCUPANCY_EVENTS, propertyId: propertyId ?? null });
  return null;
}
