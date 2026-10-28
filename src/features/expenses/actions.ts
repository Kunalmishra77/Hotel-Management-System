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
import { createExpenseSchema, createExpensesSchema, approveExpenseSchema, rejectExpenseSchema, setExpenseBudgetSchema, type CreateExpenseInput } from "./schema";
import { requiresSuperApproval } from "./domain/escalation";

export type ExpenseResult = { id: string; status: string };

/**
 * Set (or clear, when amount = 0) a monthly expense budget for one property + head
 * (07 budget-vs-actual). Managing budgets is an `expense:approve` action — audited.
 * Upsert on (property, head, month); amount is BigInt paise.
 */
export async function setExpenseBudget(input: unknown): Promise<Result<{ ok: true }>> {
  return toResult(async () => {
    const data = setExpenseBudgetSchema.parse(input);
    const user = await requireUser();
    authorize(user, "expense:approve", data.propertyId);
    return withExpenseContext(user, () =>
      expenseDb(user).$transaction(async (tx) => {
        const where = { propertyId: data.propertyId, head: data.head, month: data.month };
        if (data.amountPaise === 0) {
          // Clear the target.
          await tx.expenseBudget.deleteMany({ where });
        } else {
          // Upsert without the compound-unique key: the property-scope extension wraps
          // `where` in AND[...], and a composite unique key is invalid inside AND — so
          // use scalar find + updateMany/create, which the extension handles.
          const existing = await tx.expenseBudget.findFirst({ where, select: { id: true } });
          if (existing) {
            await tx.expenseBudget.updateMany({ where, data: { amountPaise: BigInt(data.amountPaise) } });
          } else {
            await tx.expenseBudget.create({
              data: { propertyId: data.propertyId, head: data.head, month: data.month, amountPaise: BigInt(data.amountPaise), createdById: user.userId },
            });
          }
        }
        await writeAudit(tx, { action: "expense:set-budget", entityType: "ExpenseBudget", entityId: `${data.propertyId}:${data.head}:${data.month}`, propertyId: data.propertyId, after: { head: data.head, month: data.month, amountPaise: data.amountPaise } });
        return { ok: true as const };
      }),
    );
  });
}

const SALARY_SUB = /salary|wages|payroll/i;

/**
 * Prepare one expense item for insertion: enforce the salary guard and upload its
 * bill (if any) to storage, returning the row's `data`. Bill upload happens BEFORE
 * the DB write so we never persist a row referencing a scan that failed to upload
 * (AC-8) — key only, encrypted at rest. Shared by the single + batch create paths.
 */
async function prepareExpenseRow(data: CreateExpenseInput, userId: string) {
  // FR-6 / AC-7: salary belongs to payroll (21), never a hand-keyed STAFF expense.
  if (data.head === "STAFF" && data.subCategory && SALARY_SUB.test(data.subCategory)) {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, "Salary/wages are recorded in payroll (21), not as a STAFF expense.");
  }
  let billObjectKey: string | null = null;
  if (data.billBase64) {
    const key = `expenses/${data.propertyId}/${randomUUID()}`;
    await resolveStorageAdapter().put(key, Buffer.from(data.billBase64, "base64"), { contentType: "image/jpeg" });
    billObjectKey = key;
  }
  return {
    propertyId: data.propertyId,
    head: data.head,
    subCategory: data.subCategory ?? null,
    description: data.description ?? null,
    quantity: data.quantity ?? null,
    amountPaise: data.amountPaise,
    spentOn: data.spentOn,
    paidVia: data.paidVia ?? null,
    vendor: data.vendor ?? null,
    gstNumber: data.gstNumber ?? null,
    billObjectKey,
    status: "DRAFT" as const,
    createdById: userId,
  };
}

/** Record an expense (FR-1/2/3/6). STAFF-head salary spend is refused (FR-6). */
export async function createExpense(input: unknown): Promise<Result<ExpenseResult>> {
  return toResult(async () => {
    const data = createExpenseSchema.parse(input);
    const user = await requireUser();
    authorize(user, "expense:create", data.propertyId);
    const row = await prepareExpenseRow(data, user.userId);

    return withExpenseContext(user, () =>
      expenseDb(user).$transaction(async (tx) => {
        const expense = await tx.expense.create({ data: row, select: { id: true, status: true } });
        await emitEvent(tx, { type: "ExpenseRecorded", aggregateId: expense.id, propertyId: data.propertyId, payload: { head: data.head, amountPaise: data.amountPaise } });
        await writeAudit(tx, { action: "expense:create", entityType: "Expense", entityId: expense.id, propertyId: data.propertyId, after: { head: data.head, amountPaise: data.amountPaise, hasBill: row.billObjectKey !== null } });
        return expense;
      }),
    );
  });
}

/**
 * Record several expense line items in one submit (#multi-item) — e.g. a grocery
 * run of milk, bread, eggs. Each is its own DRAFT row (so approval + rollups are
 * unchanged); all are written in ONE transaction so a partial batch can't land.
 * Authorized per distinct property; the salary guard runs on every item.
 */
export async function createExpenses(input: unknown): Promise<Result<{ count: number; ids: string[] }>> {
  return toResult(async () => {
    const { items } = createExpensesSchema.parse(input);
    const user = await requireUser();
    for (const propertyId of new Set(items.map((i) => i.propertyId))) {
      authorize(user, "expense:create", propertyId);
    }
    // Upload bills + run guards for every item before opening the transaction.
    const rows = await Promise.all(items.map((i) => prepareExpenseRow(i, user.userId)));

    return withExpenseContext(user, () =>
      expenseDb(user).$transaction(async (tx) => {
        const ids: string[] = [];
        for (const row of rows) {
          const expense = await tx.expense.create({ data: row, select: { id: true } });
          ids.push(expense.id);
          await emitEvent(tx, { type: "ExpenseRecorded", aggregateId: expense.id, propertyId: row.propertyId, payload: { head: row.head, amountPaise: row.amountPaise } });
          await writeAudit(tx, { action: "expense:create", entityType: "Expense", entityId: expense.id, propertyId: row.propertyId, after: { head: row.head, amountPaise: row.amountPaise, hasBill: row.billObjectKey !== null, batch: true } });
        }
        return { count: ids.length, ids };
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
