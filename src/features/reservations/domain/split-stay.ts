/**
 * Split stay — one booking that spends different nights in different rooms
 * (client: "room is free for part of the dates — let us sell it"). Pure, no I/O.
 *
 * A stay is a list of nights (property-local `yyyy-mm-dd`, check-in inclusive,
 * check-out exclusive). Reception picks a room per night; consecutive nights in
 * the same room collapse into one half-open allocation segment [start, end) — the
 * same shape a mid-stay room move already produces, so check-in/out, extend,
 * overstay and the exclusion constraint all treat it like any other booking.
 */

export type NightPicks = Record<string, string>; // night → roomId
export type StaySegment = { roomId: string; startDate: string; endDate: string };

const DAY_MS = 86_400_000;
const toUtc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Every night of [checkIn, checkOut) as `yyyy-mm-dd`. */
export function stayNightKeys(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let t = toUtc(checkIn); t < toUtc(checkOut); t += DAY_MS) out.push(fromUtc(t));
  return out;
}

/** Collapse per-night picks into segments; null when any night is unpicked. */
export function segmentsFromPicks(nights: string[], picks: NightPicks): StaySegment[] | null {
  const segs: StaySegment[] = [];
  for (const night of nights) {
    const roomId = picks[night];
    if (!roomId) return null;
    const next = fromUtc(toUtc(night) + DAY_MS);
    const last = segs[segs.length - 1];
    if (last && last.roomId === roomId && last.endDate === night) last.endDate = next;
    else segs.push({ roomId, startDate: night, endDate: next });
  }
  return segs;
}

/**
 * Suggest a room per night with as few room changes as possible: stay in the
 * current room while it is free; when it isn't, move to the room that stays free
 * the longest from that night (ties → the order given, i.e. room-number order).
 * Null when some night has no free room at all.
 */
export function suggestSplit(nights: string[], freeNights: Map<string, Set<string>>, roomOrder: string[]): NightPicks | null {
  const picks: NightPicks = {};
  let current: string | null = null;
  for (let i = 0; i < nights.length; i++) {
    const night = nights[i]!;
    if (current && freeNights.get(current)?.has(night)) {
      picks[night] = current;
      continue;
    }
    let best: string | null = null;
    let bestRun = 0;
    for (const roomId of roomOrder) {
      let run = 0;
      while (i + run < nights.length && freeNights.get(roomId)?.has(nights[i + run]!)) run++;
      if (run > bestRun) { best = roomId; bestRun = run; }
    }
    if (!best) return null;
    current = best;
    picks[night] = best;
  }
  return picks;
}

/**
 * Server-side check of submitted segments: they must tile [checkIn, checkOut)
 * exactly — sorted, no gap, no overlap — and each must have at least one night.
 * Returns a user-safe message, or null when valid.
 */
export function validateSegments(segments: { roomId: string; startDate: Date; endDate: Date }[], checkIn: Date, checkOut: Date): string | null {
  if (segments.length === 0) return "Pick a room for every night.";
  const sorted = [...segments].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  if (sorted[0]!.startDate.getTime() !== checkIn.getTime()) return "The first room must start on the check-in date.";
  if (sorted[sorted.length - 1]!.endDate.getTime() !== checkOut.getTime()) return "The last room must end on the check-out date.";
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    if (s.endDate.getTime() <= s.startDate.getTime()) return "Each room needs at least one night.";
    const prev = sorted[i - 1];
    if (prev && prev.endDate.getTime() !== s.startDate.getTime()) return "Every night must have exactly one room — no gaps or overlaps.";
  }
  return null;
}
