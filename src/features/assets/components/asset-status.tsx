"use client";
/** Change an asset's operational status (architecture v2 · Phase 5). */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAssetStatus } from "../actions";
import { ASSET_STATUSES } from "../schema";

const LABEL: Record<string, string> = {
  OPERATIONAL: "Operational",
  UNDER_REPAIR: "Under repair",
  OUT_OF_SERVICE: "Out of service",
};

export function AssetStatus({ assetId, status }: { assetId: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function change(next: string) {
    if (next === status) return;
    start(async () => {
      const res = await updateAssetStatus({ assetId, status: next });
      if (res.ok) router.refresh();
    });
  }

  return (
    <select
      value={status}
      onChange={(e) => change(e.target.value)}
      disabled={pending}
      aria-label="Asset status"
      className="rounded-md border bg-background px-2 py-1 text-xs font-medium"
    >
      {ASSET_STATUSES.map((s) => <option key={s} value={s}>{LABEL[s] ?? s}</option>)}
    </select>
  );
}
