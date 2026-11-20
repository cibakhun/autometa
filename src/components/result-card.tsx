import Link from "next/link";
import { DAMAGE_LABELS } from "@/core/damage";
import { FUEL_LABELS, SELLER_TYPE_LABELS, TRANSMISSION_LABELS } from "@/core/types";
import { formatDistance, formatInspectionShort, formatKm, formatMarketGap, formatPower, formatPrice, formatRegistration } from "@/lib/format";
import type { ListingSummary } from "@/search/query";
import { ListingPhoto } from "./listing-photo";

export function ResultCard({ listing }: { listing: ListingSummary }) {
  const facts = [
    formatRegistration(listing.firstRegistration),
    formatKm(listing.mileageKm),
    formatPower(listing.powerKw),
    listing.fuel ? FUEL_LABELS[listing.fuel] : null,
    listing.transmission ? TRANSMISSION_LABELS[listing.transmission] : null,
    formatInspectionShort(listing.huUntil, listing.huBasis),
  ].filter(Boolean);
  const place = [
    [listing.zip, listing.city].filter(Boolean).join(" "),
    formatDistance(listing.distanceKm),
    listing.sellerType ? SELLER_TYPE_LABELS[listing.sellerType] : null,
  ].filter(Boolean);
  const gap = formatMarketGap(listing.priceEur, listing.marketPriceEur);
  const damaged = listing.damage.length > 0;

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <Link href={`/angebot/${listing.id}`} tabIndex={-1} aria-hidden="true">
        <ListingPhoto src={listing.imageUrl} alt="" className="aspect-[4/3] w-full" />
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 font-semibold leading-snug [overflow-wrap:anywhere]">
            <Link href={`/angebot/${listing.id}`} className="hover:text-accent">
              {listing.title}
            </Link>
          </h2>
          <p className="shrink-0 text-lg font-bold">{formatPrice(listing.priceEur)}</p>
        </div>
        <p className="mt-2 text-sm text-muted">{facts.join(" · ")}</p>
        {place.length > 0 && <p className="mt-1 text-sm text-muted">{place.join(" · ")}</p>}
        {damaged && (
          <ul className="mt-2 flex flex-wrap gap-1" aria-label="Schadenshinweise im Titel">
            {listing.damage.map((kind) => (
              <li key={kind} className="rounded-full border border-warn-line bg-warn-bg px-2 py-0.5 text-xs font-medium text-warn-text">
                {DAMAGE_LABELS[kind]}
              </li>
            ))}
          </ul>
        )}
        {gap && listing.marketPriceEur !== null && (
          <p className="mt-2 text-sm">
            <span className="text-muted">{damaged ? "Intakt" : "Marktwert"} ca. {formatPrice(listing.marketPriceEur)} · </span>
            <span className={gap.below ? "font-medium text-good-text" : "text-muted"}>{gap.text}</span>
          </p>
        )}
        {listing.otherOffers.length > 0 && (
          <p className="mt-2 text-sm">
            <span className="text-muted">Auch bei </span>
            {listing.otherOffers.map((offer, i) => (
              <span key={offer.id}>
                {i > 0 && ", "}
                <a href={`/go/${offer.id}`} target="_blank" rel="noopener nofollow" className="font-medium text-accent hover:underline">
                  {offer.sourceName} ({formatPrice(offer.priceEur)})
                </a>
              </span>
            ))}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-strong">{listing.sourceName}</span>
          <a
            href={`/go/${listing.id}`}
            target="_blank"
            rel="noopener nofollow"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-strong"
          >
            Zum Angebot
          </a>
        </div>
      </div>
    </article>
  );
}
