"use server";

/**
 * `useActionState` adapters for the guest forms — 04 T-19/T-20 (FR-1/5, AC-1/3).
 *
 * The typed actions return `Result<T>`; React forms hand `(prevState, FormData)`.
 * These translate between the two so no component imports `Result` or the action
 * internals.
 *
 * The create adapter carries the module's one genuinely stateful UI flow: when
 * `createGuest` reports a probable duplicate (CONFLICT), we fetch the MASKED
 * candidates and return them so the form can render the resolution sheet
 * (open / create-anyway). "Create anyway" resubmits the same form with
 * `confirmDuplicate` set, which the same action honours.
 */
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createGuest } from "./actions";
import { addGuestId } from "./id-actions";
import { findGuestDuplicates, type DuplicateCandidate } from "./queries";

/** The values the user typed, echoed back so a re-render keeps the form filled. */
export type GuestDraft = {
  fullName: string;
  mobile: string;
  email: string;
  city: string;
  companyName: string;
};

export type GuestFormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> }
  | { status: "duplicate"; candidates: DuplicateCandidate[]; draft: GuestDraft };

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function readDraft(formData: FormData): GuestDraft {
  return {
    fullName: field(formData, "fullName"),
    mobile: field(formData, "mobile"),
    email: field(formData, "email"),
    city: field(formData, "city"),
    companyName: field(formData, "companyName"),
  };
}

/** Create a guest (AC-1); surfaces the dedupe sheet on a probable duplicate (AC-3). */
export async function createGuestFormAction(
  _prev: GuestFormState,
  formData: FormData,
): Promise<GuestFormState> {
  const draft = readDraft(formData);
  const confirmDuplicate = formData.get("confirmDuplicate") === "true";

  const result = await createGuest({
    fullName: draft.fullName,
    mobile: draft.mobile,
    email: draft.email || undefined,
    city: draft.city || undefined,
    companyName: draft.companyName || undefined,
    confirmDuplicate,
  });

  if (result.ok) redirect(`/guests/${result.data.id}`);

  // A probable duplicate: fetch the masked candidates for the resolution sheet.
  if (result.error.code === "CONFLICT" && !confirmDuplicate) {
    const user = await requireUser();
    const candidates = await findGuestDuplicates(user, {
      fullName: draft.fullName,
      mobile: draft.mobile,
      email: draft.email || null,
    });
    if (candidates.length > 0) return { status: "duplicate", candidates, draft };
  }

  return {
    status: "error",
    message: result.error.message,
    fieldErrors: result.error.fieldErrors,
  };
}

export type AddIdFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "added"; maskedValue: string };

/** Add a government ID to a guest (AC-4/5). Stays on the profile. */
export async function addGuestIdFormAction(
  _prev: AddIdFormState,
  formData: FormData,
): Promise<AddIdFormState> {
  const guestId = field(formData, "guestId");
  const type = field(formData, "type");
  const value = field(formData, "value");
  if (!guestId || !type || !value) return { status: "error", message: "Enter an ID type and number." };

  const result = await addGuestId({ guestId, type, value });
  if (!result.ok) return { status: "error", message: result.error.message };
  return { status: "added", maskedValue: result.data.maskedValue };
}
