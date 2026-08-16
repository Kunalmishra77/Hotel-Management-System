/**
 * Property-scoped database access — 00 T-8/T-9 (FR-8/9/10, AC-8/9/10).
 *
 * FR-8: "Every operational read and write executes through the property-scoped
 * helper `db.scoped(user)`, which filters to the user's FULL propertyScope (the
 * authorization boundary); a single-property read that must honour the
 * currently switched property instead reads `db.activeProperty(user)`."
 *
 * Implemented with a Prisma client extension rather than a convention, because
 * a convention is only as good as the least careful `where` clause anyone ever
 * writes. Here the filter is injected by the client itself: a query that forgets
 * to scope is still scoped, and a query that targets an out-of-scope property is
 * rejected before it reads anything (FR-9).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./client";
import { OutOfScopeError } from "../errors";
import type { PropertyScope } from "../context";

/** The caller shape `scoped()` needs — satisfied by SessionClaims. */
export type ScopedActor = {
  orgId: string;
  propertyScope: PropertyScope;
  accessiblePropertyIds: readonly string[];
  activePropertyId: string | null;
};

/**
 * Models carrying a `propertyId` that must be filtered. Derived from
 * prisma/schema.prisma — every operational entity per data-model.md
 * ("Every operational table has propertyId and is queried through the
 * property-scoped helper").
 *
 * Kept explicit rather than reflected at runtime so adding a model is a
 * deliberate decision about its tenancy, and `tests/unit/db/scoped.test.ts`
 * fails if a new `propertyId` model is not classified here.
 */
export const PROPERTY_SCOPED_MODELS = [
  "Floor",
  "RoomCategory",
  "Room",
  "RoomBlock",
  "Reservation",
  "RoomAllocation",
  "Folio",
  "Payment",
  "InvoiceSeries",
  "Invoice",
  "Expense",
  "Staff",
  "HousekeepingTask",
  "MaintenanceJob",
  "Asset",
  "RoomInspection",
  "GuestMessage",
  "MessageLog",
  "Feedback",
  "ChannelAccount",
  "DailyStatSnapshot",
  "NightAuditRun",
  "PosOutlet",
  "MenuItem",
  "PosOrder",
  "InventoryItem",
  "PayrollRun",
  "BookingEngineOrder",
  "DynamicRate",
  "AuditLog",
  "DomainEvent",
  "ImportBatch",
] as const;

export type PropertyScopedModel = (typeof PROPERTY_SCOPED_MODELS)[number];

const SCOPED_MODEL_SET: ReadonlySet<string> = new Set(PROPERTY_SCOPED_MODELS);

export function isPropertyScopedModel(model: string): model is PropertyScopedModel {
  return SCOPED_MODEL_SET.has(model);
}

/**
 * The `where` fragment for a scope.
 *
 * An org-wide scope still filters — by the concrete accessible ids — rather
 * than returning `{}`. An unfiltered query would cross the organisation
 * boundary the moment this system becomes multi-tenant, which architecture.md
 * says it is modelled to become.
 */
export function scopeFilter(actor: ScopedActor): Prisma.RoomWhereInput {
  return { propertyId: { in: [...actor.accessiblePropertyIds] } };
}

/** FR-9: reject an out-of-scope target BEFORE any read or write. */
export function assertPropertyInScope(actor: ScopedActor, propertyId: string): void {
  if (!actor.accessiblePropertyIds.includes(propertyId)) {
    throw new OutOfScopeError("Property outside caller scope", { propertyId });
  }
}

/**
 * Pull every `propertyId` literal out of a (possibly nested) argument object so
 * an explicit cross-property target can be rejected up front.
 */
function collectTargetedPropertyIds(value: unknown, depth = 0): string[] {
  if (depth > 6 || value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((v) => collectTargetedPropertyIds(v, depth + 1));

  const found: string[] = [];
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === "propertyId") {
      if (typeof v === "string") found.push(v);
      else if (v && typeof v === "object") {
        const eq = (v as { equals?: unknown }).equals;
        if (typeof eq === "string") found.push(eq);
        const inList = (v as { in?: unknown }).in;
        if (Array.isArray(inList)) {
          for (const item of inList) if (typeof item === "string") found.push(item);
        }
      }
    } else {
      found.push(...collectTargetedPropertyIds(v, depth + 1));
    }
  }
  return found;
}

type AnyArgs = Record<string, unknown>;

/** Operations whose `where`/`data` must be constrained. */
const READ_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);
const WRITE_OPS = new Set(["update", "updateMany", "delete", "deleteMany", "upsert"]);
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);

/**
 * A Prisma client whose every query on a property-scoped model is confined to
 * the actor's scope.
 *
 * `findUnique` is rewritten to `findFirst` when a scope filter must be added:
 * Prisma refuses non-unique fields in a `findUnique` where-clause, and silently
 * dropping the filter instead would be a tenancy hole.
 */
export function scopedClient(actor: ScopedActor, base: PrismaClient = prisma) {
  return base.$extends({
    name: "property-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isPropertyScopedModel(model)) return query(args);

          const a = (args ?? {}) as AnyArgs;

          // FR-9 — an explicitly targeted out-of-scope property is refused
          // before the query runs, not filtered into an empty result.
          for (const targeted of collectTargetedPropertyIds(a)) {
            assertPropertyInScope(actor, targeted);
          }

          const filter = scopeFilter(actor);

          if (CREATE_OPS.has(operation)) {
            // Creates are validated above; nothing to filter.
            return query(args);
          }

          if (READ_OPS.has(operation) || WRITE_OPS.has(operation)) {
            const where = (a.where ?? {}) as AnyArgs;
            const scopedWhere = { AND: [where, filter] };

            if (operation === "findUnique" || operation === "findUniqueOrThrow") {
              // Delegate to findFirst so a non-unique scope filter is legal.
              const delegate = (base as unknown as Record<string, Record<string, unknown>>)[
                lowerFirst(model)
              ];
              const fn = delegate?.[
                operation === "findUnique" ? "findFirst" : "findFirstOrThrow"
              ] as ((x: unknown) => unknown) | undefined;
              if (fn) return fn({ ...a, where: scopedWhere });
            }

            return query({ ...a, where: scopedWhere });
          }

          return query(args);
        },
      },
    },
  });
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export type ScopedClient = ReturnType<typeof scopedClient>;

/**
 * The public surface every feature uses.
 *
 *   db.scoped(user)          → the authorization boundary (FR-8)
 *   db.activeProperty(user)  → the switched property for single-property reads
 *   db.unscoped()            → the vetted escape hatch; see below
 */
export const db = {
  scoped(actor: ScopedActor): ScopedClient {
    return scopedClient(actor);
  },

  /**
   * The currently switched property id (FR-27), or throw when the user has none
   * in scope. Callers that need "the one property I'm looking at" use this;
   * `scoped()` remains the authorization boundary either way.
   */
  activeProperty(actor: ScopedActor): string {
    const id = actor.activePropertyId;
    if (!id) throw new OutOfScopeError("No active property in scope");
    assertPropertyInScope(actor, id);
    return id;
  },

  /**
   * Raw, unfiltered client.
   *
   * ONLY for org-level reporting rollups and platform internals (outbox
   * dispatch, backup, auth). Every use must justify itself — eslint blocks the
   * raw import in `features/` and `app/`, and this name is greppable in review.
   */
  unscoped(): PrismaClient {
    return prisma;
  },
};
