import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BODY_TYPE_LABELS, FUEL_LABELS, SELLER_TYPE_LABELS, TRANSMISSION_LABELS } from "@/core/types";
import { getPool } from "@/lib/db";
import { formatKm, formatPower, formatPrice, formatRegistration } from "@/lib/format";
import { getListing } from "@/search/query";

export default function ListingPage({ params }: PageProps<"/angebot/[id]">) {
  return (
    <Suspense fallback={<div className="h-80 animate-pulse rounded-xl bg-surface" />}>
      <ListingDetails params={params} />
    </Suspense>
  );
}

async function ListingDetails({ params }: { params: PageProps<"/angebot/[id]">["params"] }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const listing = await getListing(getPool(), Number(id));
  if (!listing) notFound();

  const rows: [string, string | null][] = [
    ["Preis", formatPrice(listing.priceEur)],
    ["Erstzulassung", formatRegistration(listing.firstRegistration).replace("EZ ", "")],
    ["Kilometerstand", formatKm(listing.mileageKm)],
    ["Leistung", formatPower(listing.powerKw)],
    ["Kraftstoff", listing.fuel ? FUEL_LABELS[listing.fuel] : null],
    ["Getriebe", listing.transmission ? TRANSMISSION_LABELS[listing.transmission] : null],
    ["Fahrzeugtyp", listing.bodyType ? BODY_TYPE_LABELS[listing.bodyType] : null],
    ["Farbe", listing.color],
    ["Standort", [listing.zip, listing.city].filter(Boolean).join(" ") || null],
    ["Anbieter", listing.sellerName ?? (listing.sellerType ? SELLER_TYPE_LABELS[listing.sellerType] : null)],
    ["Quelle", listing.sourceName],
    ["Zuletzt gesehen", new Date(listing.lastSeenAt).toLocaleDateString("de-DE")],
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/" className="text-sm text-accent hover:underline">
        ← Zurück zur Suche
      </Link>
      <article className="mt-3 rounded-xl border border-line bg-surface p-6">
        {listing.status === "gone" && (
          <p className="mb-4 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn-text">
            Dieses Angebot ist bei {listing.sourceName} nicht mehr zu finden und wahrscheinlich verkauft.
          </p>
        )}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="min-w-0 text-2xl font-bold leading-tight [overflow-wrap:anywhere]">{listing.title}</h1>
          <p className="text-2xl font-bold">{formatPrice(listing.priceEur)}</p>
        </div>
        <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows
            .filter((row): row is [string, string] => Boolean(row[1]))
            .map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 border-b border-line pb-2 text-sm">
                <dt className="text-muted">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
        </dl>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a
            href={`/go/${listing.id}`}
            target="_blank"
            rel="noopener nofollow"
            className="rounded-md bg-accent px-4 py-2 font-semibold text-on-accent hover:bg-accent-strong"
          >
            Zum Angebot bei {listing.sourceName}
          </a>
          <p className="text-xs text-muted">Fotos, Beschreibung und Kontakt findest du in der Originalanzeige.</p>
        </div>
        {listing.otherOffers.length > 0 && (
          <section className="mt-6 border-t border-line pt-4">
            <h2 className="text-sm font-semibold">Dieses Fahrzeug gibt es auch bei</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {listing.otherOffers.map((offer) => (
                <li key={offer.id} className="flex items-center justify-between gap-4">
                  <a href={`/go/${offer.id}`} target="_blank" rel="noopener nofollow" className="font-medium text-accent hover:underline">
                    {offer.sourceName}
                  </a>
                  <span className="font-medium">{formatPrice(offer.priceEur)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              Erkannt an Marke, Modell, Erstzulassung, Kilometerstand, Preis und Standort. Ein Treffer kann in seltenen Fällen ein anderes Fahrzeug sein.
            </p>
          </section>
        )}
      </article>
    </div>
  );
}
