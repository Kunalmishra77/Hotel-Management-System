/**
 * Traceability: 02 T-4/T-5 — FR-5, AC-6/AC-7/AC-14.
 *
 * `canTransition` is the single authority for the room lifecycle. 03 depends on
 * it to return a room to inventory on cancel/no-show (03 AC-12/AC-22), so the
 * reset edges are tested as hard requirements, not conveniences.
 */
import { describe, expect, it } from "vitest";
import type { RoomStatus } from "@prisma/client";
import {
  ROOM_STATUSES,
  allowedTransitions,
  canTransition,
  canTransitionAsRole,
  isBookableStatus,
} from "@/features/rooms/domain/transitions";

const ALL: RoomStatus[] = [
  "VACANT",
  "OCCUPIED",
  "RESERVED",
  "UNDER_MAINTENANCE",
  "HOUSEKEEPING",
];

describe("the happy path (design.md state machine)", () => {
  it("walks VACANT → RESERVED → OCCUPIED → HOUSEKEEPING → VACANT (AC-4/AC-5)", () => {
    expect(canTransition("VACANT", "RESERVED")).toBe(true);
    expect(canTransition("RESERVED", "OCCUPIED")).toBe(true);
    expect(canTransition("OCCUPIED", "HOUSEKEEPING")).toBe(true);
    expect(canTransition("HOUSEKEEPING", "VACANT")).toBe(true);
  });

  it("allows a walk-in to occupy a vacant room directly", () => {
    // design.md draws "walk-in occupy" from VACANT — a guest at the desk with
    // no prior booking must not require a fake reservation first.
    expect(canTransition("VACANT", "OCCUPIED")).toBe(true);
  });
});

describe("illegal edges (FR-5 / AC-6)", () => {
  it("refuses UNDER_MAINTENANCE → OCCUPIED — the named example", () => {
    // A room out of order cannot receive a guest; it must be released first.
    expect(canTransition("UNDER_MAINTENANCE", "OCCUPIED")).toBe(false);
  });

  it("refuses UNDER_MAINTENANCE → RESERVED and → HOUSEKEEPING", () => {
    expect(canTransition("UNDER_MAINTENANCE", "RESERVED")).toBe(false);
    expect(canTransition("UNDER_MAINTENANCE", "HOUSEKEEPING")).toBe(false);
  });

  it("releases maintenance only to VACANT", () => {
    expect(canTransition("UNDER_MAINTENANCE", "VACANT")).toBe(true);
  });

  it("refuses HOUSEKEEPING → OCCUPIED — a dirty room is not sellable", () => {
    expect(canTransition("HOUSEKEEPING", "OCCUPIED")).toBe(false);
  });

  it("refuses RESERVED → HOUSEKEEPING — nobody has stayed yet", () => {
    expect(canTransition("RESERVED", "HOUSEKEEPING")).toBe(false);
  });

  it("treats a no-op transition as illegal so it cannot emit a spurious event", () => {
    // FR-6 emits RoomStatusChanged on every change; a self-transition would
    // announce a change that did not happen.
    for (const status of ALL) expect(canTransition(status, status)).toBe(false);
  });
});

describe("cancel / no-show resets (AC-14 — 03 AC-12/AC-22 depend on these)", () => {
  it("allows RESERVED → VACANT when a booking is cancelled", () => {
    expect(canTransition("RESERVED", "VACANT")).toBe(true);
  });

  it("allows OCCUPIED → VACANT for a no-show reset", () => {
    expect(canTransition("OCCUPIED", "VACANT")).toBe(true);
  });

  it("keeps the room bookable again afterwards", () => {
    expect(isBookableStatus("VACANT")).toBe(true);
  });
});

describe("maintenance blocking", () => {
  it("can take a vacant room out of order", () => {
    expect(canTransition("VACANT", "UNDER_MAINTENANCE")).toBe(true);
  });

  it("cannot take an occupied room out of order while a guest is in it", () => {
    // 11.blockRoomForJob must reallocate the guest first; silently flipping the
    // status would strand a live stay.
    expect(canTransition("OCCUPIED", "UNDER_MAINTENANCE")).toBe(false);
  });

  it("can take a dirty room out of order — damage found while cleaning", () => {
    expect(canTransition("HOUSEKEEPING", "UNDER_MAINTENANCE")).toBe(true);
  });
});

