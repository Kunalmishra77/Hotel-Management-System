"use server";

/**
 * `useActionState` adapters for the room forms — 02 T-16 (AC-1).
 */
import { revalidatePath } from "next/cache";
import { createCategory } from "./actions";
import { createRoom } from "./actions";

export type CategoryFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "created"; name: string };

/**
 * Rupees → paise, converted ONCE at the boundary.
 *
 * data-model.md: money is integer paise everywhere inward. `Math.round` on the
 * scaled value avoids the classic float artefact — `4000.1 * 100` is
 * 400010.00000000006, and a truncation would quietly lose a paisa on every
 * such rate.
 */
function rupeesToPaise(input: string | null): number | null {
  if (!input) return null;
  const rupees = Number(input.replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(rupees) || rupees < 0) return null;
  return Math.round(rupees * 100);
}

function field(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function intField(formData: FormData, name: string, fallback: number): number {
  const raw = field(formData, name);
  const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

/** Create a category (AC-1). */
export async function createCategoryFormAction(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const propertyId = field(formData, "propertyId");
  const name = field(formData, "name");
  const baseRatePaise = rupeesToPaise(field(formData, "baseRateRupees"));

  if (!propertyId) return { status: "error", message: "Missing property." };
  if (!name) return { status: "error", message: "Enter a category name." };
  if (baseRatePaise === null) {
    return { status: "error", message: "Enter a valid nightly rate in rupees." };
  }

  const result = await createCategory({
    propertyId,
    name,
    baseRatePaise,
    maxAdults: intField(formData, "maxAdults", 2),
    maxChildren: intField(formData, "maxChildren", 1),
    hsnSac: field(formData, "hsnSac"),
    gstBps: intField(formData, "gstBps", 1200),
  });

  if (!result.ok) return { status: "error", message: result.error.message };

  revalidatePath("/rooms/categories");
  return { status: "created", name: result.data.name };
}

export type RoomFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "created"; number: string };

/** Create a room (AC-2/AC-3). Stays on the page so a floor can be added in a run. */
export async function createRoomFormAction(
  _prev: RoomFormState,
  formData: FormData,
): Promise<RoomFormState> {
  const propertyId = field(formData, "propertyId");
  const categoryId = field(formData, "categoryId");
  const number = field(formData, "number");

  if (!propertyId) return { status: "error", message: "Missing property." };
  if (!categoryId) return { status: "error", message: "Choose a category." };
  if (!number) return { status: "error", message: "Enter a room number." };

  const result = await createRoom({
    propertyId,
    categoryId,
    number,
    floorId: field(formData, "floorId"),
  });

  if (!result.ok) return { status: "error", message: result.error.message };

  revalidatePath("/rooms");
  revalidatePath("/rooms/categories");
  return { status: "created", number: result.data.number };
}
