import type { Metadata } from "next";
import Link from "next/link";
import { cache, Suspense } from "react";
import { DAMAGE_LABELS } from "@/core/damage";
import { isTooCheap, MARKET_CONFIDENCE_LABELS } from "@/core/deal";
import { coveredComponents, hiddenDefectRisk, type DefectProfile } from "@/core/defects";
import { onlineSpan, priceStory, type OnlineSpan, type PricePoint } from "@/core/price-history";
import type { FlipSettings } from "@/core/flip";
import { CONFIDENCE_LABELS, DIFFICULTY_LABELS, estimateRepairs, VEHICLE_CLASS_LABELS } from "@/core/repairs";
import { findMake, findModel } from "@/core/taxonomy";
import { BODY_TYPE_LABELS, FUEL_LABELS, SELLER_TYPE_LABELS, TRANSMISSION_LABELS } from "@/core/types";
import { FavoriteButton } from "@/components/favorite-button";
import { FlipCalculator } from "@/components/flip-calculator";
import { ListingPhoto } from "@/components/listing-photo";
import { ModelFileSection } from "@/components/model-file";
import { MARKET_RULES } from "@/ingest/market";
import { getPool } from "@/lib/db";
import { getFlipSettings } from "@/lib/flip-settings";
import {
  compareOffers,
  formatDayTime,
  formatEuro,
  formatInspection,
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
import { currentDevice } from "@/lib/profile";
import { favoriteIds } from "@/profiles/favorites";
import { getModelFile, type ModelFile } from "@/search/defects";
import { getListing, riskTotal, type ListingDetail } from "@/search/query";

/**
 * The listing with the visitor's flip settings, or null for an id that is no listing. Memoized per
 * request, so the title (generateMetadata) and the page read the database once.
 */
const loadListing = cache(async (id: string) => {
  if (!/^\d{1,18}$/.test(id)) return null;
  const settings = await getFlipSettings();
  const listing = await getListing(getPool(), Number(id), settings);
  return listing ? { listing, settings } : null;
});

/** "VW Golf 1.4 TSI Highline … – 5.400 € – AutoMeta": the car's name in the browser tab and in shared links. */
export async function generateMetadata({ params }: PageProps<"/angebot/[id]">): Promise<Metadata> {
  const found = await loadListing((await params).id);
  if (!found) return { title: "Angebot nicht gefunden – AutoMeta", robots: { index: false } };
  const { listing } = found;
  const price = `${formatEuro(listing.priceEur)}${listing.status === "gone" ? ", nicht mehr online" : ""}`;
  return {
    title: `${shorten(listing.title, 70)} – ${price} – AutoMeta`,
    description: [
      formatRegistration(listing.firstRegistration, listing.firstRegistrationYearOnly),
      listing.mileageKm === null ? null : formatKm(listing.mileageKm),
      formatPower(listing.powerKw),
      listing.fuel ? FUEL_LABELS[listing.fuel] : null,
      [listing.zip, listing.city].filter(Boolean).join(" ") || null,
      `bei ${listing.sourceName}`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/** Cuts a long title at a word boundary, with an ellipsis. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, "")} …`;
}

export default function ListingPage({ params }: PageProps<"/angebot/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl" aria-busy="true">
          <p className="sr-only">Angebot wird geladen …</p>
          <div className="mt-8 h-96 animate-pulse rounded-xl bg-surface" />
        </div>
      }
    >
      <ListingDetails params={params} />
    </Suspense>
  );
}

const sectionClass = "mt-6 border-t border-line pt-5 text-sm";
const headingClass = "text-base font-semibold";
const primaryButton =
  "inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-center text-sm font-semibold text-on-accent hover:bg-accent-strong";
const secondaryButton =
  "inline-flex items-center justify-center rounded-md border border-line px-4 py-2 text-center text-sm font-medium hover:border-accent";

async function ListingDetails({ params }: { params: PageProps<"/angebot/[id]">["params"] }) {
  const { id } = await params;
  const [found, device] = await Promise.all([loadListing(id), currentDevice()]);
  // Rendered here rather than with notFound(): the page has started streaming by now, so notFound()
  // could not change the status any more and would show its page only once JavaScript runs.
  if (!found) return <OfferNotFound />;
  const { listing, settings } = found;
  const pool = getPool();
  const [file, favorites] = await Promise.all([
    getModelFile(pool, listing.makeSlug, listing.modelSlug, listing.firstRegistration),
    favoriteIds(pool, device?.profileId ?? null, [listing.id]),
  ]);

  const gone = listing.status === "gone";
  const online = onlineSpan({ listedOn: listing.listedOn, firstSeenAt: listing.firstSeenAt, endedAt: endedAt(listing), asOf: listing.asOf });
  const rows: [string, string | null][] = [
    ["Erstzulassung", formatRegistration(listing.firstRegistration, listing.firstRegistrationYearOnly).replace("EZ ", "")],
    ["Kilometerstand", formatKm(listing.mileageKm)],
    ["Leistung", formatPower(listing.powerKw)],
    ["Kraftstoff", listing.fuel ? FUEL_LABELS[listing.fuel] : null],
    ["Getriebe", listing.transmission ? TRANSMISSION_LABELS[listing.transmission] : null],
    ["HU/TÜV", formatInspection(listing.huUntil, listing.huBasis)],
    ["Fahrzeugtyp", listing.bodyType ? BODY_TYPE_LABELS[listing.bodyType] : null],
    ["Farbe", listing.color],
    ["Standort", [listing.zip, listing.city].filter(Boolean).join(" ") || null],
    ["Anbieter", listing.sellerName ?? (listing.sellerType ? SELLER_TYPE_LABELS[listing.sellerType] : null)],
    ["Quelle", listing.sourceName],
    ["Online", formatOnline(online, listing.sourceName)],
    ["Zuletzt geprüft", formatDayTime(listing.checkedAt)],
  ];
  // The market value of a damaged car is that of an intact one, so its gap says nothing about the price.
  const gap = listing.damage.length === 0 ? formatMarketGap(listing.priceEur, listing.marketPriceEur) : null;
  const photo = <ListingPhoto src={listing.imageUrl} alt={listing.title} className="aspect-[4/3] w-full shrink-0 rounded-lg sm:w-72" />;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/" className="text-sm text-accent hover:underline">
        ← Zurück zur Suche
      </Link>
      <article className="mt-3 rounded-xl border border-line bg-surface p-4 sm:p-6">
        {gone && <GoneNotice listing={listing} />}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
          {/* The portal's small list photo; more photos are in the original listing. Without one, phones skip the empty frame. */}
          {listing.imageUrl ? photo : <div className="hidden shrink-0 sm:block">{photo}</div>}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold leading-tight [overflow-wrap:anywhere] sm:text-2xl">{listing.title}</h1>
            <p className="mt-2 text-2xl font-bold">
              {gone && <span className="text-sm font-normal text-muted">zuletzt </span>}
              {formatPrice(listing.priceEur)}
            </p>
            {listing.priceDroppedAt && listing.priceBeforeDropEur !== null && (
              <p className="text-sm font-medium text-good-text">
                gesenkt am {formatDayTime(listing.priceDroppedAt)}, vorher <s>{formatPrice(listing.priceBeforeDropEur)}</s>
              </p>
            )}
            {gap && (
              <p className={`text-sm ${gap.below && !isTooCheap(listing) && listing.marketConfidence !== "low" ? "font-medium text-good-text" : "text-muted"}`}>
                {gap.text}
                {listing.marketConfidence === "low" && " (Marktwert unsicher)"}
              </p>
            )}
            <Actions listing={listing} saved={favorites.has(listing.id)} />
          </div>
        </div>
        <CheaperElsewhere listing={listing} />
        <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows
            .filter((row): row is [string, string] => Boolean(row[1]))
            .map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 border-b border-line pb-2 text-sm">
                <dt className="shrink-0 text-muted">{label}</dt>
                <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
        </dl>
        <ConditionAndMarket listing={listing} />
        <Flip listing={listing} settings={settings} file={file} />
        <ModelFileFor listing={listing} file={file} />
        <PriceHistory listing={listing} />
        {listing.otherOffers.length > 0 && <AllOffers listing={listing} />}
        {!gone && (
          // The way out once more at the end of a long page; the heart stays at the top.
          <div className="mt-6 border-t border-line pt-5">
            <OriginalLink listing={listing} className={`${primaryButton} w-full sm:w-auto`} />
          </div>
        )}
      </article>
    </div>
  );
}

/** For an id that is no listing: what happened and where to go instead. */
function OfferNotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-line bg-surface p-6 text-center">
      <h1 className="text-2xl font-bold">Angebot nicht gefunden</h1>
      <p className="mt-2 text-sm text-muted">
        Unter dieser Nummer gibt es bei AutoMeta kein Angebot. Vielleicht ist der Link unvollständig oder falsch kopiert. Angebote, die
        nicht mehr online sind, bleiben sonst mit Preisverlauf und Marktwert hier stehen.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link href="/" className={primaryButton}>
          Zur Suche
        </Link>
        <Link href="/merkliste" className={secondaryButton}>
          Zur Merkliste
        </Link>
      </div>
    </div>
  );
}

