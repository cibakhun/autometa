import Link from "next/link";
import type { ReactNode } from "react";
import { DAMAGE_LABELS } from "@/core/damage";
import { kwToPs } from "@/core/normalize";
import { FUEL_LABELS, SELLER_TYPE_LABELS, TRANSMISSION_LABELS } from "@/core/types";
import { DEFAULT_FLIP_SETTINGS, type FlipSettings } from "@/core/flip";
import { listingVerdict, VERDICT_LABELS, type ListingVerdict, type VerdictReason } from "@/core/verdict";
import {
  compareOffers,
  formatDayTime,
  formatDistance,
  formatEuro,
  formatInspectionShort,
  formatKm,
  formatNumber,
  formatPrice,
  formatRegistration,
  formatSignedPrice,
} from "@/lib/format";
import type { ListingSummary } from "@/search/query";
import { FavoriteButton } from "./favorite-button";
import { ListingPhoto } from "./listing-photo";
import { Chip, reliabilityChip, sentenceCase, toneOf, VERDICT_STYLE, VerdictIcon, WrenchIcon } from "./verdict-ui";

export { VERDICT_BADGE } from "./verdict-ui";

/** A price drop is worth a note on the card for this long (counted back from the last check). */
const RECENT_DROP_MS = 14 * 24 * 3600_000;

/**
 * One listing in the search, the watch list and saved-search results, in three layers:
 * what it is and costs (photo, title, price), the plain facts (one muted line each for the car
 * and the place), and one tinted panel with everything AutoMeta thinks about it (verdict, the
 * number behind it, a few chips). Details and how each number is worked out are on the detail page.
 */
