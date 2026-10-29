/**
 * Country from a phone number's international code — "+1 555…" → United States,
 * "+44 7…" → United Kingdom. Lets staff type the guest's number WITH its country
 * code and have the country filled in, instead of picking it separately. Pure.
 *
 * Longest code wins (+971 before +9…). A code shared by several countries resolves
 * to the most likely one (+1 → United States, +7 → Russia, +39 → Italy); staff can
 * still change it. Returns null without a leading "+" / "00" (a local number).
 */
import { COUNTRIES } from "@/lib/constants/countries";

const PREFERRED: Record<string, string> = { "+1": "United States", "+7": "Russia", "+39": "Italy" };

export function countryFromPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!s.startsWith("+")) return null;
  for (let len = Math.min(5, s.length); len >= 2; len--) {
    const code = s.slice(0, len);
    const match = COUNTRIES.filter((c) => c.dial === code);
    if (match.length > 0) return PREFERRED[code] ?? match[0]!.name;
  }
  return null;
}
