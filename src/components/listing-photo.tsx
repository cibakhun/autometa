"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The preview photo of a listing, loaded straight from the portal's image server: we only keep
 * its address, never a copy. Without a photo, or when the portal does not deliver it, a quiet
 * placeholder takes its place so the cards keep their shape.
 */
export function ListingPhoto({ src, alt, className = "" }: { src: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // A photo that failed before the page became interactive fired its error event unheard.
  useEffect(() => {
    if (img.current?.complete && img.current.naturalWidth === 0) setFailed(true);
  }, []);
  const frame = `relative overflow-hidden bg-background ${className}`;

  if (!src || failed) {
    return (
      <div className={`${frame} flex items-center justify-center text-muted`} aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-10 w-10 opacity-40" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 13l2-5a2 2 0 0 1 1.9-1.3h10.2A2 2 0 0 1 19 8l2 5v4a1 1 0 0 1-1 1h-1.5M3 13v4a1 1 0 0 0 1 1h1.5M3 13h18" />
          <circle cx="7.5" cy="17.5" r="1.5" />
          <circle cx="16.5" cy="17.5" r="1.5" />
          <path d="M9 17.5h6" />
        </svg>
      </div>
    );
  }

  return (
    <div className={frame}>
      {/* A plain img on purpose: next/image would fetch and re-serve the portal's photo through our server. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={img} src={src} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailed(true)} />
    </div>
  );
}