export function ResultCard({
  listing,
  settings = DEFAULT_FLIP_SETTINGS,
  favorite = false,
  newSince,
  note,
  allDrops = false,
}: {
  listing: ListingSummary;
  /** The visitor's flip settings: minimum margin and level, for the flip line and the verdict. */
  settings?: FlipSettings;
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
    listing.powerKw === null ? null : `${kwToPs(listing.powerKw)} PS`,
    listing.fuel ? FUEL_LABELS[listing.fuel] : null,
    listing.transmission ? TRANSMISSION_LABELS[listing.transmission] : null,
    formatInspectionShort(listing.huUntil, listing.huBasis),
  ];
  const place = [
    [listing.zip, listing.city].filter(Boolean).join(" "),
    formatDistance(listing.distanceKm),
    listing.sellerType ? SELLER_TYPE_LABELS[listing.sellerType] : null,
  ];
  const isNew = newSince !== undefined && listing.firstSeenAt > newSince;
  // Judged as of the last check, like the price drop above: the same page always shows the same.
  const verdict = listingVerdict(listing, settings, new Date(listing.checkedAt));
  const dropped =
    listing.priceDroppedAt !== null &&
    listing.priceBeforeDropEur !== null &&
    (newSince !== undefined
      ? listing.priceDroppedAt > newSince
      : allDrops || Date.parse(listing.priceDroppedAt) > Date.parse(listing.checkedAt) - RECENT_DROP_MS);
  const droppedTitle = dropped ? `Preis gesenkt am ${formatDayTime(listing.priceDroppedAt!)}` : undefined;

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm transition-shadow hover:shadow-md">
      <div className="relative">
        <Link href={`/angebot/${listing.id}`} tabIndex={-1} aria-hidden="true">
          {/* Phones: a flatter photo, so a card does not fill the whole screen. */}
          <ListingPhoto src={listing.imageUrl} alt="" className="aspect-[16/10] w-full sm:aspect-[4/3]" />
        </Link>
        {(isNew || dropped) && (
          <span className="absolute left-2 top-2 flex flex-col items-start gap-1">
            {isNew && <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-on-accent shadow-sm">Neu</span>}
            {dropped && (
              <span className="rounded-full bg-good-text px-2.5 py-0.5 text-xs font-semibold text-surface shadow-sm" title={droppedTitle}>
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
              <p className="whitespace-nowrap text-xs font-medium text-good-text" title={droppedTitle}>
                vorher <s>{formatPrice(listing.priceBeforeDropEur!)}</s>
              </p>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-sm text-muted">
          <Joined parts={facts} />
        </p>
        {place.some(Boolean) && (
          <p className="mt-0.5 flex items-start gap-1 text-sm text-muted">
            <PinIcon />
            <span className="min-w-0">
              <Joined parts={place} wrap />
            </span>
          </p>
        )}
        <Assessment listing={listing} verdict={verdict} settings={settings} />
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
 * "EZ 06/2025 · 41.959 km · 193 PS": a line breaks only after a dot, never inside a value
 * (unless `wrap`), and no line starts with a dot.
 */
function Joined({ parts, wrap = false }: { parts: (string | null | false)[]; wrap?: boolean }) {
  const values = parts.filter(Boolean);
  return values.map((part, i) => (
    <span key={i}>
      {/* A place ("10623 Berlin Charlottenburg-Wilmersdorf") may wrap between its words. */}
      <span className={wrap ? undefined : "whitespace-nowrap"}>
        {part}
        {i < values.length - 1 && " ·"}
      </span>
      {i < values.length - 1 && " "}
    </span>
  ));
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}

/**
 * Reasons the panel shows in its own way, or the card elsewhere: the deciding reason is the
 * panel's main line, damage and flip have their chips and line, the price drop is the photo
 * badge, the seller is in the place line, a long HU in the facts line.
 */
const SHOWN_ELSEWHERE = new Set<VerdictReason["kind"]>(["price", "market", "damage", "flip", "drop", "seller"]);

/**
 * Everything AutoMeta thinks about the listing, as one block in the verdict's color:
 * the verdict, the number behind it (price against market value, or the flip margin for a
 * damaged car), and the other reasons as chips. All reasons on hover.
 */
function Assessment({ listing, verdict, settings }: { listing: ListingSummary; verdict: ListingVerdict; settings: FlipSettings }) {
  const style = VERDICT_STYLE[verdict.verdict];
  const damaged = listing.damage.length > 0;
  const lead = verdict.reasons[0];
  const chips: { key: string; text: string; tone: "good" | "warn" | "neutral"; title?: string; mark?: ReactNode | null }[] = [];

  if (damaged) {
    for (const kind of listing.damage) chips.push({ key: `damage-${kind}`, text: DAMAGE_LABELS[kind], tone: "warn", mark: <WrenchIcon />, title: "Schadenshinweis im Anzeigentitel" });
    if (listing.repair) {
      chips.push({
        key: "difficulty",
        text: `Schwierigkeit ${listing.repair.difficulty}/5${listing.repair.difficulty > settings.level ? ": zu schwer" : ""}`,
        tone: listing.repair.difficulty > settings.level ? "warn" : "neutral",
        title: listing.repair.difficulty > settings.level ? `Schwerer als dein Level ${settings.level} (Einstellungen)` : undefined,
      });
    }
  }
  if (listing.reliabilityRatio !== null) {
    const model = reliabilityChip(listing.reliabilityRatio);
    chips.push({ key: "model", ...model });
  }
  for (const [i, reason] of verdict.reasons.entries()) {
    if (SHOWN_ELSEWHERE.has(reason.kind)) continue;
    if (reason.kind === "hu" && reason.tone === "plus") continue;
    if (reason.kind === "model" && listing.reliabilityRatio !== null) continue;
    chips.push({ key: `reason-${i}`, text: reason.text, tone: toneOf(reason.tone) });
  }

  return (
    <div className={`mt-3 rounded-lg border px-3 py-2.5 ${style.panel}`} title={verdict.reasons.map((reason) => reason.text).join(" · ")}>
      <p className={`flex items-center gap-1.5 text-sm font-semibold ${style.text}`}>
        <VerdictIcon verdict={verdict.verdict} />
        {VERDICT_LABELS[verdict.verdict]}
      </p>
      {damaged ? <FlipNumbers listing={listing} settings={settings} /> : <PriceNumbers listing={listing} lead={lead} />}
      {chips.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1" aria-label="Weitere Gründe">
          {chips.map((chip) => (
            <li key={chip.key}>
              <Chip tone={chip.tone} title={chip.title} mark={chip.mark}>
                {chip.text}
              </Chip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Intact car: "17 % unter Marktwert" (the verdict's deciding reason) and the market value itself. */
function PriceNumbers({ listing, lead }: { listing: ListingSummary; lead: VerdictReason | undefined }) {
  const leadClass = lead?.tone === "plus" ? "font-semibold text-good-text" : lead?.tone === "minus" ? "font-semibold text-warn-text" : "text-foreground";
  return (
    <>
      {lead && <p className={`mt-1 text-sm leading-snug ${leadClass}`}>{sentenceCase(lead.text)}</p>}
      {listing.marketPriceEur !== null && listing.marketPriceEur > 0 && (
        <p className="mt-0.5 text-xs text-muted">
          Marktwert ca. {formatEuro(listing.marketPriceEur)}
          {listing.marketComps !== null && <> · {formatNumber(listing.marketComps)} Vergleichsangebote</>}
        </p>
      )}
    </>
  );
}

/** Damaged car: the flip margin per the visitor's settings, hours and pay per hour, and what it is worth intact. */
function FlipNumbers({ listing, settings }: { listing: ListingSummary; settings: FlipSettings }) {
  const { flip } = listing;
  if (!flip) {
    return (
      <p className="mt-1 text-sm text-muted">
        {listing.marketPriceEur === null ? "Ohne Marktwert keine Flip-Rechnung" : "Flip-Rechnung folgt beim nächsten Datenabgleich"}
      </p>
    );
  }
  const good = flip.marginEur > 0 && flip.marginEur >= settings.minMarginEur;
  const extras = [
    flip.perHourEur !== null && flip.marginEur > 0 ? `${formatEuro(flip.perHourEur)}/h` : null,
    `ca. ${formatNumber(flip.hours)} h Arbeit`,
  ].filter(Boolean);
  return (
    <>
      <p className="mt-1 text-sm leading-snug">
        <span className="text-muted">Flip ca. </span>
        <span className={`font-semibold ${good ? "text-good-text" : flip.marginEur < 0 ? "text-warn-text" : ""}`}>{formatSignedPrice(flip.marginEur)}</span>
        <span className="text-muted"> · {extras.join(" · ")}</span>
      </p>
      {listing.marketPriceEur !== null && <p className="mt-0.5 text-xs text-muted">Wert intakt ca. {formatEuro(listing.marketPriceEur)}</p>}
    </>
  );
}

/**
 * The same vehicle on other portals: "Auf 3 Börsen, hier am günstigsten · auch bei auto.de +2.048 €".
 * The card shows the cheapest listing that matches the filters, so with a portal filter another
 * portal can be cheaper: then that comes first.
 */
function OtherOffers({ listing }: { listing: ListingSummary }) {
  const { cheaper, savingEur, anyDearer } = compareOffers(listing.priceEur, listing.otherOffers);
  const portals = listing.otherOffers.length + 1;
  return (
    <p className="mt-2 flex items-start gap-1.5 text-sm">
      <svg viewBox="0 0 24 24" className="mt-[3px] h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M12 3l9 5-9 5-9-5z" />
        <path d="M3 13l9 5 9-5" />
      </svg>
      <span className="min-w-0">
        {cheaper ? (
          <span className="font-medium text-good-text">
            Bei {cheaper.sourceName} {formatEuro(savingEur)} günstiger
          </span>
        ) : (
          <span className="font-medium">{anyDearer ? `Auf ${portals} Börsen, hier am günstigsten` : `Auf ${portals} Börsen zum gleichen Preis`}</span>
        )}
        <span className="text-muted"> · auch bei </span>
        {listing.otherOffers.map((offer, i) => (
          <span key={offer.id}>
            {i > 0 && ", "}
            <span className="whitespace-nowrap">
              <a
                href={`/go/${offer.id}`}
                target="_blank"
                rel="noopener nofollow"
                title={`${offer.sourceName}: ${formatPrice(offer.priceEur)}`}
                className="font-medium text-accent hover:underline"
              >
                {offer.sourceName}
              </a>
              {offer.priceEur !== listing.priceEur && (
                <span className={offer.priceEur < listing.priceEur ? "text-good-text" : "text-muted"}> {formatSignedPrice(offer.priceEur - listing.priceEur)}</span>
              )}
            </span>
          </span>
        ))}
      </span>
    </p>
  );
}
