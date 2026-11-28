import type { Metadata } from "next";
import Link from "next/link";
import { cache, Suspense } from "react";
import { DAMAGE_LABELS } from "@/core/damage";
import { isTooCheap, MARKET_CONFIDENCE_LABELS } from "@/core/deal";
import { coveredComponents, hiddenDefectRisk, type DefectProfile } from "@/core/defects";
import { kwToPs } from "@/core/normalize";
import { onlineSpan, priceStory, type OnlineSpan, type PricePoint } from "@/core/price-history";
import type { FlipSettings } from "@/core/flip";
import { CONFIDENCE_LABELS, DIFFICULTY_LABELS, estimateRepairs, VEHICLE_CLASS_LABELS } from "@/core/repairs";
import { findMake, findModel } from "@/core/taxonomy";
import { BODY_TYPE_LABELS, FUEL_LABELS, SELLER_TYPE_LABELS, TRANSMISSION_LABELS } from "@/core/types";
import { listingVerdict, VERDICT_LABELS, VERDICT_RULES, type VerdictReason } from "@/core/verdict";
import { FavoriteButton } from "@/components/favorite-button";
import { FlipCalculator } from "@/components/flip-calculator";
import { Fold, HowItWorks } from "@/components/fold";
import { ListingPhoto } from "@/components/listing-photo";
import { ModelFileSection } from "@/components/model-file";
import { Chip, sentenceCase, VERDICT_STYLE, VerdictIcon, WrenchIcon } from "@/components/verdict-ui";
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

/** Each part of the page is its own card, so the eye finds one topic per box. */
const cardClass = "mt-4 rounded-xl border border-line bg-surface p-4 text-sm sm:p-6";
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
  const damaged = listing.damage.length > 0;
  // The market value of a damaged car is that of an intact one, so its gap says nothing about the price.
  const gap = !damaged ? formatMarketGap(listing.priceEur, listing.marketPriceEur) : null;
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
            {damaged && (
              <ul className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Schadenshinweise im Titel">
                {listing.damage.map((kind) => (
                  <li key={kind}>
                    <Chip tone="warn" mark={<WrenchIcon />} title="Aus dem Anzeigentitel erkannt. Was genau kaputt ist, steht in der Originalanzeige.">
                      {DAMAGE_LABELS[kind]}
                    </Chip>
                  </li>
                ))}
                <li className="text-xs text-muted">laut Anzeigentitel</li>
              </ul>
            )}
            <Actions listing={listing} saved={favorites.has(listing.id)} />
          </div>
        </div>
        <CheaperElsewhere listing={listing} />
      </article>
      {!gone && <WorthALook listing={listing} settings={settings} file={file} />}
      <Facts listing={listing} />
      <Market listing={listing} />
      {/* For a damaged car the flip estimate is the point; for an intact one it is a calculator for the curious, at the end. */}
      {damaged && <Flip listing={listing} settings={settings} file={file} />}
      <PriceHistory listing={listing} />
      {listing.otherOffers.length > 0 && <AllOffers listing={listing} />}
      <ModelFileFor listing={listing} file={file} />
      {!damaged && <Flip listing={listing} settings={settings} file={file} />}
      {!gone && (
        // The way out once more at the end of a long page; the heart stays at the top.
        <div className="mt-4">
          <OriginalLink listing={listing} className={`${primaryButton} w-full sm:w-auto`} />
        </div>
      )}
    </div>
  );
}

/** "bis 09/2027 (erste HU 3 Jahre nach Erstzulassung)" -> the value, and its source as a small note under it. */
function splitNote(value: string): [string, string | null] {
  const match = /^(.*?) \((.+)\)$/.exec(value);
  return match ? [match[1], match[2]] : [value, null];
}

