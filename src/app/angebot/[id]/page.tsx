import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DAMAGE_LABELS } from "@/core/damage";
import { coveredComponents, hiddenDefectRisk, type DefectProfile } from "@/core/defects";
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
} from "@/lib/format";
import { currentDevice } from "@/lib/profile";
import { favoriteIds } from "@/profiles/favorites";
import { getModelFile, type ModelFile } from "@/search/defects";
import { getListing, riskTotal, type ListingDetail } from "@/search/query";

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
  const [settings, device] = await Promise.all([getFlipSettings(), currentDevice()]);
  const pool = getPool();
  const listing = await getListing(pool, Number(id), settings);
  if (!listing) notFound();
  const [file, favorites] = await Promise.all([
    getModelFile(pool, listing.makeSlug, listing.modelSlug, listing.firstRegistration),
    favoriteIds(pool, device?.profileId ?? null, [listing.id]),
  ]);

  const rows: [string, string | null][] = [
    ["Preis", formatPrice(listing.priceEur)],
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
    ["Zuletzt geprüft", formatDayTime(listing.checkedAt)],
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/" className="text-sm text-accent hover:underline">
        ← Zurück zur Suche
      </Link>
      <article className="mt-3 rounded-xl border border-line bg-surface p-6">
        {listing.status === "gone" && (
          <p className="mb-4 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn-text">
            {goneNotice(listing)}
          </p>
        )}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          {/* The portal's small list photo; more photos are in the original listing. */}
          <ListingPhoto src={listing.imageUrl} alt={listing.title} className="aspect-[4/3] w-full shrink-0 rounded-lg sm:w-72" />
          <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-4">
            <h1 className="min-w-0 text-2xl font-bold leading-tight [overflow-wrap:anywhere]">{listing.title}</h1>
            <div className="text-right">
              <p className="text-2xl font-bold">{formatPrice(listing.priceEur)}</p>
              {listing.priceDroppedAt && listing.priceBeforeDropEur !== null && (
                <p className="text-sm font-medium text-good-text">
                  gesenkt am {formatDayTime(listing.priceDroppedAt)}, vorher <s>{formatPrice(listing.priceBeforeDropEur)}</s>
                </p>
              )}
            </div>
          </div>
        </div>
        <CheaperElsewhere listing={listing} />
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
        <ConditionAndMarket listing={listing} />
        <Flip listing={listing} settings={settings} file={file} />
        <ModelFileFor listing={listing} file={file} />
        <PriceHistory listing={listing} />
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a
            href={`/go/${listing.id}`}
            target="_blank"
            rel="noopener nofollow"
            className="rounded-md bg-accent px-4 py-2 font-semibold text-on-accent hover:bg-accent-strong"
          >
            Zum Angebot bei {listing.sourceName}
          </a>
          <FavoriteButton listingId={listing.id} initial={favorites.has(listing.id)} variant="inline" />
          <p className="text-xs text-muted">Weitere Fotos, Beschreibung und Kontakt findest du in der Originalanzeige.</p>
        </div>
        {listing.otherOffers.length > 0 && <AllOffers listing={listing} />}
      </article>
    </div>
  );
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
    <section className="mt-6 space-y-3 border-t border-line pt-4 text-sm">
      {damaged && (
        <div>
          <h2 className="font-semibold">Schadenshinweise im Titel</h2>
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
        <h2 className="font-semibold">{damaged ? "Marktwert in intaktem Zustand" : "Marktwert"}</h2>
        {listing.marketPriceEur !== null && gap ? (
          <>
            <p className="mt-1 text-xl font-bold">ca. {formatPrice(listing.marketPriceEur)}</p>
            <p className={gap.below ? "font-medium text-good-text" : "text-muted"}>Dieses Angebot: {gap.text}</p>
            {listing.marketLowEur !== null && listing.marketHighEur !== null && (
              <p className="mt-1">
                Übliche Spanne {formatPrice(listing.marketLowEur)} bis {formatPrice(listing.marketHighEur)}, die mittlere Hälfte von{" "}
                {formatNumber(listing.marketComps ?? 0)} vergleichbaren Angeboten.
              </p>
            )}
            {listing.marketDays !== null && (
              <p className="mt-1">Vergleichbare Angebote waren im Mittel {formatNumber(listing.marketDays)} Tage online.</p>
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

/** The flip estimate from the catalog and the calculator to adjust it; folded away for intact cars. */
function Flip({ listing, settings, file }: { listing: ListingDetail; settings: FlipSettings; file: ModelFile | null }) {
  const damaged = listing.damage.length > 0;
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

  if (!damaged) {
    return (
      <details className="mt-6 border-t border-line pt-4 text-sm">
        <summary className="cursor-pointer font-semibold">Flip-Rechner</summary>
        {calculator}
        {note}
      </details>
    );
  }

  const { flip, repair } = listing;
  return (
    <section className="mt-6 border-t border-line pt-4 text-sm">
      <h2 className="font-semibold">Flip-Bewertung</h2>
      {flip && repair ? (
        <p className="mt-1">
          Geschätzt{" "}
          <span className={`font-semibold ${flip.marginEur >= settings.minMarginEur ? "text-good-text" : flip.marginEur < 0 ? "text-warn-text" : ""}`}>
            {formatSignedPrice(flip.marginEur)}
          </span>{" "}
          Marge (je nach Teilen {formatSignedPrice(flip.marginRangeEur[0])} bis {formatSignedPrice(flip.marginRangeEur[1])}
          {riskTotal(repair) > 0 && <>, nach {formatEuro(riskTotal(repair))} Risikopuffer</>}), rund{" "}
          {formatNumber(flip.hours)} Stunden
          {flip.perHourEur !== null && flip.marginEur > 0 && <>, also ca. {formatEuro(flip.perHourEur)} pro Stunde</>}. Schwierigkeit{" "}
          {repair.difficulty} von 5 ({DIFFICULTY_LABELS[repair.difficulty]}), Sicherheit {CONFIDENCE_LABELS[repair.confidence]},{" "}
          {VEHICLE_CLASS_LABELS[repair.vehicleClass]}.
        </p>
      ) : (
        <p className="mt-1 text-muted">
          {listing.marketPriceEur === null
            ? "Ohne Marktwert keine Marge; im Rechner kannst du selbst einen eintragen."
            : "Die Reparaturschätzung für dieses Angebot wird beim nächsten Datenabgleich berechnet."}
        </p>
      )}
      {calculator}
      {note}
    </section>
  );
}

function PriceHistory({ listing }: { listing: ListingDetail }) {
  if (listing.priceHistory.length < 2) return null;
  const first = listing.priceHistory[0];
  const change = listing.priceEur - first.priceEur;
  return (
    <section className="mt-6 border-t border-line pt-4 text-sm">
      <h2 className="font-semibold">Preisverlauf</h2>
      <p className="mt-1 text-muted">
        {change < 0 ? `Um ${formatPrice(-change)} gesenkt` : change > 0 ? `Um ${formatPrice(change)} erhöht` : "Wieder beim ersten Preis"} seit{" "}
        {new Date(first.seenAt).toLocaleDateString("de-DE")}.
      </p>
      <ul className="mt-2 space-y-1">
        {listing.priceHistory.map((point) => (
          <li key={point.seenAt} className="flex justify-between gap-4">
            <span className="text-muted">{new Date(point.seenAt).toLocaleDateString("de-DE")}</span>
            <span className="font-medium">{formatPrice(point.priceEur)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Why a listing is no longer in the search, as far as we know. */
function goneNotice(listing: ListingDetail): string {
  switch (listing.goneReason) {
    case "checked":
      return `Dieses Angebot ist bei ${listing.sourceName} nicht mehr online.`;
    case "stale":
      return `Dieses Angebot konnten wir seit ${formatDayTime(listing.checkedAt)} nicht mehr bei ${listing.sourceName} bestätigen, deshalb steht es nicht mehr in der Suche. Ob es noch online ist, zeigt der Link zum Angebot.`;
    default:
      return `Dieses Angebot ist bei ${listing.sourceName} nicht mehr zu finden und wahrscheinlich verkauft.`;
  }
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
      , <span className="font-semibold text-good-text">{formatPrice(savingEur)} günstiger</span>.
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
    <section className="mt-6 border-t border-line pt-4">
      <h2 className="text-sm font-semibold">
        {listing.status === "active" ? `Dieses Fahrzeug auf ${offers.length} Börsen` : "Dieses Fahrzeug gibt es noch bei"}
      </h2>
      <ul className="mt-2 space-y-1 text-sm">
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
