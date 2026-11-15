/**
 * Form C / FRRO applies to FOREIGN nationals only (compliance.md). Nationality is
 * a free-text field, so the SAME guest can read "India", "Indian", "IND", "IN" or
 * blank across flows (manual entry, data-entry backfill, imports). The check-in
 * wizard must recognise every Indian spelling as DOMESTIC — a narrow `=== "india"`
 * test wrongly routed ISO-code guests ("IND") to Form C.
 *
 * Rule: blank → domestic; a known Indian alias → domestic; anything else → foreign.
 * We never guess a country from a city/state, so a stray value errs toward foreign
 * only when it is clearly not one of the Indian forms below.
 */
import { COUNTRIES } from "@/lib/constants/countries";

const INDIAN_ALIASES = new Set([
  "india",
  "indian",
  "ind", // ISO 3166 alpha-3
  "in", // ISO 3166 alpha-2
  "356", // ISO 3166 numeric
  "bharat",
  "bharatiya",
  "hindustan",
  "भारत",
  "inadian", // a typo seen on live data
  "indain",
  "indan",
]);

/** True only for an explicitly non-Indian nationality. Blank/Indian → false. */
export function isForeignNationality(nationality: string | null | undefined): boolean {
  const nat = (nationality ?? "").trim().toLowerCase();
  if (nat === "") return false;
  return !INDIAN_ALIASES.has(nat);
}

/**
 * Demonyms, codes and spellings seen on live data → the country list's own name
 * (client data audit, 15 Nov 2026: "IND", "Indian", "Germani", "Rusia",
 * "Franch", "Mexicans", "South Africaine", "UK", "England", "Nederland"…).
 * Keys are lower-case.
 */
const ALIASES: Record<string, string> = {
  american: "United States", usa: "United States", us: "United States", "u.s.a": "United States", "united states of america": "United States", america: "United States",
  uk: "United Kingdom", "u.k": "United Kingdom", british: "United Kingdom", britain: "United Kingdom", "great britain": "United Kingdom", england: "United Kingdom", english: "United Kingdom", scotland: "United Kingdom", scottish: "United Kingdom", wales: "United Kingdom", welsh: "United Kingdom", gbr: "United Kingdom",
  german: "Germany", germani: "Germany", deutschland: "Germany", deu: "Germany",
  french: "France", franch: "France", francais: "France", fra: "France",
  russian: "Russia", rusia: "Russia", "russian federation": "Russia", rus: "Russia",
  mexican: "Mexico", mexicans: "Mexico", mexicano: "Mexico", mex: "Mexico",
  dutch: "Netherlands", nederland: "Netherlands", nederlandse: "Netherlands", holland: "Netherlands", nld: "Netherlands",
  "south african": "South Africa", "south africaine": "South Africa", "south africain": "South Africa",
  australian: "Australia", aus: "Australia",
  "new zealander": "New Zealand", kiwi: "New Zealand", nzl: "New Zealand",
  canadian: "Canada", can: "Canada",
  japanese: "Japan", jpn: "Japan",
  chinese: "China", chn: "China",
  irish: "Ireland", irl: "Ireland",
  swiss: "Switzerland", che: "Switzerland",
  polish: "Poland", pol: "Poland",
  belgian: "Belgium", bel: "Belgium",
  norwegian: "Norway", nor: "Norway",
  swedish: "Sweden", danish: "Denmark", finnish: "Finland",
  italian: "Italy", ita: "Italy", spanish: "Spain", esp: "Spain", portuguese: "Portugal", greek: "Greece",
  argentine: "Argentina", argentinian: "Argentina", arg: "Argentina", brazilian: "Brazil", bra: "Brazil",
  mauritian: "Mauritius", nepali: "Nepal", nepalese: "Nepal", bhutanese: "Bhutan", "sri lankan": "Sri Lanka", bangladeshi: "Bangladesh",
  emirati: "United Arab Emirates", uae: "United Arab Emirates", singaporean: "Singapore", korean: "South Korea", "south korean": "South Korea",
  israeli: "Israel", turkish: "Turkey", thai: "Thailand", malaysian: "Malaysia", indonesian: "Indonesia", filipino: "Philippines",
};

/**
 * One spelling per country: "IND" / "indian" / "Inadian" → "India", "Germani" →
 * "Germany", "norway" → "Norway". Returns null for blank; an unrecognised value
 * is returned trimmed (never invented) so nothing a guest wrote is lost.
 */
export function canonicalNationality(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  const k = t.toLowerCase().replace(/\.$/, "");
  if (INDIAN_ALIASES.has(k)) return "India";
  const listed = COUNTRIES.find((c) => c.name.toLowerCase() === k || c.iso2.toLowerCase() === k);
  if (listed) return listed.name;
  return ALIASES[k] ?? t;
}
