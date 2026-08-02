/**
 * 18 T-3 — the chatbot's tool registry (FR-2/3, AC-3/10).
 *
 * HARD GUARANTEE: every tool here is READ-ONLY. There is no create/update/delete
 * tool, and there never will be — the LLM proposes, it does not mutate. Each tool
 * runs with the CALLER's scope (`db.scoped(user)` / authorized queries), so the
 * bot can never surface data the staff member could not see themselves, and
 * never confirms a booking (that is the normal server flow, FR-3).
 */
import { db } from "@/lib/db";
import { findFreeRooms, type RoomFinder } from "@/features/reservations/availability";
import type { SessionClaims } from "@/lib/auth/claims";
import type { ToolSpec } from "@/lib/ai";

/** JSON-schema-style specs advertised to the model. Read-only, no PII fields. */
export const READ_ONLY_TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: "search_availability",
    description: "Find rooms free to sell in the active property for a date range. Read-only.",
    parameters: {
      type: "object",
      properties: {
        when: { type: "string", description: "'weekend', 'today', or an ISO date range hint" },
        nights: { type: "number" },
      },
    },
  },
  {
    name: "property_faq",
    description: "Answer a general property FAQ (check-in time, amenities, policies). Read-only.",
    parameters: {
      type: "object",
      properties: { topic: { type: "string" } },
    },
  },
];

/** Names allowed to execute. A tool call for anything else is refused (FR-2). */
export const ALLOWED_TOOL_NAMES: ReadonlySet<string> = new Set(READ_ONLY_TOOL_SPECS.map((t) => t.name));

const FAQ: Record<string, string> = {
  "check-in": "Standard check-in is from 14:00 and check-out by 11:00.",
  amenities: "All suites include Wi-Fi, kitchenette, housekeeping, and 24x7 reception.",
  policy: "Government photo ID is required at check-in. Pets are not allowed.",
};

/** Compute an upcoming weekend [Sat, Mon) range in local server time. */
function weekendRange(now = new Date()): { from: Date; to: Date } {
  const from = new Date(now);
  const day = from.getDay(); // 0 Sun .. 6 Sat
  const daysUntilSat = (6 - day + 7) % 7;
  from.setDate(from.getDate() + daysUntilSat);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 2);
  return { from, to };
}

/**
 * Execute a read-only tool with the caller's scope. Returns a short, PII-free
 * string the model can phrase. Any unknown/mutating tool name is refused.
 */
export async function executeTool(
  user: SessionClaims,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!ALLOWED_TOOL_NAMES.has(name)) {
    throw new Error(`Tool "${name}" is not an allowed read-only tool.`);
  }

  if (name === "property_faq") {
    const topic = String(args.topic ?? "").toLowerCase();
    const key = Object.keys(FAQ).find((k) => topic.includes(k)) ?? "check-in";
    return FAQ[key] ?? FAQ["check-in"]!;
  }

  // search_availability
  const propertyId = user.activePropertyId ?? user.accessiblePropertyIds[0];
  if (!propertyId) return "No property is in scope for this account.";
  const { from, to } = weekendRange();
  const rooms = await findFreeRooms(db.scoped(user) as unknown as RoomFinder, {
    propertyId,
    checkInDate: from,
    checkOutDate: to,
  });
  // Aggregate by category — never leak room numbers/guest data.
  const byCategory = new Map<string, number>();
  for (const r of rooms) byCategory.set(r.categoryName, (byCategory.get(r.categoryName) ?? 0) + 1);
  if (byCategory.size === 0) return "No rooms are free for that range.";
  const summary = [...byCategory.entries()].map(([cat, n]) => `${n} ${cat}`).join(", ");
  return `${rooms.length} room(s) free (${summary}).`;
}
