"use client";

/**
 * Org security-policy editor (16). Password/lockout/session limits, the audited
 * discount threshold (entered in ₹), and per-role 2FA enforcement. These are the
 * SOURCE the auth/lockout/session code reads — not constants.
 */
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS, ROLE_ORDER } from "@/features/users/roles";
import { updateSecuritySettingsFormAction, type SecuritySettingsFormState } from "../form-actions";
import type { OrgSecuritySettings } from "../queries";

const INITIAL: SecuritySettingsFormState = { status: "idle" };

export function SecuritySettingsForm({ settings }: { settings: OrgSecuritySettings }) {
  const [state, submit, pending] = useActionState(updateSecuritySettingsFormAction, INITIAL);
  const enforced = new Set(settings.enforced2faRoles);

  return (
    <form action={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField id="passwordMinLength" label="Min password length" defaultValue={settings.passwordMinLength} min={8} max={64} />
        <NumberField id="lockoutThreshold" label="Lock out after N failed logins" defaultValue={settings.lockoutThreshold} min={3} max={20} />
        <NumberField id="sessionTtlMinutes" label="Session timeout (minutes)" defaultValue={settings.sessionTtlMinutes} min={15} max={10080} />
        <NumberField
          id="discountThresholdRupees"
          label="Audited discount threshold (₹)"
          defaultValue={Math.round(settings.discountThresholdPaise / 100)}
          min={0}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Enforce 2FA for roles</legend>
        <p className="text-sm text-muted-foreground">
          Users in a checked role must set up an authenticator. Leave all unchecked to keep 2FA optional.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="enforce-2fa">
          {ROLE_ORDER.map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="enforced2faRoles"
                value={role}
                defaultChecked={enforced.has(role)}
                className="size-4 rounded border-input accent-primary"
              />
              {ROLE_LABELS[role]}
            </label>
          ))}
        </div>
      </fieldset>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-destructive" data-testid="settings-error">
          {state.message}
        </p>
      ) : null}
      {state.status === "saved" ? (
        <p className="text-sm text-success" data-testid="settings-saved">
          Saved. New sign-ins use the updated policy.
        </p>
      ) : null}

      <Button type="submit" disabled={pending} data-testid="save-settings">
        {pending ? "Saving…" : "Save security policy"}
      </Button>
    </form>
  );
}

function NumberField({
  id,
  label,
  defaultValue,
  min,
  max,
}: {
  id: string;
  label: string;
  defaultValue: number;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} type="number" defaultValue={defaultValue} min={min} max={max} inputMode="numeric" />
    </div>
  );
}
