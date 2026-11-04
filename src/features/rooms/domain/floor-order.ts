/**
 * Floors in building order — pure. Floor names are free text ("Ground Floor",
 * "1st Floor", "2", "Terrace"), and sorting them alphabetically put "2nd Floor"
 * before "Ground Floor". The level is read from the name: basement below ground,
 * ground = 0, a number = that floor, terrace / roof on top. An explicit
 * `sortOrder` (when set) wins.
 */
export function floorLevel(name: string | null | undefined): number {
  if (!name) return 999; // rooms without a floor go last
  const n = name.trim().toLowerCase();
  if (/^(lower\s*ground|lg)\b/.test(n)) return -0.5;
  if (/basement|^b\s*\d*$/.test(n)) {
    const d = /(\d+)/.exec(n);
    return -(d ? Number(d[1]) : 1);
  }
  if (/ground|^g$|^gf$/.test(n)) return 0;
  if (/terrace|roof|top/.test(n)) return 500;
  const d = /(\d+)/.exec(n);
  return d ? Number(d[1]) : 400; // unknown names after numbered floors, before terrace
}

/** Compare two floors for display: sortOrder (when either has one), then level, then name. */
export function compareFloors(
  a: { name: string | null; sortOrder?: number | null },
  b: { name: string | null; sortOrder?: number | null },
): number {
  const sa = a.sortOrder ?? 0;
  const sb = b.sortOrder ?? 0;
  if (sa !== sb) return sa - sb;
  const la = floorLevel(a.name);
  const lb = floorLevel(b.name);
  if (la !== lb) return la - lb;
  return (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true });
}

/** "Ground Floor" stays as is; a bare "2" reads "Floor 2". */
export function floorHeading(name: string | null): string {
  if (!name) return "No floor";
  return /floor/i.test(name) ? name : `Floor ${name}`;
}
