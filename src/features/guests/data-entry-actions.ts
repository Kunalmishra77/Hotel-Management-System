"use server";

/**
 * Historical data-entry actions (26 objective — "complete guest database" from the
 * client's existing paper records). Two steps, both server-side + authorized:
 *  1. extractGuestFieldsAction — optional AI-assist that proposes fields from the
 *     record's text (empty with the mock provider; a configured provider fills
 *     what it can read). Staff always review before saving.
 *  2. dataEntryCreateGuestAction — creates the guest and, when an ID document
 *     photo is attached, stores it via the guest-ID path (encrypted, masked).
 * The source photo is captured with the record so there is an auditable original.
 */
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { toResult, type Result } from "@/lib/result";
import { extractGuestFields, type GuestFields } from "@/features/ai/guest-extract";
import { createGuest } from "./actions";
import { addGuestId } from "./id-actions";
import type { GuestFormState } from "./form-actions";

/** AI-assist: propose guest fields from pasted record text (never auto-saves). */
export async function extractGuestFieldsAction(recordText: string): Promise<Result<GuestFields>> {
  return toResult(async () => {
    const user = await requireUser();
    authorize(user, "guest:create");
    const text = (recordText ?? "").trim();
    if (!text) return {} as GuestFields;
    return extractGuestFields(text.slice(0, 4000));
  });
}

function field(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Create a guest from a historical record. Dedupe guard is lifted
 * (`confirmDuplicate`) — historical entry deliberately creates the record; any
 * duplicate is reconciled later via merge. An attached ID photo is stored after.
 */
export async function dataEntryCreateGuestAction(
  _prev: GuestFormState,
  formData: FormData,
): Promise<GuestFormState> {
  const mobile = field(formData, "mobile");
  const result = await createGuest({
    fullName: field(formData, "fullName"),
    mobile,
    email: field(formData, "email") || undefined,
    dob: field(formData, "dob") || undefined,
    gender: field(formData, "gender") || undefined,
    nationality: field(formData, "nationality") || undefined,
    occupation: field(formData, "occupation") || undefined,
    addressLine: field(formData, "addressLine") || undefined,
    city: field(formData, "city") || undefined,
    state: field(formData, "state") || undefined,
    country: field(formData, "country") || undefined,
    pincode: field(formData, "pincode") || undefined,
    companyName: field(formData, "companyName") || undefined,
    gstNumber: field(formData, "gstNumber") || undefined,
    purposeOfVisit: field(formData, "purposeOfVisit") || undefined,
    confirmDuplicate: true,
  });

  if (!result.ok) {
    return { status: "error", message: result.error.message, fieldErrors: result.error.fieldErrors };
  }

  // Optional: attach the source ID photo (encrypted, masked) to the new guest.
  const idType = field(formData, "idType");
  const scanBase64 = typeof formData.get("scanBase64") === "string" ? (formData.get("scanBase64") as string) : "";
  if (idType && scanBase64) {
    await addGuestId({
      guestId: result.data.id,
      type: idType,
      scanBase64,
      scanContentType: field(formData, "scanContentType") || "image/jpeg",
    });
  }

  redirect(`/guests/${result.data.id}`);
}
