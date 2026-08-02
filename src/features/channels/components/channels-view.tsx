"use client";

/**
 * Channels view — 13 T-20/T-21 (FR-1/4/17/19, AC-1/2/3/12/15/16). Mobile-first.
 * Connect a channel (sandbox), map external room types → internal categories,
 * go live (disabled until certified), and work the needs-attention (oversell)
 * queue. Every action re-checks permission server-side; the UI is cosmetic.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  activateChannel,
  connectChannel,
  mapRoomType,
  resolveAttention,
} from "../actions";
import type { AttentionItem, ChannelHealth, MappingRow } from "../queries";

type Category = { id: string; name: string };

export function ChannelsView(props: {
  propertyId: string;
  health: ChannelHealth[];
  attention: AttentionItem[];
  categories: Category[];
  mappingsByAccount: Record<string, MappingRow[]>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [newProvider, setNewProvider] = useState("booking_com");

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
      <h1 className="text-xl font-semibold">Channels</h1>
      {message && (
        <p role="alert" className="text-sm text-destructive" data-testid="channel-message">
          {message}
        </p>
      )}

      {/* Connect a new channel */}
      <Card>
        <CardContent className="space-y-2 p-3">
          <Label htmlFor="provider">Connect a channel (sandbox)</Label>
          <div className="flex gap-2">
            <Input
              id="provider"
              value={newProvider}
              onChange={(e) => setNewProvider(e.target.value)}
              placeholder="booking_com"
              inputMode="text"
              data-testid="connect-provider"
            />
            <Button
              disabled={pending}
              onClick={() => run(() => connectChannel({ propertyId: props.propertyId, provider: newProvider }))}
              data-testid="connect-submit"
            >
              Connect
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Needs-attention (oversell) queue */}
      {props.attention.length > 0 && (
        <Card data-testid="attention-queue">
          <CardContent className="space-y-2 p-3">
            <p className="font-medium text-amber-700">
              Needs attention ({props.attention.length}) ⚠
            </p>
            <ul className="space-y-1">
              {props.attention.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {a.reason ?? "OVERSELL"} · {a.provider} · {a.externalId}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run(() => resolveAttention({ syncLogId: a.id }))}
                    data-testid={`resolve-${a.externalId}`}
                  >
                    Resolve
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Channel health + mapping */}
      {props.health.length === 0 ? (
        <p className="text-sm text-muted-foreground">No channels connected yet.</p>
      ) : (
        <ul className="space-y-3" data-testid="channel-list">
          {props.health.map((h) => (
            <li key={h.id}>
              <Card data-testid={`channel-${h.provider}`}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{h.provider}</p>
                    <span className="text-xs" data-testid={`state-${h.provider}`}>
                      {h.isActive ? "● live" : "● sandbox"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    last sync {h.lastSyncAt ? new Date(h.lastSyncAt).toLocaleString() : "never"} ·{" "}
                    {h.pendingCount} pending · {h.deadLetterCount} dead · {h.needsAttentionCount} attn
                  </p>

                  <MappingEditor
                    accountId={h.id}
                    categories={props.categories}
                    mappings={props.mappingsByAccount[h.id] ?? []}
                    pending={pending}
                    onMap={(input) => run(() => mapRoomType(input))}
                  />

                  {!h.isActive && (
                    <Button
                      size="sm"
                      disabled={pending || !h.certified}
                      title={h.certified ? "Go live" : "Certify the channel first"}
                      onClick={() => run(() => activateChannel({ channelAccountId: h.id }))}
                      data-testid={`activate-${h.provider}`}
                    >
                      {h.certified ? "Go live" : "Live (needs certification)"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MappingEditor(props: {
  accountId: string;
  categories: Category[];
  mappings: MappingRow[];
  pending: boolean;
  onMap: (input: { channelAccountId: string; externalRoomType: string; roomCategoryId: string }) => void;
}) {
  const [externalRoomType, setExternalRoomType] = useState("");
  const [roomCategoryId, setRoomCategoryId] = useState(props.categories[0]?.id ?? "");

  return (
    <div className="space-y-1 rounded-md border p-2">
      <p className="text-xs font-medium">Room-type mapping</p>
      {props.mappings.length > 0 && (
        <ul className="text-xs text-muted-foreground">
          {props.mappings.map((m) => {
            const cat = props.categories.find((c) => c.id === m.roomCategoryId);
            return (
              <li key={m.id} data-testid={`mapping-${m.externalRoomType}`}>
                {m.externalRoomType} → {cat?.name ?? m.roomCategoryId}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          value={externalRoomType}
          onChange={(e) => setExternalRoomType(e.target.value)}
          placeholder="DLX-BB"
          className="w-28"
          data-testid={`map-external-${props.accountId}`}
        />
        <select
          value={roomCategoryId}
          onChange={(e) => setRoomCategoryId(e.target.value)}
          className="rounded-md border px-2 text-sm"
          data-testid={`map-category-${props.accountId}`}
        >
          {props.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={props.pending || !externalRoomType || !roomCategoryId}
          onClick={() =>
            props.onMap({ channelAccountId: props.accountId, externalRoomType, roomCategoryId })
          }
          data-testid={`map-submit-${props.accountId}`}
        >
          Map
        </Button>
      </div>
    </div>
  );
}
