/**
 * Booking-engine domain events — 23. Names live in the platform catalogue
 * (`src/lib/events/catalog.ts`); re-exported here as the module's public event
 * surface so consumers (14 WEBSITE revenue/pace, 12 confirmation) and this
 * module reference one spelling. Every server-side mutation emits one of these
 * plus an audit record (FR-17).
 */
import type { DomainEventType } from "@/lib/events";

export const BOOKING_ENGINE_EVENTS = {
  confirmed: "WebBookingConfirmed",
  failed: "WebBookingFailed",
  cancelled: "WebBookingCancelled",
} as const satisfies Record<string, DomainEventType>;