/** The plain facts in two groups: the car itself, and the listing (where, who, since when). */
function Facts({ listing }: { listing: ListingDetail }) {
  const online = onlineSpan({ listedOn: listing.listedOn, firstSeenAt: listing.firstSeenAt, endedAt: endedAt(listing), asOf: listing.asOf });
  const groups: { title: string; rows: [string, string | null][] }[] = [
    {
      title: "Fahrzeug",
      rows: [
        ["Erstzulassung", formatRegistration(listing.firstRegistration, listing.firstRegistrationYearOnly).replace("EZ ", "")],
        ["Kilometerstand", formatKm(listing.mileageKm)],
        // PS first, the kW as the small note under it.
        ["Leistung", listing.powerKw === null ? null : `${kwToPs(listing.powerKw)} PS (${listing.powerKw} kW)`],
        ["Kraftstoff", listing.fuel ? FUEL_LABELS[listing.fuel] : null],
        ["Getriebe", listing.transmission ? TRANSMISSION_LABELS[listing.transmission] : null],
        ["HU/TÜV", formatInspection(listing.huUntil, listing.huBasis)],
        ["Fahrzeugtyp", listing.bodyType ? BODY_TYPE_LABELS[listing.bodyType] : null],
        ["Farbe", listing.color],
      ],
    },
    {
      title: "Angebot",
      rows: [
        ["Standort", [listing.zip, listing.city].filter(Boolean).join(" ") || null],
        ["Anbieter", listing.sellerName ?? (listing.sellerType ? SELLER_TYPE_LABELS[listing.sellerType] : null)],
        ["Börse", listing.sourceName],
        ["Online", formatOnline(online, listing.sourceName)],
        ["Zuletzt geprüft", formatDayTime(listing.checkedAt)],
      ],
    },
  ];
  return (
    <section className={`${cardClass} grid gap-x-8 gap-y-5 sm:grid-cols-2`} aria-label="Fahrzeugdaten">
      {groups.map((group) => (
        <div key={group.title}>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{group.title}</h2>
          <dl>
            {group.rows
              .filter((row): row is [string, string] => Boolean(row[1]))
              .map(([label, value]) => {
                const [main, note] = splitNote(value);
                return (
                  <div key={label} className="flex justify-between gap-4 border-b border-line py-2 last:border-0">
                    <dt className="shrink-0 text-muted">{label}</dt>
                    <dd className="min-w-0 text-right [overflow-wrap:anywhere]">
                      <span className="font-medium">{main}</span>
                      {note && <span className="block text-xs text-muted">{note}</span>}
                    </dd>
                  </div>
                );
              })}
          </dl>
        </div>
      ))}
    </section>
  );
}

/** How often the model at this age had HU defects compared with all cars of its age (Modell-Akte), as the recommendation sort uses it. */
function reliabilityRatio(file: ModelFile | null): number | null {
  if (!file?.profile || !file.average || file.profile.sample === 0 || file.average.sample === 0 || file.average.anyDefect === 0) return null;
  return file.profile.anyDefect / file.profile.sample / (file.average.anyDefect / file.average.sample);
}

/**
 * "Lohnt sich?": the verdict (src/core/verdict.ts) as a tinted panel: the verdict, its deciding
 * reason, then what speaks for and against it side by side. How the verdict is made folds away.
 */
function WorthALook({ listing, settings, file }: { listing: ListingDetail; settings: FlipSettings; file: ModelFile | null }) {
  const verdict = listingVerdict({ ...listing, reliabilityRatio: reliabilityRatio(file) }, settings, new Date(listing.checkedAt));
  const style = VERDICT_STYLE[verdict.verdict];
  const [lead, ...rest] = verdict.reasons;
  const pros = rest.filter((reason) => reason.tone === "plus");
  const cons = rest.filter((reason) => reason.tone === "minus");
  const infos = rest.filter((reason) => reason.tone === "info");
  return (
    <section className={`mt-4 rounded-xl border p-4 text-sm sm:p-6 ${style.panel}`} aria-labelledby="verdict-heading">
      <h2 id="verdict-heading" className="text-xs font-semibold uppercase tracking-wide text-muted">
        Lohnt sich?
      </h2>
      <p className={`mt-1 flex items-center gap-2 text-lg font-bold ${style.text}`}>
        <VerdictIcon verdict={verdict.verdict} className="h-5 w-5" />
        {VERDICT_LABELS[verdict.verdict]}
      </p>
      {lead && <p className="mt-0.5 text-base">{sentenceCase(lead.text)}</p>}
      {(pros.length > 0 || cons.length > 0) && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {pros.length > 0 && <ReasonList title="Spricht dafür" mark="+" className="text-good-text" reasons={pros} />}
          {cons.length > 0 && <ReasonList title="Spricht dagegen" mark="−" className="text-warn-text" reasons={cons} />}
        </div>
      )}
      {infos.length > 0 && <p className="mt-3 text-muted">Gut zu wissen: {infos.map((reason) => reason.text).join(", ")}</p>}
      <HowItWorks label="Wie entsteht das Urteil?">
        <p>
          Aus Preis gegen Marktwert, Schadenshinweisen, Flip-Rechnung, HU, Modell-Akte und wie lange das Angebot schon online ist. Es ersetzt
          keine Besichtigung und Probefahrt.
        </p>
        <ul className="space-y-0.5">
          <li>
            <span className="font-medium">{VERDICT_LABELS.anschauen}:</span> ohne Schadenshinweis, mindestens {VERDICT_RULES.goodDealPct} % unter
            einem verlässlichen Marktwert, HU nicht abgelaufen.
          </li>
          <li>
            <span className="font-medium">{VERDICT_LABELS.schrauber}:</span> Schaden genannt, und die Flip-Rechnung erreicht deine Mindestmarge bei
            deinem Level (<Link href="/einstellungen" className="text-accent hover:underline">Einstellungen</Link>).
          </li>
          <li>
            <span className="font-medium">{VERDICT_LABELS.fair}:</span> höchstens {VERDICT_RULES.overpricedPct} % neben dem Marktwert.
          </li>
          <li>
            <span className="font-medium">{VERDICT_LABELS.eher_nicht}:</span> deutlich über Marktwert, auffällig billig, oder eine Reparatur, die zu
            schwer ist oder die Marge frisst.
          </li>
          <li>
            <span className="font-medium">{VERDICT_LABELS.unklar}:</span> kein Marktwert oder einer, dem zu wenige ähnliche Angebote zugrunde liegen.
          </li>
        </ul>
      </HowItWorks>
    </section>
  );
}

