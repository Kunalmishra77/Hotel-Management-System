/**
 * Org security-settings read (16). `settings:manage` only. Returns seed defaults
 * if the row is somehow absent so the editor always renders.
 */
import { authorize } from "@/lib/permissions";
import { assertOrgWide, settingsDb } from "./internal";
import type { SessionClaims } from "@/lib/auth/claims";

export type OrgSecuritySettings = {
  passwordMinLength: number;
  lockoutThreshold: number;
  sessionTtlMinutes: number;
  discountThresholdPaise: number;
  enforced2faRoles: string[];
};

export async function getOrgSecuritySettings(user: SessionClaims): Promise<OrgSecuritySettings> {
  authorize(user, "settings:manage");
  assertOrgWide(user);
  const s = await settingsDb.securitySettings.findUnique({ where: { orgId: user.orgId } });
  return {
    passwordMinLength: s?.passwordMinLength ?? 10,
    lockoutThreshold: s?.lockoutThreshold ?? 5,
    sessionTtlMinutes: s?.sessionTtlMinutes ?? 480,
    discountThresholdPaise: s?.discountThresholdPaise ?? 100_000,
    enforced2faRoles: s?.enforced2faRoles ?? [],
  };
}
