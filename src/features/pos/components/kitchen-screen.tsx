"use client";

/**
 * Kitchen prep list — 19 (FR-13, AC-12). One aggregated line per menu item across
 * all open orders, so the line cooks "12 × Masala Dosa" not twelve tickets. Read
 * -only; a manual refresh re-pulls (live LISTEN/NOTIFY push is a 17 concern).
 */
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PrepLine } from "../domain/kot";

export function KitchenScreen({ prep }: { prep: PrepLine[] }) {
  const router = useRouter();
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Kitchen</h1>
        <Button size="sm" variant="outline" onClick={() => router.refresh()} data-testid="kitchen-refresh">Refresh</Button>
      </div>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Prep queue</CardTitle></CardHeader>
        <CardContent>
          {prep.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to prepare right now.</p>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="kitchen-prep">
              {prep.map((p) => (
                <li key={p.key} className="flex items-center justify-between p-3 text-base" data-testid={`prep-${p.key}`}>
                  <span className="font-medium">{p.name}</span>
                  <span className="font-semibold">×{p.quantity}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
