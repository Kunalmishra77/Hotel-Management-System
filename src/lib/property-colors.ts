/**
 * Property colour identity (client req #11) — a light, distinct tint per property
 * so users can tell them apart at a glance on cards, badges, rows and chips.
 *
 *   D-1/17 → sky blue · D-1/23 → light orange · D-1/3 → light gold · D-1/30 → light brown
 *
 * Tints use /10 backgrounds + theme-aware text so they stay light in light mode and
 * subtle in dark mode (never heavy/dark). Matching is by the property's "D-1/NN"
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
};

const NEUTRAL: PropertyColor = {
  badge: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
  dot: "bg-slate-400",
  accent: "border-l-slate-400",
};

// Order matters: more-specific tokens first (D-1/30 before D-1/3).
const RULES: { token: string; color: PropertyColor }[] = [
  {
    token: "D-1/17",
    color: {
      badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
      dot: "bg-sky-400",
      accent: "border-l-sky-400",
    },
  },
  {
    token: "D-1/23",
    color: {
      badge: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
      dot: "bg-orange-400",
      accent: "border-l-orange-400",
    },
  },
  {
    token: "D-1/30",
    color: {
      badge: "bg-[#9c6b43]/12 text-[#8a5a33] dark:text-[#c9a888] border-[#9c6b43]/35",
      dot: "bg-[#a0703f]",
      accent: "border-l-[#a0703f]",
    },
  },
  {
    token: "D-1/3",
    color: {
      badge: "bg-amber-400/15 text-amber-800 dark:text-amber-300 border-amber-500/30",
      dot: "bg-amber-400",
      accent: "border-l-amber-400",
    },
  },
];

export function propertyColor(name: string | null | undefined): PropertyColor {
  if (!name) return NEUTRAL;
  for (const r of RULES) if (name.includes(r.token)) return r.color;
  return NEUTRAL;
}
