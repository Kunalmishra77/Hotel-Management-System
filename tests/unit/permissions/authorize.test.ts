/**
 * Traceability: 00 T-10/T-12 — FR-11/13/14, AC-11/13.
 * Pure authorization decisions; no I/O.
 */
import { describe, expect, it } from "vitest";
import {
  authorize,
  can,
  resolvePermissions,
  resolvePropertyScope,
  type AuthorizedUser,
} from "@/lib/permissions";
import { DomainError, ForbiddenError, OutOfScopeError } from "@/lib/errors";

const PROP_A = "prop_a";
const PROP_B = "prop_b";

function userWith(
  role: "ADMINISTRATOR" | "MANAGER" | "RECEPTION" | "ACCOUNTS" | "HOUSEKEEPING",
  propertyIds: string[],
): AuthorizedUser {
  const roleAssignments = [{ role, propertyIds }];
  return {
    userId: `u_${role}`,
    orgId: "org",
    roleAssignments,
    resolvedPermissions: resolvePermissions(roleAssignments),
    propertyScope: resolvePropertyScope(roleAssignments),
    activePropertyId: propertyIds[0] ?? null,
  };
}

const reception = userWith("RECEPTION", [PROP_A]);
const accounts = userWith("ACCOUNTS", [PROP_A, PROP_B]);
const admin = userWith("ADMINISTRATOR", []);
const housekeeping = userWith("HOUSEKEEPING", [PROP_A]);

describe("authorize — permission (FR-11/13, AC-11)", () => {
  it("allows a granted permission in scope", () => {
    expect(() => authorize(reception, "reservation:create", PROP_A)).not.toThrow();
  });

  it("denies a permission the role does not hold (AC-11)", () => {
    // Reception calling expense:approve — 403 regardless of what the UI showed.
    expect(() => authorize(reception, "expense:approve", PROP_A)).toThrow(ForbiddenError);
  });

  it("denies by default — housekeeping cannot see financials", () => {
    expect(() => authorize(housekeeping, "report:view-financial", PROP_A)).toThrow(ForbiddenError);
    expect(() => authorize(housekeeping, "folio:charge", PROP_A)).toThrow(ForbiddenError);
  });

  it("allows an administrator everything, org-wide", () => {
    expect(() => authorize(admin, "user:manage", PROP_A, { reason: "x" })).not.toThrow();
    expect(() => authorize(admin, "integration:manage", PROP_B)).not.toThrow();
  });
});

describe("authorize — property scope (FR-9, AC-9)", () => {
  it("rejects an out-of-scope property even when the permission is held", () => {
    // Reception HAS reservation:create — but not at PROP-B.
    expect(() => authorize(reception, "reservation:create", PROP_B)).toThrow(OutOfScopeError);
  });

  it("checks scope BEFORE the permission, so a probe cannot enumerate rights", () => {
    // Both wrong: the scope error must win, revealing nothing about permissions.
    expect(() => authorize(reception, "expense:approve", PROP_B)).toThrow(OutOfScopeError);
  });

  it("allows a multi-property user at either property", () => {
    expect(() => authorize(accounts, "folio:view", PROP_A)).not.toThrow();
    expect(() => authorize(accounts, "folio:view", PROP_B)).not.toThrow();
  });

  it("skips the scope check when no property is supplied (org-level action)", () => {
    expect(() => authorize(accounts, "folio:view")).not.toThrow();
  });
});

describe("authorize — audited reason (FR-14, AC-13)", () => {
  it("requires a reason for a reason-mandated permission", () => {
    expect(() => authorize(accounts, "folio:refund", PROP_A)).toThrow(DomainError);
    try {
      authorize(accounts, "folio:refund", PROP_A);
    } catch (e) {
      expect((e as DomainError).code).toBe("REASON_REQUIRED");
    }
  });

  it("accepts the action once a reason is given", () => {
    expect(() =>
      authorize(accounts, "folio:refund", PROP_A, { reason: "Guest charged twice" }),
    ).not.toThrow();
  });

  it("rejects a blank or whitespace-only reason", () => {
    for (const reason of ["", "   ", "\n\t"]) {
      expect(() => authorize(accounts, "folio:refund", PROP_A, { reason })).toThrow(DomainError);
    }
  });

  it("does not demand a reason for ordinary permissions", () => {
    expect(() => authorize(accounts, "payment:record", PROP_A)).not.toThrow();
  });

  it("still denies a reason-bearing call when the permission is absent", () => {
    // A reason is not a substitute for authority.
    expect(() =>
      authorize(reception, "folio:refund", PROP_A, { reason: "I really need to" }),
    ).toThrow(ForbiddenError);
  });
});

