import Link from "next/link";

/** Stand-in for an original listing page, so the click-out flow can be tried with demo data. */
export default function DemoListingPage() {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-line bg-surface p-6 text-center">
      <h1 className="text-xl font-semibold">Hier wäre die Originalanzeige</h1>
      <p className="mt-2 text-sm text-muted">
        Bei echten Quellen führt „Zum Angebot“ direkt zur Anzeige auf der jeweiligen Börse. Dieses Fahrzeug stammt aus den Demo-Daten.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm text-accent hover:underline">
        Zurück zur Suche
      </Link>
    </div>
  );
}