/** The link to the listing on its portal, through the click counter. */
function OriginalLink({ listing, className, label }: { listing: ListingDetail; className: string; label?: string }) {
  return (
    <a href={`/go/${listing.id}`} target="_blank" rel="noopener nofollow" className={className}>
      {label ?? `Zum Angebot bei ${listing.sourceName}`}
      <span className="sr-only"> (öffnet in einem neuen Tab)</span>
    </a>
  );
}

/** Near the top, so a phone does not have to scroll past the whole page: to the portal, and the heart. */
function Actions({ listing, saved }: { listing: ListingDetail; saved: boolean }) {
  // A listing that went stale may still be online; one that was taken down or vanished from its list most likely is not.
  const probablyDeleted = listing.status === "gone" && listing.goneReason !== "stale" && listing.goneReason !== "filtered";
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-start gap-2">
        <OriginalLink
          listing={listing}
          className={`${probablyDeleted ? secondaryButton : primaryButton} grow sm:grow-0`}
          label={probablyDeleted ? `Alte Anzeige bei ${listing.sourceName}` : listing.status === "gone" ? `Bei ${listing.sourceName} nachsehen` : undefined}
        />
        <FavoriteButton listingId={listing.id} initial={saved} variant="inline" />
      </div>
      <p className="mt-2 text-xs text-muted">
        {probablyDeleted
          ? "Die Anzeige ist wahrscheinlich gelöscht, der Link kann ins Leere führen."
          : "Weitere Fotos, Beschreibung und Kontakt findest du in der Originalanzeige."}
      </p>
    </div>
  );
}

