"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Shown instead of a page that failed to render, mostly because the database did not answer in
 * time. retry() fetches the page again from the server; the header and footer stay.
 */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  // Server errors reach the browser without their message, only with a digest that matches the server log.
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  return (
    <div role="alert" className="mx-auto max-w-xl rounded-xl border border-line bg-surface p-6 text-center">
      <title>Fehler – AutoMeta</title>
      <h1 className="text-2xl font-bold">Da ist etwas schiefgelaufen</h1>
      <p className="mt-2 text-sm text-muted">
        Die Seite ließ sich gerade nicht laden, meist weil die Datenbank kurz nicht antwortet. Versuch es in ein paar Sekunden noch
        einmal.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong"
        >
          Nochmal versuchen
        </button>
        <Link href="/" className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:border-accent">
          Zur Suche
        </Link>
      </div>
      {digest && <p className="mt-4 text-xs text-muted">Fehlercode für die Logs: {digest}</p>}
    </div>
  );
}
