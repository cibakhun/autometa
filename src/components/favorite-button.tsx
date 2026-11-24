"use client";

import { useState } from "react";
import { serialFetch } from "@/lib/serial-fetch";

/**
 * The heart on a listing: puts it on the watch list ("Merkliste") or takes it off. The first
 * click also creates the visitor's profile (a cookie), no sign-up.
 */
export function FavoriteButton({
  listingId,
  initial,
  variant = "overlay",
}: {
  listingId: number;
  initial: boolean;
  /** "overlay": round button on a photo; "inline": button with text, e.g. on the listing page. */
  variant?: "overlay" | "inline";
}) {
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (busy) return;
    const next = !saved;
    setBusy(true);
    setError(null);
    setSaved(next);
    try {
      const response = await serialFetch("/api/merkliste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, saved: next }),
      });
      const data = (await response.json().catch(() => ({}))) as { saved?: boolean; error?: string };
      if (!response.ok || typeof data.saved !== "boolean") throw new Error(data.error ?? "Speichern fehlgeschlagen");
      setSaved(data.saved);
    } catch (reason) {
      setSaved(!next);
      setError(reason instanceof Error ? reason.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const label = saved ? "Von der Merkliste nehmen" : "Auf die Merkliste";
  const heart = (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
      <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 7 4.5c2.1 0 3.7 1.2 5 3 1.3-1.8 2.9-3 5-3 3.6 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" />
    </svg>
  );

  if (variant === "inline") {
    return (
      <span className="inline-flex flex-col">
        <button
          type="button"
          onClick={toggle}
          aria-pressed={saved}
          disabled={busy}
          className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium ${
            saved ? "border-accent bg-accent-soft text-accent-strong" : "border-line hover:border-accent"
          }`}
        >
          <span className={saved ? "text-accent" : ""}>{heart}</span>
          {saved ? "Auf der Merkliste" : "Merken"}
        </button>
        {error && <span role="alert" className="mt-1 text-xs text-warn-text">{error}</span>}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={label}
      title={error ?? label}
      disabled={busy}
      className={`absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-surface/90 shadow-sm backdrop-blur hover:text-accent ${
        saved ? "text-accent" : "text-muted"
      } ${error ? "ring-2 ring-warn-line" : ""}`}
    >
      {heart}
    </button>
  );
}
