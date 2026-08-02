/**
 * Canonical metric library — 14 T-3/T-4 (FR-1/6/11, AC-1/2), per `reporting.md`.
 * Pure. Defined ONCE here and reused by 08-profit-reports, so no screen ever
 * recomputes a metric differently. Money in paise, occupancy in basis points.
 */
import Decimal from "decimal.js";

function roundHalfUp(d: Decimal): number {
  return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Occupancy in basis points (6667 = 66.67%). 0 available → 0 (no divide-by-zero). */
export function occupancy(availableRoomNights: number, occupiedRoomNights: number): number {
  if (availableRoomNights <= 0) return 0;
  return roundHalfUp(new Decimal(occupiedRoomNights).times(10_000).div(availableRoomNights));
}

/** Average Daily/Room Rate = room revenue ÷ occupied room-nights (paise). Room revenue only. */
export function adr(roomRevenuePaise: number | bigint, occupiedRoomNights: number): number {
  if (occupiedRoomNights <= 0) return 0;
  return roundHalfUp(new Decimal(roomRevenuePaise.toString()).div(occupiedRoomNights));
}

/** RevPAR = room revenue ÷ available room-nights (paise). */
export function revpar(roomRevenuePaise: number | bigint, availableRoomNights: number): number {
  if (availableRoomNights <= 0) return 0;
  return roundHalfUp(new Decimal(roomRevenuePaise.toString()).div(availableRoomNights));
}

/** Sellable rooms × nights, minus out-of-order/maintenance blocked room-nights. */
export function availableRoomNights(sellableRooms: number, blockedRoomNights: number, nights: number): number {
  return Math.max(0, sellableRooms * nights - blockedRoomNights);
}

/** Profit = revenue − expenses (paise, BigInt-safe). */
export function profit(revenuePaise: bigint | number, expensePaise: bigint | number): bigint {
  return BigInt(revenuePaise) - BigInt(expensePaise);
}

export type SnapshotInputs = {
  availableRoomNights: number;
  occupiedRoomNights: number;
  roomRevenuePaise: bigint;
  totalRevenuePaise: bigint;
  expensePaise: bigint;
};

export type SnapshotStats = SnapshotInputs & {
  adrPaise: number;
  revparPaise: number;
  occupancyBps: number;
};

/** Pure assembly of a day's stats from its inputs (FR-6). */
export function snapshotFrom(inputs: SnapshotInputs): SnapshotStats {
  return {
    ...inputs,
    adrPaise: adr(inputs.roomRevenuePaise, inputs.occupiedRoomNights),
    revparPaise: revpar(inputs.roomRevenuePaise, inputs.availableRoomNights),
    occupancyBps: occupancy(inputs.availableRoomNights, inputs.occupiedRoomNights),
  };
}
