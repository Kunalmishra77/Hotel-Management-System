/**
 * 06 billing — the "active line" ledger rules (append-only folio with REVERSALs).
 *
 * A folio is append-only: a correction is a REVERSAL line referencing the
 * original, never an edit. Every consumer (balance, per-night revenue, the
 * "which nights are posted" guard, MIS) therefore has to answer the same
 * question — *which lines still count?* — and before this module each one
 * answered it ad-hoc, or not at all. These are the canonical rules.
 */
import { describe, expect, it } from "vitest";
import {
  activeLines,
  activeRoomNightKeys,
  nextRoomRevision,
  netAmountByDate,
  reversedLineIds,
  type LedgerLine,
} from "@/features/billing/domain/reversal";

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** A ROOM night at `iso` for `amount` paise (GST 5% split intra-state). */
function room(id: string, iso: string, amount: number, revision = 0): LedgerLine {
  const gst = Math.round(amount * 0.05);
  return {
    id, type: "ROOM", amountPaise: amount,
    cgstPaise: Math.round(gst / 2), sgstPaise: Math.round(gst / 2), igstPaise: 0,
    businessDate: d(iso), revision, reversalOfId: null,
  };
}

/** A REVERSAL of `target`, posted on `iso` (reversals land on the day they're made). */
function reversal(id: string, iso: string, target: LedgerLine): LedgerLine {
  return {
    id, type: "REVERSAL", amountPaise: -Number(target.amountPaise),
    cgstPaise: -target.cgstPaise, sgstPaise: -target.sgstPaise, igstPaise: -target.igstPaise,
    businessDate: d(iso), revision: 0, reversalOfId: target.id,
  };
}

describe("reversedLineIds", () => {
  it("collects the targets of every linked REVERSAL", () => {
    const a = room("a", "2026-10-06", 226_800);
    const b = room("b", "2026-10-07", 226_800);
    const lines = [a, b, reversal("r1", "2026-10-16", a)];
    expect(reversedLineIds(lines)).toEqual(new Set(["a"]));
  });

  it("ignores a REVERSAL with no target (an unlinked adjustment)", () => {
    const orphan: LedgerLine = {
      id: "r", type: "REVERSAL", amountPaise: -100, cgstPaise: 0, sgstPaise: 0, igstPaise: 0,
      businessDate: d("2026-10-16"), revision: 0, reversalOfId: null,
    };
    expect(reversedLineIds([orphan]).size).toBe(0);
  });
});

describe("activeLines", () => {
  it("drops the reversed line AND its REVERSAL — the pair nets to nothing", () => {
    const a = room("a", "2026-10-06", 226_800);
    const b = room("b", "2026-10-07", 226_800);
    const active = activeLines([a, b, reversal("r1", "2026-10-16", a)]);
    expect(active.map((l) => l.id)).toEqual(["b"]);
  });

  it("keeps an UNLINKED reversal, so a manual adjustment is never silently lost", () => {
    const a = room("a", "2026-10-06", 226_800);
    const orphan: LedgerLine = {
      id: "adj", type: "REVERSAL", amountPaise: -5_000, cgstPaise: 0, sgstPaise: 0, igstPaise: 0,
      businessDate: d("2026-10-16"), revision: 0, reversalOfId: null,
    };
    expect(activeLines([a, orphan]).map((l) => l.id)).toEqual(["a", "adj"]);
  });

  it("keeps a re-posted night at a higher revision alongside the reversed original's absence", () => {
    const v0 = room("v0", "2026-10-06", 226_800, 0);
    const v1 = room("v1", "2026-10-06", 225_000, 1);
    const active = activeLines([v0, reversal("r", "2026-10-16", v0), v1]);
    expect(active.map((l) => l.id)).toEqual(["v1"]);
  });
});

describe("activeRoomNightKeys — the 'which nights are already billed' guard", () => {
  it("lists only nights whose ROOM line is still active", () => {
    const a = room("a", "2026-10-06", 226_800);
    const b = room("b", "2026-10-07", 226_800);
    const keys = activeRoomNightKeys([a, b, reversal("r", "2026-10-16", b)]);
    expect(keys).toEqual(new Set(["2026-10-06"]));
  });

  it("a fully reversed night is billable again — the regression that lost a night", () => {
    // Muniama: the rate correction parked an aggregate ROOM line on 16 Oct, so the
    // date-keyed guard thought 16 Oct was billed and the extend skipped it.
    const v0 = room("v0", "2026-10-06", 226_800);
    const keys = activeRoomNightKeys([v0, reversal("r", "2026-10-16", v0)]);
    expect(keys.has("2026-10-06")).toBe(false);
    expect(keys.has("2026-10-16")).toBe(false); // the REVERSAL itself is not a billed night
  });

  it("does not treat non-ROOM charges as room-nights", () => {
    const food: LedgerLine = {
      id: "f", type: "FOOD", amountPaise: 60_000, cgstPaise: 1_500, sgstPaise: 1_500, igstPaise: 0,
      businessDate: d("2026-10-17"), revision: 0, reversalOfId: null,
    };
    expect(activeRoomNightKeys([food]).size).toBe(0);
  });
});

