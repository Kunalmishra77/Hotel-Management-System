/**
 * PMS Agent · commands (client, 12 Nov 2026: "command de to wo chijo ko resolve
 * kare, sirf information na de"). Pure + deterministic, no LLM: a sentence in
 * English / Hindi / Hinglish becomes ONE structured command — what to do, to which
 * booking or room, with which date / amount / mode. The agent then shows the
 * plan and runs it ONLY when the user presses Confirm, through the same server
 * actions the screens use (so permissions, rules and audit all still apply).
 */
export type Target = { code?: string; room?: string; name?: string };
export type PayMode = "CASH" | "UPI" | "CREDIT_CARD" | "DEBIT_CARD" | "BANK_TRANSFER" | "ONLINE";
export type ChargeKind = "FOOD" | "LAUNDRY" | "TAXI" | "AIRPORT_TRANSFER" | "EXTRA_BED" | "MISC";
export type Channel = "DIRECT" | "WALK_IN" | "PHONE" | "WEBSITE" | "CORPORATE" | "TRAVEL_AGENT" | "BOOKING_COM" | "MAKEMYTRIP" | "EXPEDIA" | "AGODA" | "GOIBIBO" | "AIRBNB";

export type ParsedCommand =
  | { kind: "extend"; target: Target; date: string; ratePaise?: number; gstInclusive: boolean; source?: Channel }
  | { kind: "checkOut"; target: Target }
  | { kind: "checkIn"; target: Target }
  | { kind: "rate"; target: Target; ratePaise: number; gstInclusive: boolean }
  | { kind: "payment"; target: Target; amountPaise: number; mode: PayMode }
  | { kind: "holdLate"; target: Target }
  | { kind: "releaseHold"; target: Target }
  | { kind: "source"; target: Target; source: Channel }
  | { kind: "move"; target: Target; toRoom: string }
  | { kind: "roomClean"; room: string }
  | { kind: "charge"; target: Target; chargeType: ChargeKind; amountPaise: number; description: string }
  | { kind: "scan" };

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

/** A date in the sentence → yyyy-mm-dd. A date with no year picks the next one on/after ~30 days ago. */
export function parseDate(text: string, today: Date): string | null {
  const t = text.toLowerCase();
  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(t);
  if (iso) return `${iso[1]}-${pad(+iso[2]!)}-${pad(+iso[3]!)}`;
  const dmy = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/.exec(t);
  const named = /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?(?:\s*,?\s*(\d{4}))?\b/.exec(t)
    ?? /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/.exec(t);
  let d: number, m: number, y: number | undefined;
  if (named) {
    const monthFirst = isNaN(Number(named[1]));
    d = Number(monthFirst ? named[2] : named[1]);
    m = MONTHS[(monthFirst ? named[1] : named[2])!]!;
    y = named[3] ? Number(named[3]) : undefined;
  } else if (dmy) {
    d = Number(dmy[1]); m = Number(dmy[2]);
    y = dmy[3] ? Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]) : undefined;
  } else if (/\b(tomorrow|kal)\b/.test(t)) {
    return new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);
  } else if (/\b(today|aaj)\b/.test(t)) {
    return today.toISOString().slice(0, 10);
  } else return null;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  if (y === undefined) {
    y = today.getUTCFullYear();
    if (Date.UTC(y, m - 1, d) < today.getTime() - 30 * 86_400_000) y += 1;
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** The first money amount (₹2,535 · 2535 · rs 6000 · 6k) — ignores dates, codes and room numbers. */
export function parseAmount(text: string): number | null {
  const t = text.toLowerCase().replace(/bk-[a-z0-9]+/g, " ").replace(/\b(?:[gb]|\d{1,2})f-\d{1,2}\b/g, " ").replace(/\b(?:room|kamra|kamre)\s+[a-z]?\d{1,4}[a-z]?\b/g, " ").replace(/\b\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g, " ");
  const m = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/.exec(t) ?? /\b([\d,]{3,}(?:\.\d{1,2})?)\s*(k)?\b/.exec(t) ?? /\b(\d+(?:\.\d+)?)\s*(k)\b/.exec(t);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, "")) * (m[2] === "k" ? 1000 : 1);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

const CHANNELS: [RegExp, Channel][] = [
  [/\b(mmt|make\s*my\s*trip|makemytrip)\b/, "MAKEMYTRIP"], [/\bbooking\.?com\b/, "BOOKING_COM"], [/\bagoda\b/, "AGODA"], [/\bgoibibo\b/, "GOIBIBO"],
  [/\bairbnb\b/, "AIRBNB"], [/\bexpedia\b/, "EXPEDIA"], [/\bwalk[\s-]?in\b/, "WALK_IN"], [/\bphone\b/, "PHONE"], [/\bwebsite\b/, "WEBSITE"],
  [/\bcorporate\b/, "CORPORATE"], [/\btravel\s*agent\b/, "TRAVEL_AGENT"], [/\bdirect\b/, "DIRECT"],
];
export const channelOf = (t: string): Channel | undefined => CHANNELS.find(([re]) => re.test(t))?.[1];

function payModeOf(t: string): PayMode {
  if (/\bupi|gpay|phonepe|paytm\b/.test(t)) return "UPI";
  if (/\b(debit)\b/.test(t)) return "DEBIT_CARD";
  if (/\b(card|credit)\b/.test(t)) return "CREDIT_CARD";
  if (/\b(bank|neft|imps|rtgs|transfer)\b/.test(t)) return "BANK_TRANSFER";
  if (/\b(online|ota|prepaid|mmt|makemytrip|booking\.?com|agoda|goibibo|airbnb|expedia)\b/.test(t)) return "ONLINE";
  return "CASH";
}

