"use client";
/**
 * OTA-style property photo gallery. A featured image + a thumbnail grid; clicking
 * any photo opens a full-screen lightbox with prev/next. Falls back gracefully
 * when a property has few or no photos.
 */
import { useState, useCallback, useEffect } from "react";
import { ChevronLeft, ChevronRight, X, Images } from "lucide-react";

export function PropertyGallery({ images, alt }: { images: string[]; alt: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const has = images.length > 0;

  const close = useCallback(() => setOpen(null), []);
  const go = useCallback((d: number) => setOpen((i) => (i === null ? null : (i + d + images.length) % images.length)), [images.length]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, go]);

  if (!has) {
    return (
      <div className="grid h-64 place-items-center rounded-2xl border border-dashed bg-muted/30 text-muted-foreground sm:h-80">
        <span className="inline-flex items-center gap-2 text-sm"><Images className="size-5" aria-hidden="true" /> Photos coming soon</span>
      </div>
    );
  }

  const [hero, ...rest] = images;
  const thumbs = rest.slice(0, 4);

  return (
    <>
      <div className="grid gap-2 overflow-hidden rounded-2xl sm:grid-cols-2 sm:gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={hero}
          alt={alt}
          loading="eager"
          onClick={() => setOpen(0)}
          className="h-60 w-full cursor-pointer object-cover transition hover:brightness-95 sm:h-[26rem]"
        />
        {thumbs.length > 0 && (
          <div className="hidden grid-cols-2 gap-2 sm:grid">
            {thumbs.map((src, i) => (
              <button key={src} type="button" onClick={() => setOpen(i + 1)} className="relative overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`${alt} — photo ${i + 2}`} loading="lazy" className="h-[12.6rem] w-full cursor-pointer object-cover transition hover:brightness-95" />
                {i === thumbs.length - 1 && images.length > 5 && (
                  <span className="absolute inset-0 grid place-items-center bg-black/45 text-sm font-medium text-white">
                    +{images.length - 5} photos
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {open !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4" role="dialog" aria-label="Photo viewer" onClick={close}>
          <button type="button" onClick={close} aria-label="Close" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
            <X className="size-5" />
          </button>
          {images.length > 1 && (
            <button type="button" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Previous" className="absolute left-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
              <ChevronLeft className="size-6" />
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={images[open]} alt={`${alt} — photo ${open + 1}`} className="max-h-[85dvh] max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          {images.length > 1 && (
            <button type="button" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Next" className="absolute right-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
              <ChevronRight className="size-6" />
            </button>
          )}
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white">{open + 1} / {images.length}</span>
        </div>
      )}
    </>
  );
}
