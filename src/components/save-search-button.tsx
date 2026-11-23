"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * "Suche speichern" above the results: keeps the current filters as a saved search. Pushes for
 * new matches are set up on /suchauftraege.
 */
export function SaveSearchButton({ query, saved }: { query: string; saved: { id: number; name: string } | null }) {
  const [state, setState] = useState<{ id: number; name: string } | null>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/suchauftraege", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = (await response.json().catch(() => ({}))) as { id?: number; name?: string; error?: string };
      if (!response.ok || typeof data.id !== "number") throw new Error(data.error ?? "Speichern fehlgeschlagen");
      setState({ id: data.id, name: data.name ?? "" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  if (state) {
    return (
      <Link
        href={`/suchauftraege#suche-${state.id}`}
        className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent-strong"
        title={state.name}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        Suchauftrag gespeichert
      </Link>
    );
  }
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent disabled:opacity-60"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {busy ? "Speichere …" : "Suche speichern"}
      </button>
      {error && <span role="alert" className="mt-1 text-xs text-warn-text">{error}</span>}
    </span>
  );
}