const ROOM_RE = /\b((?:[gb]|\d{1,2})f-\d{1,2}|r\d{1,2})\b/gi;
const STOP = new Set(("ka ki ke ko hai kar karo kardo kar do do please pls guest booking room stay the a an of to for by from and me mein se tak wala wale wali " +
  "extend checkout check out in checkin rate payment paid pay received jama source change move shift hold late arrival release remove clean saaf charge food " +
  "laundry taxi cash upi card online bank today tomorrow kal aaj till until new set mark ready incl including gst with plus on night nights per").split(" "));

function targetOf(raw: string, t: string, rooms: string[]): Target {
  const code = /\bBK-[A-Z0-9]{5,}\b/i.exec(raw)?.[0]?.toUpperCase();
  if (code) return { code };
  if (rooms[0]) return { room: rooms[0] };
  const name = t.replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !MONTHS[w.slice(0, 3)] && !channelOf(w)).join(" ");
  return name ? { name } : {};
}

const has = (t: string, ...re: RegExp[]) => re.some((r) => r.test(t));

/** Turn a sentence into a command, or null when it is a question rather than an instruction. */
export function parseCommand(raw: string, today: Date): ParsedCommand | null {
  const t = ` ${raw.toLowerCase().replace(/\s+/g, " ")} `;
  // Questions ("how to extend", "extend kaise") are answered by the guide, not run.
  if (has(t, /\bkaise\b/, /\bhow (to|do|can)\b/, /\bkya kare\b/, /\?\s*$/)) return null;
  if (has(t, /\b(scan|problems?|issues?|galti|galtiyan|errors?|kya galat|check everything|audit|gadbad)\b/)) return { kind: "scan" };

  const rooms = [...raw.matchAll(ROOM_RE)].map((m) => m[1]!.toUpperCase());
  // Plain room numbers when introduced by "room" / "kamra": "room 104", "room 9A".
  for (const m of raw.matchAll(/\b(?:room|kamra|kamre)\s+([a-z]?\d{1,4}[a-z]?)\b/gi)) if (!rooms.includes(m[1]!.toUpperCase())) rooms.push(m[1]!.toUpperCase());
  const target = targetOf(raw, t, rooms);
  const amount = parseAmount(raw);
  const incl = has(t, /\bincl(uding|usive)?\b/, /\bwith gst\b/, /\bgst (ke )?saath\b/, /\binc\.? gst\b/);

  if (has(t, /\bextend\b/, /\bbadha(o|na|do)?\b/, /\bincrease stay\b/)) {
    const date = parseDate(raw, today);
    if (!date) return null;
    return { kind: "extend", target, date, ...(has(t, /\brate\b/, /@/, /₹/, /\brs\b/) && amount ? { ratePaise: amount } : {}), gstInclusive: incl, source: channelOf(t) };
  }
  if (has(t, /\bcheck[\s-]?out\b/)) return { kind: "checkOut", target };
  if (has(t, /\bcheck[\s-]?in\b/)) return { kind: "checkIn", target };
  if (has(t, /\b(release|remove|cancel)\b.*\bhold\b/, /\bnot coming\b/, /\bnahi aa(ega|yega|egi|yegi)\b/)) return { kind: "releaseHold", target };
  if (has(t, /\bhold\b/, /\blate arrival\b/, /\b(der se|baad me) aa(ega|yega|egi|yegi)\b/, /\bstill coming\b/)) return { kind: "holdLate", target };
  if (has(t, /\b(move|shift)\b/, /\broom (badlo|badal|change)\b/, /\bassign\b/)) {
    const toRoom = rooms.length >= 2 ? rooms[1]! : target.code || target.name ? rooms[0] : undefined;
    if (!toRoom) return null;
    return { kind: "move", target: rooms.length >= 2 ? { room: rooms[0] } : target, toRoom };
  }
  if (has(t, /\b(clean|saaf|cleaned|ready)\b/) && rooms[0] && !amount) return { kind: "roomClean", room: rooms[0] };
  if (has(t, /\bsource\b/, /\bchannel\b/)) {
    const source = channelOf(t.replace(/\bsource\b|\bchannel\b/g, " "));
    if (!source) return null;
    return { kind: "source", target, source };
  }
  if (has(t, /\b(payment|paid|pay|received|receive|jama|collect(ed)?|mila)\b/) && amount) return { kind: "payment", target, amountPaise: amount, mode: payModeOf(t) };
  if (has(t, /\b(rate|tariff)\b/) && amount) return { kind: "rate", target, ratePaise: amount, gstInclusive: incl };
  const charge: [RegExp, ChargeKind, string][] = [
    [/\b(food|khana|dinner|lunch|breakfast|meal)\b/, "FOOD", "Food"], [/\blaundry\b/, "LAUNDRY", "Laundry"], [/\b(airport)\b/, "AIRPORT_TRANSFER", "Airport transfer"],
    [/\b(taxi|cab)\b/, "TAXI", "Taxi"], [/\bextra bed\b/, "EXTRA_BED", "Extra bed"], [/\bcharge\b/, "MISC", "Charge"],
  ];
  const c = charge.find(([re]) => re.test(t));
  if (c && amount && has(t, /\b(add|charge|lagao|laga|jodo|post)\b/)) {
    const word = /\b(dinner|lunch|breakfast)\b/.exec(t)?.[1];
    return { kind: "charge", target, chargeType: c[1], amountPaise: amount, description: word ? word[0]!.toUpperCase() + word.slice(1) : c[2] };
  }
  return null;
}
