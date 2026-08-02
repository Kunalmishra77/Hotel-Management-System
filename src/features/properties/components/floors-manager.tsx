"use client";

/**
 * Floors management — 01 T-15 (FR-4, AC-4).
 *
 * Add-in-place: the form stays put after a successful add so several floors can
 * be entered in a row, which is how this is actually used (Ground, 1, 2, 3…).
 * A duplicate name is rejected by the DB unique constraint and surfaced here.
 */
import { useActionState, useEffect, useRef } from "react";
import { Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addFloorFormAction, type FloorFormState } from "../form-actions";
import type { FloorListItem } from "../queries";

const INITIAL: FloorFormState = { status: "idle" };

export function FloorsManager({
  propertyId,
  floors,
  canManage,
}: {
  propertyId: string;
  floors: FloorListItem[];
  canManage: boolean;
}) {
  const [state, submit, pending] = useActionState(addFloorFormAction, INITIAL);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear and refocus after a successful add so the next name can be typed
  // straight away — no reaching for the mouse between floors.
  useEffect(() => {
    if (state.status === "added" && inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.focus();
    }
  }, [state]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
          Floors
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {floors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No floors yet.</p>
        ) : (
          <ol className="divide-y rounded-md border" data-testid="floor-list">
            {floors.map((floor) => (
              <li
                key={floor.id}
                className="flex min-h-touch items-center justify-between gap-3 px-3 py-2 text-sm"
                data-testid={`floor-${floor.name}`}
              >
                <span className="font-medium">{floor.name}</span>
                <span className="text-xs text-muted-foreground">#{floor.sortOrder}</span>
              </li>
            ))}
          </ol>
        )}

        {canManage && (
          <form action={submit} className="space-y-2">
            <input type="hidden" name="propertyId" value={propertyId} />
            <Label htmlFor="floor-name">Add a floor</Label>
            <div className="flex gap-2">
              <Input
                id="floor-name"
                name="name"
                ref={inputRef}
                placeholder="Ground, 1, 2…"
                maxLength={40}
                required
                aria-invalid={state.status === "error"}
                aria-describedby={state.status === "error" ? "floor-error" : undefined}
              />
              <Button type="submit" disabled={pending} aria-label="Add floor">
                <Plus className="size-4" />
                <span className="sr-only sm:not-sr-only">Add</span>
              </Button>
            </div>

            {state.status === "error" && (
              <p id="floor-error" role="alert" className="text-xs text-destructive">
                {state.message}
              </p>
            )}
            {state.status === "added" && (
              <p role="status" className="text-xs text-muted-foreground">
                Added &ldquo;{state.name}&rdquo;.
              </p>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
