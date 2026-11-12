"use server";

/**
 * Historical data-entry actions (26 objective — "complete guest database" from the
 * client's existing paper records). Two steps, both server-side + authorized:
 *  1. extractGuestFieldsAction — proposes fields from the record's text with a
 *     built-in parser (no AI needed, client 12 Nov 2026); an AI provider, if one
 *     is ever configured, only fills what the parser left empty. Staff always
 *     review before saving.
 *  2. dataEntryCreateGuestAction — creates the guest and, when an ID document
 *     photo is attached, stores it via the guest-ID path (encrypted, masked).
 * The source photo is captured with the record so there is an auditable original.
 */
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { toResult, type Result } from "@/lib/result";
import { extractGuestFields, type GuestFields } from "@/features/ai/guest-extract";
import { parseGuestRecord } from "./domain/record-parse";
import { createGuest } from "./actions";
import { addGuestId } from "./id-actions";
import { findSameGuest } from "./internal";
import type { GuestFormState } from "./form-actions";

/** Propose guest fields from pasted record text (never auto-saves). Works with no AI. */
export async function extractGuestFieldsAction(recordText: string): Promise<Result<GuestFields>> {
  return toResult(async () => {
    const user = await requireUser();
    authorize(user, "guest:create");
    const text = (recordText ?? "").trim();
    if (!text) return {} as GuestFields;
    const parsed = parseGuestRecord(text.slice(0, 4000));
    // Optional extra from an AI provider: only fills gaps, and its absence or
    // failure is silent — auto-fill never depends on it.
    let ai: GuestFields = {};
    try { ai = await extractGuestFields(text.slice(0, 4000)); } catch { ai = {}; }
    const out: GuestFields = { ...parsed };
    for (const [k, v] of Object.entries(ai) as [keyof GuestFields, string | undefined][]) if (v && !out[k]) out[k] = v;
    return out;
  });
}

function field(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Create a guest from a historical record. The interactive "possible duplicate"
 * prompt is skipped (`confirmDuplicate`) so bulk entry flows, BUT a guest with the
 * same mobile/email AND the same name is the same person — that profile is reused
 * (and the ID photo attached to it) instead of minting a duplicate. An attached
 * ID photo is stored after.
 */
export async function dataEntryCreateGuestAction(
  _prev: GuestFormState,
  formData: FormData,
): Promise<GuestFormState> {
  const mobile = field(formData, "mobile");
  const user = await requireUser();
  authorize(user, "guest:create");
  const existingId = await findSameGuest(user.orgId, {
    fullName: field(formData, "fullName"),
    mobile,
    email: field(formData, "email") || null,
  });
  if (existingId) {
    await attachIdPhoto(existingId, formData);
    redirect(`/guests/${existingId}`);
  }

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

  await attachIdPhoto(result.data.id, formData);
  redirect(`/guests/${result.data.id}`);
}

/** Optional: attach the source ID photo (encrypted, masked) to the guest. */
async function attachIdPhoto(guestId: string, formData: FormData): Promise<void> {
  const idType = field(formData, "idType");
  const scanBase64 = typeof formData.get("scanBase64") === "string" ? (formData.get("scanBase64") as string) : "";
  if (idType && scanBase64) {
    await addGuestId({
      guestId,
      type: idType,
      scanBase64,
      scanContentType: field(formData, "scanContentType") || "image/jpeg",
    });
  }
}
