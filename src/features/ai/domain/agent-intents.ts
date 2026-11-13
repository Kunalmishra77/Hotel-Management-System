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
  | { kind: "stats"; metric: StatsMetric; period: Period }
  | { kind: "price"; item: string }
  | { kind: "guest"; name: string }
  | { kind: "unknown" };

/** What a counting question asks about. */
export type StatsMetric = "guests" | "checkins" | "bookings" | "nights" | "cancellations";
/** A business-date range [from, to) as UTC-midnight dates, with a human label. */
export type Period = { from: Date; to: Date; label: string };

export type GuideTopic = { id: string; title: string; steps: string[] };

/** Starter questions shown before the first one is asked. */
export const AGENT_SUGGESTIONS: readonly string[] = [
  "Aaj kaun aa raha hai?",
  "Today's check-outs",
  "Who is staying now?",
  "Khali rooms",
  "Today's pending dues?",
  "This month's revenue?",
  "Koi galti hai kya check karo",
  "Extend kaise kare?",
];


/**
 * Hindi (Devanagari) → the Hinglish the rules below already understand, so
 * "2026 में कितने ग्राहक आए" is read like "2026 mei kitne customers aaye".
 * Multi-word phrases first, then whole words; digits ०–९ become 0–9.
 */
const HINDI_PHRASES: readonly [string, string][] = [
  ["चेक-इन", "check-in"], ["चेक इन", "check-in"], ["चेकइन", "check-in"],
  ["चेक-आउट", "check-out"], ["चेक आउट", "check-out"], ["चेकआउट", "check-out"],
  ["अब तक", "ab tak"], ["आ चुके", "aa chuke"],
];
const HINDI_WORDS: Record<string, string> = {
  कितने: "kitne", कितना: "kitna", कितनी: "kitni", ग्राहक: "customers", ग्राहकों: "customers", कस्टमर: "customers", कस्टमर्स: "customers",
  मेहमान: "guests", मेहमानों: "guests", गेस्ट: "guests", गेस्ट्स: "guests", लोग: "log", साल: "saal", वर्ष: "saal",
  महीने: "mahine", महीना: "mahina", हफ्ते: "hafte", हफ़्ते: "hafte", इस: "is", पिछले: "pichle", पूरा: "pura", पूरे: "pure",
  आज: "aaj", कल: "kal", अभी: "abhi", बुकिंग: "booking", बुकिंग्स: "bookings", कमरे: "rooms", कमरा: "room", रूम: "room", रूम्स: "rooms",
  खाली: "khali", कमाई: "kamai", आमदनी: "income", खर्चा: "kharcha", खर्च: "kharcha", बकाया: "baaki", कौन: "kaun", क्या: "kya", कैसे: "kaise",
  रात: "night", रातें: "nights", रातों: "nights", आए: "aaye", आये: "aaye", रुके: "ruke", दाम: "daam", कीमत: "price", रुपये: "rupaye", रुपए: "rupaye",
  प्रॉपर्टी: "property", प्रॉपर्टीज: "properties", होटल: "hotel", होटलों: "hotels", कैंसिल: "cancel", रद्द: "cancel",
  है: "hai", हैं: "hai", में: "mei", मे: "mei", की: "ki", का: "ka", के: "ke", को: "ko", यह: "ye", ये: "ye", हमारे: "humare", हमारी: "humari",
  जनवरी: "january", फरवरी: "february", मार्च: "march", अप्रैल: "april", मई: "may", जून: "june", जुलाई: "july", अगस्त: "august",
  सितंबर: "september", सितम्बर: "september", अक्टूबर: "october", नवंबर: "november", नवम्बर: "november", दिसंबर: "december", दिसम्बर: "december",
};
export function toLatin(text: string): string {
  let t = text.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966)).replace(/[।॥]/g, " ");
  for (const [hi, en] of HINDI_PHRASES) t = t.split(hi).join(en);
  return t.split(/(\s+)/).map((w) => {
    const bare = w.replace(/[?!.,;:'"()]/g, "");
    const en = HINDI_WORDS[bare];
    return en ? w.replace(bare, en) : w;
  }).join("");
}

const norm = (q: string) => toLatin(q).toLowerCase().replace(/[?!.,;:'"()]/g, " ").replace(/\s+/g, " ").trim();
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

const COUNT = [" kitne ", " kitna ", " kitni ", " kitte ", "how many", "number of", " count ", " total ", " ginti "];
const PERIOD_WORDS = [" saal", " year", " mahin", " month", " week", " hafte", " ab tak", " abhi tak", " so far", " till now", " till date", " all time"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const utcDay = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m, d));
const monthLabel = (date: Date) => date.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * The period a counting question is about. `today` = the property-local
 * business date (UTC midnight). Default — no period named — is this year so far,
 * which is what "abhi tak kitne" means at a front desk.
 */
export function parsePeriod(question: string, today: Date): Period {
  const q = ` ${norm(question)} `;
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const cap = (end: Date) => (end > tomorrow ? tomorrow : end);
  const yearInQ = /\b(20\d{2})\b/.exec(q)?.[1];

  // A month by name: "october", "oct 2026", "अक्टूबर" ("may" only as the full word).
  for (let i = 0; i < 12; i++) {
    if (q.includes(` ${MONTHS[i]}`) || (i !== 4 && new RegExp(` ${MONTH_SHORT[i]} `).test(q))) {
      const yr = yearInQ ? Number(yearInQ) : i > m ? y - 1 : y;
      return { from: utcDay(yr, i), to: cap(utcDay(yr, i + 1)), label: monthLabel(utcDay(yr, i)) };
    }
  }
  if (yearInQ) {
    const yr = Number(yearInQ);
    return { from: utcDay(yr, 0), to: cap(utcDay(yr + 1, 0)), label: yr === y ? `${yr} so far` : String(yr) };
  }
  if (any(q, ["last month", "pichle mahin", "pichhle mahin", "previous month"])) {
    return { from: utcDay(y, m - 1), to: utcDay(y, m), label: monthLabel(utcDay(y, m - 1)) };
  }
  if (any(q, ["this month", "is mahin", " mahin", " month"])) return { from: utcDay(y, m), to: tomorrow, label: `${monthLabel(today)} so far` };
  if (any(q, ["last year", "pichle saal", "pichhle saal", "previous year"])) return { from: utcDay(y - 1, 0), to: utcDay(y, 0), label: String(y - 1) };
  if (any(q, ["this week", "is hafte", " week", " hafte"])) {
    const dow = (today.getUTCDay() + 6) % 7; // Monday = 0
    return { from: new Date(today.getTime() - dow * 86_400_000), to: tomorrow, label: "this week" };
  }
  if (any(q, [" today ", " aaj "])) return { from: today, to: tomorrow, label: "today" };
  if (any(q, ["all time", "kab se", "shuru se"])) return { from: utcDay(2000, 0), to: tomorrow, label: "all time" };
  return { from: utcDay(y, 0), to: tomorrow, label: `${y} so far` };
}

function statsMetric(q: string): StatsMetric | null {
  if (any(q, ["cancel"])) return "cancellations";
  if (any(q, ["room night", "room-night", " nights", " night ", " raat"])) return "nights";
  if (any(q, ["booking", "reservation"])) return "bookings";
  if (any(q, ["check-in", "check in", "checkin", " aaye", "aa chuke", "aa gaye", "arrived", " stays", " stay ", "visit"])) return "checkins";
  if (any(q, ["guest", "customer", "mehman", " log ", "people", "person", "client"])) return "guests";
  return null;
}

const PRICE = [" rupe", " rupay", " rupaye", " rupee", " rs ", " daam", " price", " cost", " kitne ka ", " kitne ki ", " kitna ka ", " kitne me ", " kitne mei ", "₹"];
const PRICE_NOISE = new Set("kitne kitna kitni ka ki ke hai h kya rupe rupay rupaye rupee rupees rs daam price cost of the what is me mei batao bata ek one plate".split(" "));

/** Words that make a phrase a question, never a guest's name. */
const QUESTION_WORDS = new Set(("kitne kitna kitni kya kyu kyun kyon kaise kab kahan kaha konsa kaunsa how what why when which where who " +
  "abhi tak ab saal year month mahine humare hamare properties property hotel hotels sab sabhi pura pure total").split(" "));

/** Hinglish glue words — never part of a name. */
const FILLER = new Set(("ye yeh wo woh mei me mein se tak aur bhi hi wala wale wali abhi aa chuke chuka hain ho gaya gaye hua hue tha thi the " +
  "na nahi nhi to bhi sir ji haan han ok okay theek thik sab").split(" "));

// Words that carry no guest name — stripped before a name search.
const STOP = new Set(("find search show give tell me about details detail of the a an is are was for please pls guest guests booking " +
  "customer customers guests ka ki ke ko hai h kya kaun kon batao bata dikhao dikha dhundo dhundho dhoondo search karo info information balance due status room stay where kahan").split(" "));

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

  // Counting questions: "2026 mei kitne customers aaye", "is mahine kitni bookings".
  if (any(q, COUNT)) {
    const metric = statsMetric(q);
    const now = !any(q, PERIOD_WORDS) && !/\b20\d{2}\b/.test(q) && any(q, [" abhi ", " now ", "currently"]);
    if (metric && now && (metric === "guests" || metric === "checkins")) return { kind: "inHouse" };
    if (metric) {
      const today = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}T00:00:00Z`);
      const period = parsePeriod(raw, today);
      if (period.label === "today" && metric === "checkins") return { kind: "arrivals", dayOffset: 0 };
      return { kind: "stats", metric, period };
    }
  }

  // Price of something sold here (the POS menu): "jalebi kitne rupe ka hai".
  if (any(q, PRICE) && !any(q, [" room", "tariff", " rate "])) {
    const item = norm(raw).split(" ").filter((w) => w.length > 1 && !PRICE_NOISE.has(w) && !/^\d+$/.test(w)).join(" ");
    if (item) return { kind: "price", item };
  }

  const dayOffset = any(q, TOMORROW) ? 1 : 0;
  if (any(q, ["arrival", "arriving", "aane wale", "aane vale", "aa rahe", "aayenge", "check in today", "check-in today", "checkin today", "aaj check in", "kaun aa"])) return { kind: "arrivals", dayOffset };
  if (any(q, ["departure", "departing", "jaane wale", "jane wale", "ja rahe", "jayenge", "check out today", "check-out today", "checkout today", "aaj check out", "kaun ja", "leaving"])) return { kind: "departures", dayOffset };
  if (any(q, ["vacant", "khali", "empty room", "free room", "available room", "rooms available", "room available"])) return { kind: "vacant" };
  if (any(q, ["in-house", "in house", "inhouse", "staying", "ruke", "ruka", "kaun kaun", "who is here", "guests now", "abhi kaun"])) return { kind: "inHouse" };
  if (any(q, ["due", "outstanding", "pending", "owe", "baaki", "baki", "revenue", "income", "earning", "kamai", "sales", "expense", "kharcha", "profit", "munafa",
    "occupanc", "fullest", "busiest", "cancel", "no-show", "no show", "clean", "dirty", "housekeep", "collected", "collection"])) return { kind: "business" };

  if (any(q, HOW)) return { kind: "help" }; // a how-to we have no page for

  // Only something that reads like a name is searched as a guest — a sentence
  // the agent didn't understand must never come back as random guests whose
  // names share a syllable with it ("kitne abhi tak" → "Abhishek").
  const words = norm(raw).split(" ").filter((w) => w.length > 1);
  const nameWords = words.filter((w) => !STOP.has(w) && !QUESTION_WORDS.has(w) && !FILLER.has(w));
  const name = nameWords.join(" ");
  if (nameWords.length >= 1 && nameWords.length <= 3 && name.length >= 3) return { kind: "guest", name };
  return words.length ? { kind: "unknown" } : { kind: "help" };
}
