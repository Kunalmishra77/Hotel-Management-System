"use server";

/** `useActionState` adapter for the security-settings form (16). */
import { updateSecuritySettings } from "./actions";

export type SecuritySettingsFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "saved" };

function num(fd: FormData, name: string): number {
  const v = fd.get(name);
  return typeof v === "string" && v.trim() !== "" ? Number(v) : 0;
}

export async function updateSecuritySettingsFormAction(
  _prev: SecuritySettingsFormState,
  formData: FormData,
): Promise<SecuritySettingsFormState> {
  const enforced2faRoles = formData.getAll("enforced2faRoles").map(String);
  const res = await updateSecuritySettings({
    passwordMinLength: num(formData, "passwordMinLength"),
    lockoutThreshold: num(formData, "lockoutThreshold"),
    sessionTtlMinutes: num(formData, "sessionTtlMinutes"),
    // The threshold is entered in ₹ for readability; stored as paise.
    discountThresholdPaise: Math.round(num(formData, "discountThresholdRupees") * 100),
    enforced2faRoles,
  });
  if (!res.ok) return { status: "error", message: res.error.message };
  return { status: "saved" };
}
