"use client";

/**
 * Public guest feedback form (#26) — short and non-irritating: overall rating,
 * one optional comment, an optional "would recommend". On submit it thanks the
 * guest and nudges a direct booking next time (reduce OTA dependence).
 */
import { useState, useTransition } from "react";
import { submitPublicReview } from "../public-actions";

function Stars({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            className={`text-3xl leading-none transition-transform hover:scale-110 ${n <= value ? "text-amber-400" : "text-slate-300 dark:text-slate-600"}`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReviewForm({ token, guestName, propertyName, bookUrl }: { token: string; guestName: string; propertyName: string; bookUrl: string }) {
  const [rating, setRating] = useState(0);
  const [recommend, setRecommend] = useState(0);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function submit() {
    setError(null);
    start(async () => {
      const res = await submitPublicReview({ token, rating, comment, recommend: recommend || undefined });
      if (!res.ok) { setError(res.error.message); return; }
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <div className="text-5xl">🙏</div>
        <h2 className="text-xl font-semibold">Thank you{guestName ? `, ${guestName}` : ""}!</h2>
        <p className="text-sm text-muted-foreground">Your feedback helps us serve you better.</p>
        <div className="rounded-xl border bg-primary/5 p-4">
          <p className="text-sm font-medium">Loved your stay?</p>
          <p className="mt-1 text-sm text-muted-foreground">Book us <span className="font-medium text-foreground">directly</span> next time for our best direct-guest rate — better than MakeMyTrip or Goibibo.</p>
          <a href={bookUrl} className="mt-3 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Book direct &amp; save →</a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">How was your stay?</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{propertyName} · a quick 30-second review{guestName ? `, ${guestName}` : ""}.</p>
      </div>
      <Stars value={rating} onChange={setRating} label="Overall experience" />
      <div>
        <label htmlFor="rv-comment" className="mb-1.5 block text-sm font-medium">Anything that stood out, or we could do better? <span className="font-normal text-muted-foreground">(optional)</span></label>
        <textarea id="rv-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={1000}
          className="w-full rounded-md border border-input bg-background p-3 text-sm" placeholder="Your thoughts…" />
      </div>
      <Stars value={recommend} onChange={setRecommend} label="How likely are you to recommend us? (optional)" />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button type="button" onClick={submit} disabled={pending || rating === 0}
        className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {pending ? "Sending…" : "Submit feedback"}
      </button>
      {rating === 0 && <p className="text-center text-xs text-muted-foreground">Tap a star to rate your stay.</p>}
    </div>
  );
}
