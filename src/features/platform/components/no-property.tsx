import Link from "next/link";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shared empty state for the many per-property pages when the caller has no
 * active property (a fresh org, or a role assigned no property). Replaces the
 * bare "Select a property" dead-ends with a real next step: create one (if
 * allowed) or ask an admin — plus a pointer to the header switcher.
 */
export function NoProperty({ what, canCreate }: { what: string; canCreate: boolean }) {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-lg border border-dashed p-8 text-center">
      <Building2 className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="mt-3 text-base font-semibold">No property selected</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {what} is shown per property.{" "}
        {canCreate
          ? "Create your first property to get started, or pick one from the switcher at the top of the page."
          : "Ask an administrator to assign you to a property, then pick it from the switcher at the top of the page."}
      </p>
      {canCreate && (
        <Button asChild className="mt-4">
          <Link href="/properties/new">Create a property</Link>
        </Button>
      )}
    </div>
  );
}
