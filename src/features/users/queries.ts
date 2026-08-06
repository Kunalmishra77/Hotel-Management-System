import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { usersDb, USER_ROW_SELECT, type UserRow } from "./internal";

/** Every user in the org (user-admin surface). Admin-only. */
export async function listUsers(): Promise<UserRow[]> {
  const user = await requireUser();
  authorize(user, "user:manage");
  return usersDb.user.findMany({
    where: { orgId: user.orgId, deletedAt: null },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: USER_ROW_SELECT,
  });
}

/** Properties in the org, for the role-scope selector. Admin-only. */
export async function listOrgProperties(): Promise<{ id: string; name: string }[]> {
  const user = await requireUser();
  authorize(user, "user:manage");
  return usersDb.property.findMany({
    where: { orgId: user.orgId, isActive: true, deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
