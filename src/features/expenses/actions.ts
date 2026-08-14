"use server";

/**
 * Expense actions — 07 T-4/T-5 (FR-1..4/6/7, AC-1..4/6/7/9/10). Canonical write
 * path. Two guards worth calling out: STAFF-head salary/wages/payroll entries are
 * REJECTED (salary's single source is payroll, 21 — no double count, FR-6), and
 * the bill image is stored in encrypted object storage with only its key on the
 * row (never bytes, never logs — AC-8).
 */
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { resolveStorageAdapter } from "@/lib/storage";
import { expenseDb, withExpenseContext } from "./internal";
import { createExpenseSchema, approveExpenseSchema, rejectExpenseSchema } from "./schema";
import { requiresSuperApproval } from "./domain/escalation";

export type ExpenseResult = { id: string; status: string };

const SALARY_SUB = /salary|wages|payroll/i;

/** Record an expense (FR-1/2/3/6). STAFF-head salary spend is refused (FR-6). */
export async function createExpense(input: unknown): Promise<Result<ExpenseResult>> {
  return toResult(async () => {
    const data = createExpenseSchema.parse(input);
    const user = await requireUser();
    authorize(user, "expense:create", data.propertyId);

    // FR-6 / AC-7: salary belongs to payroll (21), never a hand-keyed STAFF expense.
    if (data.head === "STAFF" && data.subCategory && SALARY_SUB.test(data.subCategory)) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Salary/wages are recorded in payroll (21), not as a STAFF expense.");
    }

    // Store the bill BEFORE the row so we never persist an expense referencing a
    // scan that failed to upload (AC-8) — key only, encrypted at rest.
    let billObjectKey: string | null = null;
    if (data.billBase64) {
      const key = `expenses/${data.propertyId}/${randomUUID()}`;
      await resolveStorageAdapter().put(key, Buffer.from(data.billBase64, "base64"), { contentType: "image/jpeg" });
      billObjectKey = key;
    }

    return withExpenseContext(user, () =>
      expenseDb(user).$transaction(async (tx) => {
        const expense = await tx.expense.create({
          data: {
            propertyId: data.propertyId,
            head: data.head,
            subCategory: data.subCategory ?? null,
            description: data.description ?? null,
            amountPaise: data.amountPaise,
            spentOn: data.spentOn,
            paidVia: data.paidVia ?? null,
            vendor: data.vendor ?? null,
            billObjectKey,
            status: "DRAFT",
            createdById: user.userId,
          },
          select: { id: true, status: true },
        });
        await emitEvent(tx, { type: "ExpenseRecorded", aggregateId: expense.id, propertyId: data.propertyId, payload: { head: data.head, amountPaise: data.amountPaise } });
        await writeAudit(tx, { action: "expense:create", entityType: "Expense", entityId: expense.id, propertyId: data.propertyId, after: { head: data.head, amountPaise: data.amountPaise, hasBill: billObjectKey !== null } });
        return expense;
      }),
    );
  });
}

/** Approve a DRAFT expense (FR-4, AC-4): it now counts toward finalized profit. */
export async function approveExpense(input: unknown): Promise<Result<ExpenseResult>> {
  return toResult(async () => {
    const { expenseId } = approveExpenseSchema.parse(input);
    const user = await requireUser();
    const client = expenseDb(user);
    const expense = await client.expense.findFirst({ where: { id: expenseId }, select: { id: true, propertyId: true, status: true, amountPaise: true } });
    if (!expense) throw new NotFoundError("Expense not found.");
    // Escalation (Phase 6): a major spend needs Super-Admin approval — a Manager's
    // expense:approve is refused; only an Administrator holds expense:approve-large.
    authorize(
      user,
      requiresSuperApproval(expense.amountPaise) ? "expense:approve-large" : "expense:approve",
      expense.propertyId,
    );

    return withExpenseContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.expense.updateMany({ where: { id: expenseId }, data: { status: "APPROVED", approvedById: user.userId } });
        await emitEvent(tx, { type: "ExpenseApproved", aggregateId: expenseId, propertyId: expense.propertyId, payload: {} });
        await writeAudit(tx, { action: "expense:approve", entityType: "Expense", entityId: expenseId, propertyId: expense.propertyId, before: { status: expense.status }, after: { status: "APPROVED" } });
        return { id: expenseId, status: "APPROVED" };
      }),
    );
  });
}

/** Reject a DRAFT expense (FR-4, AC-9): excluded from rollups/profit, audited. */
export async function rejectExpense(input: unknown): Promise<Result<ExpenseResult>> {
  return toResult(async () => {
    const { expenseId, reason } = rejectExpenseSchema.parse(input);
    const user = await requireUser();
    const client = expenseDb(user);
    const expense = await client.expense.findFirst({ where: { id: expenseId }, select: { id: true, propertyId: true, status: true } });
    if (!expense) throw new NotFoundError("Expense not found.");
    authorize(user, "expense:approve", expense.propertyId, { reason });

    return withExpenseContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.expense.updateMany({ where: { id: expenseId }, data: { status: "REJECTED" } });
        await writeAudit(tx, { action: "expense:reject", entityType: "Expense", entityId: expenseId, propertyId: expense.propertyId, reason, before: { status: expense.status }, after: { status: "REJECTED" } });
        return { id: expenseId, status: "REJECTED" };
      }),
    );
  });
}
