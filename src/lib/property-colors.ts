/**
 * Property colour identity (client req #11) — a distinct colour per property so
 * users can tell them apart at a glance on cards, badges, rows and chips.
 *
 *   D-1/17 → blue · D-1/23 → orange · D-1/3 → gold (yellow) · D-1/30 → brown
 *
 * Oct 2026 (client): the original 5–10% tints were too light — orange, gold and
 * brown read as the same beige, so properties looked alike. Badges are now SOLID
 * (white/dark text for contrast) and row tints ~15–20%, with gold pushed toward
 * yellow and brown deepened so the three warm colours separate. Normal text on a
 * tinted row stays readable in both themes. Matching is by the property's "D-1/NN"
 * token in its name; longer tokens are checked first so "D-1/3" doesn't swallow
 * "D-1/30". Unknown properties fall back to a neutral slate tint.
 */
export type PropertyColor = {
  /** tailwind classes for a badge/chip (bg + text + border) */
  badge: string;
  /** a small solid dot (legend / leading marker) */
  dot: string;
  /** a subtle left-accent border for rows/cards */
  accent: string;
  /** a very light background tint for a whole row/card/cell of this property */
  row: string;
};

const NEUTRAL: PropertyColor = {
  badge: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
  dot: "bg-slate-400",
  accent: "border-l-slate-400",
  row: "",
};

// Order matters: more-specific tokens first (D-1/30 before D-1/3).
const RULES: { token: string; color: PropertyColor }[] = [
  {
    token: "D-1/17",
    color: {
      badge: "bg-sky-600 text-white border-sky-700",
      dot: "bg-sky-600",
      accent: "border-l-sky-600",
      row: "bg-sky-500/15 dark:bg-sky-500/20",
    },
  },
  {
    token: "D-1/23",
    color: {
      badge: "bg-orange-600 text-white border-orange-700",
      dot: "bg-orange-600",
      accent: "border-l-orange-600",
      row: "bg-orange-500/15 dark:bg-orange-500/20",
    },
  },
  {
    token: "D-1/30",
    color: {
      badge: "bg-[#6f4220] text-white border-[#5a3418]",
      dot: "bg-[#6f4220]",
      accent: "border-l-[#6f4220]",
      row: "bg-[#7a4a24]/20 dark:bg-[#a0703f]/25",
    },
  },
  {
    token: "D-1/3",
    color: {
      badge: "bg-yellow-400 text-yellow-950 border-yellow-500",
      dot: "bg-yellow-400",
      accent: "border-l-yellow-400",
      row: "bg-yellow-400/25 dark:bg-yellow-400/15",
    },
  },
];

export function propertyColor(name: string | null | undefined): PropertyColor {
  if (!name) return NEUTRAL;
  for (const r of RULES) if (name.includes(r.token)) return r.color;
  return NEUTRAL;
}
