"use client";

/** The Form C step on its own page (missed at check-in) — back to the register when saved. */
import { useState } from "react";
import Link from "next/link";
import { CFormStep } from "./check-in-cform-step";
import type { CheckInContext } from "../queries";

export function FormCStandalone({ context }: { context: CheckInContext }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="space-y-4">
      <CFormStep context={context} saved={saved} onSaved={() => setSaved(true)} />
      {saved ? (
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/bookings/form-c" className="font-medium text-primary underline-offset-4 hover:underline">Back to the Form C register</Link>
          <Link href={`/bookings/${context.id}`} className="text-muted-foreground underline-offset-4 hover:underline">Open the booking</Link>
        </div>
      ) : null}
    </div>
  );
}
