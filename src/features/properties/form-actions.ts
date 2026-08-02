"use server";

/**
 * `useActionState` adapters — 01 T-14/T-15 (AC-1/3/4).
 *
 * The typed actions take a validated object and return `Result<T>`; React forms
 * hand you `(prevState, FormData)`. These translate between the two and shape
 * the outcome for rendering, so no component has to know about `Result`.
 *
 * Field-level errors are surfaced as a `fieldErrors` map so the form can mark
 * the offending input rather than showing one message at the top — AC-3 asks
 * for a *field* error on a bad GSTIN, and AC-10 for field messages generally.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { createProperty, deactivateProperty, updateProperty } from "./actions";
import { addFloor } from "./floor-actions";
import { createPropertySchema, updatePropertySchema } from "./schema";
import { field } from "./internal";

export type PropertyFormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

export type FloorFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "added"; name: string };

/** Pull the property fields out of a submitted form. */
function readPropertyFields(formData: FormData) {
  return {
    name: field(formData, "name"),
    code: field(formData, "code"),
    addressLine1: field(formData, "addressLine1"),
    addressLine2: field(formData, "addressLine2") ?? null,
    city: field(formData, "city"),
    state: field(formData, "state"),
    country: field(formData, "country") ?? "India",
    pincode: field(formData, "pincode"),
    timezone: field(formData, "timezone") ?? "Asia/Kolkata",
    gstin: field(formData, "gstin") ?? null,
    ownerName: field(formData, "ownerName") ?? null,
    ownerContact: field(formData, "ownerContact") ?? null,
  };
}

function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  return error.flatten().fieldErrors as Record<string, string[]>;
}

/** Create (AC-1/2/3/10). Redirects to the new property on success. */
export async function createPropertyFormAction(
  _prev: PropertyFormState,
  formData: FormData,
): Promise<PropertyFormState> {
  const parsed = createPropertySchema.safeParse(readPropertyFields(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  const result = await createProperty(parsed.data);
  if (!result.ok) {
    // A duplicate code is a field problem, not a page-level one (AC-2).
    const isCodeConflict = result.error.code === "CONFLICT";
    return {
      status: "error",
      message: result.error.message,
      ...(isCodeConflict ? { fieldErrors: { code: [result.error.message] } } : {}),
    };
  }

  redirect(`/properties/${result.data.id}`);
}

/** Edit (AC-2/3). */
export async function updatePropertyFormAction(
  _prev: PropertyFormState,
  formData: FormData,
): Promise<PropertyFormState> {
  const id = field(formData, "id");
  if (!id) return { status: "error", message: "Missing property id." };

  const parsed = updatePropertySchema.safeParse({ id, ...readPropertyFields(formData) });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  const result = await updateProperty(parsed.data);
  if (!result.ok) {
    const isCodeConflict = result.error.code === "CONFLICT";
    return {
      status: "error",
      message: result.error.message,
      ...(isCodeConflict ? { fieldErrors: { code: [result.error.message] } } : {}),
    };
  }

  redirect(`/properties/${id}`);
}

/** Add a floor (AC-4). Stays on the page so several can be added in a row. */
export async function addFloorFormAction(
  _prev: FloorFormState,
  formData: FormData,
): Promise<FloorFormState> {
  const propertyId = field(formData, "propertyId");
  const name = field(formData, "name");

  if (!propertyId) return { status: "error", message: "Missing property." };
  if (!name) return { status: "error", message: "Enter a floor name." };

  const result = await addFloor({ propertyId, name });
  if (!result.ok) return { status: "error", message: result.error.message };

  return { status: "added", name: result.data.name };
}

export type DeactivateState = { status: "idle" } | { status: "error"; message: string };

/** Deactivate (AC-5). */
export async function deactivatePropertyFormAction(
  _prev: DeactivateState,
  formData: FormData,
): Promise<DeactivateState> {
  const id = field(formData, "id");
  if (!id) return { status: "error", message: "Missing property id." };

  const result = await deactivateProperty({ id, reason: field(formData, "reason") ?? null });
  if (!result.ok) return { status: "error", message: result.error.message };

  redirect("/properties");
}