describe("can — non-throwing companion for UI rendering", () => {
  it("mirrors authorize for permission and scope", () => {
    expect(can(reception, "reservation:create", PROP_A)).toBe(true);
    expect(can(reception, "expense:approve", PROP_A)).toBe(false);
    expect(can(reception, "reservation:create", PROP_B)).toBe(false);
  });

  it("ignores the reason requirement — that is enforced at mutation time", () => {
    // Nav must still show a refund control; the reason is collected in the form.
    expect(can(accounts, "folio:refund", PROP_A)).toBe(true);
  });
});

describe("resolvePermissions with overrides (FR-11)", () => {
  it("revokes a default grant for the matching role", () => {
    const perms = resolvePermissions([{ role: "RECEPTION", propertyIds: [PROP_A] }], [
      { role: "RECEPTION", permission: "reservation:cancel", granted: false },
    ]);
    expect(perms).not.toContain("reservation:cancel");
    expect(perms).toContain("reservation:create");
  });

  it("adds a permission the role would not otherwise hold", () => {
    const perms = resolvePermissions([{ role: "RECEPTION", propertyIds: [PROP_A] }], [
      { role: "RECEPTION", permission: "expense:approve", granted: true },
    ]);
    expect(perms).toContain("expense:approve");
  });

  it("ignores an override for a role the user does not hold", () => {
    const perms = resolvePermissions([{ role: "RECEPTION", propertyIds: [PROP_A] }], [
      { role: "ACCOUNTS", permission: "reservation:create", granted: false },
    ]);
    expect(perms).toContain("reservation:create");
  });

  it("ignores an override naming an unknown permission rather than crashing", () => {
    // Stale config must not be able to lock everyone out of sign-in.
    expect(() =>
      resolvePermissions([{ role: "RECEPTION", propertyIds: [PROP_A] }], [
        { role: "RECEPTION", permission: "module:that-was-removed", granted: true },
      ]),
    ).not.toThrow();
  });

  it("unions permissions across multiple role assignments", () => {
    const perms = resolvePermissions([
      { role: "RECEPTION", propertyIds: [PROP_A] },
      { role: "ACCOUNTS", propertyIds: [PROP_B] },
    ]);
    expect(perms).toContain("reservation:create"); // from RECEPTION
    expect(perms).toContain("expense:approve"); // from ACCOUNTS
  });
});

describe("resolvePropertyScope (FR-10)", () => {
  it("treats an empty propertyIds as org-wide", () => {
    expect(resolvePropertyScope([{ role: "ADMINISTRATOR", propertyIds: [] }])).toEqual({
      kind: "ALL_IN_ORG",
    });
  });

  it("unions the ids of bounded assignments", () => {
    expect(
      resolvePropertyScope([
        { role: "RECEPTION", propertyIds: [PROP_A] },
        { role: "ACCOUNTS", propertyIds: [PROP_B, PROP_A] },
      ]),
    ).toEqual({ kind: "PROPERTIES", propertyIds: [PROP_A, PROP_B] });
  });

  it("widens to org-wide if ANY assignment is org-wide", () => {
    expect(
      resolvePropertyScope([
        { role: "RECEPTION", propertyIds: [PROP_A] },
        { role: "ADMINISTRATOR", propertyIds: [] },
      ]),
    ).toEqual({ kind: "ALL_IN_ORG" });
  });

  it("is empty for a user with no assignments — deny by default", () => {
    expect(resolvePropertyScope([])).toEqual({ kind: "PROPERTIES", propertyIds: [] });
  });
});
