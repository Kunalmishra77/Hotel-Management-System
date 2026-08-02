/**
 * Traceability: 02 T-9 — FR-7, AC-8/AC-9.
 *
 * AC-8: a block on 14–20 Jul excludes the room from a 15–17 Jul search **even
 * though its status is VACANT** — availability is driven by the block, not the
 * status.
 * AC-9: from 21 Jul the room is available again.
 *
 * Half-open [start, end) throughout, matching the `daterange(...,'[)')`
 * exclusion constraint 03 uses (database-setup.md). Getting this boundary wrong
 * is how you double-sell a room on a changeover day.
 */
import { describe, expect, it } from "vitest";
import {
  type DateRange,
  blocksOverlapping,
  isRoomBlockedDuring,
  rangesOverlap,
} from "@/features/rooms/domain/blocks";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const range = (from: string, to: string): DateRange => ({ startDate: d(from), endDate: d(to) });

/** The block from AC-8: 14–20 Jul. */
const JUL_14_20 = range("2026-07-14", "2026-07-20");

describe("rangesOverlap — half-open [start, end)", () => {
  it("overlaps when one range sits inside another (AC-8)", () => {
    expect(rangesOverlap(range("2026-07-15", "2026-07-17"), JUL_14_20)).toBe(true);
  });

  it("overlaps on a partial head or tail", () => {
    expect(rangesOverlap(range("2026-07-10", "2026-07-15"), JUL_14_20)).toBe(true);
    expect(rangesOverlap(range("2026-07-18", "2026-07-25"), JUL_14_20)).toBe(true);
  });

  it("does NOT overlap when one ends exactly as the other begins", () => {
    // The changeover case: a stay ending on the 14th and a block starting on
    // the 14th do not collide, because the guest leaves that morning.
    expect(rangesOverlap(range("2026-07-10", "2026-07-14"), JUL_14_20)).toBe(false);
    expect(rangesOverlap(range("2026-07-20", "2026-07-25"), JUL_14_20)).toBe(false);
  });

  it("does not overlap when clearly separate", () => {
    expect(rangesOverlap(range("2026-07-01", "2026-07-05"), JUL_14_20)).toBe(false);
    expect(rangesOverlap(range("2026-08-01", "2026-08-05"), JUL_14_20)).toBe(false);
  });

  it("is symmetric", () => {
    const a = range("2026-07-15", "2026-07-17");
    expect(rangesOverlap(a, JUL_14_20)).toBe(rangesOverlap(JUL_14_20, a));
  });

  it("treats an empty range as overlapping nothing", () => {
    // A zero-night block would otherwise silently swallow a whole day.
    expect(rangesOverlap(range("2026-07-15", "2026-07-15"), JUL_14_20)).toBe(false);
  });
});

describe("isRoomBlockedDuring (AC-8 / AC-9)", () => {
  const blocks = [JUL_14_20];

  it("excludes the room for 15–17 Jul (AC-8)", () => {
    expect(isRoomBlockedDuring(blocks, range("2026-07-15", "2026-07-17"))).toBe(true);
  });

  it("frees the room from 21 Jul onward (AC-9)", () => {
    expect(isRoomBlockedDuring(blocks, range("2026-07-21", "2026-07-23"))).toBe(false);
  });

  it("frees the room on the 20th itself — the block ends there", () => {
    expect(isRoomBlockedDuring(blocks, range("2026-07-20", "2026-07-22"))).toBe(false);
  });

  it("is not blocked when the block list is empty (AC-9 — block removed)", () => {
    expect(isRoomBlockedDuring([], range("2026-07-15", "2026-07-17"))).toBe(false);
  });

  it("blocks when ANY of several blocks overlaps", () => {
    const many = [range("2026-06-01", "2026-06-05"), JUL_14_20, range("2026-09-01", "2026-09-03")];
    expect(isRoomBlockedDuring(many, range("2026-07-16", "2026-07-17"))).toBe(true);
    expect(isRoomBlockedDuring(many, range("2026-07-25", "2026-07-27"))).toBe(false);
  });
});

describe("blocksOverlapping", () => {
  it("returns the blocks that collide, for an explanatory message", () => {
    // Staff need to know WHICH block is in the way, not just that one is.
    const many = [range("2026-06-01", "2026-06-05"), JUL_14_20];
    const hits = blocksOverlapping(many, range("2026-07-15", "2026-07-17"));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual(JUL_14_20);
  });

  it("returns an empty list when nothing collides", () => {
    expect(blocksOverlapping([JUL_14_20], range("2026-08-01", "2026-08-02"))).toEqual([]);
  });
});
