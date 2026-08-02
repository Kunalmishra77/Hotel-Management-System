"use client";

/**
 * Categories + quick room creation — 02 T-16 (AC-1/AC-2/AC-3).
 *
 * design.md: "Category form — name, rate (₹, numeric keypad), max adults/
 * children, HSN/SAC."
 *
 * The rate is entered in RUPEES and converted to integer paise once, in the
 * form action. Nothing below the boundary ever sees a decimal.
 */
import { useActionState, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";
import {
  createCategoryFormAction,
  createRoomFormAction,
  type CategoryFormState,
  type RoomFormState,
} from "../form-actions";
import type { CategoryListItem } from "../queries";

const CATEGORY_INITIAL: CategoryFormState = { status: "idle" };
const ROOM_INITIAL: RoomFormState = { status: "idle" };

export function CategoryManager({
  propertyId,
  categories,
  floors,
  canManage,
}: {
  propertyId: string;
  categories: CategoryListItem[];
  floors: { id: string; name: string }[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Categories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">No categories yet.</p>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="category-list">
              {categories.map((category) => (
                <li
                  key={category.id}
                  className="flex min-h-touch items-center justify-between gap-3 px-3 py-2"
                  data-testid={`category-${category.name}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{category.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {category.maxAdults} adult{category.maxAdults === 1 ? "" : "s"} ·{" "}
                      {category.maxChildren} child{category.maxChildren === 1 ? "" : "ren"}
                      {category.hsnSac ? ` · HSN ${category.hsnSac}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      {formatINR(category.baseRatePaise)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {category.roomCount} room{category.roomCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canManage && <CategoryForm propertyId={propertyId} />}
        </CardContent>
      </Card>

      {canManage && categories.length > 0 && (
        <RoomForm propertyId={propertyId} categories={categories} floors={floors} />
      )}
    </div>
  );
}

function CategoryForm({ propertyId }: { propertyId: string }) {
  const [state, submit, pending] = useActionState(createCategoryFormAction, CATEGORY_INITIAL);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "created") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={submit} className="space-y-3 border-t pt-3">
      <input type="hidden" name="propertyId" value={propertyId} />
      <p className="text-sm font-medium">Add a category</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cat-name">Name</Label>
          <Input id="cat-name" name="name" required maxLength={60} placeholder="Deluxe" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cat-rate">Nightly rate (₹)</Label>
          <Input
            id="cat-rate"
            name="baseRateRupees"
            required
            // Numeric keypad on a phone (mobile-first.md); decimal because a
            // rate may carry paise.
            inputMode="decimal"
            placeholder="4000"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="cat-adults">Max adults</Label>
          <Input id="cat-adults" name="maxAdults" inputMode="numeric" defaultValue={2} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cat-children">Max children</Label>
          <Input id="cat-children" name="maxChildren" inputMode="numeric" defaultValue={1} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cat-hsn">HSN/SAC</Label>
          <Input id="cat-hsn" name="hsnSac" inputMode="numeric" placeholder="996311" />
        </div>
      </div>

      {state.status === "error" && (
        <p id="category-error" role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      )}
      {state.status === "created" && (
        <p role="status" className="text-xs text-muted-foreground">
          Added &ldquo;{state.name}&rdquo;.
        </p>
      )}

      <Button type="submit" disabled={pending}>
        <Plus className="size-4" />
        {pending ? "Adding…" : "Add category"}
      </Button>
    </form>
  );
}

function RoomForm({
  propertyId,
  categories,
  floors,
}: {
  propertyId: string;
  categories: CategoryListItem[];
  floors: { id: string; name: string }[];
}) {
  const [state, submit, pending] = useActionState(createRoomFormAction, ROOM_INITIAL);
  const numberRef = useRef<HTMLInputElement>(null);

  // Clear and refocus after each add — rooms are entered a floor at a time.
  useEffect(() => {
    if (state.status === "created" && numberRef.current) {
      numberRef.current.value = "";
      numberRef.current.focus();
    }
  }, [state]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Add rooms</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={submit} className="space-y-3">
          <input type="hidden" name="propertyId" value={propertyId} />

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="room-number">Number</Label>
              <Input
                id="room-number"
                name="number"
                ref={numberRef}
                required
                maxLength={10}
                placeholder="101"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="room-category">Category</Label>
              <select
                id="room-category"
                name="categoryId"
                required
                className="flex min-h-touch w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="room-floor">Floor</Label>
              <select
                id="room-floor"
                name="floorId"
                className="flex min-h-touch w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">No floor</option>
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {state.status === "error" && (
            <p id="room-error" role="alert" className="text-xs text-destructive">
              {state.message}
            </p>
          )}
          {state.status === "created" && (
            <p role="status" className="text-xs text-muted-foreground">
              Added room {state.number}.
            </p>
          )}

          <Button type="submit" disabled={pending}>
            <Plus className="size-4" />
            {pending ? "Adding…" : "Add room"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
