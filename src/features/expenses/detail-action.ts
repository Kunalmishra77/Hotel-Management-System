"use server";

/**
 * Full detail of one expense for the "View" popup (client: "open karke dekh sake
 * kis chij ka expense hai") — what, how much, where, paid how, the vendor / GSTIN,
 * who entered and who approved or rejected it (with the reason), and whether a
 * bill scan is attached. Property-scoped; `expense:create`.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { expenseDb } from "./internal";

export type ExpenseDetail = {
  id: string;
  propertyName: string;
  head: string;
  subCategory: string | null;
  description: string | null;
  quantity: string | null;
  amountPaise: number;
  spentOn: string;
  paidVia: string | null;
  vendor: string | null;
  gstNumber: string | null;
  status: string;
  hasBill: boolean;
  createdBy: string | null;
  createdAt: string;
  approvedBy: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
};

export async function getExpenseDetail(expenseId: string): Promise<Result<ExpenseDetail>> {
  return toResult(async () => {
    const user = await requireUser();
    const client = expenseDb(user);
    const e = await client.expense.findFirst({
      where: { id: expenseId },
      select: {
        id: true, propertyId: true, head: true, subCategory: true, description: true, quantity: true, amountPaise: true,
        spentOn: true, paidVia: true, vendor: true, gstNumber: true, status: true, billObjectKey: true,
        createdById: true, approvedById: true, createdAt: true,
      },
    });
    if (!e) throw new NotFoundError("Expense not found.");
    authorize(user, "expense:create", e.propertyId);

    const [property, decision] = await Promise.all([
      client.property.findFirst({ where: { id: e.propertyId }, select: { name: true } }),
      client.auditLog.findFirst({
        where: { entityType: "Expense", entityId: e.id, action: { in: ["expense:approve", "expense:reject"] } },
        orderBy: { createdAt: "desc" },
        select: { action: true, reason: true, createdAt: true, userId: true },
      }),
    ]);
    // Who decided: the approver on the row, else the actor of the last decision (a rejection).
    const deciderId = e.approvedById ?? decision?.userId ?? null;
    const people = await client.user.findMany({
      where: { id: { in: [e.createdById, deciderId].filter((x): x is string => !!x) } },
      select: { id: true, name: true },
    });
    const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? null) : null);
    return {
      id: e.id,
      propertyName: property?.name ?? "—",
      head: e.head,
      subCategory: e.subCategory,
      description: e.description,
      quantity: e.quantity,
      amountPaise: Number(e.amountPaise),
      spentOn: e.spentOn.toISOString().slice(0, 10),
      paidVia: e.paidVia,
      vendor: e.vendor,
      gstNumber: e.gstNumber,
      status: e.status,
      hasBill: e.billObjectKey !== null,
      createdBy: nameOf(e.createdById),
      createdAt: e.createdAt.toISOString(),
      approvedBy: nameOf(deciderId),
      decidedAt: decision?.createdAt.toISOString() ?? null,
      rejectReason: decision?.action === "expense:reject" ? (decision.reason ?? null) : null,
    };
  });
}