describe("allowedTransitions", () => {
  it("lists exactly the legal targets for a status", () => {
    expect([...allowedTransitions("VACANT")].sort()).toEqual(
      ["OCCUPIED", "RESERVED", "UNDER_MAINTENANCE"].sort(),
    );
    expect([...allowedTransitions("UNDER_MAINTENANCE")]).toEqual(["VACANT"]);
  });

  it("agrees with canTransition for every pair — one source of truth", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        expect(allowedTransitions(from).includes(to)).toBe(canTransition(from, to));
      }
    }
  });

  it("covers every status the schema defines", () => {
    expect([...ROOM_STATUSES].sort()).toEqual(ALL.sort());
  });
});

describe("role gating (AC-7 / AC-12)", () => {
  it("lets Housekeeping mark a cleaned room vacant", () => {
    expect(canTransitionAsRole("HOUSEKEEPING", "VACANT", ["HOUSEKEEPING"])).toBe(true);
  });

  it("does NOT let Housekeeping occupy or reserve a room (AC-7)", () => {
    // Front-desk actions are not theirs, even though the edges are legal.
    expect(canTransitionAsRole("VACANT", "OCCUPIED", ["HOUSEKEEPING"])).toBe(false);
    expect(canTransitionAsRole("VACANT", "RESERVED", ["HOUSEKEEPING"])).toBe(false);
  });

  it("does not let Housekeeping put a room under maintenance", () => {
    // Reporting a fault raises a maintenance job (10 → 11); it does not let
    // housekeeping unilaterally remove a room from sale.
    expect(canTransitionAsRole("VACANT", "UNDER_MAINTENANCE", ["HOUSEKEEPING"])).toBe(false);
  });

  it("lets Reception drive the front-desk edges", () => {
    expect(canTransitionAsRole("VACANT", "RESERVED", ["RECEPTION"])).toBe(true);
    expect(canTransitionAsRole("RESERVED", "OCCUPIED", ["RECEPTION"])).toBe(true);
    expect(canTransitionAsRole("OCCUPIED", "HOUSEKEEPING", ["RECEPTION"])).toBe(true);
  });

  it("lets Reception perform the cancel/no-show resets (AC-14)", () => {
    // 03 runs these on the reception user's behalf.
    expect(canTransitionAsRole("RESERVED", "VACANT", ["RECEPTION"])).toBe(true);
    expect(canTransitionAsRole("OCCUPIED", "VACANT", ["RECEPTION"])).toBe(true);
  });

  it("gates UNDER_MAINTENANCE to Maintenance (and above)", () => {
    expect(canTransitionAsRole("VACANT", "UNDER_MAINTENANCE", ["MAINTENANCE"])).toBe(true);
    expect(canTransitionAsRole("VACANT", "UNDER_MAINTENANCE", ["RECEPTION"])).toBe(false);
  });

  it("lets an Administrator perform any legal transition", () => {
    for (const from of ALL) {
      for (const to of allowedTransitions(from)) {
        expect(canTransitionAsRole(from, to, ["ADMINISTRATOR"])).toBe(true);
      }
    }
  });

  it("never lets a role bypass an ILLEGAL edge — the state machine wins", () => {
    // Role gating narrows the legal set; it can never widen it.
    for (const role of ["ADMINISTRATOR", "MANAGER", "RECEPTION", "HOUSEKEEPING", "MAINTENANCE"] as const) {
      expect(canTransitionAsRole("UNDER_MAINTENANCE", "OCCUPIED", [role])).toBe(false);
    }
  });

  it("honours the union of a multi-role user's permissions", () => {
    expect(canTransitionAsRole("VACANT", "UNDER_MAINTENANCE", ["RECEPTION", "MAINTENANCE"])).toBe(
      true,
    );
  });

  it("denies a user with no roles at all", () => {
    expect(canTransitionAsRole("VACANT", "RESERVED", [])).toBe(false);
  });
});

describe("isBookableStatus (FR-8 — what 03 may allocate)", () => {
  it("counts VACANT as bookable", () => {
    expect(isBookableStatus("VACANT")).toBe(true);
  });

  it("does not count a room that is out of order or dirty", () => {
    expect(isBookableStatus("UNDER_MAINTENANCE")).toBe(false);
    expect(isBookableStatus("HOUSEKEEPING")).toBe(false);
  });

  it("does not count an occupied room", () => {
    expect(isBookableStatus("OCCUPIED")).toBe(false);
  });

  it("does not count a RESERVED room — it is already spoken for", () => {
    expect(isBookableStatus("RESERVED")).toBe(false);
  });
});
