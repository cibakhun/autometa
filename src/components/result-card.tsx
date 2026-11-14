import Link from "next/link";
import { FUEL_LABELS, TRANSMISSION_LABELS } from "@/core/types";
import { formatDistance, formatKm, formatPower, formatPrice, formatRegistration } from "@/lib/format";
import type { ListingSummary } from "@/search/query";

export function ResultCard({ listing }: { listing: ListingSummary }) {
  const facts = [
    formatRegistration(listing.firstRegistration),
    formatKm(listing.mileageKm),
    formatPower(listing.powerKw),
    listing.fuel ? FUEL_LABELS[listing.fuel] : null,
    listing.transmission ? TRANSMISSION_LABELS[listing.transmission] : null,
  ].filter(Boolean);
  const distance = formatDistance(listing.distanceKm);

  return (
    <article className="flex h-full flex-col rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold leading-snug">
          <Link href={`/angebot/${listing.id}`} className="hover:text-accent">
            {listing.title}
          </Link>
        </h2>
        <p className="shrink-0 text-lg font-bold">{formatPrice(listing.priceEur)}</p>
      </div>
      <p className="mt-2 text-sm text-muted">{facts.join(" · ")}</p>
      <p className="mt-1 text-sm text-muted">
        {[listing.zip, listing.city].filter(Boolean).join(" ")}
        {distance && ` · ${distance}`}
        {listing.sellerType === "private" ? " · Privat" : " · Händler"}
      </p>
      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-strong">{listing.sourceName}</span>
        <a
          href={`/go/${listing.id}`}
          target="_blank"
          rel="noopener nofollow"
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-strong"
        >
          Zum Angebot
        </a>
      </div>
    </article>
  );
}
