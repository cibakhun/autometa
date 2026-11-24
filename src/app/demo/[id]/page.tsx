import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getPool } from "@/lib/db";

export const metadata: Metadata = { title: "Demo-Anzeige – AutoMeta", robots: { index: false } };

const primaryButton = "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong";
const secondaryButton = "rounded-md border border-line px-4 py-2 text-sm font-medium hover:border-accent";

/** Stand-in for an original listing page, so the click-out flow can be tried with demo data. */
export default function DemoListingPage({ params }: PageProps<"/demo/[id]">) {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-line bg-surface p-6 text-center">
      <p className="text-sm font-medium text-muted">Demo-Daten</p>
      <h1 className="mt-1 text-2xl font-bold">Hier wäre die Originalanzeige</h1>
      <p className="mt-2 text-sm text-muted">
        Bei echten Quellen führt „Zum Angebot“ direkt zur Anzeige auf der Börse, mit allen Fotos, der Beschreibung und dem Kontakt zum
        Verkäufer. Dieses Fahrzeug stammt aus den Demo-Daten und hat keine echte Anzeige.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Suspense fallback={null}>
          <BackToListing params={params} />
        </Suspense>
        <Link href="/" className={secondaryButton}>
          Zur Suche
        </Link>
      </div>
    </div>
  );
}

/** Back to AutoMeta's page of the demo listing; the link to here carries the listing's external id. */
async function BackToListing({ params }: { params: PageProps<"/demo/[id]">["params"] }) {
  const { id } = await params;
  const { rows } = await getPool().query<{ id: string }>(
    "select l.id from listings l join sources s on s.id = l.source_id where s.kind = 'demo' and l.external_id = $1 limit 1",
    [id],
  );
  if (!rows[0]) return null;
  return (
    <Link href={`/angebot/${rows[0].id}`} className={primaryButton}>
      Zurück zum Angebot
    </Link>
  );
}
