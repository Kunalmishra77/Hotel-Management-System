/**
 * Availability/rate delta — 13 T-4 (FR-9/10). Pure: no I/O.
 *
 * Given a normalized description of a state change (the consumer resolves the
 * affected category + date range from the raw domain event via DB lookups, then
 * calls this), decide WHETHER a push is warranted and to WHICH channel push
 * (availability vs rate), returning the delta to enqueue — or `null` to skip.
 *
 * Keeping the decision pure means "which events trigger a push" is unit-tested
 * without a database, and the consumer stays a thin I/O shell.
 */

/** The domain-event types 13 reacts to for outbound sync (design § Events). */
export type ChannelTriggerType =
  | "ReservationCreated"
  | "ReservationModified"
  | "ReservationCancelled"
  | "RoomStatusChanged"
  | "DynamicRateApproved";

export type DeltaInput = {
  type: ChannelTriggerType;
  propertyId: string;
  /** Resolved by the consumer (reservation→room→category, or event payload). */
  categoryId: string | null;
  from: Date | null;
  to: Date | null;
  /** Present only for a rate change. */
  ratePaise?: number | null;
};

export type PushKind = "availability" | "rate";

export type AvailabilityDelta = {
  push: PushKind;
  propertyId: string;
  categoryId: string;
  from: Date;
  to: Date;
  ratePaise: number | null;
};

const AVAILABILITY_TRIGGERS: ReadonlySet<ChannelTriggerType> = new Set([
  "ReservationCreated",
  "ReservationModified",
  "ReservationCancelled",
  "RoomStatusChanged",
]);

/**
 * Normalize a trigger into the push it warrants, or `null` when it changes
 * nothing a channel cares about (e.g. an event with no resolvable category or
 * date range — the consumer could not attribute it to sellable inventory).
 */
export function availabilityDelta(input: DeltaInput): AvailabilityDelta | null {
  if (!input.categoryId || !input.from || !input.to) return null;
  if (input.to <= input.from) return null;

  if (input.type === "DynamicRateApproved") {
    if (input.ratePaise == null || input.ratePaise < 0) return null;
    return {
      push: "rate",
      propertyId: input.propertyId,
      categoryId: input.categoryId,
      from: input.from,
      to: input.to,
      ratePaise: input.ratePaise,
    };
  }

  if (AVAILABILITY_TRIGGERS.has(input.type)) {
    return {
      push: "availability",
      propertyId: input.propertyId,
      categoryId: input.categoryId,
      from: input.from,
      to: input.to,
      ratePaise: null,
    };
  }

  return null;
}
