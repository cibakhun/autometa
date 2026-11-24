"use client";

import { useState, type FormEvent } from "react";
import { BODY_TYPE_LABELS, BODY_TYPES, FUEL_LABELS, FUELS, SELLER_TYPE_LABELS, SELLER_TYPES, TRANSMISSION_LABELS, TRANSMISSIONS } from "@/core/types";
import { DIFFICULTY_LABELS, type Difficulty } from "@/core/repairs";
import type { SearchFilters } from "@/search/filters";
import {
  CONDITION_LABELS,
  CONDITIONS,
  HU_FILTER_LABELS,
  HU_FILTERS,
  PRICE_DROP_FILTER_LABELS,
  PRICE_DROP_FILTERS,
  RADII_KM,
  SORT_LABELS,
  SORTS,
} from "@/search/filters";
import type { MakeFacet, SourceFacet } from "@/search/query";
import { activeFilters, slugName } from "./active-filters";
import { SearchLink, Spinner, useSearchNavigation } from "./search-transition";

const KM_STEPS = [10_000, 25_000, 50_000, 75_000, 100_000, 150_000, 200_000];
/** The options plus a value from the URL that is not one of them (e.g. from "Vergleichbare Angebote"). */
const withCurrent = (options: number[], current: number | undefined, descending = false) =>
  current === undefined || options.includes(current)
    ? options
    : [...options, current].sort((a, b) => (descending ? b - a : a - b));
const PS_STEPS = [60, 75, 100, 125, 150, 200, 250, 300];
const CURRENT_YEAR = 2026;
/** Every year back to 1990, older cars (Bastler, classics) in coarser steps down to the parser's 1950. */
const YEARS = [...Array.from({ length: CURRENT_YEAR - 1990 + 1 }, (_, i) => CURRENT_YEAR - i), 1985, 1980, 1975, 1970, 1960, 1950];
const nf = new Intl.NumberFormat("de-DE");
const DIFFICULTIES = [1, 2, 3, 4, 5] as const satisfies readonly Difficulty[];

// 16px text on phones: iOS zooms into any smaller field on focus.
const fieldClass =
  "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 sm:text-sm";
const labelClass = "mb-1 block text-xs font-medium text-muted";

