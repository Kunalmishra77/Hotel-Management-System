"use client";

/**
 * Accounting reconciliation view — 22 T-10 (FR-6/7/8, AC-7/8/10/12). Mobile-first,
 * admin-only. Shows per-provider sync status + last sync time, a failed queue with
 * per-row retry, and a provider/mode config form. Every action re-checks
 * permission server-side; the UI is cosmetic.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { configureAccounting, retrySync } from "../actions";
import type { ProviderSummary, ReconciliationRow } from "../queries";

export function AccountingView(props: {
  providers: ProviderSummary[];
  failed: ReconciliationRow[];
  recent: ReconciliationRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [provider, setProvider] = useState<"zoho" | "tally">("zoho");
  const [mode, setMode] = useState<"sandbox" | "live">("sandbox");
  const [credentialsRef, setCredentialsRef] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setMessage(null);
    start(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setMessage(res.error?.message ?? "Something went wrong.");
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Accounting sync</h1>
      {message && (
        <p role="alert" className="text-sm text-destructive" data-testid="accounting-message">
          {message}
        </p>
      )}

      {/* Provider / mode config (config not code) */}
      <Card>
        <CardContent className="space-y-2 p-3">
          <Label htmlFor="acc-provider">Provider &amp; mode</Label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="acc-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as "zoho" | "tally")}
              className="rounded-md border px-2 py-2 text-sm"
              data-testid="config-provider"
            >
              <option value="zoho">Zoho Books</option>
              <option value="tally">Tally</option>
            </select>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "sandbox" | "live")}
              className="rounded-md border px-2 py-2 text-sm"
              data-testid="config-mode"
            >
              <option value="sandbox">Sandbox</option>
              <option value="live">Live</option>
            </select>
            <Input
              value={credentialsRef}
              onChange={(e) => setCredentialsRef(e.target.value)}
              placeholder="credentials ref (vault://…)"
              className="w-48"
              data-testid="config-credentials"
            />
            <Button
              disabled={pending}
              onClick={() =>
                run(() =>
                  configureAccounting({
                    provider,
                    mode,
                    ...(credentialsRef ? { credentialsRef } : {}),
                  }),
                )
              }
              data-testid="config-save"
            >
              Save
            </Button>
          </div>
          {mode === "live" && (
            <p className="text-xs text-amber-700">
              Live needs the provider account/connector — see the runbook. Until wired, live
              pushes fail safely and stay retriable.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Per-provider status */}
      {props.providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sync activity yet.</p>
      ) : (
        <ul className="space-y-2" data-testid="provider-list">
          {props.providers.map((p) => (
            <li key={p.provider}>
              <Card data-testid={`provider-${p.provider}`}>
                <CardContent className="space-y-1 p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{p.provider}</p>
                    <span className="text-xs text-muted-foreground">{p.mode ?? "sandbox"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {p.synced} synced · {p.sandbox} sandbox · {p.pending} pending ·{" "}
                    <span className={p.failed > 0 ? "text-destructive" : ""}>{p.failed} failed</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    last sync {p.lastSyncAt ? new Date(p.lastSyncAt).toLocaleString() : "never"}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* Failed queue with retry */}
      {props.failed.length > 0 && (
        <Card data-testid="failed-queue">
          <CardContent className="space-y-2 p-3">
            <p className="font-medium text-destructive">Failed ({props.failed.length}) ⚠</p>
            <ul className="space-y-1">
              {props.failed.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    {f.provider} · {f.entityType} · {f.error ?? "push failed"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run(() => retrySync({ logId: f.id }))}
                    data-testid={`retry-${f.id}`}
                  >
                    Retry
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Recent activity */}
      {props.recent.length > 0 && (
        <Card data-testid="recent-activity">
          <CardContent className="space-y-1 p-3">
            <p className="text-sm font-medium">Recent</p>
            <ul className="text-xs text-muted-foreground">
              {props.recent.slice(0, 20).map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {r.entityType} · {r.provider}
                  </span>
                  <span>{r.status}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
