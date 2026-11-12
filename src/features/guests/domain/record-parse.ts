/**
 * Auto-fill a guest from pasted record text WITHOUT any AI (client, 12 Nov 2026:
 * "autofill keh raha hai AI not enabled — hum AI use hi nahi kar rahe").
 * Deterministic and offline: labelled lines ("Name: …", "DOB: …", "Address: …")
 * plus recognisable patterns (an Indian mobile, an email, a 6-digit PIN, a date,
 * Male/Female, an Indian state). Reads only what is clearly there — never guesses;
 * staff review every field before saving.
 */
export type ParsedGuest = Partial<Record<
  "fullName" | "mobile" | "email" | "dob" | "gender" | "nationality" | "occupation" | "addressLine" | "city" | "state" | "country" | "pincode" | "companyName" | "purposeOfVisit",
  string
>>;

const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Delhi", "Jammu and Kashmir", "Ladakh", "Chandigarh", "Puducherry",
];

// label (lower-case, as typed before ":" / "-") → field
const LABELS: [RegExp, keyof ParsedGuest][] = [
  [/^(guest\s*)?(full\s*)?name|^naam/, "fullName"],
  [/^(mobile|phone|mob|contact|cell|whatsapp|ph)\b/, "mobile"],
  [/^e-?mail/, "email"],
  [/^(dob|d\.o\.b|date of birth|birth\s*date|janm)/, "dob"],
  [/^(gender|sex|ling)/, "gender"],
  [/^(nationality|citizenship)/, "nationality"],
  [/^(occupation|profession|designation)/, "occupation"],
  [/^(address|addr|pata|residence)/, "addressLine"],
  [/^(city|town|district|shahar)/, "city"],
  [/^state/, "state"],
  [/^country/, "country"],
  [/^(pin|pincode|pin code|postal|zip)/, "pincode"],
  [/^(company|organisation|organization|firm|employer)/, "companyName"],
  [/^(purpose|reason)/, "purposeOfVisit"],
];

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** A date in common Indian forms → yyyy-mm-dd (day-first), or null. */
export function toIsoDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s,-]+(\d{4})$/i.exec(t);
  if (m && MONTHS[m[2]!.toLowerCase()]) return `${m[3]}-${MONTHS[m[2]!.toLowerCase()]}-${m[1]!.padStart(2, "0")}`;
  return null;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function parseGuestRecord(text: string): ParsedGuest {
  const out: ParsedGuest = {};
  const set = (k: keyof ParsedGuest, v: string | null | undefined) => { const x = v?.trim(); if (x && !out[k]) out[k] = x; };

  // 1 · labelled lines win — "Name: Ravi Kumar", "DOB - 12/03/1990"
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z.][A-Za-z .()/]{0,28}?)\s*[:\-–=]\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const label = m[1]!.toLowerCase().trim();
    const hit = LABELS.find(([re]) => re.test(label));
    if (hit) set(hit[1], m[2]);
  }

  // 2 · patterns anywhere in the text
  const flat = text.replace(/\s+/g, " ");
  set("email", /[\w.+-]+@[\w-]+\.[\w.]+/.exec(flat)?.[0]);
  if (!out.mobile) set("mobile", /(?:\+?91[\s-]?)?\b([6-9]\d{4}[\s-]?\d{5})\b/.exec(flat)?.[1]?.replace(/[\s-]/g, ""));
  if (!out.dob) {
    const d = /\b(?:dob|d\.o\.b\.?|birth|born)\b[^0-9a-z]{0,6}(\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[\s-][a-z]{3,9}[\s,-]+\d{4})/i.exec(flat)?.[1];
    if (d) set("dob", d);
  }
  if (!out.gender) set("gender", /\b(male|female|transgender)\b/i.exec(flat)?.[1] ?? (/\b(?:sex|gender)\W{0,3}(m|f)\b/i.exec(flat)?.[1]));
  if (!out.pincode) set("pincode", /\b(?:pin(?:code)?\W{0,3})?([1-9]\d{5})\b/i.exec(flat.replace(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/g, " "))?.[1]);
  if (!out.state) set("state", STATES.find((s) => new RegExp(`\\b${s}\\b`, "i").test(flat)));
  if (!out.fullName) {
    // The first line that looks like a name (2–4 words of letters, no digits).
    const first = text.split(/\r?\n/).map((l) => l.trim()).find((l) => /^[A-Za-z][A-Za-z.' ]{2,48}$/.test(l) && l.split(/\s+/).length >= 2 && l.split(/\s+/).length <= 4 && !/government|india|male|female|address|birth/i.test(l));
    set("fullName", first);
  }

  // 3 · normalise
  if (out.dob) {
    // The value may carry more than the date ("05-Jun-1988 Female") — take the date part.
    const part = /\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[\s-][a-z]{3,9}[\s,-]+\d{4}/i.exec(out.dob)?.[0];
    const iso = part ? toIsoDate(part) : null;
    if (iso) out.dob = iso; else delete out.dob;
  }
  if (out.gender) {
    const g = out.gender.toLowerCase();
    out.gender = g.startsWith("f") ? "Female" : g.startsWith("m") ? "Male" : g.startsWith("t") || g.startsWith("o") ? "Other" : out.gender;
  }
  if (out.mobile) { const digits = out.mobile.replace(/\D/g, "").replace(/^91(?=[6-9]\d{9}$)/, ""); out.mobile = digits; }
  if (out.fullName) out.fullName = titleCase(out.fullName);
  if (out.state) out.state = STATES.find((s) => s.toLowerCase() === out.state!.toLowerCase()) ?? out.state;
  if (out.state && !out.country) out.country = "India";
  if (out.country && /^india$/i.test(out.country) && !out.nationality) out.nationality = "India";
  return out;
}
