/**
 * GSTIN helpers (client, 22 Nov 2026 — company bills). A GSTIN is 15 characters:
 * 2-digit state code + PAN (10) + entity no. + "Z" + check character. The state
 * code tells us the company's state, so staff never type it.
 */
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** GST state codes (CBIC). */
const STATE_BY_CODE: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};

export function normalizeGstin(v: string): string {
  return v.replace(/\s+/g, "").toUpperCase();
}

export function isValidGstin(v: string): boolean {
  return GSTIN_RE.test(normalizeGstin(v));
}

/** "07AAHCT9474D1Z0" → "Delhi"; null when the code is unknown or the GSTIN malformed. */
export function stateFromGstin(v: string): string | null {
  const g = normalizeGstin(v);
  if (!GSTIN_RE.test(g)) return null;
  return STATE_BY_CODE[g.slice(0, 2)] ?? null;
}