/** When a gone listing left: the day its page said "taken down", else the last time it was seen online. */
function endedAt(listing: ListingDetail): string | null {
  if (listing.status !== "gone") return null;
  return listing.goneReason === "checked" ? (listing.goneAt ?? listing.lastSeenAt) : listing.lastSeenAt;
}

/** Search for the intact listings the market value compares with (as close as the filters allow). */
function comparablesQuery(listing: ListingDetail): string | null {
  if (!listing.makeSlug || !listing.modelSlug || !listing.firstRegistration || listing.mileageKm === null) return null;
  const year = Number(listing.firstRegistration.slice(0, 4));
  const km = listing.mileageKm;
  const kmMax = Math.max(km * (1 + MARKET_RULES.mileageShare), km + MARKET_RULES.mileageMinSpanKm);
  const params = new URLSearchParams({
    make: listing.makeSlug,
    model: listing.modelSlug,
    yearMin: String(year - MARKET_RULES.yearSpan),
    yearMax: String(year + MARKET_RULES.yearSpan),
    kmMax: String(Math.ceil(kmMax / 1000) * 1000),
    priceMin: String(MARKET_RULES.minCompPriceEur),
    zustand: "intakt",
    sort: "price_asc",
  });
  if (listing.fuel) params.append("fuel", listing.fuel);
  if (listing.transmission) params.set("transmission", listing.transmission);
  return `/?${params}`;
}