function ReasonList({ title, mark, className, reasons }: { title: string; mark: string; className: string; reasons: VerdictReason[] }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <h3 className={`text-xs font-semibold ${className}`}>{title}</h3>
      <ul className="mt-1 space-y-0.5">
        {reasons.map((reason, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true" className={`w-3 shrink-0 text-center font-bold ${className}`}>
              {mark}
            </span>
            <span>{sentenceCase(reason.text)}</span>
          </li>
        ))}
      </ul>
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

/**
 * The market value: the number, where this price sits on the usual range (a scale), how far the
 * value can be trusted, and how it is worked out (folded).
 */
function Market({ listing }: { listing: ListingDetail }) {
  const damaged = listing.damage.length > 0;
  const gap = formatMarketGap(listing.priceEur, listing.marketPriceEur);
  const comparables = comparablesQuery(listing);
  const tooCheap = isTooCheap(listing);
  const trusted = listing.marketConfidence === "high" || listing.marketConfidence === "medium";
  const method = (
    <p>
      Verglichen mit Angeboten ohne Schadenshinweis: gleiches Modell, Erstzulassung ±{MARKET_RULES.yearSpan} Jahr, ähnlicher Kilometerstand,
      gleicher Kraftstoff, gleiches Getriebe und ähnliche Leistung. Der Marktwert ist der mittlere Preis dieser Angebote. Es sind
      Angebotspreise, keine Verkaufspreise.
    </p>
  );

  return (
    <section className={cardClass} aria-labelledby="market-heading">
      <h2 id="market-heading" className={headingClass}>
        {damaged ? "Marktwert in intaktem Zustand" : "Marktwert"}
      </h2>
      {listing.marketPriceEur !== null && gap ? (
        <>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-2xl font-bold">ca. {formatEuro(listing.marketPriceEur)}</p>
            <p className={gap.below && !damaged && !tooCheap && trusted ? "font-medium text-good-text" : "text-muted"}>
              Dieses Angebot: {gap.text}
            </p>
          </div>
          {listing.marketLowEur !== null && listing.marketHighEur !== null && (
            <PriceScale
              priceEur={listing.priceEur}
              marketEur={listing.marketPriceEur}
              lowEur={listing.marketLowEur}
              highEur={listing.marketHighEur}
              tone={damaged ? "muted" : tooCheap ? "warn" : gap.below && trusted ? "good" : "plain"}
            />
          )}
          {tooCheap && (
            <p className="mt-3 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-sm font-medium text-warn-text">{TOO_CHEAP_WARNING}</p>
          )}
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Wie verlässlich der Marktwert ist">
            {listing.marketConfidence && (
              <li>
                <Chip
                  tone={listing.marketConfidence === "low" ? "warn" : listing.marketConfidence === "high" ? "good" : "neutral"}
                  mark={null}
                  title={listing.marketConfidence === "low" ? unsureMarketReason(listing.marketComps) : undefined}
                >
                  Verlässlichkeit: {MARKET_CONFIDENCE_LABELS[listing.marketConfidence]}
                </Chip>
              </li>
            )}
            {listing.marketComps !== null && (
              <li>
                <Chip mark={null}>{formatNumber(listing.marketComps)} Vergleichsangebote</Chip>
              </li>
            )}
            {listing.marketDays !== null && (
              <li>
                <Chip mark={null} title="So lange waren vergleichbare Angebote im Mittel online, bevor sie verschwanden">
                  Vergleichbare im Schnitt {formatDays(listing.marketDays)} online
                </Chip>
              </li>
            )}
          </ul>
          {listing.marketConfidence === "low" && <p className="mt-2 text-muted">Unsicher, weil: {unsureMarketReason(listing.marketComps)}.</p>}
          <div className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <HowItWorks label="Wie wird der Marktwert berechnet?" className="">
              {method}
              {listing.marketLowEur !== null && listing.marketHighEur !== null && (
                <p>
                  Übliche Spanne {formatEuro(listing.marketLowEur)} bis {formatEuro(listing.marketHighEur)}: die mittlere Hälfte der{" "}
                  {formatNumber(listing.marketComps ?? 0)} vergleichbaren Angebote. Verlässlich heißt mindestens 20 Vergleichsangebote mit nicht zu
                  weit gestreuten Preisen, brauchbar mindestens 10.
                </p>
              )}
            </HowItWorks>
            {comparables && (
              <Link href={comparables} className="text-accent hover:underline">
                Vergleichbare Angebote ansehen →
              </Link>
            )}
          </div>
        </>
      ) : (
        <p className="mt-1 text-muted">
          {comparables
            ? `Zu wenige vergleichbare Angebote für einen Marktwert (mindestens ${MARKET_RULES.minComps} nötig).`
            : "Ohne Modell, Erstzulassung und Kilometerstand lässt sich kein Marktwert berechnen."}
        </p>
      )}
    </section>
  );
}

const SCALE_TONES = { good: "bg-good-text", warn: "bg-warn-text", plain: "bg-foreground", muted: "bg-muted" } as const;

/**
 * Where the price sits: a bar with the usual range of comparable listings (their middle half),
 * the market value as a line in it and this listing's price as a dot, both labeled.
 */
function PriceScale({
  priceEur,
  marketEur,
  lowEur,
  highEur,
  tone,
}: {
  priceEur: number;
  marketEur: number;
  lowEur: number;
  highEur: number;
  tone: keyof typeof SCALE_TONES;
}) {
  const lo = Math.min(lowEur, priceEur, marketEur);
  const hi = Math.max(highEur, priceEur, marketEur);
  const pad = (hi - lo) * 0.12 || hi * 0.1 || 1;
  const at = (eur: number) => ((eur - (lo - pad)) / (hi - lo + 2 * pad)) * 100;
  // A label slides along its mark: left-aligned at the left end, centered in the middle, right-aligned
  // at the right end, so it never sticks out of the bar on a phone.
  const label = (eur: number) => ({ left: `${at(eur)}%`, transform: `translateX(-${at(eur)}%)` });
  return (
    <figure className="mt-4" aria-label={`Preis ${formatEuro(priceEur)}, Marktwert ca. ${formatEuro(marketEur)}, übliche Spanne ${formatEuro(lowEur)} bis ${formatEuro(highEur)}`}>
      <div className="relative h-5 text-xs text-muted" aria-hidden="true">
        <span className="absolute whitespace-nowrap" style={label(marketEur)}>
          Marktwert
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-background ring-1 ring-line" aria-hidden="true">
        <div className="absolute inset-y-0 rounded-full bg-accent-soft ring-1 ring-accent/30" style={{ left: `${at(lowEur)}%`, width: `${at(highEur) - at(lowEur)}%` }} />
        <div className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded bg-accent" style={{ left: `${at(marketEur)}%` }} />
        <div
          className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow ${SCALE_TONES[tone]}`}
          style={{ left: `${at(priceEur)}%` }}
        />
      </div>
      <div className="relative mt-1.5 h-5 text-xs" aria-hidden="true">
        <span className="absolute whitespace-nowrap font-semibold" style={label(priceEur)}>
          Dieses Angebot {formatEuro(priceEur)}
        </span>
      </div>
      <figcaption className="mt-1 flex items-center gap-1.5 text-xs text-muted">
        <span className="inline-block h-2.5 w-5 rounded-full bg-accent-soft ring-1 ring-accent/30" aria-hidden="true" />
        Übliche Spanne {formatEuro(lowEur)} bis {formatEuro(highEur)}
      </figcaption>
    </figure>
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
  return <ModelFileSection makeName={make.name} modelName={model.name} file={file} jobs={estimate.jobs.map((j) => j.job)} risk={risk} className={cardClass} />;
}

/** "ca. 25 Stunden": the hours are estimates, so whole hours from 10 on and half hours below. */
function formatHours(hours: number): string {
  const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 2) / 2;
  return `ca. ${formatNumber(rounded)} ${rounded === 1 ? "Stunde" : "Stunden"}`;
}

/** The stored flip estimate as four numbers at a glance, the same the search list shows, and the rest in one sentence. */
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
  const tiles: { label: string; value: string; className?: string; note?: string }[] = [
    { label: "Marge", value: formatSignedPrice(flip.marginEur), className: marginClass },
    { label: "Pro Stunde", value: flip.perHourEur !== null && flip.marginEur > 0 ? `ca. ${formatEuro(flip.perHourEur)}` : "–" },
    { label: "Arbeit", value: formatHours(flip.hours) },
    { label: "Schwierigkeit", value: `${repair.difficulty} von 5`, note: DIFFICULTY_LABELS[repair.difficulty] },
  ];
  return (
    <div data-flip-summary className="mt-2">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg bg-background px-3 py-2">
            <dt className="text-xs text-muted">{tile.label}</dt>
            <dd className={`text-lg font-bold ${tile.className ?? ""}`}>{tile.value}</dd>
            {tile.note && <dd className="text-xs leading-snug text-muted">{tile.note}</dd>}
          </div>
        ))}
      </dl>
      <p className="mt-2 text-muted">
        Je nach Teilen {formatSignedPrice(flip.marginRangeEur[0])} bis {formatSignedPrice(flip.marginRangeEur[1])}.
        {risk > 0 && <> Der Risikopuffer von {formatEuro(risk)} ist schon abgezogen.</>} Sicherheit der Schätzung{" "}
        {CONFIDENCE_LABELS[repair.confidence]}, Teilepreise für {VEHICLE_CLASS_LABELS[repair.vehicleClass]}.
      </p>
    </div>
  );
}

/**
 * The flip estimate from the catalog and the calculator to adjust it. For a damaged car the
 * estimate shows and the calculator folds away; for intact cars and listings that are gone the
 * whole thing folds away, it is only for comparison there.
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
    <HowItWorks label="Woher kommen Teile, Stunden und Risikopuffer?">
      <p>
        Teile und Stunden sind Schätzungen aus dem <Link href="/reparaturen" className="text-accent hover:underline">Reparaturkatalog</Link> für
        einen Hobbyschrauber. Der Risikopuffer rechnet mit Mängeln, die die HU bei solchen Autos oft findet, und mit einem schlimmeren Schaden,
        wenn der Preis weit unter dem Marktwert liegt. Abschlag und Nebenkosten kommen aus deinen{" "}
        <Link href="/einstellungen" className="text-accent hover:underline">Einstellungen</Link>.
      </p>
    </HowItWorks>
  );

  if (!damaged || gone) {
    return (
      <Fold className={cardClass} title={damaged ? "Flip-Bewertung" : "Flip-Rechner"} aside={gone ? "nur zum Vergleich" : "selbst durchrechnen, falls du flippen willst"}>
        {damaged && <FlipSummary listing={listing} settings={settings} />}
        {calculator}
        {note}
      </Fold>
    );
  }

  return (
    <section className={cardClass} aria-labelledby="flip-heading">
      <h2 id="flip-heading" className={headingClass}>
        Flip-Bewertung
      </h2>
      <FlipSummary listing={listing} settings={settings} />
      <Fold className="mt-4 border-t border-line pt-3" title="Selbst nachrechnen" aside="jeder Wert lässt sich ändern">
        {calculator}
      </Fold>
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
    <section className={cardClass}>
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
      <HowItWorks label="Wie genau ist der Verlauf?">
        <p>
          Preise, wie AutoMeta sie bei {listing.sourceName} gesehen hat. Jedes Angebot wird etwa einmal am Tag geprüft; eine Änderung, die
          innerhalb eines Tages wieder zurückgenommen wurde, kann fehlen.
        </p>
      </HowItWorks>
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
    <section className={cardClass}>
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
      <HowItWorks label="Wie erkennt AutoMeta dasselbe Auto?">
        <p>
          An Marke, Modell, Erstzulassung, Kilometerstand, Preis und Standort. Bei Börsen ohne Standort muss der Kilometerstand auf den
          Kilometer gleich sein. Ein Treffer kann in seltenen Fällen ein anderes Fahrzeug sein.
        </p>
      </HowItWorks>
    </section>
  );
}
