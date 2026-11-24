import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Seite nicht gefunden – AutoMeta" };

/** Any address AutoMeta has no page for. An unknown offer has its own message (src/app/angebot/[id]/page.tsx). */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-line bg-surface p-6 text-center">
      <p className="text-sm font-medium text-muted">Fehler 404</p>
      <h1 className="mt-1 text-2xl font-bold">Seite nicht gefunden</h1>
      <p className="mt-2 text-sm text-muted">Diese Adresse gibt es bei AutoMeta nicht. Vielleicht ist der Link unvollständig oder vertippt.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link href="/" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong">
          Zur Suche
        </Link>
        <Link href="/merkliste" className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:border-accent">
          Zur Merkliste
        </Link>
      </div>
    </div>
  );
}
