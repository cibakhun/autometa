"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { BODY_TYPE_LABELS, BODY_TYPES, FUEL_LABELS, FUELS, SELLER_TYPE_LABELS, SELLER_TYPES, TRANSMISSION_LABELS, TRANSMISSIONS } from "@/core/types";
import { DEAL_FILTER_LABELS, DEAL_FILTERS } from "@/core/deal";
import { VERDICT_FILTER_LABELS, VERDICT_FILTERS, VERDICT_RULES } from "@/core/verdict";
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
import { Chevron, InfoIcon } from "./fold";
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

        <Group title="Bewertung durch AutoMeta">
          <div>
            <FieldLabel htmlFor="urteil" name="Urteil" hint={`Anschauen: ohne Schaden, mind. ${VERDICT_RULES.goodDealPct} % unter einem verlässlichen Marktwert, HU nicht abgelaufen. Schrauber: Schaden genannt, die Flip-Rechnung erreicht deine Mindestmarge bei deinem Level (Einstellungen).`} />
            <select id="urteil" name="urteil" defaultValue={filters.urteil ?? ""} aria-describedby="urteil-hint" className={fieldClass}>
              <option value="">Beliebig</option>
              {VERDICT_FILTERS.map((v) => <option key={v} value={v}>{VERDICT_FILTER_LABELS[v]}</option>)}
            </select>
          </div>

          <div>
            <FieldLabel htmlFor="deal" name="Schnäppchen" hint="Nur Autos ohne Schadenshinweis, deren Marktwert auf genug ähnlichen Angeboten beruht. Über 50 % darunter zählt nicht: Da steckt fast immer etwas dahinter." />
            <select id="deal" name="deal" defaultValue={filters.deal ?? ""} aria-describedby="deal-hint" className={fieldClass}>
              <option value="">Beliebig</option>
              {DEAL_FILTERS.map((d) => <option key={d} value={d}>{DEAL_FILTER_LABELS[d]}</option>)}
            </select>
          </div>

          <div>
            <FieldLabel htmlFor="gesenkt" name="Preis gesenkt" hint="Nur Angebote, deren Preis zuletzt gesunken ist, seit AutoMeta sie kennt." />
            <select id="gesenkt" name="gesenkt" defaultValue={filters.gesenkt ?? ""} aria-describedby="gesenkt-hint" className={fieldClass}>
              <option value="">Beliebig</option>
              {PRICE_DROP_FILTERS.map((d) => <option key={d} value={d}>{PRICE_DROP_FILTER_LABELS[d]}</option>)}
            </select>
          </div>

          <div>
            <FieldLabel htmlFor="zustand" name="Zustand laut Titel" hint="Erkennt Hinweise wie „Motorschaden“, „springt nicht an“ oder „Bastler“ im Anzeigentitel." />
            <select id="zustand" name="zustand" defaultValue={filters.zustand ?? ""} aria-describedby="zustand-hint" className={fieldClass}>
              <option value="">Beliebig</option>
              {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
            </select>
          </div>
        </Group>

        <Group title="Fahrzeug">
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

          <CheckGroup
            legend="Kraftstoff"
            name="fuel"
            options={FUELS.map((fuel) => ({ value: fuel, label: FUEL_LABELS[fuel] }))}
            selected={filters.fuel}
          />
          <CheckGroup
            legend="Fahrzeugtyp"
            name="body"
            options={BODY_TYPES.map((body) => ({ value: body, label: BODY_TYPE_LABELS[body] }))}
            selected={filters.body}
          />

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
            <FieldLabel htmlFor="hu" name="TÜV/HU" hint="Zählt nur Angebote, deren Titel die HU nennt („TÜV 05/2027“, „TÜV neu“), und Autos unter 3 Jahren." />
            <select id="hu" name="hu" defaultValue={filters.hu ?? ""} aria-describedby="hu-hint" className={fieldClass}>
              <option value="">Beliebig</option>
              {HU_FILTERS.map((h) => <option key={h} value={h}>{HU_FILTER_LABELS[h]}</option>)}
            </select>
          </div>
        </Group>

        {/* For people who repair cars themselves; folded away unless one of its filters is set. */}
        <details open={filters.schwierigkeit !== undefined || filters.margeMin !== undefined} className="border-t border-line pt-3">
          <summary className="fold flex cursor-pointer select-none items-center justify-between gap-2 text-sm font-semibold hover:text-accent">
            Für Schrauber (Flip)
            <Chevron />
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <FieldLabel
                htmlFor="schwierigkeit"
                name="Schwierigkeit bis"
                hintId="flip-hint"
                hint={`Nur Angebote mit Schadenshinweis haben eine Reparaturschätzung. Schwierigkeit 1: ${DIFFICULTY_LABELS[1]}, 5: ${DIFFICULTY_LABELS[5]}.`}
              />
              <select id="schwierigkeit" name="schwierigkeit" defaultValue={filters.schwierigkeit ?? ""} aria-describedby="flip-hint" className={fieldClass}>
                <option value="">Beliebig</option>
                {DIFFICULTIES.map((d) => <option key={d} value={d} title={DIFFICULTY_LABELS[d]}>{d} von 5</option>)}
              </select>
            </div>
            <div className="self-end">
              <label htmlFor="margeMin" className={labelClass}>Flip-Marge ab (€)</label>
              <input id="margeMin" name="margeMin" type="number" step={1} inputMode="numeric" defaultValue={filters.margeMin} aria-describedby="flip-hint" className={fieldClass} />
            </div>
          </div>
        </details>

        <Group title="Ort und Börsen">
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

          {sources.length > 1 && (
            <CheckGroup
              legend="Börsen"
              name="source"
              columns={1}
              options={sources.map((source) => ({ value: source.id, label: source.name, count: source.count }))}
              selected={filters.source}
            />
          )}
        </Group>

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

/** A heading over a few related filters, so the long form reads as a handful of topics. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-line pt-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/**
 * A field label with an (i) button that shows what the filter does. The text stays the field's
 * description for screen readers either way (aria-describedby on the field, `${htmlFor}-hint`).
 */
function FieldLabel({ htmlFor, name, hint, hintId = `${htmlFor}-hint` }: { htmlFor: string; name: string; hint: string; hintId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mb-1 flex items-center gap-1">
        <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
          {name}
        </label>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={hintId}
          aria-label={`Was bedeutet „${name}“?`}
          title={open ? "Erklärung ausblenden" : "Erklärung anzeigen"}
          className={`-m-1 rounded-full p-1 hover:text-accent ${open ? "text-accent" : "text-muted"}`}
        >
          <InfoIcon />
        </button>
      </div>
      <p id={hintId} hidden={!open} className="mb-1.5 rounded-md bg-background px-2 py-1.5 text-xs text-muted">
        {hint}
      </p>
    </>
  );
}

/**
 * A list of checkboxes folded into one line ("Kraftstoff: Alle" / "Kraftstoff: Diesel, Benzin")
 * that opens on a tap; open from the start when something is chosen. Folded boxes still count:
 * they stay in the form.
 */
function CheckGroup({
  legend,
  name,
  options,
  selected,
  columns = 2,
}: {
  legend: string;
  name: string;
  options: { value: string; label: string; count?: number }[];
  selected: readonly string[];
  columns?: 1 | 2;
}) {
  const [chosen, setChosen] = useState<string[]>(() => options.filter((o) => selected.includes(o.value)).map((o) => o.value));
  const summary = chosen.length === 0 ? "Alle" : options.filter((o) => chosen.includes(o.value)).map((o) => o.label).join(", ");
  return (
    <details open={selected.length > 0}>
      <summary className="fold flex cursor-pointer select-none items-center justify-between gap-2 rounded-md border border-line px-2.5 py-1.5 text-sm hover:border-accent">
        <span className="min-w-0 truncate">
          <span className="text-xs font-medium text-muted">{legend}: </span>
          <span className={chosen.length > 0 ? "font-medium" : ""}>{summary}</span>
        </span>
        <Chevron />
      </summary>
      <fieldset className={`mt-2 grid gap-x-2 gap-y-1 px-1 ${columns === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        <legend className="sr-only">{legend}</legend>
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={name}
              value={option.value}
              defaultChecked={selected.includes(option.value)}
              onChange={(event) =>
                setChosen((current) => (event.target.checked ? [...current, option.value] : current.filter((value) => value !== option.value)))
              }
              className="accent-accent"
            />
            {option.label}
            {option.count !== undefined && <span className="text-muted">({nf.format(option.count)})</span>}
          </label>
        ))}
      </fieldset>
    </details>
  );
}