describe("nextRoomRevision", () => {
  it("is 0 for a night never posted", () => {
    expect(nextRoomRevision([], "2026-10-06")).toBe(0);
  });

  it("is one past the highest revision ever used for that night", () => {
    const v0 = room("v0", "2026-10-06", 226_800, 0);
    const v1 = room("v1", "2026-10-06", 225_000, 1);
    expect(nextRoomRevision([v0, v1], "2026-10-06")).toBe(2);
  });

  it("counts reversed revisions too — the unique index still holds them", () => {
    const v0 = room("v0", "2026-10-06", 226_800, 0);
    expect(nextRoomRevision([v0, reversal("r", "2026-10-16", v0)], "2026-10-06")).toBe(1);
  });

  it("is per-night, not per-folio", () => {
    const v0 = room("v0", "2026-10-06", 226_800, 0);
    const v1 = room("v1", "2026-10-06", 225_000, 1);
    expect(nextRoomRevision([v0, v1], "2026-10-07")).toBe(0);
  });
});

describe("netAmountByDate — per-night revenue for MIS (ADR / RevPAR / daily revenue)", () => {
  it("attributes each night's revenue to its OWN business date", () => {
    const net = netAmountByDate([room("a", "2026-10-06", 226_800), room("b", "2026-10-07", 226_800)], ["ROOM"]);
    expect(net.get("2026-10-06")).toBe(226_800n);
    expect(net.get("2026-10-07")).toBe(226_800n);
  });

  it("a reversed night contributes nothing — and the reversal does NOT dent another day", () => {
    // The old night-audit summed `type='ROOM'` only, so a reversal (type REVERSAL)
    // never cancelled anything: room revenue/ADR/RevPAR stayed permanently inflated.
    const a = room("a", "2026-10-06", 226_800);
    const net = netAmountByDate([a, reversal("r", "2026-10-16", a)], ["ROOM"]);
    expect(net.get("2026-10-06") ?? 0n).toBe(0n);
    expect(net.get("2026-10-16") ?? 0n).toBe(0n);
  });

  it("a corrected night reports the corrected amount on the original night", () => {
    const v0 = room("v0", "2026-10-06", 226_800, 0);
    const v1 = room("v1", "2026-10-06", 225_000, 1);
    const net = netAmountByDate([v0, reversal("r", "2026-10-16", v0), v1], ["ROOM"]);
    expect(net.get("2026-10-06")).toBe(225_000n);
  });

  it("filters by type, and with no filter totals every active line", () => {
    const a = room("a", "2026-10-06", 226_800);
    const food: LedgerLine = {
      id: "f", type: "FOOD", amountPaise: 60_000, cgstPaise: 1_500, sgstPaise: 1_500, igstPaise: 0,
      businessDate: d("2026-10-06"), revision: 0, reversalOfId: null,
    };
    expect(netAmountByDate([a, food], ["ROOM"]).get("2026-10-06")).toBe(226_800n);
    expect(netAmountByDate([a, food]).get("2026-10-06")).toBe(286_800n);
  });

  it("ignores a reversal posted on a date it is asked about — Muniama's 16 Oct", () => {
    // The ₹22,500 aggregate and its reversals all sat on 16 Oct. Asking for 16 Oct
    // must report only what 16 Oct genuinely earned, not the correction traffic.
    const v0 = room("v0", "2026-10-06", 226_800);
    const oct16 = room("x", "2026-10-16", 225_000);
    const net = netAmountByDate([v0, reversal("r", "2026-10-16", v0), oct16], ["ROOM"]);
    expect(net.get("2026-10-16")).toBe(225_000n);
    expect(net.get("2026-10-06") ?? 0n).toBe(0n);
  });
});

describe("the 'nothing was billed' check that a balance gate cannot see", () => {
  /** What check-out now measures before letting a stay walk: net ROOM revenue. */
  const roomCharged = (lines: LedgerLine[]): bigint =>
    activeLines(lines).reduce((sum, l) => (l.type === "ROOM" ? sum + BigInt(l.amountPaise) : sum), 0n);

  it("is zero for a stay booked at a ₹0 rate — balance is ₹0, yet nothing was earned", () => {
    // The hole: a hand-entered OTA stay saved with no tariff posts ₹0 room-nights,
    // settles to ₹0 and checks out silently. `balance > 0` never fires.
    const nights = [room("a", "2026-10-18", 0), room("b", "2026-10-19", 0)];
    expect(roomCharged(nights)).toBe(0n);
  });

  it("is positive for a normally billed stay", () => {
    expect(roomCharged([room("a", "2026-10-18", 210_000), room("b", "2026-10-19", 210_000)])).toBe(420_000n);
  });

  it("is zero once every night has been reversed — a transfer must not leave a billable husk", () => {
    const a = room("a", "2026-10-18", 250_000);
    const b = room("b", "2026-10-19", 250_000);
    const lines = [a, b, reversal("r1", "2026-10-20", a), reversal("r2", "2026-10-20", b)];
    expect(roomCharged(lines)).toBe(0n);
  });

  it("counts the corrected amount, not the reversed original", () => {
    const v0 = room("v0", "2026-10-18", 300_000, 0);
    const v1 = room("v1", "2026-10-18", 210_000, 1);
    expect(roomCharged([v0, reversal("r", "2026-10-20", v0), v1])).toBe(210_000n);
  });

  it("ignores non-room revenue — a food-only folio is still an unbilled STAY", () => {
    const food: LedgerLine = {
      id: "f", type: "FOOD", amountPaise: 60_000, cgstPaise: 1_500, sgstPaise: 1_500, igstPaise: 0,
      businessDate: d("2026-10-18"), revision: 0, reversalOfId: null,
    };
    expect(roomCharged([food])).toBe(0n);
  });
});