function ConditionAndMarket({ listing }: { listing: ListingDetail }) {
  const damaged = listing.damage.length > 0;
  const gap = formatMarketGap(listing.priceEur, listing.marketPriceEur);
  const comparables = comparablesQuery(listing);
  return (
    <section className={`${sectionClass} space-y-5`}>
      {damaged && (
        <div>
          <h2 className={headingClass}>Schadenshinweise im Titel</h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {listing.damage.map((kind) => (
              <li key={kind} className="rounded-full border border-warn-line bg-warn-bg px-2.5 py-0.5 text-xs font-medium text-warn-text">
                {DAMAGE_LABELS[kind]}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Aus dem Anzeigentitel erkannt. Was genau kaputt ist, steht in der Originalanzeige.</p>
        </div>
      )}
      <div>
        <h2 className={headingClass}>{damaged ? "Marktwert in intaktem Zustand" : "Marktwert"}</h2>
        {listing.marketPriceEur !== null && gap ? (
          <>
            <p className="mt-1 text-xl font-bold">ca. {formatEuro(listing.marketPriceEur)}</p>
            <p className={gap.below && !damaged && !isTooCheap(listing) && listing.marketConfidence !== "low" ? "font-medium text-good-text" : "text-muted"}>
              Dieses Angebot: {gap.text}
            </p>
            {isTooCheap(listing) && (
              <p className="mt-2 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-sm font-medium text-warn-text">{TOO_CHEAP_WARNING}</p>
            )}
            {listing.marketConfidence && (
              <p className="mt-1">
                Verlässlichkeit des Marktwerts: <span className="font-medium">{MARKET_CONFIDENCE_LABELS[listing.marketConfidence]}</span>
                {listing.marketConfidence === "low" && <span className="text-muted"> ({unsureMarketReason(listing.marketComps)})</span>}
              </p>
            )}
            {listing.marketLowEur !== null && listing.marketHighEur !== null && (
              <p className="mt-1">
                Übliche Spanne {formatEuro(listing.marketLowEur)} bis {formatEuro(listing.marketHighEur)}, die mittlere Hälfte von{" "}
                {formatNumber(listing.marketComps ?? 0)} vergleichbaren Angeboten.
              </p>
            )}
            {listing.marketDays !== null && (
              <p className="mt-1">Vergleichbare Angebote waren im Mittel {formatDays(listing.marketDays)} online.</p>
            )}
            <p className="mt-2 text-xs text-muted">
              Verglichen mit Angeboten ohne Schadenshinweis: gleiches Modell, Erstzulassung ±{MARKET_RULES.yearSpan} Jahr, ähnlicher
              Kilometerstand, gleicher Kraftstoff, gleiches Getriebe und ähnliche Leistung. Es sind Angebotspreise, keine Verkaufspreise.
            </p>
            {comparables && (
              <Link href={comparables} className="mt-1 inline-block text-accent hover:underline">
                Vergleichbare Angebote ansehen
              </Link>
            )}
          </>
        ) : (
          <p className="mt-1 text-muted">
            {comparables
              ? `Zu wenige vergleichbare Angebote für einen Marktwert (mindestens ${MARKET_RULES.minComps} nötig).`
              : "Ohne Modell, Erstzulassung und Kilometerstand lässt sich kein Marktwert berechnen."}
          </p>
        )}
      </div>
    </section>
  );
}

const repairFacts = (listing: ListingDetail) => ({
  makeSlug: listing.makeSlug,
  powerKw: listing.powerKw,
  bodyType: listing.bodyType,
  fuel: listing.fuel,
  huBasis: listing.huBasis,
  huUntil: listing.huUntil,
});

/** The profile the risk buffer uses: the model's own, else the average car of its age. */
function riskProfile(file: ModelFile | null): { profile: DefectProfile | null; basis: "model" | "average" | null } {
  if (file?.profile) return { profile: file.profile, basis: "model" };
  if (file?.average) return { profile: file.average, basis: "average" };
  return { profile: null, basis: null };
}

/** The Modell-Akte for a car whose model and age group are known. */
function ModelFileFor({ listing, file }: { listing: ListingDetail; file: ModelFile | null }) {
  if (!file || !listing.makeSlug || !listing.modelSlug) return null;
  const make = findMake(listing.makeSlug);
  const model = findModel(listing.makeSlug, listing.modelSlug);
  if (!make || !model) return null;
  const estimate = estimateRepairs(listing.damage, repairFacts(listing));
  const { profile } = riskProfile(file);
  const risk = hiddenDefectRisk(profile, estimate.vehicleClass, coveredComponents(estimate.jobs.map((j) => j.job.id)));
  return <ModelFileSection makeName={make.name} modelName={model.name} file={file} jobs={estimate.jobs.map((j) => j.job)} risk={risk} />;
}

/** "ca. 25 Stunden": the hours are estimates, so whole hours from 10 on and half hours below. */
function formatHours(hours: number): string {
  const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 2) / 2;
  return `ca. ${formatNumber(rounded)} ${rounded === 1 ? "Stunde" : "Stunden"}`;
}

/** The stored flip estimate in two sentences, the same numbers the search list shows. */
function FlipSummary({ listing, settings }: { listing: ListingDetail; settings: FlipSettings }) {
  const { flip, repair } = listing;
  if (!flip || !repair) {
    return (
      <p className="mt-1 text-muted">
        {listing.marketPriceEur === null
          ? "Ohne Marktwert keine Marge; im Rechner kannst du selbst einen eintragen."
          : "Die Reparaturschätzung für dieses Angebot wird beim nächsten Datenabgleich berechnet."}
      </p>
    );
  }
  const risk = riskTotal(repair);
  const marginClass = flip.marginEur >= settings.minMarginEur ? "text-good-text" : flip.marginEur < 0 ? "text-warn-text" : "";
  return (
    <div data-flip-summary className="mt-1 space-y-1">
      <p>
        Geschätzt <span className={`text-base font-bold ${marginClass}`}>{formatSignedPrice(flip.marginEur)}</span> Marge, je nach Teilen{" "}
        {formatSignedPrice(flip.marginRangeEur[0])} bis {formatSignedPrice(flip.marginRangeEur[1])}.
        {risk > 0 && <> Der Risikopuffer von {formatEuro(risk)} ist schon abgezogen.</>}
      </p>
      <p>
        Arbeit {formatHours(flip.hours)}
        {flip.perHourEur !== null && flip.marginEur > 0 && <>, also ca. {formatEuro(flip.perHourEur)} pro Stunde</>}. Schwierigkeit{" "}
        {repair.difficulty} von 5 ({DIFFICULTY_LABELS[repair.difficulty]}), Sicherheit {CONFIDENCE_LABELS[repair.confidence]}, Teilepreise
        für {VEHICLE_CLASS_LABELS[repair.vehicleClass]}.
      </p>
    </div>
  );
}

/**
 * The flip estimate from the catalog and the calculator to adjust it. Folded away for intact cars
 * and for listings that are gone, where it is only for comparison.
 */
function Flip({ listing, settings, file }: { listing: ListingDetail; settings: FlipSettings; file: ModelFile | null }) {
  const damaged = listing.damage.length > 0;
  const gone = listing.status === "gone";
  const { profile, basis } = riskProfile(file);
  const calculator = (
    <FlipCalculator
      priceEur={listing.priceEur}
      marketEur={listing.marketPriceEur}
      damage={listing.damage}
      facts={repairFacts(listing)}
      settings={settings}
      profile={profile}
      profileBasis={basis}
    />
  );
  const note = (
    <p className="mt-3 text-xs text-muted">
      Teile und Stunden sind Schätzungen aus dem <Link href="/reparaturen" className="text-accent hover:underline">Reparaturkatalog</Link>{" "}
      für einen Hobbyschrauber. Der Risikopuffer rechnet mit Mängeln, die die HU bei solchen Autos oft findet, und mit einem schlimmeren
      Schaden, wenn der Preis weit unter dem Marktwert liegt. Abschlag und Nebenkosten kommen aus deinen{" "}
      <Link href="/einstellungen" className="text-accent hover:underline">Einstellungen</Link>.
    </p>
  );

  if (!damaged || gone) {
    return (
      <details className={sectionClass}>
        <summary className={`cursor-pointer ${headingClass}`}>
          {damaged ? "Flip-Bewertung" : "Flip-Rechner"}
          {gone && <span className="text-sm font-normal text-muted"> (nur zum Vergleich)</span>}
        </summary>
        {damaged && <FlipSummary listing={listing} settings={settings} />}
        {calculator}
        {note}
      </details>
    );
  }

  return (
    <section className={sectionClass}>
      <h2 className={headingClass}>Flip-Bewertung</h2>
      <FlipSummary listing={listing} settings={settings} />
      <h3 className="mt-4 font-semibold">Selbst nachrechnen</h3>
      <p className="text-xs text-muted">Jeder Wert lässt sich ändern. Der Rechner startet mit der Schätzung oben.</p>
      {calculator}
      {note}
    </section>
  );
}

const longDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
/** "19.11.2026" for a moment (ISO) or a day (YYYY-MM-DD), in German time. */
const formatDate = (value: string) => longDate.format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
const formatDays = (days: number) => (days === 1 ? "1 Tag" : `${formatNumber(days)} Tage`);
const formatTimes = (count: number) => (count === 1 ? "einmal" : count === 2 ? "zweimal" : `${formatNumber(count)}-mal`);

/** "seit 12.11.2026 (11 Tage, laut Kleinanzeigen)" or "mind. 5 Tage (bei AutoMeta seit 19.11.2026)". */
function formatOnline(online: OnlineSpan, sourceName: string): string {
  const days = online.days === 0 ? "unter einem Tag" : formatDays(online.days);
  if (online.until) {
    return online.basis === "portal"
      ? `${formatDate(online.since)} bis ${formatDate(online.until)} (${days})`
      : `mind. ${days} (bei AutoMeta ${formatDate(online.since)} bis ${formatDate(online.until)})`;
  }
  if (online.days === 0) return online.basis === "portal" ? `seit heute (laut ${sourceName})` : "seit heute bei AutoMeta";
  return online.basis === "portal"
    ? `seit ${formatDate(online.since)} (${days}, laut ${sourceName})`
    : `mind. ${days} (bei AutoMeta seit ${formatDate(online.since)})`;
}

/**
 * Price changes since AutoMeta first saw the listing, and a small chart. Amounts as plain euros:
 * "von 250 € auf 0 €" reads better here than "auf Zu verschenken".
 */
function PriceHistory({ listing }: { listing: ListingDetail }) {
  const story = priceStory(listing.priceHistory);
  if (!story) return null;
  const { changes, totalEur } = story;
  const share = story.firstEur > 0 ? Math.round((Math.abs(totalEur) / story.firstEur) * 100) : null;
  const total = `${formatSignedPrice(totalEur)}${share ? ` (${totalEur < 0 ? "−" : "+"}${share} %)` : ""}`;
  const counts = [story.drops > 0 ? `${formatTimes(story.drops)} gesenkt` : null, story.raises > 0 ? `${formatTimes(story.raises)} erhöht` : null]
    .filter(Boolean)
    .join(" und ");
  return (
    <section className={sectionClass}>
      <h2 className={headingClass}>Preisverlauf</h2>
      {changes.length === 0 ? (
        <p className="mt-1">
          Unverändert {formatEuro(story.firstEur)}, seit AutoMeta das Angebot am {formatDate(story.firstSeenAt)} zum ersten Mal gesehen hat.
        </p>
      ) : (
        <>
          {changes.length === 1 ? (
            <p className="mt-1">
              Am {formatDate(changes[0].at)} von {formatEuro(changes[0].fromEur)} auf {formatEuro(changes[0].toEur)}{" "}
              {totalEur < 0 ? "gesenkt" : "erhöht"}: <span className={`font-semibold ${totalEur < 0 ? "text-good-text" : ""}`}>{total}</span>.
            </p>
          ) : (
            <p className="mt-1">
              Seit dem {formatDate(story.firstSeenAt)} {counts}, insgesamt{" "}
              <span className={`font-semibold ${totalEur < 0 ? "text-good-text" : totalEur > 0 ? "" : "text-muted"}`}>{total}</span>.
              {story.lastDrop && (
                <>
                  {" "}
                  Zuletzt gesenkt am {formatDate(story.lastDrop.at)} von {formatEuro(story.lastDrop.fromEur)} auf {formatEuro(story.lastDrop.toEur)}.
                </>
              )}
            </p>
          )}
          <PriceChart points={listing.priceHistory} endAt={endedAt(listing) ?? listing.asOf} />
          <ol className="mt-3 space-y-1">
            <li className="flex justify-between gap-4">
              <span className="text-muted">{formatDate(story.firstSeenAt)} erster Preis</span>
              <span className="font-medium">{formatEuro(story.firstEur)}</span>
            </li>
            {changes.map((change) => (
              <li key={change.at} className="flex justify-between gap-4">
                <span className="text-muted">
                  {formatDate(change.at)}{" "}
                  <span className={change.toEur < change.fromEur ? "text-good-text" : ""}>{formatSignedPrice(change.toEur - change.fromEur)}</span>
                </span>
                <span className="font-medium">{formatEuro(change.toEur)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="mt-2 text-xs text-muted">
        Preise, wie AutoMeta sie bei {listing.sourceName} gesehen hat. Jedes Angebot wird etwa einmal am Tag geprüft; eine Änderung, die
        innerhalb eines Tages wieder zurückgenommen wurde, kann fehlen.
      </p>
    </section>
  );
}

/** A step line of the price from the first sighting to now (or until the listing left). */
function PriceChart({ points, endAt }: { points: PricePoint[]; endAt: string }) {
  const start = Date.parse(points[0].seenAt);
  const last = Date.parse(points.at(-1)!.seenAt);
  // The line goes on to today; a change seen moments ago still gets a little room.
  const end = Math.max(Date.parse(endAt), last + (last - start) * 0.05, start + 1);
  const prices = points.map((p) => p.priceEur);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const pad = (high - low) * 0.15 || high * 0.05 || 1;
  const x = (iso: string) => (((Date.parse(iso) - start) / (end - start)) * 100).toFixed(2);
  const y = (eur: number) => (100 - ((eur - (low - pad)) / (high - low + 2 * pad)) * 100).toFixed(2);
  const line = points.map((p, i) => (i === 0 ? `M0 ${y(p.priceEur)}` : `H${x(p.seenAt)} V${y(p.priceEur)}`)).join(" ") + " H100";
  const label = `Preis von ${formatEuro(points[0].priceEur)} am ${formatDate(points[0].seenAt)} bis ${formatEuro(points.at(-1)!.priceEur)} am ${formatDate(points.at(-1)!.seenAt)}`;

  return (
    <figure className="mt-3">
      <div className="flex gap-2">
        <div className="flex w-16 shrink-0 flex-col justify-between text-right text-xs text-muted" aria-hidden="true">
          <span>{formatEuro(high)}</span>
          <span>{formatEuro(low)}</span>
        </div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label} className="h-28 min-w-0 flex-1 overflow-visible rounded-md border border-line">
          <path d={`${line} V100 H0 Z`} fill="var(--accent)" fillOpacity={0.12} stroke="none" />
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      </div>
      <figcaption className="ml-[4.5rem] mt-1 flex justify-between gap-2 text-xs text-muted">
        <span>{formatDate(points[0].seenAt)}</span>
        <span>{formatDate(endAt)}</span>
      </figcaption>
    </figure>
  );
}

/** Why a gone listing is no longer in the search and since when, and where the car is still offered. */
function GoneNotice({ listing }: { listing: ListingDetail }) {
  // The other offers are the active ones of the same vehicle, cheapest first.
  const cheaper = listing.otherOffers[0] ?? null;
  let heading: string;
  let text: string;
  switch (listing.goneReason) {
    case "checked":
      heading = `Nicht mehr online seit ${formatDate(listing.goneAt ?? listing.lastSeenAt)}`;
      text = `Laut ${listing.sourceName} verkauft oder gelöscht.`;
      break;
    case "filtered":
      heading = "Aus der Suche aussortiert";
      text = `Die Anzeige hat eine Prüfregel von AutoMeta nicht bestanden, etwa als Gesuch, Tausch gegen etwas anderes oder wegen eines Platzhalter- oder Tippfehlerpreises. Deshalb steht sie nicht mehr in der Suche.`;
      break;
    case "stale":
      heading = `Seit ${formatDate(listing.checkedAt)} nicht mehr bestätigt`;
      text = `AutoMeta konnte das Angebot bei ${listing.sourceName} länger nicht mehr prüfen, deshalb steht es nicht mehr in der Suche. Ob es noch online ist, zeigt der Link zur Anzeige.`;
      break;
    default:
      heading = `Nicht mehr online, zuletzt gesehen am ${formatDate(listing.lastSeenAt)}`;
      text = `Bei ${listing.sourceName} nicht mehr zu finden, wahrscheinlich verkauft.`;
  }
  return (
    <div className="mb-4 rounded-lg border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn-text">
      <p className="text-base font-semibold">{heading}</p>
      <p className="mt-1">
        {text} Preisverlauf, Marktwert und Modell-Akte bleiben hier zum Vergleich.
      </p>
      {cheaper && (
        <p className="mt-1">
          Dasselbe Fahrzeug gibt es noch bei{" "}
          <a href={`/go/${cheaper.id}`} target="_blank" rel="noopener nofollow" className="font-semibold underline">
            {cheaper.sourceName} für {formatPrice(cheaper.priceEur)}
          </a>
          .
        </p>
      )}
    </div>
  );
}

/** A note under the title when another portal offers this vehicle for less. */
function CheaperElsewhere({ listing }: { listing: ListingDetail }) {
  const { cheaper, savingEur } = compareOffers(listing.priceEur, listing.otherOffers);
  if (!cheaper || listing.status === "gone") return null;
  return (
    <p className="mt-4 rounded-md border border-line bg-accent-soft px-3 py-2 text-sm">
      Dieses Fahrzeug gibt es bei{" "}
      <a href={`/go/${cheaper.id}`} target="_blank" rel="noopener nofollow" className="font-semibold text-accent hover:underline">
        {cheaper.sourceName} für {formatPrice(cheaper.priceEur)}
      </a>
      , <span className="font-semibold text-good-text">{formatEuro(savingEur)} günstiger</span>.
    </p>
  );
}

/** Every portal that lists this vehicle, cheapest first, with the gap to the one shown. */
function AllOffers({ listing }: { listing: ListingDetail }) {
  const offers = [
    ...listing.otherOffers,
    ...(listing.status === "active" ? [{ id: listing.id, sourceName: listing.sourceName, priceEur: listing.priceEur }] : []),
  ].sort((a, b) => a.priceEur - b.priceEur || a.id - b.id);
  const lowest = offers[0].priceEur;
  return (
    <section className={sectionClass}>
      <h2 className={headingClass}>
        {listing.status === "active" ? `Dieses Fahrzeug auf ${offers.length} Börsen` : "Dieses Fahrzeug gibt es noch bei"}
      </h2>
      <ul className="mt-2 space-y-1">
        {offers.map((offer) => {
          const self = offer.id === listing.id;
          return (
            <li key={offer.id} className="flex items-center justify-between gap-4">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <a href={`/go/${offer.id}`} target="_blank" rel="noopener nofollow" className="font-medium text-accent hover:underline">
                  {offer.sourceName}
                </a>
                {self && <span className="text-xs text-muted">diese Anzeige</span>}
                {offer.priceEur === lowest && offers.some((o) => o.priceEur > lowest) && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-good-text">günstigster Preis</span>
                )}
              </span>
              <span className="shrink-0 text-right">
                <span className="font-medium">{formatPrice(offer.priceEur)}</span>
                {!self && listing.status === "active" && offer.priceEur !== listing.priceEur && (
                  <span className={offer.priceEur < listing.priceEur ? "ml-2 text-good-text" : "ml-2 text-muted"}>
                    {formatSignedPrice(offer.priceEur - listing.priceEur)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Erkannt an Marke, Modell, Erstzulassung, Kilometerstand, Preis und Standort. Bei Börsen ohne Standort muss der
        Kilometerstand auf den Kilometer gleich sein. Ein Treffer kann in seltenen Fällen ein anderes Fahrzeug sein.
      </p>
    </section>
  );
}
