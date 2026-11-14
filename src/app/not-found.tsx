import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-line bg-surface p-6 text-center">
      <h1 className="text-xl font-semibold">Nicht gefunden</h1>
      <p className="mt-2 text-sm text-muted">Dieses Angebot gibt es nicht oder nicht mehr.</p>
      <Link href="/" className="mt-4 inline-block text-sm text-accent hover:underline">
        Zurück zur Suche
      </Link>
    </div>
  );
}
