import Link from "next/link";
import type { ReactNode } from "react";
import { DAMAGE_LABELS } from "@/core/damage";
import { isTooCheap } from "@/core/deal";
import { FUEL_LABELS, SELLER_TYPE_LABELS, TRANSMISSION_LABELS } from "@/core/types";
import type { FlipResult } from "@/core/flip";
import {
  compareOffers,
  formatDayTime,
  formatDistance,
  formatEuro,
  formatInspectionShort,
  formatKm,
  formatMarketGap,
  formatNumber,
  formatPower,
  formatPrice,
  formatRegistration,
  formatSignedPrice,
  TOO_CHEAP_WARNING,
  unsureMarketReason,
} from "@/lib/format";
import type { ListingSummary, RepairSummary } from "@/search/query";
import { FavoriteButton } from "./favorite-button";
import { ListingPhoto } from "./listing-photo";

/** A price drop is worth a note on the card for this long (counted back from the last check). */
const RECENT_DROP_MS = 14 * 24 * 3600_000;

export function ResultCard({
  listing,
  minMarginEur,
  favorite = false,
  newSince,
  note,
  allDrops = false,
}: {
  listing: ListingSummary;
  minMarginEur?: number;
  /** Whether the listing is on the visitor's watch list (the heart). */
  favorite?: boolean;
  /** "Neu" badge for listings first seen after this moment (ISO), e.g. what a saved search found. */
  newSince?: string;
  /** Extra line at the top, e.g. on the watch list: "Nicht mehr online". */
  note?: ReactNode;
  /** Show a price drop however long ago it was (the search asks for dropped prices). */
  allDrops?: boolean;
}) {
  const facts = [
    formatRegistration(listing.firstRegistration, listing.firstRegistrationYearOnly),
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
  const tooCheap = isTooCheap(listing);
  const unsure = listing.marketConfidence === "low";
  const isNew = newSince !== undefined && listing.firstSeenAt > newSince;
  const dropped =
    listing.priceDroppedAt !== null &&
    listing.priceBeforeDropEur !== null &&
    (newSince !== undefined
      ? listing.priceDroppedAt > newSince
      : allDrops || Date.parse(listing.priceDroppedAt) > Date.parse(listing.checkedAt) - RECENT_DROP_MS);

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm transition-shadow hover:shadow-md">
      <div className="relative">
        <Link href={`/angebot/${listing.id}`} tabIndex={-1} aria-hidden="true">
          <ListingPhoto src={listing.imageUrl} alt="" className="aspect-[4/3] w-full" />
        </Link>
        {(isNew || dropped) && (
          <span className="absolute left-2 top-2 flex flex-col items-start gap-1">
            {isNew && <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-on-accent shadow-sm">Neu</span>}
            {dropped && (
              <span
                className="rounded-full bg-good-text px-2.5 py-0.5 text-xs font-semibold text-surface shadow-sm"
                title={`Preis gesenkt am ${formatDayTime(listing.priceDroppedAt!)}`}
              >
                Preis {formatSignedPrice(listing.priceEur - listing.priceBeforeDropEur!)}
              </span>
            )}
          </span>
        )}
        <FavoriteButton listingId={listing.id} initial={favorite} />
      </div>
      <div className="flex flex-1 flex-col p-4">
        {note}
        <div className="flex items-start justify-between gap-3">
          {/* At most two lines, so cards in a row stay about equally tall; the full title is on hover and the detail page. */}
          <h2 className="line-clamp-2 min-w-0 font-semibold leading-snug [overflow-wrap:anywhere]" title={listing.title}>
            <Link href={`/angebot/${listing.id}`} className="hover:text-accent">
              {listing.title}
            </Link>
          </h2>
          <div className="shrink-0 text-right">
            <p className="whitespace-nowrap text-lg font-bold leading-snug">{formatPrice(listing.priceEur)}</p>
            {dropped && (
              <p className="whitespace-nowrap text-xs font-medium text-good-text" title={`Preis gesenkt am ${formatDayTime(listing.priceDroppedAt!)}`}>
                vorher <s>{formatPrice(listing.priceBeforeDropEur!)}</s>
              </p>
            )}
          </div>
        </div>
        <p className="mt-2 text-sm text-muted">
          <Joined parts={facts} />
        </p>
        {place.length > 0 && (
          <p className="mt-1 text-sm text-muted">
            <Joined parts={place} wrap />
          </p>
        )}
        {damaged && (
          <ul className="mt-2 flex flex-wrap gap-1" aria-label="Schadenshinweise im Titel">
            {listing.damage.map((kind) => (
              <li key={kind} className="rounded-full border border-warn-line bg-warn-bg px-2 py-0.5 text-xs font-medium text-warn-text">
                {DAMAGE_LABELS[kind]}
              </li>
            ))}
          </ul>
        )}
        {tooCheap && (
          <p className="mt-2 rounded-md border border-warn-line bg-warn-bg px-2 py-1 text-xs font-medium text-warn-text">{TOO_CHEAP_WARNING}</p>
        )}
        {gap && listing.marketPriceEur !== null && (
          <p className="mt-2 text-sm">
            <span className="whitespace-nowrap text-muted">
              {damaged ? "Intakt" : "Marktwert"} ca. {formatPrice(listing.marketPriceEur)}&nbsp;·
            </span>{" "}
            <span className={`whitespace-nowrap ${gap.below && !damaged && !tooCheap && !unsure ? "font-medium text-good-text" : "text-muted"}`}>{gap.text}</span>
            {unsure && (
              <span className="whitespace-nowrap text-muted" title={`Marktwert unsicher: ${unsureMarketReason(listing.marketComps)}`}>
                {" "}
                · unsicher
              </span>
            )}
          </p>
        )}
        {listing.flip && listing.repair && <FlipLine flip={listing.flip} repair={listing.repair} minMarginEur={minMarginEur} />}
        {listing.reliabilityRatio !== null && <ReliabilityLine ratio={listing.reliabilityRatio} />}
        {listing.otherOffers.length > 0 && <OtherOffers listing={listing} />}
        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="whitespace-nowrap rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-strong">{listing.sourceName}</span>
            <span className="whitespace-nowrap text-xs text-muted" title="Zuletzt in der Liste der Börse gesehen oder auf der Anzeige selbst bestätigt">
              geprüft {formatDayTime(listing.checkedAt)}
            </span>
          </span>
          <a
            href={`/go/${listing.id}`}
            target="_blank"
            rel="noopener nofollow"
            aria-label={`Zum Angebot bei ${listing.sourceName} (neuer Tab)`}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-strong sm:min-h-9"
          >
            Zum Angebot
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
            </svg>
          </a>
        </div>
      </div>
    </article>
  );
}

/**
 * "EZ 06/2025 · 41.959 km · 142 kW (193 PS)": a line breaks only after a dot, never inside a
 * value (unless `wrap`), and no line starts with a dot.
 */
function Joined({ parts, wrap = false }: { parts: (string | null | false)[]; wrap?: boolean }) {
  const values = parts.filter(Boolean);
  return values.map((part, i) => (
    <span key={i}>
      {/* A place ("10623 Berlin Charlottenburg-Wilmersdorf") may wrap between its words. */}
      <span className={wrap ? undefined : "whitespace-nowrap"}>
        {part}
        {i < values.length - 1 && "\u00a0·"}
      </span>
      {i < values.length - 1 && " "}
    </span>
  ));
}

/** "Modell-Akte: 23 % weniger HU-Mängel als gleich alte Autos" (shown when sorted by recommendation). */
function ReliabilityLine({ ratio }: { ratio: number }) {
  const percent = Math.round(Math.abs(1 - ratio) * 100);
  const text =
    percent < 5
      ? "HU-Mängel wie bei gleich alten Autos"
      : `${percent} % ${ratio < 1 ? "weniger" : "mehr"} HU-Mängel als gleich alte Autos`;
  return (
    <p className="mt-2 text-sm" title="Anteil der Autos dieses Modells und Alters mit Mangel bei der Hauptuntersuchung (RDW-Daten), verglichen mit allen gleich alten Autos">
      <span className="text-muted">Modell-Akte: </span>
      <span className={percent < 5 ? "" : ratio < 1 ? "font-medium text-good-text" : "font-medium text-warn-text"}>{text}</span>
    </p>
  );
}

/** "Flip ca. +1.310 € · 8 h · 164 €/h · Schwierigkeit 3/5" */
function FlipLine({ flip, repair, minMarginEur }: { flip: FlipResult; repair: RepairSummary; minMarginEur?: number }) {
  const good = flip.marginEur > 0 && (minMarginEur === undefined || flip.marginEur >= minMarginEur);
  const parts = [
    `${formatNumber(flip.hours)} h`,
    flip.perHourEur !== null && flip.marginEur > 0 ? `${formatEuro(flip.perHourEur)}/h` : null,
    `Schwierigkeit ${repair.difficulty}/5`,
  ].filter(Boolean);
  return (
    <p className="mt-2 text-sm">
      <span className="whitespace-nowrap">
        <span className="text-muted">Flip ca. </span>
        <span className={good ? "font-medium text-good-text" : flip.marginEur < 0 ? "font-medium text-warn-text" : "font-medium"}>
          {formatSignedPrice(flip.marginEur)}
        </span>
        <span className="text-muted">&nbsp;·</span>
      </span>{" "}
      <span className="text-muted">
        <Joined parts={parts} />
      </span>
    </p>
  );
}

/**
 * The same vehicle on other portals: "Hier am günstigsten · auch bei auto.de 29.448 € (+2.048 €)".
 * The card shows the cheapest listing that matches the filters, so with a portal filter another
 * portal can be cheaper: then that comes first.
 */
function OtherOffers({ listing }: { listing: ListingSummary }) {
  const { cheaper, savingEur, anyDearer } = compareOffers(listing.priceEur, listing.otherOffers);
  const portals = listing.otherOffers.length + 1;
  return (
    <p className="mt-2 text-sm">
      {cheaper ? (
        <span className="font-medium text-good-text">
          Bei {cheaper.sourceName} {formatPrice(savingEur)} günstiger
        </span>
      ) : (
        <span className="font-medium">{anyDearer ? `Hier am günstigsten von ${portals} Börsen` : `Gleicher Preis auf ${portals} Börsen`}</span>
      )}
      <span className="text-muted"> · auch bei </span>
      {listing.otherOffers.map((offer, i) => (
        <span key={offer.id}>
          {i > 0 && ", "}
          <span className="whitespace-nowrap">
            <a href={`/go/${offer.id}`} target="_blank" rel="noopener nofollow" className="font-medium text-accent hover:underline">
              {offer.sourceName} {formatPrice(offer.priceEur)}
            </a>
            {offer.priceEur !== listing.priceEur && (
              <span className={offer.priceEur < listing.priceEur ? "text-good-text" : "text-muted"}>
                {" "}({formatSignedPrice(offer.priceEur - listing.priceEur)})
              </span>
            )}
          </span>
        </span>
      ))}
    </p>
  );
}
