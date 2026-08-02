/**
 * 15 T-3 — validateStructuredQuery (FR-7, AC-6/AC-11).
 *
 * The 18-ai path: an LLM compiles natural language into a StructuredQuery. This
 * module is the guardrail — it validates the query against a per-entity field +
 * operator ALLOW-LIST before anything runs. A non-whitelisted field, an unknown
 * entity, or a bad operator is rejected `INVALID_QUERY` and NEVER executed. The
 * LLM never writes SQL; values stay literal and are parameterised at execution.
 */
import { DomainError } from "@/lib/errors";
import { ok, type Result } from "@/lib/result";
import { ENTITY_KINDS, type EntityKind, type FilterOp, type StructuredQuery } from "../types";

/** Fields the LLM may filter/sort on, per entity, with the operators allowed. */
const ALLOW_LIST: Record<EntityKind, Record<string, FilterOp[]>> = {
  guest: {
    fullName: ["eq", "contains"],
    companyName: ["eq", "contains"],
    city: ["eq", "contains", "in"],
    state: ["eq", "contains", "in"],
    gstNumber: ["eq"],
    createdAt: ["gte", "lte"],
  },
  reservation: {
    code: ["eq", "contains"],
    status: ["eq", "in"],
    source: ["eq", "in"],
    checkInDate: ["gte", "lte", "eq"],
    checkOutDate: ["gte", "lte", "eq"],
    propertyId: ["eq", "in"],
    createdAt: ["gte", "lte"],
  },
  invoice: {
    number: ["eq", "contains"],
    financialYear: ["eq"],
    customerName: ["eq", "contains"],
    customerGstin: ["eq"],
    issuedAt: ["gte", "lte"],
    propertyId: ["eq", "in"],
  },
  expense: {
    head: ["eq", "in"],
    subCategory: ["eq", "contains"],
    status: ["eq", "in"],
    vendor: ["eq", "contains"],
    spentOn: ["gte", "lte"],
    propertyId: ["eq", "in"],
  },
  staff: {
    name: ["eq", "contains"],
    department: ["eq", "in"],
    isActive: ["eq"],
    propertyId: ["eq", "in"],
  },
};

const MAX_FILTERS = 20;
const MAX_LIMIT = 200;

function reject(detail: string): never {
  // Deliberately generic to the client; the detail is server-log only (never an oracle).
  throw new DomainError("INVALID_QUERY", detail, { details: { detail } });
}

/**
 * Validate a StructuredQuery against the allow-list. Returns the (unchanged)
 * query on success so callers can `if (!res.ok) return res` then execute
 * `res.data`. Any deviation → INVALID_QUERY, never executed (AC-11).
 */
export function validateStructuredQuery(query: StructuredQuery): Result<StructuredQuery> {
  if (!ENTITY_KINDS.includes(query.entity)) reject(`unknown entity: ${String(query.entity)}`);
  const allowed = ALLOW_LIST[query.entity];

  if (!Array.isArray(query.filters)) reject("filters must be an array");
  if (query.filters.length > MAX_FILTERS) reject("too many filters");

  for (const f of query.filters) {
    const ops = allowed[f.field];
    if (!ops) reject(`field not allowed for ${query.entity}: ${f.field}`);
    if (!ops.includes(f.op)) reject(`operator ${f.op} not allowed on ${f.field}`);
    if (f.op === "in" && !Array.isArray(f.value)) reject("`in` requires an array value");
    if (f.op !== "in" && Array.isArray(f.value)) reject(`${f.op} requires a scalar value`);
  }

  if (query.dateRange && !allowed[query.dateRange.field]) {
    reject(`date field not allowed for ${query.entity}: ${query.dateRange.field}`);
  }
  if (query.sort && !allowed[query.sort.field]) {
    reject(`sort field not allowed for ${query.entity}: ${query.sort.field}`);
  }
  if (query.limit !== undefined && (query.limit < 1 || query.limit > MAX_LIMIT)) {
    reject("limit out of range");
  }

  return ok(query);
}

/** Exposed for tests + the executor: the whitelisted fields for an entity. */
export function allowedFields(entity: EntityKind): string[] {
  return Object.keys(ALLOW_LIST[entity] ?? {});
}
