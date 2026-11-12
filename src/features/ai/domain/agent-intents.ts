/**
 * PMS Agent — understanding a question WITHOUT an LLM (client, 12 Nov 2026: "bina
 * kisi AI API ke, platform se related sare jawab"). Pure + deterministic: the
 * question (English / Hindi / Hinglish) is classified into one intent, and the
 * agent (../agent.ts) answers it from live data with the caller's scope. Nothing
 * here touches the database, so every phrasing rule is unit-tested.
 */
export type AgentIntent =
  | { kind: "booking"; code: string }
  | { kind: "room"; room: string }
  | { kind: "guide"; topic: GuideTopic }
  | { kind: "help" }
  | { kind: "arrivals"; dayOffset: number }
  | { kind: "departures"; dayOffset: number }
  | { kind: "vacant" }
  | { kind: "inHouse" }
  | { kind: "business" } // dues, revenue, expenses, profit, occupancy, cancellations, to-clean
  | { kind: "guest"; name: string };

export type GuideTopic = { id: string; title: string; steps: string[] };

/** Starter questions shown before the first one is asked. */
export const AGENT_SUGGESTIONS: readonly string[] = [
  "Aaj kaun aa raha hai?",
  "Today's check-outs",
  "Who is staying now?",
  "Khali rooms",
  "Today's pending dues?",
  "This month's revenue?",
  "Extend kaise kare?",
  "Guest late aayega — kya kare?",
];


