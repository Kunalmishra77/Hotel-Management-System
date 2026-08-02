/**
 * Traceability: 00 FR-4 (identical auth errors, no enumeration) ·
 * 01 AC-2 (duplicate code rejected with "code already in use").
 *
 * These two pull in opposite directions, and the split is the point: a conflict
 * must be specific enough to act on, while an auth failure must reveal nothing.
 */
import { describe, expect, it } from "vitest";
import {
  ConflictError,
  DomainError,
  ErrorCode,
  ForbiddenError,
  NotFoundError,
  OutOfScopeError,
  userMessageFor,
} from "@/lib/errors";

describe("ConflictError — specific by design (01 AC-2)", () => {
  it("shows the caller the actual collision", () => {
    const error = new ConflictError('Code "WMG" is already in use.');
    expect(error.userMessage).toBe('Code "WMG" is already in use.');
    // Not the generic fallback, which gives the user nothing to fix.
    expect(error.userMessage).not.toMatch(/conflicts with the current state/);
  });

  it("still carries the generic message when none was given", () => {
    expect(new ConflictError().userMessage).toMatch(/conflicts with the current state/);
  });

  it("keeps details out of the user-facing text", () => {
    const error = new ConflictError("Floor \"1\" already exists.", { internalId: "flr_secret" });
    expect(error.userMessage).not.toContain("flr_secret");
  });

  it("maps to HTTP 409", () => {
    expect(new ConflictError("x").httpStatus).toBe(409);
  });
});

describe("auth errors stay generic (00 FR-4 — no enumeration)", () => {
  it("never leaks a specific reason, even when one is passed", () => {
    // The internal message is for the log; the user sees one fixed string.
    const invalid = new DomainError(ErrorCode.INVALID_CREDENTIALS, "user bob@x.com not found");
    expect(invalid.userMessage).toBe("Incorrect email or password.");
    expect(invalid.userMessage).not.toContain("bob@x.com");
  });

  it("gives a locked account the SAME text as a wrong password", () => {
    // Different wording would confirm the account exists.
    const locked = new DomainError(ErrorCode.ACCOUNT_LOCKED);
    const wrong = new DomainError(ErrorCode.INVALID_CREDENTIALS);
    expect(locked.userMessage).toBe(wrong.userMessage);
  });

  it("does not let a caller override an auth message by accident", () => {
    // publicMessage is opt-in; the plain `message` argument never becomes
    // user-facing, so a careless throw cannot open an oracle.
    const error = new DomainError(ErrorCode.FORBIDDEN, "missing permission folio:refund");
    expect(error.userMessage).not.toContain("folio:refund");
  });
});

describe("other domain errors", () => {
  it("ForbiddenError and OutOfScopeError say nothing about what exists", () => {
    const forbidden = new ForbiddenError("no property:manage", { propertyId: "prop_secret" });
    const scope = new OutOfScopeError("outside scope", { propertyId: "prop_secret" });
    expect(forbidden.userMessage).not.toContain("prop_secret");
    expect(scope.userMessage).not.toContain("prop_secret");
    expect(forbidden.httpStatus).toBe(403);
    expect(scope.httpStatus).toBe(403);
  });

  it("NotFoundError maps to 404 with a neutral message", () => {
    const error = new NotFoundError("Property prop_abc not found");
    expect(error.httpStatus).toBe(404);
    expect(error.userMessage).not.toContain("prop_abc");
  });

  it("an unknown error surfaces only the internal fallback", () => {
    expect(userMessageFor(new Error("stack trace with secrets"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
