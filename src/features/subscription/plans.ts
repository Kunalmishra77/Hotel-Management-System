/**
 * SaaS plans & add-on modules (architecture v2 · "How we offer it"). Pure catalog:
 * the tiers a hotel chain can subscribe to, and the à-la-carte modules on top.
 * The Organization row stores `plan` + `addonModules`; this describes them.
 */
export type PlanId = "CORE" | "GROWTH" | "ENTERPRISE";

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  pricePerPropertyMonth: number; // ₹ (display)
  includes: string[];
  bundledAddons: AddonId[];
};

export type AddonId = "channel-manager" | "booking-engine" | "owner-portal" | "ai";

export const ADDONS: { id: AddonId; name: string; desc: string }[] = [
  { id: "channel-manager", name: "Channel Manager", desc: "Sync rates & availability with OTAs (Booking.com, MMT, Agoda…)." },
  { id: "booking-engine", name: "Booking Engine", desc: "Your own commission-free direct-booking website." },
  { id: "owner-portal", name: "Owner Portal", desc: "Read-only financials, documents & payouts for property owners." },
  { id: "ai", name: "AI Suite", desc: "NL search, guest chatbot, forecasting & the floating assistant." },
];

export const PLANS: Plan[] = [
  {
    id: "CORE",
    name: "Core PMS",
    tagline: "Everything to run the front desk.",
    pricePerPropertyMonth: 4999,
    includes: ["Reservations & front desk", "GST folio & invoicing", "Housekeeping & maintenance", "Guest CRM & reports", "Mobile PWA + offline"],
    bundledAddons: [],
  },
  {
    id: "GROWTH",
    name: "Growth",
    tagline: "Core + fill more rooms, direct.",
    pricePerPropertyMonth: 7999,
    includes: ["Everything in Core PMS", "Point of sale (POS) & inventory", "Payroll & accounting sync"],
    bundledAddons: ["channel-manager", "booking-engine"],
  },
  {
    id: "ENTERPRISE",
    name: "Enterprise",
    tagline: "The whole platform, every property.",
    pricePerPropertyMonth: 11999,
    includes: ["Everything in Growth", "Owner portal & payouts", "Corporate CRM & dynamic pricing", "Priority support & SLAs"],
    bundledAddons: ["channel-manager", "booking-engine", "owner-portal", "ai"],
  },
];

export const PLAN_BY_ID: Record<string, Plan> = Object.fromEntries(PLANS.map((p) => [p.id, p]));

export const PLAN_STATUS_LABEL: Record<string, string> = {
  TRIAL: "Free trial",
  ACTIVE: "Active",
  PAST_DUE: "Payment due",
  CANCELLED: "Cancelled",
};

/** The add-on modules effectively available to an org = its plan's bundle ∪ its purchased add-ons. */
export function effectiveAddons(plan: string, purchased: readonly string[]): AddonId[] {
  const bundled = PLAN_BY_ID[plan]?.bundledAddons ?? [];
  const set = new Set<AddonId>([...bundled, ...(purchased as AddonId[])]);
  return ADDONS.map((a) => a.id).filter((id) => set.has(id));
}