const norm = (q: string) => q.toLowerCase().replace(/[?!.,;:'"()]/g, " ").replace(/\s+/g, " ").trim();
const any = (q: string, words: readonly string[]) => words.some((w) => q.includes(w));

const HOW = ["how to", "how do", "how can", "how i ", "kaise", "kese", "kaisay", "kya karu", "kya kare", "kya karna", "steps", "process", "tarika", "method"];
const TOMORROW = ["tomorrow", "kal ", "kal?", " kal", "next day"];

/** Platform how-to's — the agent's own manual of this PMS. Keywords are matched against the question. */
export const GUIDE: readonly (GuideTopic & { keys: readonly string[] })[] = [
  { id: "check-in", title: "Check a guest in", keys: ["check in", "check-in", "checkin"], steps: [
    "Open Bookings → the guest's booking (or tap Check in on Arrivals today).",
    "Verify → Details: mobile, WhatsApp (tick 'Same as mobile'), gender, nationality, home address. Email and date of birth may be skipped — they stay as pending.",
    "Identity: upload the ID's front (the back is optional). Any other document → 'Other document' + its name.",
    "Registration card (signature) → Payment (optional) → Complete check-in. The whole stay is billed at check-in.",
  ] },
  { id: "extend", title: "Extend a stay", keys: ["extend", "badha", "aur din", "more nights", "extra night"], steps: [
    "Open the booking → 'Extend stay'.",
    "Pick the new check-out date and where the extra nights were booked ('Extra nights booked via' — Direct, MMT, Agoda…).",
    "Leave the rate blank to keep the rate the guest pays now, or type the new nightly rate (choose GST on top / included).",
    "Pay at hotel (due) or Already paid. Press Extend stay — the extra nights are billed at once.",
  ] },
  { id: "late-arrival", title: "Guest arriving late / no-show", keys: ["late", "no show", "no-show", "noshow", "nahi aaya", "nhi aaya", "der se", "guaranteed"], steps: [
    "Open the booking → 'Late arrival' card.",
    "Confirmed booking: 'Hold for late arrival'. Already no-show: 'Guest still coming — restore & hold the booking' (the room comes back if it's free).",
    "The booking stays in Arrivals today and is never marked no-show. When the guest comes, check in normally — the bill starts from the booked date.",
    "Guest not coming after all: 'Guest isn't coming — remove the hold'.",
  ] },
  { id: "move-room", title: "Move / assign / swap a room", keys: ["move room", "room change", "change room", "assign room", "room badal", "shift room", "swap"], steps: [
    "Open the booking → 'Move room' (same property) — pick the new room and the date the guest moves.",
    "No room on the booking (e.g. after a no-show)? The same card assigns one.",
    "Two guests exchanging rooms: 'Swap room with another booking'. Another property: 'Transfer to another property'.",
  ] },
  { id: "check-out", title: "Check a guest out", keys: ["check out", "check-out", "checkout"], steps: [
    "Open the booking (or In-house guests) → Check out.",
    "Leaving early? Only the nights stayed are billed; unused nights are reversed automatically.",
    "A balance due blocks check-out — take the payment first (Folio → Take payment), or use the defer option.",
    "The GST invoice is issued at check-out — one per bill (an OTA bill and a Direct bill when both exist).",
  ] },
  { id: "split-bill", title: "Separate OTA and direct bills", keys: ["split", "separate bill", "two bill", "2 bill", "alag bill", "ota bill", "direct bill"], steps: [
    "Nothing to do by hand: an OTA stay with direct nights, food or laundry shows 'Separate bills on this stay' on the folio.",
    "The OTA bill (MMT, Booking.com…) is the hotel's copy; only the Direct bill is given/shared with the guest.",
    "Each bill gets its own GST invoice at check-out, or press 'Generate … GST invoice' on that bill.",
  ] },
  { id: "ota-payment", title: "Record an OTA's payment", keys: ["ota payment", "mmt payment", "online payment", "prepaid", "booking.com payment", "agoda payment", "ota ka paisa", "online paisa", "mmt", "ota", "booking.com", "agoda", "goibibo", "airbnb"], steps: [
    "Open the guest's Folio → Take payment.",
    "Mode: 'Online / OTA prepaid (MMT, Booking.com)' and the amount the OTA paid.",
    "The OTA bill then shows ₹0 due. OTA money is never recorded automatically.",
  ] },
  { id: "payment", title: "Take a payment", keys: ["take payment", "payment lena", "payment kaise", "collect payment", "paisa lena", "record payment"], steps: [
    "Open the Folio → Take payment.",
    "Pick the mode (Cash, UPI, Card, Bank transfer, Online / OTA prepaid) and the amount — split tenders are allowed.",
    "Each payment has a receipt link; a wrong entry is fixed with 'correct' (never deleted).",
  ] },
  { id: "invoice", title: "Generate / correct a GST invoice", keys: ["invoice", "bill banana", "gst bill", "void", "revise", "credit note"], steps: [
    "Folio → Generate GST invoice (one per bill on a split stay). You can set the bill-to name and company GSTIN.",
    "Wrong invoice? Open it in 'Bills & version history' → Void & revise. A credit note cancels it; then generate the corrected one.",
    "Invoices are never edited or deleted (GST rules); numbers run gap-free.",
  ] },
  { id: "rate", title: "Change the room rate", keys: ["rate", "tariff", "price change", "room rate"], steps: [
    "Booking page → 'Edit room rate' (or Folio → Fix room rate).",
    "Enter the nightly rate and choose 'Add GST on top' or 'Rate includes GST'.",
    "'Only part of the stay' re-prices just some nights (e.g. an extension at a different rate). The booking's rate updates too.",
  ] },
  { id: "charge", title: "Add food / laundry / other charges", keys: ["food", "khana", "laundry", "charge", "dinner", "breakfast", "taxi", "add-on", "addon"], steps: [
    "Folio → + Charge: pick the type (Food, Laundry, Taxi…), description and amount (GST is added for the type).",
    "Wrong charge? Tap 'reverse' next to it — a reversing entry is added, nothing is deleted.",
    "On an OTA stay these charges go on the Direct bill (the guest's).",
  ] },
  { id: "id", title: "Guest ID documents", keys: ["id proof", "aadhaar", "aadhar", "passport", "driving", "voter", "document", "id card"], steps: [
    "Front image is required, the back is optional, the number is optional.",
    "Any other document: choose 'Other document', type its name (e.g. Company ID) and upload it.",
    "Add later from the guest's profile → Add document, or the booking's Pending information card.",
  ] },
  { id: "source", title: "Booking source / channel", keys: ["source", "channel", "mmt se", "booking source"], steps: [
    "Booking page → 'Booking source' → pick the channel and press Change source.",
    "Extensions keep their own channel ('Extra nights booked via'); the card lists 'Source by nights'.",
  ] },
  { id: "cancel", title: "Cancel a booking", keys: ["cancel"], steps: [
    "Only a booking that hasn't arrived can be cancelled: open it → Cancel booking.",
    "A guest already in-house is checked out (early check-out bills only the nights stayed).",
  ] },
  { id: "new-booking", title: "Make a new booking", keys: ["new booking", "booking kaise", "book a room", "naya booking", "nayi booking", "reservation"], steps: [
    "Bookings → New booking: dates → check availability → pick room(s).",
    "Pick or create the guest (name + mobile + address is enough), source, rate, advance.",
    "Confirm booking. The rest of the guest's details are collected at check-in.",
  ] },
  { id: "housekeeping", title: "Housekeeping / room status", keys: ["housekeeping", "clean", "safai", "room status", "dirty"], steps: [
    "Housekeeping: tap a room to mark it cleaning / clean / inspected — works on a phone, even offline.",
    "Rooms show Vacant, Occupied, Reserved, Housekeeping or Under-maintenance live.",
  ] },
  { id: "expense", title: "Record an expense", keys: ["expense", "kharcha", "kharch"], steps: [
    "Expenses → Add expense: property, head (Kitchen, Maintenance, Utilities…), amount, date, bill photo.",
    "Approved expenses feed the profit reports.",
  ] },
];

/** The best-matching how-to for a question, or null. */
export function matchGuide(question: string): GuideTopic | null {
  const q = norm(question);
  let best: { topic: GuideTopic; score: number } | null = null;
  for (const t of GUIDE) {
    const score = t.keys.reduce((n, k) => n + (q.includes(k) ? k.length : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { topic: { id: t.id, title: t.title, steps: t.steps }, score };
  }
  return best?.topic ?? null;
}

// Words that carry no guest name — stripped before a name search.
const STOP = new Set(("find search show give tell me about details detail of the a an is are was for please pls guest guests booking " +
  "customer ka ki ke ko hai h kya kaun kon batao bata dikhao dikha dhundo dhundho dhoondo search karo info information balance due status room stay where kahan").split(" "));

/** Classify a question into one intent. */
export function classify(question: string): AgentIntent {
  const raw = question.trim();
  const q = ` ${norm(raw)} `;

  const code = /\bBK-[A-Z0-9]{5,}\b/i.exec(raw)?.[0];
  if (code) return { kind: "booking", code: code.toUpperCase() };

  if (any(q, HOW)) {
    const topic = matchGuide(q);
    if (topic) return { kind: "guide", topic };
  }

  // A room: "2F-3", "GF-1", "R2", "room 101" — asked about who is in it.
  const roomTok = /\b((?:[gb]|\d{1,2})f-\d{1,2}|r\d{1,2})\b/i.exec(raw)?.[1] ?? /\b(?:room|kamra|kamre)\s+([a-z]?\d{1,4}[a-z]?)\b/i.exec(raw)?.[1];
  if (roomTok) return { kind: "room", room: roomTok.toUpperCase() };

  if (any(q, [" help ", "what can you", "kya kar sakte", "kya puch", "commands", " hi ", " hello ", " hey ", "namaste"])) return { kind: "help" };

  const dayOffset = any(q, TOMORROW) ? 1 : 0;
  if (any(q, ["arrival", "arriving", "aane wale", "aane vale", "aa rahe", "aayenge", "check in today", "check-in today", "checkin today", "aaj check in", "kaun aa"])) return { kind: "arrivals", dayOffset };
  if (any(q, ["departure", "departing", "jaane wale", "jane wale", "ja rahe", "jayenge", "check out today", "check-out today", "checkout today", "aaj check out", "kaun ja", "leaving"])) return { kind: "departures", dayOffset };
  if (any(q, ["vacant", "khali", "empty room", "free room", "available room", "rooms available", "room available"])) return { kind: "vacant" };
  if (any(q, ["in-house", "in house", "inhouse", "staying", "ruke", "ruka", "kaun kaun", "who is here", "guests now", "abhi kaun"])) return { kind: "inHouse" };
  if (any(q, ["due", "outstanding", "pending", "owe", "baaki", "baki", "revenue", "income", "earning", "kamai", "sales", "expense", "kharcha", "profit", "munafa",
    "occupanc", "fullest", "busiest", "cancel", "no-show", "no show", "clean", "dirty", "housekeep", "collected", "collection"])) return { kind: "business" };

  if (any(q, HOW)) return { kind: "help" }; // a how-to we have no page for

  const name = norm(raw).split(" ").filter((w) => w.length > 1 && !STOP.has(w)).join(" ");
  if (name.length >= 3) return { kind: "guest", name };
  return { kind: "help" };
}