export function FilterForm({ facets, sources, filters }: { facets: MakeFacet[]; sources: SourceFacet[]; filters: SearchFilters }) {
  const { navigate, pendingOrigin } = useSearchNavigation();
  const searching = pendingOrigin === "form";
  const [make, setMake] = useState(filters.make ?? "");
  const [open, setOpen] = useState(false);
  const activeCount = activeFilters(filters).length;
  // A make or model from the URL without active listings (e.g. from an old saved search) stays
  // selectable, so the form shows the filter that is actually applied instead of "Alle".
  const makes =
    filters.make && !facets.some((f) => f.slug === filters.make)
      ? [...facets, { slug: filters.make, name: slugName(filters.make), count: 0, models: [] }]
      : facets;
  const knownModels = makes.find((f) => f.slug === make)?.models ?? [];
  const models =
    make === filters.make && filters.model && !knownModels.some((m) => m.slug === filters.model)
      ? [...knownModels, { slug: filters.model, name: slugName(filters.model), count: 0 }]
      : knownModels;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string" && value.trim() !== "") params.append(key, value.trim());
    }
    if (params.get("sort") === "newest") params.delete("sort");
    if (!params.get("zip")) params.delete("radius");
    const query = params.toString();
    navigate(query ? `/?${query}` : "/", "form");
  }

  return (
    <>
      {/* Phones: the long form stays folded away above the results until it is needed. */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="filters"
        className="flex w-full items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2.5 text-sm font-medium md:hidden"
      >
        <span className="inline-flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          {open ? "Filter ausblenden" : "Filter anzeigen"}
          {activeCount > 0 && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-on-accent">{activeCount} aktiv</span>
          )}
        </span>
        <svg viewBox="0 0 24 24" className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <form
        id="filters"
        action="/"
        method="get"
        onSubmit={onSubmit}
        className={`${open ? "mt-3 block" : "hidden"} space-y-4 rounded-xl border border-line bg-surface p-4 md:mt-0 md:block`}
      >
        <div>
          <label htmlFor="q" className={labelClass}>Suchbegriff</label>
          <input id="q" name="q" type="search" defaultValue={filters.q} placeholder="z. B. TDI, Kombi, GTI" className={fieldClass} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="make" className={labelClass}>Marke</label>
            <select id="make" name="make" value={make} onChange={(e) => setMake(e.target.value)} className={fieldClass}>
              <option value="">Alle</option>
              {makes.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.name} ({nf.format(f.count)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="model" className={labelClass}>Modell</label>
            <select
              id="model"
              name="model"
              key={make}
              defaultValue={make === filters.make ? filters.model : ""}
              disabled={!make}
              className={`${fieldClass} disabled:opacity-50`}
            >
              <option value="">Alle</option>
              {models.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.name} ({nf.format(m.count)})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="priceMin" className={labelClass}>Preis ab (€)</label>
            <input id="priceMin" name="priceMin" type="number" min={0} step={1} inputMode="numeric" defaultValue={filters.priceMin} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="priceMax" className={labelClass}>Preis bis (€)</label>
            <input id="priceMax" name="priceMax" type="number" min={0} step={1} inputMode="numeric" defaultValue={filters.priceMax} className={fieldClass} />
          </div>
        </div>

        <div>
          <label htmlFor="gesenkt" className={labelClass}>Preis gesenkt</label>
          <select id="gesenkt" name="gesenkt" defaultValue={filters.gesenkt ?? ""} aria-describedby="gesenkt-hint" className={fieldClass}>
            <option value="">Beliebig</option>
            {PRICE_DROP_FILTERS.map((d) => <option key={d} value={d}>{PRICE_DROP_FILTER_LABELS[d]}</option>)}
          </select>
          <p id="gesenkt-hint" className="mt-1 text-xs text-muted">Nur Angebote, deren Preis zuletzt gesunken ist, seit AutoMeta sie kennt.</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="yearMin" className={labelClass}>Erstzulassung ab</label>
            <select id="yearMin" name="yearMin" defaultValue={filters.yearMin ?? ""} className={fieldClass}>
              <option value="">Beliebig</option>
              {withCurrent(YEARS, filters.yearMin, true).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="yearMax" className={labelClass}>bis</label>
            <select id="yearMax" name="yearMax" defaultValue={filters.yearMax ?? ""} className={fieldClass}>
              <option value="">Beliebig</option>
              {withCurrent(YEARS, filters.yearMax, true).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="kmMax" className={labelClass}>Kilometer bis</label>
            <select id="kmMax" name="kmMax" defaultValue={filters.kmMax ?? ""} className={fieldClass}>
              <option value="">Beliebig</option>
              {withCurrent(KM_STEPS, filters.kmMax).map((km) => <option key={km} value={km}>{nf.format(km)} km</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="psMin" className={labelClass}>Leistung ab</label>
            <select id="psMin" name="psMin" defaultValue={filters.psMin ?? ""} className={fieldClass}>
              <option value="">Beliebig</option>
              {withCurrent(PS_STEPS, filters.psMin).map((ps) => <option key={ps} value={ps}>{ps} PS</option>)}
            </select>
          </div>
        </div>

        <fieldset>
          <legend className={labelClass}>Kraftstoff</legend>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {FUELS.map((fuel) => (
              <label key={fuel} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="fuel" value={fuel} defaultChecked={filters.fuel.includes(fuel)} className="accent-accent" />
                {FUEL_LABELS[fuel]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className={labelClass}>Fahrzeugtyp</legend>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {BODY_TYPES.map((body) => (
              <label key={body} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="body" value={body} defaultChecked={filters.body.includes(body)} className="accent-accent" />
                {BODY_TYPE_LABELS[body]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="transmission" className={labelClass}>Getriebe</label>
            <select id="transmission" name="transmission" defaultValue={filters.transmission ?? ""} className={fieldClass}>
              <option value="">Beliebig</option>
              {TRANSMISSIONS.map((t) => <option key={t} value={t}>{TRANSMISSION_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="seller" className={labelClass}>Anbieter</label>
            <select id="seller" name="seller" defaultValue={filters.seller ?? ""} className={fieldClass}>
              <option value="">Beliebig</option>
              {SELLER_TYPES.map((s) => <option key={s} value={s}>{SELLER_TYPE_LABELS[s]}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="zustand" className={labelClass}>Zustand laut Titel</label>
          <select id="zustand" name="zustand" defaultValue={filters.zustand ?? ""} aria-describedby="zustand-hint" className={fieldClass}>
            <option value="">Beliebig</option>
            {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
          </select>
          <p id="zustand-hint" className="mt-1 text-xs text-muted">
            Erkennt Hinweise wie „Motorschaden“, „springt nicht an“ oder „Bastler“ im Anzeigentitel.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="schwierigkeit" className={labelClass}>Schwierigkeit bis</label>
            <select id="schwierigkeit" name="schwierigkeit" defaultValue={filters.schwierigkeit ?? ""} aria-describedby="flip-hint" className={fieldClass}>
              <option value="">Beliebig</option>
              {DIFFICULTIES.map((d) => <option key={d} value={d} title={DIFFICULTY_LABELS[d]}>{d} von 5</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="margeMin" className={labelClass}>Flip-Marge ab (€)</label>
            <input id="margeMin" name="margeMin" type="number" step={1} inputMode="numeric" defaultValue={filters.margeMin} aria-describedby="flip-hint" className={fieldClass} />
          </div>
          <p id="flip-hint" className="col-span-2 text-xs text-muted">
            Nur Angebote mit Schadenshinweis haben eine Reparaturschätzung. Schwierigkeit 1: {DIFFICULTY_LABELS[1]}, 5: {DIFFICULTY_LABELS[5]}.
          </p>
        </div>

        <div>
          <label htmlFor="hu" className={labelClass}>TÜV/HU</label>
          <select id="hu" name="hu" defaultValue={filters.hu ?? ""} aria-describedby="hu-hint" className={fieldClass}>
            <option value="">Beliebig</option>
            {HU_FILTERS.map((h) => <option key={h} value={h}>{HU_FILTER_LABELS[h]}</option>)}
          </select>
          <p id="hu-hint" className="mt-1 text-xs text-muted">
            Zählt nur Angebote, deren Titel die HU nennt („TÜV 05/2027“, „TÜV neu“), und Autos unter 3 Jahren.
          </p>
        </div>

        {sources.length > 1 && (
          <fieldset>
            <legend className={labelClass}>Börsen</legend>
            <div className="grid grid-cols-1 gap-y-1">
              {sources.map((source) => (
                <label key={source.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="source" value={source.id} defaultChecked={filters.source.includes(source.id)} className="accent-accent" />
                  {source.name} <span className="text-muted">({nf.format(source.count)})</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="zip" className={labelClass}>PLZ</label>
            <input id="zip" name="zip" inputMode="numeric" pattern="\d{5}" maxLength={5} placeholder="z. B. 10115" defaultValue={filters.zip} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="radius" className={labelClass}>Umkreis</label>
            <select id="radius" name="radius" defaultValue={filters.radius ?? 50} className={fieldClass}>
              {RADII_KM.map((r) => <option key={r} value={r}>{r} km</option>)}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="sort" className={labelClass}>Sortierung</label>
          <select id="sort" name="sort" defaultValue={filters.sort} className={fieldClass}>
            {SORTS.map((s) => <option key={s} value={s}>{SORT_LABELS[s]}{s === "distance" ? " (mit PLZ)" : ""}</option>)}
          </select>
        </div>

        {/* Stays at the bottom of the screen while the long form scrolls by. */}
        <div className="sticky bottom-0 -mx-4 -mb-4 flex gap-2 rounded-b-xl border-t border-line bg-surface px-4 py-3">
          <button
            type="submit"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong"
          >
            {searching && <Spinner />}
            {searching ? "Sucht …" : "Suchen"}
          </button>
          <SearchLink href="/" className="rounded-md border border-line px-3 py-2 text-sm hover:border-accent">
            Zurücksetzen
          </SearchLink>
        </div>
      </form>
    </>
  );
}
